# MMYolo Training Structural Issues - Root Cause Analysis

## Problem Statement
MMYolo training was failing with various errors related to annotation format, configuration structure, and data handling. This document details the root causes and solutions.

---

## Root Cause #1: COCO JSON Validation Failures

### The Problem
MMYolo's dataset loader (`CocoDataset`) performs strict validation:
- Expects positive image dimensions (width, height > 0)
- Requires valid polygon coordinates (numeric, ≥3 points)
- Needs proper category_id mapping

### What Was Happening
```python
# Old code - produced invalid COCO JSON
coco_img = {
    "id": 123,
    "file_name": "image.jpg",
    "width": image.width or 0,    # ❌ Could be 0
    "height": image.height or 0,   # ❌ Could be 0
}

# Old code - crashed on empty arrays
raw = ann.segmentation
poly = raw[0]  # ❌ IndexError if raw is []
```

### MMYolo's Response
```
ValueError: Image dimensions must be positive
AssertionError: Invalid polygon format
```

### The Fix
```python
# Read actual dimensions from file
if not img_width or img_width <= 0:
    from PIL import Image as PILImage
    with PILImage.open(dst_path) as pil_img:
        img_width, img_height = pil_img.size

# Safe array access with validation
if isinstance(raw, list) and len(raw) > 0:
    poly = raw[0] if isinstance(raw[0], list) else raw
    if all(isinstance(coord, (int, float)) for coord in poly):
        seg_poly = [poly]
```

---

## Root Cause #2: Path Resolution Ambiguity

### The Problem
MMYolo config used ambiguous path structure:
```python
# Old config
train_dataloader = dict(
    dataset=dict(
        data_root='',                    # Empty string
        ann_file='relative/path/train.json',  # Relative
        data_prefix=dict(img='relative/images/'),  # Relative
    ),
)
```

### MMYolo's Interpretation
When `data_root=''`, MMYolo would:
1. Try to interpret relative paths from current working directory
2. Fall back to hardcoded `data/coco/` paths
3. Fail to find files → `FileNotFoundError`

### The Fix
Use absolute paths throughout:
```python
# New config - explicit absolute paths
train_dataloader = dict(
    dataset=dict(
        data_root='',
        ann_file='/app/projects/1/training/task_123/dataset/annotations/train.json',
        data_prefix=dict(img='/app/projects/1/training/task_123/dataset/images/train/'),
    ),
)
```

**Why This Works**: MMYolo's `CocoDataset` can handle absolute paths even when `data_root=''`. The loader uses `os.path.join(data_root, ann_file)` which correctly handles absolute paths.

---

## Root Cause #3: Silent Data Loss

### The Problem
Annotations were silently dropped during dataset preparation:
```python
# Old code
ann_class = db.query(AnnotationClass).filter(...).first()
if not ann_class:
    continue  # ❌ Silent skip, no logging
```

### Impact on Training
- Dataset appeared to prepare successfully
- Training used fewer samples than expected
- Model performance degraded without obvious cause
- No warning that data was missing

### The Fix
```python
# New code - explicit logging
if ann.category_id is None:
    logger.warning(f"Annotation {ann.id} has no category_id, skipping")
    continue

if not ann_class:
    logger.warning(
        f"No AnnotationClass found for annotation {ann.id} "
        f"(category_id={ann.category_id})"
    )
    continue
```

**Why This Matters**: Users now see exactly which annotations are being skipped and can fix the root cause in their data.

---

## Root Cause #4: DJI-Specific Requirements Not Enforced

### The Problem
DJI documentation specified strict requirements, but code didn't enforce them:

| Requirement | Old Behavior | Result |
|------------|--------------|--------|
| Config must be yolov8_s | User could select any | Wrong architecture |
| num_classes ≤ 10 | No validation | Quantization failure |
| widen_factor = 0.25 | Not applied | Calibration failure |
| MMYolo v0.6.0 | Version not checked | Compatibility issues |

### What Went Wrong
Users would:
1. Train model with wrong config
2. Send to DJI for quantization
3. DJI quantization fails
4. Have to restart entire training process

### The Fix
Automatic enforcement when `dji_patch_path` is provided:
```python
is_dji_mode = bool(dji_patch_path)
if is_dji_mode:
    # Force correct config
    if num_classes > 10:
        raise ValueError("DJI requires num_classes <= 10")
    
    config_id = "yolov8_s_syncbn_fast_8xb16-500e_coco"
    
    # Apply widen_factor override
    widen_factor_override = """
    model = dict(
        backbone=dict(widen_factor=0.25),
    )
    """
```

**Why This Works**: Training fails fast with clear error message rather than succeeding but producing unusable model.

---

## Root Cause #5: Config Model Head Override Pattern

### The Problem
Old config used conditional pattern that didn't work reliably:
```python
# Old - unreliable
if 'model' in globals() and isinstance(model, dict):
    if isinstance(model.get('bbox_head'), dict):
        model['bbox_head']['num_classes'] = 5
```

**Issues**:
- `globals()` check unreliable in MMEngine config system
- Conditional meant override might not apply
- No clear indication if override succeeded

### MMYolo's Response
```
RuntimeError: num_classes mismatch
  Expected: 80 (COCO default)
  Got: 5 (your dataset)
```

### The Fix
Direct dictionary override in config:
```python
# New - explicit override
model = dict(
    bbox_head=dict(
        num_classes=5,
        head_module=dict(
            num_classes=5,
        ),
    ),
)
```

**Why This Works**: MMEngine's config system properly merges this with base config, guaranteeing the override applies.

---

## Root Cause #6: Evaluator Configuration Incomplete

### The Problem
```python
# Old config
val_evaluator = dict(ann_file=_val_ann)
```

**Missing**:
- `type` field (defaults to wrong evaluator)
- `metric` specification
- Proper configuration fields

### MMYolo's Response
```
KeyError: 'type'
AttributeError: 'NoneType' has no attribute 'evaluate'
```

### The Fix
```python
# New config - complete evaluator
val_evaluator = dict(
    type='CocoMetric',
    ann_file='/absolute/path/to/val.json',
    metric=['bbox'],
    format_only=False,
)
```

---

## Root Cause #7: subprocess Error Handling

### The Problem
DJI patch application used uncaptured subprocess calls:
```python
# Old
subprocess.run(["git", "clone", ...], check=True)
# If fails: CalledProcessError with no details
```

### What Users Saw
```
subprocess.CalledProcessError: Command '['git', 'clone', ...]' returned non-zero exit status 128.
```
No information about WHY it failed.

### The Fix
```python
# New - captured output
try:
    result = subprocess.run(
        ["git", "clone", ...],
        check=True,
        capture_output=True,
        text=True,
    )
except subprocess.CalledProcessError as e:
    raise RuntimeError(
        f"Failed to clone:\n"
        f"Command: {' '.join(e.cmd)}\n"
        f"Stderr: {e.stderr}\n"
        f"Stdout: {e.stdout}"
    )
```

**Now Users See**:
```
Failed to clone:
Command: git clone https://github.com/open-mmlab/mmyolo.git /path
Stderr: fatal: destination path exists and is not an empty directory.
```

---

## Verification Tests

### Test 1: Empty Segmentation Array
```python
# Dataset with annotation
annotation = {
    "segmentation": [],  # Empty
    "bbox": [10, 20, 100, 150],
    "category_id": 1
}

# Old: IndexError
# New: Skips polygon, uses bbox only
```

### Test 2: Missing Image Dimensions
```python
# Database record
image = {
    "width": None,
    "height": None,
    "file_name": "test.jpg"
}

# Old: COCO JSON has "width": 0, "height": 0
# New: Reads from actual file, uses real dimensions
```

### Test 3: DJI Mode with 15 Classes
```python
# Training request
config = {
    "dji_patch_path": "/app/patches/dji.patch",
    "num_classes": 15
}

# Old: Trains successfully, fails at DJI quantization
# New: ValueError raised immediately with clear message
```

### Test 4: Relative Path Config
```python
# Old config generates
ann_file = "dataset/annotations/train.json"

# MMYolo tries to load from current directory
# Result: FileNotFoundError

# New config generates
ann_file = "/app/projects/1/training/task_123/dataset/annotations/train.json"

# MMYolo loads successfully
```

---

## Architecture Decision: Why These Fixes

### Decision: Use Absolute Paths
**Alternatives Considered**:
1. Set `data_root` to project directory, use relative paths
2. Change working directory before training
3. Use absolute paths (chosen)

**Rationale**: 
- Absolute paths are unambiguous regardless of CWD
- No side effects from changing directories
- Explicit is better than implicit

### Decision: Fail Fast on DJI Violations
**Alternatives Considered**:
1. Allow training, warn about DJI incompatibility
2. Auto-fix violations (merge classes, etc.)
3. Fail fast with clear error (chosen)

**Rationale**:
- Users need to explicitly design for DJI constraints
- Auto-fixing could introduce silent correctness issues
- Clear errors enable users to fix root cause

### Decision: Read Image Dimensions from Files
**Alternatives Considered**:
1. Require dimensions in database
2. Use default fallback (640x640)
3. Read from actual files (chosen)

**Rationale**:
- Database may be incomplete
- Default fallback produces incorrect COCO JSON
- Reading files is source of truth

---

## Lessons Learned

1. **Validate Early**: Catch errors at dataset prep, not during training
2. **Log Everything**: Silent failures are impossible to debug
3. **Read the Spec**: MMYolo expects strict COCO format
4. **Test Edge Cases**: Empty arrays, None values, missing data
5. **Clear Errors**: Tell users exactly what's wrong and how to fix

---

**Document Version**: 1.0  
**Last Updated**: May 26, 2026  
**Verified**: All root causes fixed and tested
