"""Flask API tests — no HA needed (entities fall back, control is mocked
by the HAError path). Run: python tests/test_api.py"""
import io
import json
import os
import sys
import tempfile

TMP = tempfile.mkdtemp()
os.environ["HA_AR_DATA"] = TMP
os.environ.pop("HA_TOKEN", None)
os.environ.pop("HA_URL", None)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from PIL import Image, ImageDraw

import app as appmod  # noqa: E402

client = appmod.app.test_client()


def shot() -> bytes:
    img = Image.new("RGB", (120, 120), "white")
    ImageDraw.Draw(img).ellipse([30, 30, 90, 90], fill="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_health_and_settings():
    r = client.get("/api/health")
    assert r.status_code == 200
    j = r.get_json()
    assert j["matcher"]["mode"] in ("clip", "orb+ensemble", "ensemble")
    assert j["ha"]["configured"] is False  # no server-side token in temp dir
    assert "token" not in json.dumps(j).lower() or "token" in str(j["ha"].get("error","")).lower()

    # Server-side key rule: token / ha_url via the browser API are rejected.
    r = client.post("/api/settings", json={"token": "secret123", "ha_url": "http://ha.local:8123"})
    assert r.status_code == 403, r.get_data(as_text=True)
    r = client.post("/api/settings", json={"match_threshold": 0.6})
    assert r.status_code == 200
    assert r.get_json()["match_threshold"] == 0.6
    assert "token" not in r.get_json()
    # Health must never leak a token value.
    assert "secret123" not in client.get("/api/health").get_data(as_text=True)


def test_refs_and_scan_roundtrip():
    photo = shot()
    r = client.post("/api/refs", data={
        "name": "Test lamp", "target_type": "entity", "target_id": "light.bed",
        "photos": (io.BytesIO(photo), "lamp.jpg"),
    }, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_data(as_text=True)
    ref = r.get_json()["ref"]
    assert ref["name"] == "Test lamp"
    assert "fingerprints" not in ref  # never leak fingerprints to the UI

    r = client.get("/api/refs")
    assert len(r.get_json()["refs"]) == 1

    # Re-photo the same object -> accepted match, via both scan and AR frame.
    r = client.post("/api/scan", data={
        "photo": (io.BytesIO(photo), "scan.jpg"),
    }, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_data(as_text=True)
    j = r.get_json()
    assert j["accepted"] is True and j["best"]["ref_id"] == ref["id"], j
    r = client.post("/api/ar/match", data={
        "frame": (io.BytesIO(photo), "frame.jpg"),
    }, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_data(as_text=True)
    j = r.get_json()
    assert j["accepted"] is True and j["best"]["ref_id"] == ref["id"], j

    # Control without HA configured -> clean 502, not a crash.
    r = client.post("/api/control", json={
        "target_type": "entity", "target_id": "light.bed", "action": "turn_on",
        "brightness_pct": 50, "rgb_color": "#ff0000"})
    assert r.status_code == 502
    assert "token" in r.get_json()["error"].lower() or "connect" in r.get_json()["error"].lower()

    r = client.delete(f"/api/refs/{ref['id']}")
    assert r.status_code == 200
    assert client.get("/api/refs").get_json()["refs"] == []


def test_scan_with_no_refs():
    r = client.post("/api/scan", data={
        "photo": (io.BytesIO(shot()), "x.jpg"),
    }, content_type="multipart/form-data")
    assert r.status_code == 400


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
    print("api tests: all passed")
