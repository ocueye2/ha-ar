"""
Home Assistant client — server-side key ONLY.

Security rule for this app (user requirement: keep the key server side):
  - The HA long-lived token lives ONLY on the server.
  - Sources, in order:
      1. HA_TOKEN_FILE env -> file path (Docker secret, e.g. /run/secrets/ha_token)
      2. /run/secrets/ha_token (Docker secret, default location)
      3. HA_TOKEN env var (docker-compose environment)
      4. /data/ha_token (file mounted into the volume, chmod 600)
  - The token is NEVER accepted from the browser: there is no
    POST /api/settings token field, no token in any API response,
    no token in HTML/JS/localStorage, and it is never logged.
  - HA_URL comes from env HA_URL (or /data/ha_url). The API only
    reports whether HA is configured, never the token.
"""
from __future__ import annotations

import os

import requests

DATA_DIR = os.environ.get("HA_AR_DATA", "/data")


def _read_token_file(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def resolve_config() -> dict:
    """Return config — token is internal only, callers must not expose it."""
    ha_url = (os.environ.get("HA_URL") or "").strip().rstrip("/")
    if not ha_url:
        ha_url = _read_token_file(os.path.join(DATA_DIR, "ha_url")).strip().rstrip("/")
    token = ""
    source = "none"
    token_file = os.environ.get("HA_TOKEN_FILE") or "/run/secrets/ha_token"
    if token_file and os.path.exists(token_file):
        token = _read_token_file(token_file)
        if token:
            source = "docker-secret"
    if not token and os.environ.get("HA_TOKEN"):
        token = os.environ["HA_TOKEN"].strip()
        source = "env"
    if not token:
        p = os.path.join(DATA_DIR, "ha_token")
        if os.path.exists(p):
            token = _read_token_file(p)
            if token:
                source = "data-file"
    if not ha_url:
        ha_url = "http://homeassistant.local:8123"
    return {"ha_url": ha_url, "token": token, "source": source,
            "configured": bool(token)}


CONTROLLABLE_DOMAINS = ("light", "switch", "fan", "cover", "climate",
                        "media_player", "scene", "script", "group", "automation")
DEFAULT_TIMEOUT = 10


class HAError(Exception):
    pass


class HAClient:
    def __init__(self, ha_url: str | None = None, token: str | None = None):
        cfg = resolve_config()
        self.ha_url = (ha_url or cfg["ha_url"]).rstrip("/")
        # token param is only for tests — never pass a browser-supplied value.
        self.token = token if token is not None else cfg["token"]
        self.configured = bool(self.token)

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json"}

    def _req(self, method, path, **kw):
        if not self.configured:
            raise HAError("Home Assistant is not connected yet — set HA_TOKEN "
                          "on the server (docker-compose env or Docker secret "
                          "/run/secrets/ha_token). The token is never entered "
                          "in the browser.")
        url = f"{self.ha_url}{path}"
        try:
            r = requests.request(method, url, headers=self._headers(),
                                 timeout=kw.pop("timeout", DEFAULT_TIMEOUT), **kw)
        except requests.RequestException as e:
            raise HAError(f"Could not reach Home Assistant at {self.ha_url}: {e}")
        if r.status_code == 401:
            raise HAError("Home Assistant rejected the server-side token (401). "
                          "Create a fresh long-lived token in HA and update HA_TOKEN on the server.")
        if r.status_code == 404:
            raise HAError(f"Home Assistant returned 404 for {path} — check HA_URL ({self.ha_url}).")
        if not r.ok:
            raise HAError(f"Home Assistant error {r.status_code}: {r.text[:200]}")
        return r

    def get_states(self) -> list[dict]:
        return self._req("GET", "/api/states").json()

    def get_state(self, entity_id: str) -> dict:
        return self._req("GET", f"/api/states/{entity_id}").json()

    def list_targets(self) -> list[dict]:
        states = self.get_states()
        out = []
        for s in states:
            eid = s.get("entity_id", "")
            domain = eid.split(".", 1)[0] if "." in eid else ""
            if domain not in CONTROLLABLE_DOMAINS:
                continue
            attrs = s.get("attributes", {}) or {}
            out.append({
                "entity_id": eid, "domain": domain,
                "name": attrs.get("friendly_name") or eid,
                "state": s.get("state"),
                "supported_color_modes": attrs.get("supported_color_modes") or [],
                "brightness": attrs.get("brightness"),
                "rgb_color": attrs.get("rgb_color"),
                "hs_color": attrs.get("hs_color"),
                "color_temp_kelvin": attrs.get("color_temp_kelvin"),
                "icon": attrs.get("icon"),
            })
        out.sort(key=lambda e: (e["domain"], e["name"].lower()))
        return out

    def call_service(self, domain: str, service: str, data: dict | None = None,
                     target: dict | None = None) -> dict:
        payload: dict = {}
        if data:
            payload.update(data)
        if target:
            payload["target"] = target
        r = self._req("POST", f"/api/services/{domain}/{service}", json=payload)
        try:
            return r.json()
        except Exception:
            return {"ok": True}

    def control(self, target_type: str, target_id: str, action: str,
                **kwargs) -> dict:
        if target_type == "scene":
            return self.call_service("scene", "turn_on", target={"entity_id": target_id})
        if target_type == "script":
            return self.call_service("script", "turn_on", target={"entity_id": target_id})
        domain, _, _ = target_id.partition(".")
        if action == "run":
            return self.call_service(domain, "turn_on", target={"entity_id": target_id})
        if action in ("turn_on", "turn_off", "toggle"):
            data: dict = {}
            if action == "turn_on":
                if kwargs.get("brightness_pct") is not None:
                    data["brightness_pct"] = int(kwargs["brightness_pct"])
                elif kwargs.get("brightness") is not None:
                    data["brightness"] = int(kwargs["brightness"])
                if kwargs.get("rgb_color"):
                    data["rgb_color"] = [int(c) for c in kwargs["rgb_color"][:3]]
                elif kwargs.get("hs_color"):
                    data["hs_color"] = [float(c) for c in kwargs["hs_color"][:2]]
                elif kwargs.get("color_name"):
                    data["color_name"] = kwargs["color_name"]
                if kwargs.get("color_temp_kelvin"):
                    data["color_temp_kelvin"] = int(kwargs["color_temp_kelvin"])
                if kwargs.get("effect"):
                    data["effect"] = kwargs["effect"]
                if kwargs.get("transition") is not None:
                    data["transition"] = float(kwargs["transition"])
            return self.call_service(domain, action, data=data or None, target={"entity_id": target_id})
        if action == "set":
            return self.control(target_type, target_id, "turn_on", **kwargs)
        raise HAError(f"Unknown action {action!r} for {target_id}")

    def check(self) -> dict:
        """Safe for /api/health — never includes the token."""
        cfg = resolve_config()
        if not cfg["configured"]:
            return {"ok": False, "configured": False, "source": cfg["source"],
                    "error": "No server-side token set (HA_TOKEN env or Docker secret)."}
        try:
            self._req("GET", "/api/", timeout=5)
            return {"ok": True, "configured": True, "source": cfg["source"]}
        except HAError as e:
            return {"ok": False, "configured": True, "source": cfg["source"], "error": str(e)}
