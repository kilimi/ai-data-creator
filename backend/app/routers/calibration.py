"""
Calibration router: stores homography-based calibrations between two image collections.
A calibration maps pixel coordinates in a source collection to pixel coordinates in a
target collection via a 3×3 homography computed with cv2.findHomography (RANSAC).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List
import cv2
import numpy as np
from datetime import datetime

from ..database import get_db
from ..models import CollectionCalibration, ImageCollection, Dataset

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response schemas (local – no need to add to global schemas.py)
# ---------------------------------------------------------------------------

class PointPair(BaseModel):
    src_x: float
    src_y: float
    tgt_x: float
    tgt_y: float


class SaveCalibrationRequest(BaseModel):
    source_collection_id: int
    target_collection_id: int
    point_pairs: List[PointPair]


class CalibrationResponse(BaseModel):
    id: int
    dataset_id: int
    source_collection_id: int
    target_collection_id: int
    source_collection_name: str
    target_collection_name: str
    homography: List[List[float]]
    homography_inv: List[List[float]]
    point_pairs: List[dict]
    point_count: int
    validation: dict = {}  # Validation metrics
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_homography(point_pairs: List[PointPair]):
    """
    Compute H (src→tgt) and H_inv (tgt→src) from at least 4 point pairs.
    Returns (H_list, H_inv_list, validation_info) as plain Python for JSON storage.
    Raises ValueError when computation fails.
    """
    if len(point_pairs) < 4:
        raise ValueError("At least 4 point pairs are required to compute a homography.")

    src_pts = np.array([[p.src_x, p.src_y] for p in point_pairs], dtype=np.float32)
    tgt_pts = np.array([[p.tgt_x, p.tgt_y] for p in point_pairs], dtype=np.float32)

    H, mask = cv2.findHomography(src_pts, tgt_pts, cv2.RANSAC, ransacReprojThreshold=5.0)
    if H is None:
        raise ValueError(
            "Homography computation failed. The point correspondences may be degenerate "
            "(e.g., all collinear). Please provide more spread-out point pairs."
        )

    inliers = int(mask.sum()) if mask is not None else len(point_pairs)
    if inliers < 4:
        raise ValueError(
            f"RANSAC kept only {inliers} inliers. "
            "The point correspondences are too noisy. Please re-calibrate with more accurate points."
        )

    # Compute reprojection error for validation
    src_pts_h = np.hstack([src_pts, np.ones((len(src_pts), 1))])
    projected = (H @ src_pts_h.T).T
    projected = projected[:, :2] / projected[:, 2:3]
    errors = np.linalg.norm(tgt_pts - projected, axis=1)
    
    inlier_mask = mask.ravel() == 1 if mask is not None else np.ones(len(errors), dtype=bool)
    inlier_errors = errors[inlier_mask]
    
    mean_error = float(np.mean(inlier_errors))
    max_error = float(np.max(inlier_errors))
    
    validation_info = {
        "total_points": len(point_pairs),
        "inliers": inliers,
        "outliers": len(point_pairs) - inliers,
        "mean_reprojection_error_px": round(mean_error, 2),
        "max_reprojection_error_px": round(max_error, 2),
    }
    
    print(f"[Calibration] {inliers}/{len(point_pairs)} inliers, "
          f"mean error: {mean_error:.2f}px, max: {max_error:.2f}px")
    
    if mean_error > 20.0:
        print(f"[Warning] High reprojection error ({mean_error:.1f}px). "
              f"Calibration may be inaccurate for cameras with different FOVs.")

    H_inv = np.linalg.inv(H)
    return H.tolist(), H_inv.tolist(), validation_info


def _calibration_to_response(cal: CollectionCalibration) -> CalibrationResponse:
    # Extract validation info if stored in point_pairs
    validation = {}
    if cal.point_pairs and isinstance(cal.point_pairs, list) and len(cal.point_pairs) > 0:
        last_item = cal.point_pairs[-1]
        if isinstance(last_item, dict) and "_validation" in last_item:
            validation = last_item["_validation"]
    
    return CalibrationResponse(
        id=cal.id,
        dataset_id=cal.dataset_id,
        source_collection_id=cal.source_collection_id,
        target_collection_id=cal.target_collection_id,
        source_collection_name=cal.source_collection.name if cal.source_collection else "",
        target_collection_name=cal.target_collection.name if cal.target_collection else "",
        homography=cal.homography,
        homography_inv=cal.homography_inv,
        point_pairs=cal.point_pairs,
        point_count=cal.point_count,
        validation=validation,
        created_at=cal.created_at,
        updated_at=cal.updated_at,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/datasets/{dataset_id}/calibrations", response_model=List[CalibrationResponse])
def list_calibrations(dataset_id: int, db: Session = Depends(get_db)):
    """Return all calibrations stored for this dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    calibrations = (
        db.query(CollectionCalibration)
        .filter(CollectionCalibration.dataset_id == dataset_id)
        .all()
    )
    return [_calibration_to_response(c) for c in calibrations]


@router.post("/datasets/{dataset_id}/calibrations", response_model=CalibrationResponse)
def save_calibration(
    dataset_id: int,
    body: SaveCalibrationRequest,
    db: Session = Depends(get_db),
):
    """
    Compute homography from point pairs and upsert the calibration.
    If a calibration for this source↔target pair already exists it is replaced.
    """
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    src_col = db.query(ImageCollection).filter(
        ImageCollection.id == body.source_collection_id,
        ImageCollection.dataset_id == dataset_id,
    ).first()
    tgt_col = db.query(ImageCollection).filter(
        ImageCollection.id == body.target_collection_id,
        ImageCollection.dataset_id == dataset_id,
    ).first()

    if not src_col:
        raise HTTPException(status_code=404, detail="Source collection not found in this dataset")
    if not tgt_col:
        raise HTTPException(status_code=404, detail="Target collection not found in this dataset")
    if body.source_collection_id == body.target_collection_id:
        raise HTTPException(status_code=400, detail="Source and target collections must be different")

    try:
        H, H_inv, validation_info = _compute_homography(body.point_pairs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    pairs_json = [p.dict() for p in body.point_pairs]
    # Store validation metadata for debugging
    pairs_json.append({"_validation": validation_info})

    # Upsert: check both orderings (src→tgt and tgt→src are the same physical calibration)
    existing = (
        db.query(CollectionCalibration)
        .filter(
            CollectionCalibration.dataset_id == dataset_id,
            CollectionCalibration.source_collection_id == body.source_collection_id,
            CollectionCalibration.target_collection_id == body.target_collection_id,
        )
        .first()
    )

    if existing:
        existing.homography = H
        existing.homography_inv = H_inv
        existing.point_pairs = pairs_json
        existing.point_count = len(body.point_pairs)
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return _calibration_to_response(existing)

    cal = CollectionCalibration(
        dataset_id=dataset_id,
        source_collection_id=body.source_collection_id,
        target_collection_id=body.target_collection_id,
        homography=H,
        homography_inv=H_inv,
        point_pairs=pairs_json,
        point_count=len(body.point_pairs),
    )
    db.add(cal)
    db.commit()
    db.refresh(cal)
    return _calibration_to_response(cal)


@router.delete("/datasets/{dataset_id}/calibrations/{calibration_id}")
def delete_calibration(
    dataset_id: int,
    calibration_id: int,
    db: Session = Depends(get_db),
):
    """Delete a stored calibration."""
    cal = (
        db.query(CollectionCalibration)
        .filter(
            CollectionCalibration.id == calibration_id,
            CollectionCalibration.dataset_id == dataset_id,
        )
        .first()
    )
    if not cal:
        raise HTTPException(status_code=404, detail="Calibration not found")

    db.delete(cal)
    db.commit()
    return {"success": True}


@router.get("/datasets/{dataset_id}/calibrations/{calibration_id}/validate")
def validate_calibration(
    dataset_id: int,
    calibration_id: int,
    db: Session = Depends(get_db),
):
    """
    Retrieve validation metrics for a calibration.
    Shows how well the point pairs align and provides quality assessment.
    """
    cal = (
        db.query(CollectionCalibration)
        .filter(
            CollectionCalibration.id == calibration_id,
            CollectionCalibration.dataset_id == dataset_id,
        )
        .first()
    )
    if not cal:
        raise HTTPException(status_code=404, detail="Calibration not found")
    
    # Re-compute validation from stored point pairs
    point_pairs = [
        PointPair(**p) for p in cal.point_pairs 
        if "_validation" not in p  # Skip validation metadata
    ]
    
    if len(point_pairs) < 4:
        return {"error": "Not enough point pairs to validate"}
    
    src_pts = np.array([[p.src_x, p.src_y] for p in point_pairs], dtype=np.float32)
    tgt_pts = np.array([[p.tgt_x, p.tgt_y] for p in point_pairs], dtype=np.float32)
    H = np.array(cal.homography)
    
    # Compute reprojection for each point
    src_pts_h = np.hstack([src_pts, np.ones((len(src_pts), 1))])
    projected = (H @ src_pts_h.T).T
    projected = projected[:, :2] / projected[:, 2:3]
    errors = np.linalg.norm(tgt_pts - projected, axis=1)
    
    point_details = []
    for i, (src, tgt, proj, err) in enumerate(zip(src_pts, tgt_pts, projected, errors)):
        point_details.append({
            "index": i + 1,
            "source": {"x": float(src[0]), "y": float(src[1])},
            "target": {"x": float(tgt[0]), "y": float(tgt[1])},
            "projected": {"x": float(proj[0]), "y": float(proj[1])},
            "error_px": round(float(err), 2),
        })
    
    mean_error = float(np.mean(errors))
    max_error = float(np.max(errors))
    
    # Quality assessment
    if mean_error < 5:
        quality = "excellent"
        recommendation = "Calibration is highly accurate. Safe to use for precise alignment."
    elif mean_error < 15:
        quality = "good"
        recommendation = "Calibration is acceptable for most use cases."
    elif mean_error < 30:
        quality = "fair"
        recommendation = "Calibration has noticeable error. Consider adding more points or recalibrating."
    else:
        quality = "poor"
        recommendation = "Calibration error is very high. This may be due to different FOVs or incorrect point pairs. Recalibration strongly recommended."
    
    return {
        "calibration_id": calibration_id,
        "source_collection": cal.source_collection.name if cal.source_collection else "",
        "target_collection": cal.target_collection.name if cal.target_collection else "",
        "total_points": len(point_pairs),
        "mean_error_px": round(mean_error, 2),
        "max_error_px": round(max_error, 2),
        "quality": quality,
        "recommendation": recommendation,
        "point_details": point_details,
    }
