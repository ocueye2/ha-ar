# HA AR Control 🥽

**Point your phone camera at a thing — its controls float over it in AR.**

A Docker container + Flask website for Home Assistant. Save a reference photo of an object — a lamp, a fan, a speaker — linked to a light, switch, fan, scene or script. Open AR View, point the live camera at it, and its controls pop up over the video: on/off, brightness, colour, run scene/script.

No cloud. No account. Matching runs locally in the container.

## 🔒 Key stays server-side — the whole point

The Home Assistant long-lived token is **never in the browser**:

- No token field in the UI. Settings has match threshold + CLIP only.
- `POST /api/settings` rejects `token` / `ha_url` with 403.
- No token in any API response, HTML, JS, or localStorage.
- The browser only sends `entity_id` + `action` to `/api/control`. The Flask server adds `Authorization: Bearer <token>` when it calls HA.
- `/api/health` only says `configured: true/false` + source (`env` / `docker-secret` / `data-file`) — never the token or URL.

Set the token on the server only, one of these:

```bash
# 1. env in docker-compose (simplest) — copy .env.example to .env
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your-long-lived-token

# 2. Docker secret (preferred, Swarm) — uncomment secrets: in docker-compose.yml
printf 'YOUR_TOKEN' | docker secret create ha_token -

# 3. file in the volume, chmod 600
echo -n 'YOUR_TOKEN' > data/ha_token
```

HA → your profile → Security → Long-lived access tokens → Create token.
Rotate it the same way: new token on the server, restart the container. No browser change.

## How it works

1. **Library** — photograph an object, name it, pick what it controls. Up to 5 photos per object (different angles / lighting help a lot).
2. **AR View** — tap Start AR camera. Every ~1.2s a small JPEG frame is sent to *this server* for matching. When it recognises an object, a floating control card appears over the video. Tap 🔒 Lock to hold a device while you adjust it — AR won't switch away. If it's unsure, it shows the top 3 to tap.
3. **Snap & match once** — fallback when the camera is blocked (e.g. plain HTTP on a phone — `getUserMedia` needs HTTPS, localhost is exempt).

### Matching

Same local tiered matcher as Photo Control:

| Tier | When |
|---|---|
| CLIP embeddings | torch + transformers installed **and** CLIP on in Settings |
| ORB features | OpenCV installed (included in the Docker image) |
| Ensemble (always on) | Pillow + numpy only — perceptual hash + colour hist + layout/edge |

Accepted at ≥ 0.55 (configurable) **and** beating the runner-up by ≥ 0.05. Above 0.85 it accepts outright. A fresh match is held for 4s so the card doesn't flicker on one missed frame.

## Run it

```bash
cp .env.example .env   # fill in HA_URL / HA_TOKEN
docker compose up -d --build
# open http://<your-host>:8100 on your phone — use HTTPS via your tunnel/reverse proxy for camera
```

Data (reference photos, fingerprints, match settings) lives in `./data` and survives restarts. `./data` does **not** contain the HA token unless you chose the `data/ha_token` file option.

Without Docker:

```bash
HA_URL=http://homeassistant.local:8123 HA_TOKEN=xxx pip install -r app/requirements.txt
HA_URL=http://homeassistant.local:8123 HA_TOKEN=xxx python app/app.py
# open http://127.0.0.1:8100
```

## Controls by target

- **Light** — on / off / toggle, brightness slider, colour swatches + picker, colour-temp slider.
- **Switch / fan / cover / media player** — on / off / toggle.
- **Scene / script** — a big Run button.

After every action the app reads the entity state back from HA, so the UI shows reality, not optimism.

## API

| Endpoint | What |
|---|---|
| `GET /` | AR website |
| `GET /api/health` | Matcher mode, HA configured yes/no (no token), ref count |
| `GET/POST /api/settings` | Match threshold, CLIP flag only — token/ha_url rejected 403 |
| `GET /api/entities` | Controllable HA targets (fallback to known devices when HA is offline) |
| `GET/POST/DELETE /api/refs` | Reference objects |
| `POST /api/refs/<id>/photo` | Add a photo to a reference |
| `POST /api/ar/match` | Multipart `frame` (JPEG) → ranked matches + live state — the AR loop |
| `POST /api/scan` | Multipart `photo` → same, for a single still |
| `POST /api/control` | `{target_type, target_id, action, brightness_pct, rgb_color, color_temp_kelvin, ...}` — server adds the HA token |
| `GET /api/state/<entity_id>` | Live HA state |

## Project layout

```
docker-compose.yml  Dockerfile  README.md  .env.example
app/
  app.py          Flask app + API (/api/ar/match, /api/control, no-token settings)
  matcher.py      CLIP / ORB / ensemble matcher
  ha_client.py    HA REST client — token from env / Docker secret / data file ONLY
  store.py        Reference + match-settings storage (/data) — no token here
  templates/index.html   AR live view + Library + Settings
  static/app.js  static/style.css
  requirements.txt
tests/            pytest-style unit tests (no HA, no camera needed)
data/             created on first run — photos, refs.json, settings.json
```

## Tests

```bash
pip install -r app/requirements.txt
python -m pytest tests/ -q
```

## Limits, honestly

- This is phone-camera AR overlay (live video + floating controls), not WebXR / headset AR. True WebXR hit-testing needs HTTPS + ARCore/ARKit and is unreliable from a plain Flask container — the overlay approach works on any phone browser.
- Matching is *recognition of a specific object you photographed*, not general object detection. A white lamp and a different white lamp in the same light will confuse the ensemble — add a second reference angle, raise the threshold, or turn on CLIP.
- Phone camera needs HTTPS on a real phone (or localhost). If you open it over plain HTTP on LAN, use Snap & match once, or put it behind HTTPS (Cloudflare Tunnel / Caddy).
- If HA is at `http://homeassistant.local:8123` on your LAN, the container needs LAN access to reach it.
