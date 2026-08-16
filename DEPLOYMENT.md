# Deployment Workflow

This project deploys to **two destinations**:

1. **Production (canonical)** — `petrasynthetic.com/faller/` via Neubox FTP. Has the Pinata JWT injected so per-visitor capture works in IPFS.
2. **Backup (mirror)** — `faller-homenaje-a-lxs-valientes.vercel.app` via Vercel auto-deploy on push to `main`. No JWT in the public repo, so capture is disabled there (graceful fallback).

---

## Per-visitor capture archive ("grabador → reproductor")

The artwork is meant to be inhabited: each visitor's motion during live mocap is captured into a per-session archive on **IPFS via Pinata**. When live mocap stops, the avatar immediately auto-activates "Replay Last Visitor" and plays back that session from the gateway — no page reload needed. The default choreography in `motion_latest.json` is never touched at runtime.

### How it works

- `pinata.js` (4.3 KB, no deps) provides `init() / pinJSON() / unpin() / fetchJSON()`.
- Each flush pins the session's full frame array to IPFS via `/pinning/pinFileToIPFS` (multipart). Pinata returns a CID.
- A manifest of `{ session_id, cid }` pairs is kept in `localStorage` (key `faller:visitor-manifest`).
- On page load, the last CID in the manifest is fetched from `https://gateway.pinata.cloud/ipfs/{cid}` and played back.

### Why IPFS instead of local disk

Static hosts (Neubox, Vercel, GitHub Pages, Netlify) reject `PUT`/`POST` on JSON files. The previous approach (write to `motion_visitors.json` via PUT) only worked in local dev with `server-put.js`. IPFS via Pinata works everywhere static files work.

### Storage layout

- `motion_latest.json` — committed default choreography, read-only at runtime (unchanged).
- `motion_visitors.json` — **deprecated**. Old code path is gone. If you see references to it in old logs, that's stale code from a previous deploy.

Each session in IPFS has `session_id` (ISO timestamp), `started_at`, `ended_at`, `frame_count`, `fps`, and `frames[]`. The "Grabador → Reproductor" loop is: enable Webcam Tracking → move → disable → avatar plays your motion from IPFS. Repeat to replace with a new session.

---

## Local dev server

Live mocap capture is IPFS-backed now, so any static server works. No PUT server needed.

```bash
cd C:\Users\petra\Downloads\00-simplest\05-fuego
python -m http.server 8000
# Opens at http://localhost:8000/fuego-avatar.html
```

`pinata.init()` will auto-detect the JWT from `.env-faller` in the same directory. If the file is missing, capture is disabled (warning in console: `[pinata] No JWT found...`).

The old `server-put.js` and `start-put-server.bat` are still in the repo (gitignored) but no longer needed. Delete them whenever.

---

## Generative audio (`audio.js`)

The campfire soundscape is built procedurally with Tone.js. Six layers stack into reverb + limiter:

1. **Drone** — three detuned sawtooth oscillators in D minor (D2, F2, A1). The fire's "breath".
2. **Wind** — pink noise through a slowly-modulated lowpass filter.
3. **Crackles** — three profiles (dry/wet/thick) with weighted random selection (55/30/15). Dry = white HP 2.5kHz short. Wet = pink BP 900Hz mid. Thick = brown LP 600Hz long.
4. **Ember bed** — pink noise through BP 3kHz + slow LFO. Constant "shhhhh" substrate.
5. **Wood resonance** — slow pops every 4-12s with BP 350Hz. Logs settling.
6. **3D pops** — pink noise through BP 800Hz, every 8-15s, positioned via `Panner3D` (HRTF) in a ring around the listener. Use headphones for best effect.

### Reactive audio API

The render loop computes per-joint velocity from MediaPipe landmarks, averages across all avatars, and calls `window.setFireIntensity(0..1)` to modulate the drone, ember bed, and crackle layers. Dancers still → fire settles to 0.2 floor. Dancers moving fast → fire rages toward 1.0. Exponential smoothing (factor 0.06/frame) prevents audible clicks.

Default intensity is 0.35 — pleasant out-of-the-box when the API is never called. Toggle audio via the Inspector "Audio" slider; user gesture required on first activation to unlock the AudioContext.

---

## How to update the live site

### Step 1 — Edit source

```bash
cd C:\Users\petra\Downloads\00-simplest\05-fuego
# Edit fuego-avatar.html (the source of truth)
# Edit pinata.js (the Pinata module)
# Edit audio.js (the audio graph)
```

### Step 2 — Deploy to Vercel (backup, mirror)

```bash
# Copy source HTML to index.html (Vercel serves index.html)
cp fuego-avatar.html index.html

# Confirm no JWT leaked into the public HTML
grep -c "eyJhbG" index.html   # MUST be 0

# Commit + push
git add index.html fuego-avatar.html pinata.js audio.js
git commit -m "Describe your change"
git push origin main

# Vercel auto-detects within ~30s
# Visit https://faller-homenaje-a-lxs-valientes.vercel.app
```

### Step 3 — Deploy to Neubox (production, with JWT)

**This step is what actually matters** — Vercel is a mirror. The canonical live site is `petrasynthetic.com/faller/` and needs the Pinata JWT injected as a `<meta>` tag.

#### Option A — Manual deploy via FTP

```bash
# 1. Stage the upload (copy + cache-bust + inject meta tag)
mkdir -p "C:/Users/petra/AppData/Local/Temp/faller-upload"

# 2. Backup the current source before mutating
cp fuego-avatar.html "archive/fuego-avatar.html.bak-before-deploy-$(date +%s)"

# 3. Inject <meta name="pinata-jwt"> from .env-faller
#    (the deployment script is at scripts/deploy-neubox.sh — see below)
bash scripts/deploy-neubox.sh
```

The `scripts/deploy-neubox.sh` script does:

1. Reads JWT from `.env-faller` (line starting with `jwt:`).
2. Copies `fuego-avatar.html` → temp upload dir as `index.html`.
3. Injects `<meta name="pinata-jwt" content="{jwt}">` into the temp `index.html` right after `<meta charset="utf-8">`.
4. Updates cache-bust suffixes (`audio.js?cb=...`, `motion_latest.json?cb=...`, `pinata.js?cb=...`).
5. Uploads 4 files to Neubox via `curl -T`:
   - `index.html`
   - `audio.js`
   - `motion_latest.json`
   - `pinata.js`
6. Verifies SHA256 byte-for-byte against `https://petrasynthetic.com/faller/{file}` (with `?nocache=...` to bypass nginx cache).

#### Option B — Dry-run first (test the meta injection without uploading)

```bash
bash scripts/deploy-neubox.sh --dry-run
```

This writes the prepared `index.html` to the temp dir and prints its size + first lines. Inspect it before doing the real upload.

#### What if the JWT expires?

Pinata scoped keys live forever (or until revoked). The current `faller-visitors` key has `exp: 1818297362` (Aug 2027). When it expires:

1. Generate a new scoped key at https://app.pinata.cloud/developers/api-keys (V3 Files Write + Groups Write + Legacy pinFile/pinByHash/pinJSON/unpin, no admin, no delete).
2. Replace the `jwt:` line in `.env-faller`.
3. Re-run `bash scripts/deploy-neubox.sh`.

The repo never sees the new JWT — it only ever lives in `.env-faller` (gitignored) and in the FTP-uploaded `index.html` on Neubox.

---

## What NOT to commit

- `.vercel/` (local deployment state, gitignored)
- `.env-faller` (Pinata JWT, gitignored) — **never** paste the JWT into any tracked file
- `__fix*.ps1` (local PowerShell helpers)
- `archive/` (old backups)
- `body.glb`, `test-rig.html`, `fuego.html`, `fuego-back.html`, `fuego-avatar.backup-pre-distributed-fire.html`, `fuego-avatar copy.html`
- `motion_visitors.json` (deprecated — capture is IPFS now)
- `server-put.js`, `start-put-server.bat` (local dev only; legacy, safe to delete)
- `fuego-avatar.html.bak-before-deploy-*` (per-deploy backups land in `archive/`)

All already in `.gitignore`.

---

## Identity

- GitHub: `Luis-Cwk` (personal)
- Git commits use `dfrmnc22@gmail.com` (per-repo override)
- Global git config keeps `petra@789.mx` (work email) untouched

---

## Live URLs

- **Production (canonical):** https://petrasynthetic.com/faller/ — has Pinata, per-visitor capture works
- **Backup (mirror):** https://faller-homenaje-a-lxs-valientes.vercel.app — same code, no JWT, capture disabled (graceful)

Both serve the same `fuego-avatar.html` source. Neubox is the one that gets the JWT meta tag at deploy time.
