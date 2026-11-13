"""
HA AR Control — point your phone camera at a thing, control it in AR.

Docker container + Flask website. Live camera view, the server matches
frames against your reference photos, and floating controls appear over
the video when an object is recognised. Tap On/Off, brightness, colour,
or Run scene/script — all through the server.

KEY RULE — server-side key only:
  The Home Assistant long-lived token is NEVER in the browser.
  Set it on the server only:
    docker-compose:  HA_URL + HA_TOKEN env, or a Docker secret
                     /run/secrets/ha_token (HA_TOKEN_FILE)
  There is no token field in the UI, no POST /api/settings token,
  no token in any API response, JS, HTML or localStorage.
  The browser only calls /api/ar/match and /api/control with an
  entity_id — the Flask server adds the Bearer token to HA.
  HA_URL is also server-side; /api/health only says configured yes/no.

Run locally:  HA_URL=http://homeassistant.local:8123 HA_TOKEN=xxx python app/app.py
Run in Docker: docker compose up -d --build  (port 8100)
"""
from __future__ import annotations

import os
import sys

if "HA_AR_DATA" not in os.environ:
    _here = os.path.dirname(os.path.abspath(__file__))
    _local = os.path.join(os.path.dirname(_here), "data")
    os.environ["HA_AR_DATA"] = _local
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request, render_template, send_from_directory

import matcher
import store
from ha_client import HAClient, HAError, resolve_config

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

DATA_DIR = os.environ["HA_AR_DATA"]
PHOTOS_DIR = os.path.join(DATA_DIR, "photos")


def _sync_clip_flag():
    s = store.load_settings()
    os.environ["HA_AR_ENABLE_CLIP"] = "1" if s.get("enable_clip") else "0"


_sync_clip_flag()


@app.after_request
def _sec_headers(resp):
    # Camera needs HTTPS in production for getUserMedia on a real phone
    # (localhost is exempt). These headers keep the token out of caches.
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/photos/<path:fname>")
def photo(fname):
    return send_from_directory(PHOTOS_DIR, fname)


@app.route("/api/health")
def health():
    ha = HAClient().check()
    # Never include ha_url with credentials or the token — check() is safe.
    return jsonify({"ok": True, "matcher": matcher.status(),
                    "ha": ha, "refs": len(store.load_refs())})


@app.route("/api/settings", methods=["GET"])
def get_settings():
    # No ha_url, no token status that leaks anything — just match prefs.
    # HA configured-ness comes from /api/health.
    return jsonify({"ok": True, **store.public_settings(),
                    "ha_configured": resolve_config()["configured"]})


@app.route("/api/settings", methods=["POST"])
def post_settings():
    # Token / ha_url are rejected here by design — server-side only.
    data = request.get_json(silent=True) or {}
    if "token" in data or "ha_url" in data:
        return jsonify({"ok": False, "error": "HA token / URL are server-side only. "
                        "Set HA_TOKEN / HA_URL in docker-compose env or as a Docker secret — "
                        "never in the browser."}), 403
    store.save_settings({
        "match_threshold": data.get("match_threshold"),
        "enable_clip": data.get("enable_clip"),
    })
    _sync_clip_flag()
    return jsonify({"ok": True, **store.public_settings()})


@app.route("/api/entities")
def entities():
    try:
        targets = HAClient().list_targets()
        return jsonify({"ok": True, "entities": targets, "source": "home-assistant"})
    except HAError as e:
        fallback = [
            {"entity_id": "light.bed", "domain": "light", "name": "Bed LED strip", "state": "unknown"},
            {"entity_id": "light.tp_link_power_strip_8112_plug_1", "domain": "light", "name": "Desk lamp", "state": "unknown"},
            {"entity_id": "switch.tp_link_power_strip_8112_plug_2", "domain": "switch", "name": "Monitor", "state": "unknown"},
            {"entity_id": "switch.tp_link_power_strip_8112_plug_3", "domain": "switch", "name": "Clock", "state": "unknown"},
            {"entity_id": "fan.bed_fan", "domain": "fan", "name": "Bed fan", "state": "unknown"},
            {"entity_id": "media_player.ele1_3", "domain": "media_player", "name": "Speakers", "state": "unknown"},
        ]
        return jsonify({"ok": False, "error": str(e), "entities": fallback, "source": "fallback"})


@app.route("/api/state/<path:entity_id>")
def state(entity_id):
    try:
        return jsonify({"ok": True, "state": HAClient().get_state(entity_id)})
    except HAError as e:
        return jsonify({"ok": False, "error": str(e)}), 502


@app.route("/api/refs", methods=["GET"])
def list_refs():
    return jsonify({"ok": True, "refs": store.public_refs()})


@app.route("/api/refs", methods=["POST"])
def create_ref():
    name = request.form.get("name", "")
    target_type = request.form.get("target_type", "entity")
    target_id = request.form.get("target_id", "")
    files = request.files.getlist("photos") or request.files.getlist("photo")
    files = [f for f in files if f and f.filename]
    if not files:
        return jsonify({"ok": False, "error": "Add at least one photo."}), 400
    try:
        raws = [f.read() for f in files]
        ref = store.create_ref(name, target_type, target_id, raws)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "ref": {k: v for k, v in ref.items() if k != "fingerprints"}})


@app.route("/api/refs/<ref_id>", methods=["DELETE"])
def remove_ref(ref_id):
    if store.delete_ref(ref_id):
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Reference not found."}), 404


@app.route("/api/refs/<ref_id>/photo", methods=["POST"])
def add_ref_photo(ref_id):
    f = request.files.get("photo")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "No photo uploaded."}), 400
    try:
        ref = store.add_photo(ref_id, f.read())
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "ref": {k: v for k, v in ref.items() if k != "fingerprints"}})


def _match_frame(raw: bytes):
    refs = store.load_refs()
    if not refs:
        return None, "No reference photos yet — add one in the Library first."
    settings = store.load_settings()
    threshold = float(settings.get("match_threshold") or 0.55)

    def _ref_image(ref):
        photos = ref.get("photos") or []
        if not photos:
            return None
        with open(os.path.join(PHOTOS_DIR, photos[0]), "rb") as f:
            return matcher.load_image_bytes(f.read())

    result = matcher.rank(raw, refs, threshold=threshold, ref_image_loader=_ref_image)
    ha = HAClient()
    out = []
    for r in result["results"][:3]:
        ref = r["ref"]
        item = {"ref_id": ref["id"], "name": ref["name"],
                "target_type": ref["target_type"], "target_id": ref["target_id"],
                "score": r["score"], "parts": r["parts"],
                "photos": ref.get("photos", []), "state": None}
        try:
            if ref["target_type"] == "entity":
                item["state"] = ha.get_state(ref["target_id"])
        except Exception:
            pass
        out.append(item)
    return {"accepted": result["accepted"],
            "best": out[0] if (result["accepted"] and out) else None,
            "results": out, "threshold": threshold}, None


@app.route("/api/ar/match", methods=["POST"])
def ar_match():
    """AR frame match — same as scan, but for live video frames (small JPEG)."""
    f = request.files.get("photo") or request.files.get("frame")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "No frame uploaded."}), 400
    raw = f.read()
    if not raw:
        return jsonify({"ok": False, "error": "Empty frame."}), 400
    result, err = _match_frame(raw)
    if err:
        return jsonify({"ok": False, "error": err, "results": []}), 400
    return jsonify({"ok": True, **result})


@app.route("/api/scan", methods=["POST"])
def scan():
    f = request.files.get("photo")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "Take or upload a photo first."}), 400
    raw = f.read()
    if not raw:
        return jsonify({"ok": False, "error": "That photo is empty."}), 400
    result, err = _match_frame(raw)
    if err:
        return jsonify({"ok": False, "error": err, "results": []}), 400
    return jsonify({"ok": True, **result})


def _parse_rgb(value):
    if value is None:
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        return [int(value[0]), int(value[1]), int(value[2])]
    if isinstance(value, str):
        v = value.strip().lstrip("#")
        if len(v) == 6:
            try:
                return [int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)]
            except ValueError:
                return None
        parts = [p.strip() for p in value.split(",")]
        if len(parts) == 3:
            try:
                return [int(p) for p in parts]
            except ValueError:
                return None
    return None


@app.route("/api/control", methods=["POST"])
def control():
    # Browser sends only entity_id + action — the server adds the HA token.
    data = request.get_json(silent=True) or {}
    target_type = data.get("target_type", "entity")
    target_id = data.get("target_id", "")
    action = data.get("action", "toggle")
    if not target_id:
        return jsonify({"ok": False, "error": "No target given."}), 400
    kwargs: dict = {}
    if data.get("brightness_pct") is not None:
        try:
            kwargs["brightness_pct"] = max(0, min(100, int(data["brightness_pct"])))
        except (TypeError, ValueError):
            pass
    if data.get("brightness") is not None:
        try:
            kwargs["brightness"] = max(0, min(255, int(data["brightness"])))
        except (TypeError, ValueError):
            pass
    rgb = _parse_rgb(data.get("rgb_color") or data.get("color"))
    if rgb:
        kwargs["rgb_color"] = rgb
    if data.get("hs_color"):
        kwargs["hs_color"] = data["hs_color"]
    if data.get("color_name"):
        kwargs["color_name"] = data["color_name"]
    if data.get("color_temp_kelvin"):
        try:
            kwargs["color_temp_kelvin"] = int(data["color_temp_kelvin"])
        except (TypeError, ValueError):
            pass
    if data.get("effect"):
        kwargs["effect"] = data["effect"]
    try:
        HAClient().control(target_type, target_id, action, **kwargs)
    except HAError as e:
        return jsonify({"ok": False, "error": str(e)}), 502
    state = None
    try:
        if target_type == "entity":
            state = HAClient().get_state(target_id)
    except Exception:
        pass
    return jsonify({"ok": True, "state": state})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8100"))
    print("HA AR Control — http://127.0.0.1:%d" % port)
    print("Data dir:", DATA_DIR)
    print("HA configured (server-side token):", resolve_config()["configured"])
    print("Matcher:", matcher.status())
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
