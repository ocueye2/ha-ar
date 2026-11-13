"""
Reference store — the "photo -> target" mapping.

Layout under DATA_DIR (default /data in the add-on, ./data in dev):
  refs.json      — list of references (metadata + fingerprints, no pixels)
  photos/<id>_0.jpg, <id>_1.jpg ... — original reference photos (thumbnails
                   are served from here; full images are downscaled to
                   max 1024px on enrol so storage stays small)
  settings.json  — match threshold + CLIP flag ONLY. No token here:
                   the HA token is server-side only (env / Docker secret).

A reference:
  { "id": "ref_...", "name": "Bed LED strip", "target_type": "entity",
    "target_id": "light.bed", "created_at": "...", "photos": ["<id>_0.jpg"],
    "fingerprints": [ matcher.fingerprint(...) , ... ] }

One reference can hold up to MAX_PHOTOS_PER_REF photos (different angles /
lighting) — matching takes the best photo, so adding a second angle for a
tricky object is the single best way to improve accuracy.
"""
from __future__ import annotations

import io
import json
import os
import time
import uuid

from PIL import Image

from matcher import fingerprint, load_image_bytes

DATA_DIR = os.environ.get("HA_AR_DATA", "/data")
REFS_PATH = os.path.join(DATA_DIR, "refs.json")
PHOTOS_DIR = os.path.join(DATA_DIR, "photos")
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
MAX_PHOTOS_PER_REF = 5
MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_DIM = 1024


def _ensure_dirs():
    os.makedirs(PHOTOS_DIR, exist_ok=True)


def load_refs() -> list[dict]:
    try:
        with open(REFS_PATH, encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def save_refs(refs: list[dict]) -> None:
    _ensure_dirs()
    tmp = REFS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(refs, f)
    os.replace(tmp, REFS_PATH)


def _downscale(raw: bytes) -> bytes:
    img = load_image_bytes(raw)
    if max(img.size) > MAX_DIM:
        img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def create_ref(name: str, target_type: str, target_id: str,
               photo_bytes_list: list[bytes]) -> dict:
    if not name.strip():
        raise ValueError("Give the object a name (e.g. “Bed lamp”).")
    if target_type not in ("entity", "scene", "script"):
        raise ValueError("target_type must be entity, scene or script.")
    if not target_id.strip():
        raise ValueError("Pick a Home Assistant target first.")
    if not photo_bytes_list:
        raise ValueError("Add at least one reference photo.")
    if len(photo_bytes_list) > MAX_PHOTOS_PER_REF:
        raise ValueError(f"At most {MAX_PHOTOS_PER_REF} photos per object.")
    _ensure_dirs()
    ref_id = "ref_" + uuid.uuid4().hex[:10]
    refs = load_refs()
    photos, fps = [], []
    for i, raw in enumerate(photo_bytes_list):
        if len(raw) > MAX_PHOTO_BYTES:
            raise ValueError("Photo is too large (max 8 MB).")
        small = _downscale(raw)
        fname = f"{ref_id}_{i}.jpg"
        with open(os.path.join(PHOTOS_DIR, fname), "wb") as f:
            f.write(small)
        photos.append(fname)
        fps.append(fingerprint(small))
    ref = {"id": ref_id, "name": name.strip(), "target_type": target_type,
           "target_id": target_id.strip(),
           "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "photos": photos, "fingerprints": fps}
    refs.append(ref)
    save_refs(refs)
    return ref


def add_photo(ref_id: str, raw: bytes) -> dict:
    refs = load_refs()
    ref = next((r for r in refs if r["id"] == ref_id), None)
    if ref is None:
        raise ValueError("Reference not found.")
    if len(ref["photos"]) >= MAX_PHOTOS_PER_REF:
        raise ValueError(f"Already has {MAX_PHOTOS_PER_REF} photos — delete "
                         "one first.")
    _ensure_dirs()
    small = _downscale(raw)
    fname = f"{ref_id}_{len(ref['photos'])}.jpg"
    with open(os.path.join(PHOTOS_DIR, fname), "wb") as f:
        f.write(small)
    ref["photos"].append(fname)
    ref["fingerprints"].append(fingerprint(small))
    save_refs(refs)
    return ref


def delete_ref(ref_id: str) -> bool:
    refs = load_refs()
    ref = next((r for r in refs if r["id"] == ref_id), None)
    if ref is None:
        return False
    for fname in ref.get("photos", []):
        try:
            os.remove(os.path.join(PHOTOS_DIR, fname))
        except OSError:
            pass
    refs = [r for r in refs if r["id"] != ref_id]
    save_refs(refs)
    return True


def public_refs() -> list[dict]:
    """Refs without fingerprints (they're large and the UI doesn't need them)."""
    out = []
    for r in load_refs():
        out.append({k: v for k, v in r.items() if k != "fingerprints"})
    return out


# ------------------------------------------------------------- settings
def load_settings() -> dict:
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def save_settings(patch: dict) -> dict:
    # SECURITY: token / ha_url are never accepted here. They live only
    # in server env / Docker secrets — see ha_client.resolve_config().
    # Any token key in the patch is dropped silently.
    cur = load_settings()
    for k in ("match_threshold", "enable_clip"):
        if k in patch and patch[k] not in (None, ""):
            cur[k] = patch[k]
    _ensure_dirs()
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(cur, f)
    return cur


def public_settings() -> dict:
    s = load_settings()
    return {"match_threshold": float(s.get("match_threshold", 0.55)),
            "enable_clip": bool(s.get("enable_clip", False))}
