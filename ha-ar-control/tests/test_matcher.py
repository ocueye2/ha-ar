"""Matcher tests — synthetic images only, no camera / HA / torch needed.

Run:  python tests/test_matcher.py
      python -m pytest tests/ -q
"""
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from PIL import Image, ImageDraw

from matcher import fingerprint, rank, score_pair, status


def make_image(kind: str, variant: int = 0) -> bytes:
    """Distinct synthetic 'objects': a red lamp-ish circle vs a blue square etc."""
    img = Image.new("RGB", (200, 200), "white")
    d = ImageDraw.Draw(img)
    if kind == "lamp":
        d.ellipse([60 + variant * 5, 40, 140 + variant * 5, 120], fill="red")
        d.rectangle([90, 120, 110, 170], fill="black")
    elif kind == "fan":
        d.rectangle([40, 40, 160, 160], fill="blue")
        d.ellipse([70, 70, 130, 130], fill="yellow")
    else:  # speaker
        d.rectangle([50, 30 + variant * 3, 150, 170], fill="green")
        d.ellipse([80, 60, 120, 100], fill="black")
        d.ellipse([80, 120, 120, 160], fill="black")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_exact_duplicate_scores_one():
    raw = make_image("lamp")
    fp = fingerprint(raw)
    assert score_pair(fp, fp)["score"] == 1.0


def test_same_object_beats_different_object():
    lamp_a = make_image("lamp", 0)
    lamp_b = make_image("lamp", 1)  # same object, slightly shifted
    fan = make_image("fan")
    same = score_pair(fingerprint(lamp_a), fingerprint(lamp_b))["score"]
    diff = score_pair(fingerprint(lamp_a), fingerprint(fan))["score"]
    assert same > diff, f"same={same} diff={diff}"
    assert same > 0.55, f"same-object score too low: {same}"


def test_rank_accepts_best_and_rejects_unknown():
    refs = [
        {"id": "ref_lamp", "name": "Lamp", "target_type": "entity",
         "target_id": "light.bed", "fingerprints": [fingerprint(make_image("lamp", 0))]},
        {"id": "ref_fan", "name": "Fan", "target_type": "entity",
         "target_id": "fan.bed_fan", "fingerprints": [fingerprint(make_image("fan"))]},
    ]
    hit = rank(make_image("lamp", 1), refs)
    assert hit["accepted"] and hit["best"]["id"] == "ref_lamp", hit["best_score"]
    miss = rank(make_image("speaker"), refs)
    # A speaker matches neither lamp nor fan well enough to accept.
    assert not miss["accepted"], miss["best_score"]


def test_status_reports_mode():
    s = status()
    assert s["mode"] in ("clip", "orb+ensemble", "ensemble")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
    print("matcher tests: all passed")
