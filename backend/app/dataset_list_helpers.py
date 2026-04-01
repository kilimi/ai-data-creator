"""Fast batch helpers for dataset list UIs (one preview image per dataset, no N+1 scans)."""
from __future__ import annotations

from typing import Dict, List

from sqlalchemy import func
from sqlalchemy.orm import Session, load_only

from .models import Image


def first_preview_url_by_dataset(db: Session, dataset_ids: List[int]) -> Dict[int, str]:
    """
    For each dataset_id, pick the image with minimum id (stable 'first' image) and build
    a small preview URL (?thumb=300) for relative paths — same convention as datasets router.
    """
    if not dataset_ids:
        return {}
    rows = (
        db.query(Image.dataset_id, func.min(Image.id))
        .filter(Image.dataset_id.in_(dataset_ids))
        .group_by(Image.dataset_id)
        .all()
    )
    if not rows:
        return {}
    min_ids = [mid for (_ds, mid) in rows]
    imgs = (
        db.query(Image)
        .filter(Image.id.in_(min_ids))
        .options(
            load_only(
                Image.id,
                Image.dataset_id,
                Image.url,
                Image.thumbnail_url,
            )
        )
        .all()
    )
    out: Dict[int, str] = {}
    for img in imgs:
        u = img.thumbnail_url or img.url
        if not u:
            continue
        if u.startswith("/"):
            sep = "&" if "?" in u else "?"
            out[img.dataset_id] = f"{u}{sep}thumb=300"
        else:
            out[img.dataset_id] = u
    return out
