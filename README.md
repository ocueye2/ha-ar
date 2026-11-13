# Home Assistant AR

A self-hosted, mobile-first AR control panel for Home Assistant. The app runs as a static React site in one Nginx Docker container. It uses Home Assistant's browser OAuth flow and WebSocket client for live entity state and service calls. Image targets are compiled locally in the browser with MindAR; camera frames are not uploaded.

> **Status:** MVP / starter implementation. The app has not yet been tested against your Home Assistant instance or on your iPhone. Image tracking performance depends on the reference image, lighting, camera focus, and device. Treat this as a working project baseline, not a certified production release.

## Features

- Home Assistant OAuth login and WebSocket state subscriptions.
- Automatic entity discovery and search.
- Add an AR device by choosing an HA entity and capturing/uploading a reference image.
- Compile image targets in the browser and save configuration locally.
- Camera view with MindAR image tracking and live device overlay controls.
- Basic light, climate, cover, media-player and switch controls.
- Docker Compose deployment with Nginx and a health endpoint.

## Run with Docker

```bash
git clone <your-repository-url> homeassistant-ar
cd homeassistant-ar
docker compose up -d --build
```

Open `http://<docker-host>:8085` to view the app. For iPhone camera access, publish it behind HTTPS using your reverse proxy. Browsers only allow camera access in secure contexts (HTTPS or localhost).

## Home Assistant connection

1. Open the site and go to **Settings**.
2. Enter your Home Assistant URL, for example `https://ha.example.com`.
3. Complete the Home Assistant login/authorization flow.
4. If Home Assistant is on another origin, make sure its HTTP integration allows the app's origin for OAuth/CORS. Do not disable authentication or expose Home Assistant directly to the public internet.
5. Open **Devices**, select an entity, add a clear reference photo, and save.
6. Return to the camera and point at the saved image.

The browser OAuth flow stores refresh/access tokens in this browser's local storage. Use a dedicated Home Assistant user with only the permissions needed for the devices you want to control. Anyone with access to this browser profile may be able to use its active session.

## Reverse proxy

Proxy HTTPS traffic to the container's port 80. Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:8085;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
}
```

No websocket proxy is needed on the app's Nginx container; the browser opens the Home Assistant WebSocket directly.

## Configuration and storage

The current MVP stores configuration, image data, compiled `.mind` target data, and OAuth tokens in the browser's local storage. They are not stored in the container. This means:

- The same browser profile retains its devices after container restarts.
- A different browser/device has its own configuration.
- Clearing site data removes the local configuration and login session.
- Reference photos are shrunk to 640px (JPEG) when added, and the compiled target file is stored alongside them, so each device costs roughly 100–300 KB of the browser's ~5 MB local-storage limit. If storage fills up, delete a device to make room.

## Notes / limitations

- The current AR view displays a detected-device control panel in the camera view. The tracking anchor is indicated with a reticle; the controls are not yet spatially pinned to the exact physical surface.
- MindAR uses image targets, not general object recognition. It recognizes the reference image/visual appearance you register; it does not identify arbitrary products by their object shape.
- Image targets are compiled together whenever a device is added or removed. Recompilation can take time on a phone.
- Some entities may not support every displayed service. Home Assistant will return an error if a service is unsupported or the entity is unavailable.
- OAuth requires a secure, correctly configured Home Assistant origin. For cross-origin hosting, configure the allowed origin in Home Assistant's HTTP integration and verify the redirect flow.
- The current app is single-user per browser profile and does not include a server-side user database, multi-user sharing, or backups.

## Development

Use Node 22 (see `.nvmrc` — the Dockerfile builds with node:22 too). On newer
Node, `npm install` fails building the `canvas` native module (mind-ar
dependency) because there is no prebuilt binary for it; on Node 22 install
with `npm install --ignore-scripts` if the native build is not needed, since
the browser build does not use it.

```bash
npm install
npm run dev
```

Then open the Vite address from a secure context for camera testing. Build the production site with:

```bash
npm run build
```

## Project structure

```text
src/
  components/     Device cards and Home Assistant controls
  lib/            Home Assistant connection, target compilation, storage
  pages/          Camera, device setup, settings
  main.tsx        App state and navigation
  style.css       Mobile-first Home Assistant-inspired UI
```
