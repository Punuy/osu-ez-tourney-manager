# osu! EZ Tourney Manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-orange.svg)](#)

**All-in-one tournament overlay & control panel for osu!mania** — designed to replace the osu!lazer tournament client with something lighter, faster, and fully customizable.

> Run one command, open two browser tabs, and you have a complete tournament broadcast system.

<!-- If you have a screenshot, uncomment and replace the path below:
![Screenshot](https://raw.githubusercontent.com/Punuy/osu-ez-tourney-manager/main/docs/screenshot.png)
-->

## ✨ Features

- 🎮 **Live scene switching** — Gameplay, Map Pool, Pick/Ban, Standby, Win, Showcase, and more
- 🎨 **Custom HTML/CSS overlays** — full creative control per scene with live preview editor
- 🖼️ **Per-scene media** — images, GIFs, or looping videos as backgrounds with dim control
- 🎬 **Scene transitions** — cross-fade or custom transition videos between scenes
- 📡 **osu!tourney IPC** — reads match state, scores, and beatmaps from osu!stable
- 📊 **tosu integration** — player accuracy, combo, HP, and multiplayer chat (optional)
- 🎥 **OBS WebSocket sync** — automatically switch OBS scenes from the panel (optional)
- 💬 **Bancho IRC** — send lobby commands and auto-set maps on pick (optional)
- 🔌 **Local REST API** — integrate with Stream Deck or any local automation
- 📦 **Zero npm dependencies** — just Node.js, no install step needed
- 📋 **osu!lazer bracket import** — compatible `bracket.json` format

## Requirements

- Windows
- Node.js 22 or later
- osu!stable with `osu!tourney` for tournament spectating
- OBS Studio for broadcast output

Optional integrations:

- [tosu](https://github.com/tosuapp/tosu) for player accuracy, combo, HP, and multiplayer chat
- OBS WebSocket for synchronizing OBS scenes with the panel
- Bancho IRC for lobby commands

No `npm install` step is required.

## Start

Run either command from the repository root:

```powershell
node server/index.js
```

Or open `START.bat`.

Default URLs:

| Purpose | URL |
| --- | --- |
| Control panel | `http://localhost:7272/panel` |
| OBS browser source | `http://localhost:7272/overlay` |

To use another port in PowerShell:

```powershell
$env:PORT=7300; node server/index.js
```

## OBS setup

1. Create a Browser Source.
2. Set its URL to `http://localhost:7272/overlay`.
3. Set its size to `1920 × 1080`.
4. Disable **Shutdown source when not visible** so the overlay keeps its state.

The overlay is designed at 1920 × 1080 and scales to the Browser Source size.

## First-time workflow

1. Open the control panel.
2. Configure teams, rounds, map pool, and matches.
3. Select the current match from the Live page.
4. In Backgrounds, select a scene and upload an image, GIF, or video if needed.
5. Open **Custom Overlay HTML / CSS** and create the scene UI. A custom overlay is rendered above the scene media.
6. Use the Live page to stage scenes and send them to Program with **FADE** or **TRANSITION**.

Each custom scene starts empty. The HTML/CSS editor controls the entire foreground of that scene.

## Media and custom overlays

Backgrounds are configured per scene.

- Supported media: `.mp4`, `.webm`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`
- Video loops automatically and is muted.
- Media is the bottom layer.
- The custom HTML/CSS overlay is the foreground layer.
- Use the dim control to darken only the media layer.

The editor popup has a live preview. Draft edits appear there before saving.

### Scene transitions

The Backgrounds page also accepts one optional transition video (`.mp4` or `.webm`).

- **FADE** performs the standard cross-fade.
- **TRANSITION** plays the uploaded video over the scene change.

## osu!tourney and live data

The application reads osu!stable FileBasedIPC files from the configured osu! directory. It receives match state, map changes, and team scores from osu!tourney.

tosu is optional. When enabled and running at the configured WebSocket address, it adds individual player data and multiplayer chat.

Set the osu! path, tosu URL, OBS WebSocket, and IRC settings in the Settings page. Settings are stored locally in `data/config.json`.

## Tournament data

Tournament data is stored in `data/bracket.json`. The structure is compatible with the osu!lazer tournament bracket format, so an existing bracket can be imported from the Settings page.

For a map pool, enter one map per line in Rounds & Pool:

```text
NM1 5730612
NM2 5786956
HD1 5821689
TB  5815671
```

Use the beatmap ID, not the beatmapset ID.

## Data directories

| Path | Purpose |
| --- | --- |
| `data/bracket.json` | Teams, rounds, matches, and map pool |
| `data/config.json` | Runtime and integration settings |
| `data/backgrounds.json` | Scene media and custom overlay settings |
| `data/backgrounds/` | Uploaded scene images, GIFs, and videos |
| `data/transitions/` | Uploaded transition video |
| `data/flags/` | Optional local team flags |
| `data/cache/` | Cached beatmap metadata |

## API

The local API can be used with Stream Deck or other local automation.

```text
POST /api/scene            {"scene":"gameplay"}
POST /api/scene            {"scene":"standby","transition":true}
POST /api/match/current    {"id":1}
POST /api/match/score      {"delta1":1}
POST /api/pickban          {"beatmapId":123,"type":"Pick","team":"Red"}
POST /api/warmup           {"value":true}
POST /api/standby          {"text":"Starting soon"}
GET  /api/state
GET  /api/events
GET  /api/export
```

`/api/events` is a Server-Sent Events stream used by the panel and overlay.

## License

[MIT](LICENSE) © Punuy
