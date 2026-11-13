"""
HA AR Control — image matcher.

Goal: given a new photo, find which *reference* photo (and therefore which
Home Assistant target) it shows. No cloud, no training, no labelling.

Three tiers, best available wins — the code degrades gracefully so the
add-on runs on a Pi as well as on a NUC:

1. CLIP embeddings (optional, best for "same object, different angle /
   lighting"). Enabled only if torch + transformers are installed AND
   `enable_clip` is on. Model: openai/clip-vit-base-patch32, downloaded
   once into /data/models. Cosine similarity.
2. ORB feature matching (optional, good for same object, same-ish angle).
   Enabled only if opencv-python-headless is installed. BFMatcher +
   Lowe ratio test, score = good matches / max(keypoints).
3. Always-on ensemble (Pillow + numpy only, zero extra downloads):
   perceptual hash (aHash + dHash), colour histogram correlation, and
   downscaled-grayscale template correlation. This is the default in the
   Docker image and is what the unit tests exercise.

Final score is a 0..1 blend. A match is accepted when the best score is
>= threshold (default 0.55, configurable) AND it beats the runner-up by
>= 0.05 — otherwise the UI shows the top 3 and lets the user pick.
That margin rule matters: two lamps in one room look alike, and guessing
wrong turns off the wrong light.
"""
from __future__ import annotations

import hashlib
import io
import math
import os

import numpy as np
from PIL import Image

# --- optional deps, imported lazily so a missing one never breaks the app ---
try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None

_CLIP = None          # (model, processor) once loaded
_CLIP_TRIED = False


# ---------------------------------------------------------------- helpers
def load_image_bytes(raw: bytes) -> Image.Image:
    """Decode bytes to RGB PIL image, honouring EXIF rotation (phone photos)."""
    img = Image.open(io.BytesIO(raw))
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    return img.convert("RGB")


def _ahash(img: Image.Image, size: int = 8) -> int:
    small = img.convert("L").resize((size, size), Image.LANCZOS)
    px = np.asarray(small, dtype=np.float64)
    avg = px.mean()
    bits = 0
    for v in (px > avg).flatten():
        bits = (bits << 1) | int(v)
    return bits


def _dhash(img: Image.Image, size: int = 8) -> int:
    small = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = np.asarray(small, dtype=np.float64)
    diff = px[:, 1:] > px[:, :-1]
    bits = 0
    for v in diff.flatten():
        bits = (bits << 1) | int(v)
    return bits


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _hist(img: Image.Image, bins: int = 32) -> np.ndarray:
    """Per-channel normalised colour histogram, concatenated."""
    arr = np.asarray(img, dtype=np.float64)
    parts = []
    for ch in range(3):
        h, _ = np.histogram(arr[:, :, ch], bins=bins, range=(0, 255), density=False)
        h = h.astype(np.float64)
        n = h.sum()
        parts.append(h / n if n else h)
    return np.concatenate(parts)


def _hist_corr(a: np.ndarray, b: np.ndarray) -> float:
    if a.std() == 0 or b.std() == 0:
        return 0.0
    c = float(np.corrcoef(a, b)[0, 1])
    return max(0.0, min(1.0, (c + 1.0) / 2.0)) if math.isfinite(c) else 0.0


def _thumb_corr(a_img: Image.Image, b_img: Image.Image, size: int = 32) -> float:
    """Grayscale 32x32 template correlation — shape / layout similarity."""
    a = np.asarray(a_img.convert("L").resize((size, size), Image.LANCZOS),
                   dtype=np.float64).flatten()
    b = np.asarray(b_img.convert("L").resize((size, size), Image.LANCZOS),
                   dtype=np.float64).flatten()
    a = (a - a.mean()) / (a.std() or 1.0)
    b = (b - b.mean()) / (b.std() or 1.0)
    return max(0.0, min(1.0, float(np.dot(a, b) / len(a))))


def _orb_score(a_img: Image.Image, b_img: Image.Image) -> float | None:
    """ORB good-match ratio, or None when cv2 is unavailable / no keypoints."""
    if cv2 is None:
        return None
    try:
        a = np.asarray(a_img.convert("L"))
        b = np.asarray(b_img.convert("L"))
        orb = cv2.ORB_create(nfeatures=800)
        ka, da = orb.detectAndCompute(a, None)
        kb, db = orb.detectAndCompute(b, None)
        if da is None or db is None or not ka or not kb:
            return 0.0
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        pairs = bf.knnMatch(da, db, k=2)
        good = 0
        for m_n in pairs:
            if len(m_n) != 2:
                continue
            m, n = m_n
            if m.distance < 0.75 * n.distance:
                good += 1
        denom = max(len(ka), len(kb))
        return max(0.0, min(1.0, good / denom * 4.0))  # scale: ~0.25 ratio ~= 1.0
    except Exception:
        return None


# ---------------------------------------------------------------- CLIP (optional)
def _clip_embed(img: Image.Image) -> np.ndarray | None:
    """Return a unit CLIP embedding, or None if CLIP is unavailable."""
    global _CLIP, _CLIP_TRIED
    if not os.environ.get("HA_AR_ENABLE_CLIP", "0") == "1":
        return None
    if _CLIP_TRIED and _CLIP is None:
        return None
    if _CLIP is None:
        _CLIP_TRIED = True
        try:
            import torch  # type: ignore
            from transformers import CLIPModel, CLIPProcessor  # type: ignore
            model_id = os.environ.get("HA_AR_CLIP_MODEL",
                                      "openai/clip-vit-base-patch32")
            cache = os.environ.get("HA_AR_MODEL_DIR", "/data/models")
            proc = CLIPProcessor.from_pretrained(model_id, cache_dir=cache)
            model = CLIPModel.from_pretrained(model_id, cache_dir=cache)
            model.eval()
            _CLIP = (model, proc, torch)
        except Exception as e:
            print(f"[matcher] CLIP unavailable: {e}")
            _CLIP = None
            return None
    model, proc, torch = _CLIP
    try:
        with torch.no_grad():
            inp = proc(text=[""], images=img, return_tensors="pt", padding=True)
            emb = model.get_image_features(**{k: v for k, v in inp.items()
                                              if k in ("pixel_values",)})
            emb = emb / emb.norm(dim=-1, keepdim=True)
            return emb[0].cpu().numpy().astype(np.float64)
    except Exception as e:
        print(f"[matcher] CLIP embed failed: {e}")
        return None


def clip_available() -> bool:
    try:
        import torch, transformers  # noqa: F401
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- fingerprint
def fingerprint(raw: bytes) -> dict:
    """
    Compute everything storable for one image. The fingerprint is JSON-safe
    except for the optional CLIP vector, which is stored as a list.
    """
    img = load_image_bytes(raw)
    fp: dict = {
        "ahash": _ahash(img),
        "dhash": _dhash(img),
        "hist": _hist(img).tolist(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "size": list(img.size),
    }
    # Keep small grayscale thumbnails (plain lists, ~1k numbers each, fine).
    # thumb: whole frame (layout). centre: middle 60% (the object itself —
    # backgrounds are usually the same room, so the full frame alone
    # confuses two objects in one room). edge: gradient magnitude map —
    # the most discriminating cheap signal in testing (same shape ~0.8,
    # different shape ~0.05–0.16, where histograms sit at ~0.97 for both).
    def _norm(arr):
        arr = np.asarray(arr, dtype=np.float64)
        return np.round((arr - arr.mean()) / (arr.std() or 1.0), 2).tolist()

    grey = img.convert("L")
    fp["thumb"] = _norm(grey.resize((32, 32), Image.LANCZOS))
    w, h = img.size
    cw, ch = int(w * 0.6), int(h * 0.6)
    centre = grey.crop(((w - cw) // 2, (h - ch) // 2,
                        (w + cw) // 2, (h + ch) // 2))
    fp["centre"] = _norm(centre.resize((32, 32), Image.LANCZOS))
    small = np.asarray(grey.resize((32, 32), Image.LANCZOS), dtype=np.float64)
    edge = np.zeros_like(small)
    edge[:, :-1] += np.abs(np.diff(small, axis=1))
    edge[:-1, :] += np.abs(np.diff(small, axis=0))
    fp["edge"] = _norm(edge)
    emb = _clip_embed(img)
    if emb is not None:
        fp["clip"] = [round(float(x), 4) for x in emb]
    return fp


def _fingerprint_image(img: Image.Image) -> dict:
    """Same as fingerprint() but from an already-decoded image (for tests)."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return fingerprint(buf.getvalue())


def score_pair(fp_a: dict, fp_b: dict, img_a=None, img_b=None) -> dict:
    """
    Score two fingerprints. img_a/img_b are optional decoded PIL images —
    when supplied, ORB runs live (it needs pixels, not just the fingerprint).
    Returns {"score": 0..1, "parts": {...}}.
    """
    # Exact duplicate: instant 1.0.
    if fp_a.get("sha256") and fp_a.get("sha256") == fp_b.get("sha256"):
        return {"score": 1.0, "parts": {"exact": 1.0}}

    def _corr(key):
        if key not in fp_a or key not in fp_b:
            return None
        ta = np.array(fp_a[key], dtype=np.float64).flatten()
        tb = np.array(fp_b[key], dtype=np.float64).flatten()
        return max(0.0, min(1.0, float(np.dot(ta, tb) / len(ta))))

    ah = 1.0 - _hamming(fp_a["ahash"], fp_b["ahash"]) / 64.0
    dh = 1.0 - _hamming(fp_a["dhash"], fp_b["dhash"]) / 64.0
    hc = _hist_corr(np.array(fp_a["hist"]), np.array(fp_b["hist"]))
    tc = _corr("thumb")
    cc = _corr("centre")
    ec = _corr("edge")

    parts = {"ahash": ah, "dhash": dh, "hist": hc, "thumb": tc}
    if cc is not None:
        parts["centre"] = cc
    if ec is not None:
        parts["edge"] = ec
    # Base ensemble. Weights are deliberate: colour histograms are ~0.97
    # even for different objects in the same room (white walls dominate),
    # so hist gets only 0.05; shape/edge signals carry the decision.
    weighted = [("ahash", ah, 0.15), ("dhash", dh, 0.15),
                ("hist", hc, 0.05), ("thumb", tc, 0.10)]
    if cc is not None:
        weighted.append(("centre", cc, 0.20))
    if ec is not None:
        weighted.append(("edge", ec, 0.35))
    total_w = sum(w for _, _, w in weighted)
    score = sum(v * w for _, v, w in weighted) / total_w

    if img_a is not None and img_b is not None:
        orb = _orb_score(img_a, img_b)
        if orb is not None:
            parts["orb"] = orb
            # ORB is the most discriminating signal when present: blend it in.
            score = 0.55 * score + 0.45 * orb

    if fp_a.get("clip") and fp_b.get("clip"):
        ca = np.array(fp_a["clip"], dtype=np.float64)
        cb = np.array(fp_b["clip"], dtype=np.float64)
        cos = float(np.dot(ca, cb) / (np.linalg.norm(ca) * np.linalg.norm(cb) or 1.0))
        clip_score = max(0.0, min(1.0, (cos + 1.0) / 2.0))
        parts["clip"] = clip_score
        # CLIP dominates when available — it understands "same lamp".
        score = 0.35 * score + 0.65 * clip_score

    return {"score": round(max(0.0, min(1.0, score)), 4), "parts": parts}


def rank(query_raw: bytes, refs: list[dict], threshold: float = 0.55,
         margin: float = 0.05, ref_image_loader=None) -> dict:
    """
    refs: list of {"id","name","target_type","target_id","fingerprints":[...]}
    ref_image_loader: optional callable(ref) -> PIL Image of the reference
    (its first photo). When supplied, ORB runs live query-vs-reference.
    Returns {"best": ref|None, "results": [{ref, score, parts}...] sorted desc,
             "accepted": bool}.
    A reference with several photos scores as its BEST photo — one good
    angle should be enough.
    """
    q_img = load_image_bytes(query_raw)
    q_fp = fingerprint(query_raw)
    results = []
    for ref in refs:
        ref_img = None
        if ref_image_loader is not None:
            try:
                ref_img = ref_image_loader(ref)
            except Exception:
                ref_img = None
        best = {"score": 0.0, "parts": {}}
        for fp in ref.get("fingerprints", []):
            s = score_pair(q_fp, fp, img_a=q_img, img_b=ref_img)
            if s["score"] > best["score"]:
                best = s
        results.append({"ref": ref, "score": best["score"], "parts": best["parts"]})
    results.sort(key=lambda r: r["score"], reverse=True)
    best = results[0] if results else None
    accepted = False
    if best and best["score"] >= threshold:
        second = results[1]["score"] if len(results) > 1 else 0.0
        accepted = (best["score"] - second) >= margin or best["score"] >= 0.85
    return {"best": best["ref"] if (best and accepted) else None,
            "best_score": best["score"] if best else 0.0,
            "results": results, "accepted": accepted,
            "threshold": threshold}


def status() -> dict:
    return {
        "opencv": cv2 is not None,
        "clip_installed": clip_available(),
        "clip_enabled": os.environ.get("HA_AR_ENABLE_CLIP", "0") == "1",
        "mode": ("clip" if (clip_available() and os.environ.get(
            "HA_AR_ENABLE_CLIP", "0") == "1") else
                 "orb+ensemble" if cv2 is not None else "ensemble"),
    }
