
# Shared Dataset Picker — UX ideas for scale

`DatasetEvalPicker` is already shared across `TrainModelModal`, `EvaluateModelModal`, and `CreateAugmentedDatasetModal`. **We keep three separate modals** that share this one picker component — no unification.

**Domain rule (project memory):** a dataset has a **1:N relationship with annotation files**. There is no single "ground truth" per dataset; a dataset can carry many annotation files of different types (detection / segmentation / classification / oriented). The picker must let the user choose which annotation file(s) to use — not just which dataset.

**Confirmed decisions (from this conversation):**
- Keep three modals sharing the picker.
- **No "saved presets"** feature.
- Default annotation file per dataset = **latest compatible** one.
- Picker **filters by the chosen task**, and **notifies** the user (inline, non-blocking) when they try to add a dataset that has no annotation files or none that suit the task.

Below are the scale-friendly ideas we want to build, reflecting those decisions.

## 1. Two-pane layout with a persistent "Selection" tray
Split the picker into a left "Browse" pane and a right "Selection" tray. Each tray entry is a **(dataset, annotation file, collection)** triple — the same dataset can appear twice with two different annotation files.
- Always-visible running totals: rows, datasets, images, annotation files, class union/intersection
- Bulk actions on the tray: Remove all, Clear invalid
- Inline warnings surface here (see #5)

## 2. Faceted filter rail (left sidebar inside the modal)
Replace/augment the horizontal tag chips with a compact filter rail:
- **Task type** — pre-selected from the current modal's task; filters at the **annotation-file** level. This is what "filter by choice" means in practice.
- Annotation type (Boxes / Masks / Masks+Boxes / Keypoints)
- Annotation-file count (0, 1, 2+) — quickly find datasets with multiple options
- Groups (checkbox per group)
- Tags (searchable, "show more")
- Size buckets (0, 1–100, 100–1k, 1k+ images)
- Last used / Last annotated (Any / 7d / 30d)
Each facet shows counts and can be collapsed.

## 3. Compatibility-first sorting & sections
Filter-by-choice is the default, but we don't hide everything. Auto-sort the browse list into sections:
1. **Compatible** — has ≥ 1 annotation file matching the current task (default: expanded)
2. **Not compatible** — has annotation files, but none suit the task (collapsed; label "Show N incompatible")
3. **No annotations** — datasets with zero annotation files (collapsed; hidden entirely in Train, shown collapsed in Evaluate/Augment where empty datasets can still be valid)

## 4. Smart top section: "Recent"
Above the list, show 3–6 chips: datasets/groups the user recently trained or evaluated on for this task. One-click "Add" pre-selects the **latest compatible** annotation file. No named presets, no persistence beyond usage history that already exists (`lastUsedAt`).

## 5. Non-blocking notifications for bad picks
When the user tries to add a dataset that is not usable for the current task, the picker never silently drops it. Instead:
- **Dataset with no annotation files** → a toast/inline banner on the row: "'{name}' has no annotation files. Add annotations first, or remove it from your selection." In Train mode, the row is not addable; in Augment mode, the row is addable with a soft warning; in Evaluate mode, blocked with the same message.
- **Dataset with annotation files but none matching the task** → row banner: "'{name}' has 3 annotation files, but none are {task}. Change the task or pick a different dataset." Row is dimmed; checkbox disabled; message is dismissible per-session.
- **Selection tray** shows an aggregated warning strip: "1 dataset has no compatible annotations — Fix or remove."

Consistent phrasing across the three modals. Notifications live inline (no modal-on-modal).

## 6. Group-first browsing with drill-down
When groups exist, default the browse view to *groups only* (collapsed). Each group card shows aggregate stats (datasets, images, total annotation files, count compatible with the current task). "Add whole group":
- Adds one tray row per member dataset
- Auto-picks **latest compatible** annotation file per dataset (per the confirmed default)
- Skips incompatible members and shows the notification from #5 for each skipped one
Ungrouped datasets appear under a final "Ungrouped" section.

## 7. Annotation-file-aware dataset row
The collapsed row makes the 1:N relationship visible without expanding:
- Small stack of annotation-type pills (e.g. `seg` `det` `det`) with count
- Hover reveals file names + last-modified dates
- On add, latest compatible file is used automatically
- Expand to swap file or add another file from the same dataset ("1 of 3 files selected — add another")

## 8. Bulk operations
- Multi-select via checkbox + shift-click range
- "Select all filtered" — adds latest compatible annotation file per dataset; skipped rows raise the notifications from #5
- "Select all annotation files matching task" — expands every compatible file into its own tray row
- "Invert selection"
- "Remove all" on the tray

## 9. Class-overlap preview per annotation file (Train / Evaluate)
Class sets belong to annotation files, so overlap is shown at file level:
- Row-level meter per annotation file: "8/12 model classes present"
- Tray aggregate: "Union: 14 classes · Intersection: 6 · Missing from model: 2"
- Warning when two selected annotation files for the same dataset have conflicting class definitions

## 10. Virtualization + keyboard nav
Virtualized list so 500+ rows scroll like 20. Keyboard: `Cmd/Ctrl+K` focus search, arrows to navigate, `Space` to toggle (adds latest compatible file), `Enter` to expand the file picker for the row.

## 11. Density & view modes tuned to size
Auto-pick default density by dataset count:
- ≤ 20: comfortable (thumbnails)
- 21–100: dense
- 100+: table view with click-sortable columns (Name · Images · Annotation files · Task types · Tags · Last used) plus an inline "Files" popover
Manual toggle stays.

## 12. Empty & noisy states
- "3 filters are hiding 47 datasets — Clear filters"
- "Model task = segmentation hides 22 datasets that only have detection files — Show anyway"
- Never show an empty modal without an action

## 13. Cross-modal consistency polish
Same picker component in three modals, so all three get:
- Same header ("Datasets · N rows · Est. images · Est. annotations")
- Same keyboard shortcuts
- Same tray on the right
- Same notification phrasing from #5

---

## Recommended first slice (highest ROI, lowest risk)
1. **Two-pane layout with persistent selection tray** treating each entry as (dataset, annotation file, collection) — #1
2. **Faceted filter rail** with task-type filter defaulted from the modal's task — #2
3. **Compatibility sections + "Show incompatible"** — #3
4. **Non-blocking notifications for incompatible / empty datasets** — #5 (this is the "notify the user" ask)
5. **Group-first browsing with "Add whole group" using latest compatible per member** — #6
6. **Annotation-file-aware dataset row** ("1 of 3 selected", pills) — #7
7. **Virtualized list + keyboard nav** — #10

Class-overlap preview (#9) and table view (#11) are strong follow-ups.

## Notes on scope guarantees
- No preset save/load anywhere.
- Default annotation-file resolution everywhere (add, bulk add, add-group, "Recent" chip) = **latest compatible**.
- Task-based filter is on by default and can be turned off via "Show incompatible" in-section, per #3.
- Incompatible / empty picks always surface an inline, dismissible notification — never a silent drop and never a hard modal dialog.
