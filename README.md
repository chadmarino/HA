# HA App: a custom Home Assistant control app

A lightweight web app for controlling and managing Home Assistant. It runs in your browser and talks directly to your Home Assistant server over HA's own WebSocket and REST APIs. It needs no build step, no add-on and no cloud service. You can install it to your phone's home screen as an app.

## Features

**Home**
- All your devices, grouped by **area** (taken from HA's area, device and entity registries).
- Live updates: state changes from anywhere show up instantly.
- Controls for each device type:
  - lights: on/off, brightness, color temperature, color
  - switches, fans (speed), covers (open/stop/close and position), valves
  - climate and water heaters: target temperature and mode
  - locks: unlocking asks for confirmation
  - media players: transport controls and volume
  - scenes, scripts and buttons
  - input numbers, selects and booleans
  - vacuums, lawn mowers, alarm panels (prompts for a code when one is needed), updates
  - sensors, people and weather
- **Favorites**: tap ☆ on any device to pin it to the top.
- Search, filter by type, and hide diagnostic and hidden entities (configurable).
- Tap a device's name for **details**: all attributes, plus 24-hour history (a sparkline for numeric sensors).

**Automations, scripts and scenes**
- List them, enable or disable, and run now. Shows when each last ran.
- Create, edit and delete them in a YAML editor that validates as you type. They are saved through HA's config API, the same one the HA UI uses, so they land in `automations.yaml`, `scripts.yaml` and `scenes.yaml`.
- A **quick builder** for automations: *When* (an entity changes, a time, sunrise or sunset) → *Then* (turn on/off/toggle) generates the YAML for you.
- Automations defined in hand-written YAML packages can be viewed but are read-only.

**Tools** (admin users)
- **Actions**: call any action with autocomplete, field docs, example data, and an option to return the response.
- **Template**: a live Jinja2 template playground.
- **States**: browse and filter every entity.
- **System**: check your configuration, reload automations, scripts, scenes or all YAML, and restart (the config is checked first).

**Other**
- Log in with your normal Home Assistant account (OAuth), or with a long-lived access token.
- Light and dark themes, a phone layout with a bottom tab bar, and reconnects automatically.

## Install on Home Assistant (recommended)

Serving the app from HA itself avoids all CORS and mixed-content issues. If you're already logged into HA in that browser, it signs you in automatically.

1. Copy the `app/` folder to `/config/www/ha-app/` on your HA server. You can do this in any of these ways:
   - **SSH** (the "Advanced SSH & Web Terminal" add-on): `HA_HOST=homeassistant.local ./tools/deploy.sh`
   - **Samba share** add-on: copy `app/*` into `config/www/ha-app/`.
   - **Studio Code Server** or **File editor** add-on: upload the files there.
2. If `/config/www` didn't exist before, restart Home Assistant once.
3. Open `http://<your-ha>:8123/local/ha-app/index.html`.
4. Optional, to add it to the HA sidebar: go to **Settings → Dashboards → Add dashboard → Webpage**, and set the URL to `/local/ha-app/index.html`.
5. Optional, on your phone: open the URL in your browser and choose **Add to Home Screen**.

> Files in `/local/` can be fetched without logging in, but this app's files contain no secrets. Your login token is kept only in your browser's local storage.

To update, pull this repo and run the deploy step again.

## Run it anywhere else

You can also host `app/` on any static web server. If it isn't on the same origin as HA, add this to HA's `configuration.yaml` and restart:

```yaml
http:
  cors_allowed_origins:
    - https://your-app-host.example
```

Browsers block an `https://` page from talking to `http://` HA (and the reverse), so use the same scheme on both.

## Development

```bash
npm install
npm run dev     # fake Home Assistant + the app at http://localhost:8123/local/ha-app/
                # token: mock-token (or click "Log in with Home Assistant")
npm test        # end-to-end tests in headless Chromium against the mock server
```

The simulated house and API logic live in `demo/mock-core.js`. `tools/mock-ha.mjs` serves it over real HTTP and WebSockets for development and tests. `demo/` runs the same simulation inside the page, which is how the published click-through demo works.

### Layout

```
app/                  ← everything that gets deployed
  index.html, manifest.webmanifest, icon.svg, css/app.css
  js/ha.js            HA client: WebSocket, REST, OAuth/token auth, auto-reconnect
  js/store.js         shared state and preferences
  js/cards.js         device cards and their controls
  js/views/*.js       home, details, automations, tools, settings and login
  vendor/js-yaml.mjs  YAML parser (MIT)
demo/mock-core.js     simulated house and HA APIs (shared)
demo/browser.js       in-page fake WebSocket/fetch for the browser demo
demo/index.html       demo page
tools/mock-ha.mjs     mock Home Assistant server
tools/e2e.mjs         Playwright end-to-end tests
tools/deploy.sh       copy app/ to /config/www/ha-app over SSH
```
