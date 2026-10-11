# TrailPulse — Offline-First Nature Audio Guide

> **"Touch Grass, Screen Off"**: A zero-screen-time nature audio guide for Hacktoberfest 2026. Hikers prepare a trail tour at home, then hike with their phone locked in their pocket while spatial background GPS triggers ambient naturalist audio vignettes directly through wireless earbuds.

[![Hacktoberfest 2026](https://img.shields.io/badge/Hacktoberfest-2026%20Touch%20Grass-brightgreen)](https://hacktoberfest.com/)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-trailpulse.onrender.com-10b981?logo=render)](https://trailpulse.onrender.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-100%25%20Offline%20Ready-green)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![Open Weights: Gemma 2](<https://img.shields.io/badge/AI-Gemma%202%20(9B)-blue>)](https://ai.google.dev/gemma)
[![Audio: ElevenLabs](https://img.shields.io/badge/Audio-ElevenLabs%20TTS-orange)](https://elevenlabs.io)

---

## The Philosophy: "Zero Screen-Time Outdoors"

Modern outdoor technology suffers from a paradox: apps intended to enhance time in nature (plant identifiers, digital maps, peak finders) pull the user’s eyes directly toward glass screens. Hikers stop at vistas, open apps, scan menus, and read paragraphs of text while ignoring the physical landscape around them. Furthermore, backcountry recreation frequently occurs in complete cellular dead zones where conventional cloud-hosted AI APIs fail entirely.

**TrailPulse inverts this interaction model by treating the screen as an obstacle to be minimized.**

```
┌────────────────────────────────────────────────────────┐
│ Pre-Trip Preparation Phase (Connected: Home / Cellular) │
└───────────────────────────┬────────────────────────────┘
                            │ Uploads GPX Track
                            ▼
           ┌─────────────────────────────────┐
           │  Express Orchestration Server   │
           └──────┬───────────────────┬──────┘
                  │                   │
                  ▼                   ▼
       ┌───────────────────────┐ ┌──────────────────────┐
       │     OpenStreetMap /   │ │  Gemma 2 (9B / 2B)   │
       │   Overpass API (POIs) │ │ Nature Vignette Gen  │
       └───────────────────────┘ └──────────┬───────────┘
                                            │
                                            ▼
                                 ┌──────────────────────┐
                                 │  ElevenLabs TTS API  │
                                 └──────────┬───────────┘
                                            │
                                            ▼
                          Streamed ZIP: [manifest.json + *.mp3]
                                            │
┌───────────────────────────────────────────┴─────────────┐
│  On-Trail Active Phase (Disconnected: 100% Offline PWA) │
├─────────────────────────────────────────────────────────┤
│ 1. Browser IndexedDB stores MP3 blobs & coordinates.    │
│ 2. navigator.geolocation tracks satellite GPS.          │
│ 3. Haversine Spatial Geofence detects waypoint distance.│
│ 4. HTML5 Audio plays narration into earbuds.            │
│ 5. MediaSession API binds metadata to lock screen.      │
└─────────────────────────────────────────────────────────┘
```

---

## Key Features

1. **At-Home Trail Preparation & 1-Click Curated Demos**:
   - Accepts standard `.gpx` tracks or 1-click pre-packaged circuits (**Red Fort Quick Tour** & **Humayun's Tomb Garden**).
   - Generates 30–45s bite-sized, tactile naturalist & heritage vignettes via **Gemma 2** (strict word count and zero conversational filler).
   - Synthesizes narration via **ElevenLabs** (with pure JS PCM WAV fallback tone).
   - Compiles and streams a compressed `trail_bundle.zip` unpacked entirely client-side into IndexedDB.

2. **100% Disconnected Offline PWA**:
   - In-memory ZIP extraction via `fflate` into client RAM.
   - Audio blobs stored directly in browser **IndexedDB** (`idb-keyval`).
   - Full Service Worker offline caching via `vite-plugin-pwa` and Workbox.

3. **Pocket Mode (Lock Screen Geofencing)**:
   - High-contrast outdoor HUD (forest green `#0f2d1e`, slate moss `#1b3b2b`, bioluminescent emerald `#4ade80`).
   - Satellite GPS tracking with dynamic Haversine distance calculations.
   - 25m proximity trigger with 10-minute cooldown hysteresis (prevents re-triggering on switchbacks).
   - Full `navigator.mediaSession` integration: displays landmark names on phone lock screens and supports Bluetooth earbud tap controls (play/pause).
   - Built-in **GPS Simulator (Virtual Hiker)** to test geofence triggers right from the browser.

---

## Monorepo Architecture

```
trailpulse/
├── package.json               # Root scripts: install:all, build, start
├── server/
│   ├── package.json           # Backend dependencies
│   ├── server.js              # Express API & serves client/dist in production
│   └── services/
│       ├── gpxParser.js       # GPX to GeoJSON & waypoint sampling
│       ├── overpassService.js # OpenStreetMap Overpass POI query (400m)
│       ├── gemmaService.js    # Local/remote Gemma 2 runner & naturalist fallback
│       └── audioService.js    # ElevenLabs TTS & pure JS PCM WAV synthesizer
└── client/
    ├── package.json           # Frontend dependencies
    ├── vite.config.js         # Configured with vite-plugin-pwa
    ├── index.html             # Standalone PWA entry point
    └── src/
        ├── main.jsx           # App mount and service worker registration
        ├── App.jsx            # Main UI state machine & Pocket Mode HUD
        ├── styles.css         # High-contrast outdoor dark forest theme
        ├── data/
        │   └── sampleTrails.js # Red Fort & Humayun's Tomb 45s demo registry
        └── services/
            ├── zipService.js      # In-memory RAM unzipper & IndexedDB storage
            └── geofenceEngine.js  # Haversine spatial engine & MediaSession player

```

---

## Quick Test for Evaluators (60s Desk Demo)

No hiking or local environment setup required:

1. Open the **[Live Demo](https://trailpulse.onrender.com/)** on desktop or mobile.
2. Under **Curated 1-Click Demo Trails**, choose **Red Fort Quick Tour** or **Humayun's Tomb Garden**.
3. Tap **Load & Explore**.
4. Tap **GPS Simulator** to simulate the route. Watch the distance drop in the HUD and listen as the entry chime and audio vignette automatically fire within 40m of the landmark.

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Local Development

Terminal 1 (Frontend):

```bash
npm run dev:client
```

### 3. Start the Server

Terminal 2 (Backend):

```bash
npm run dev:server
```

### 4. Production Build & Start

# Builds both client and server workspaces

```bash
npm run build
```

# Starts the compiled production server

```bash
npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser or mobile device.

---

## Environment Variables (Optional)

Create a `.env` file in `server/` to configure live external APIs:

```env
# ElevenLabs Speech Synthesis (optional - pure JS harmonic WAV chime used if omitted)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM

# Local / Remote Gemma 2 Model Runner (optional - sensory naturalist fallback used if offline)
GEMMA_API_URL=http://localhost:11434/api/generate
GEMMA_MODEL=gemma2:9b

# Server Port
PORT=3000
```

> **Note**: TrailPulse is built with **zero external dependencies required for testing**. If Ollama or ElevenLabs are not configured, the backend automatically provides evocative naturalist scripts and acoustic harmonic chime audio buffers so that the entire preparation, unzipping, and geofence trigger pipeline works 100% out-of-the-box!

---

## Testing & Verification

Run the automated service and HTTP integration suites:

```bash
# Unit test GPX parsing, Overpass POIs, Gemma word counts, and audio synthesis:
node server/test-bundle.js

# Test live Express endpoints, static SPA serving, and ZIP generation:
node server/test-http.js
```

---

## Field Usage Guide

1. **Before the Walk (At Home / Wi-Fi)**:
   - Visit TrailPulse on your mobile browser.
   - Upload any custom `.gpx` file or tap **"Load & Explore"** on a curated demo trail.
   - The app unpacks coordinates and audio blobs directly into local IndexedDB.
2. **At the Trailhead / Landmark**:
   - Tap **"Start Walk (Screen Off)"**.
   - Connect wireless earbuds.
   - Lock your phone and place it in your pocket.
3. **On the Move**:
   - As you approach within 25–40m of a landmark, a subtle chime sounds, followed immediately by spatial narration.
   - Use lock-screen media controls or earbud taps to pause or resume playback.

---

## License

MIT License. Built for Hacktoberfest 2026.
