# Deployment Workflow

This site auto-deploys to Vercel on every push to the `main` branch.

## Local dev server (with PUT support for live mocap capture)

Live mocap capture writes `motion_visitors.json` to disk via `PUT` requests. Vercel static hosting and most local dev servers (Live Server, Vite, `python -m http.server`) reject PUT. Use the bundled mini server:

```bash
cd C:\Users\petra\Downloads\00-simplest\05-fuego
node server-put.js
# Opens at http://localhost:8000/fuego-avatar.html
```

The server serves static files AND accepts PUT on `.json` and `.json.tmp` paths (atomic-ish write: tmp + rename). Use this URL when you want live mocap capture to actually persist to disk.

## Per-visitor capture archive ("grabador → reproductor")

The artwork is meant to be inhabited: each visitor's motion during live mocap is captured into a per-session archive at `motion_visitors.json`. When live mocap stops, the avatar immediately auto-activates "Replay Last Visitor" and plays back that session — no page reload needed. The default choreography in `motion_latest.json` is never touched at runtime.

File layout:

- `motion_latest.json` — committed default choreography, read-only at runtime
- `motion_visitors.json` — per-visitor archive, one entry per live mocap activation, written via PUT on stop

Each session in `motion_visitors.json` has `session_id` (ISO timestamp), `started_at`, `ended_at`, `frame_count`, `fps`, and `frames[]`. The "Grabador → Reproductor" loop is: enable Webcam Tracking → move → disable → avatar plays your motion. Repeat to replace with a new session.

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

## First-time setup (already done)

1. Created repo `Luis-Cwk/faller-homenaje-a-lxs-valientes` on GitHub
2. Connected Vercel project `faller-homenaje-a-lxs-valientes` to this repo via Vercel dashboard
3. Vercel watches `main` branch → every push triggers a new production deploy

## How to update the live site

```bash
cd C:\Users\petra\Downloads\00-simplest\05-fuego

# 1. Make your edits to fuego-avatar.html
# 2. Copy the updated file as index.html (what Vercel serves)
cp fuego-avatar.html index.html

# 3. Stage + commit + push
git add index.html
git commit -m "Describe your change"
git push origin main

# Vercel auto-detects the push and redeploys within ~30 seconds.
# Visit https://faller-homenaje-a-lxs-valientes.vercel.app to see the change.
```

## What NOT to commit

- `.vercel/` (local deployment state, gitignored)
- `__fix*.ps1` (local PowerShell helpers)
- `archive/` (old backups)
- `body.glb`, `test-rig.html`, `fuego.html`, `fuego-back.html`, `fuego-avatar.backup-pre-distributed-fire.html`, `fuego-avatar copy.html`
- `motion_visitors.json` (per-visitor capture archive, regenerated at runtime)
- `server-put.js`, `start-put-server.bat` (local dev only; Vercel serves static)

These are all already in `.gitignore`.

## Identity

- GitHub: `Luis-Cwk` (personal)
- Git commits use `dfrmnc22@gmail.com` (per-repo override)
- Global git config keeps `petra@789.mx` (work email) untouched

## Vercel credentials

- Vercel account linked to `dfrmnc22` (not the work email)
- Local `vercel login` stores encrypted credentials in `%USERPROFILE%\.vercel`
- Never commit the Vercel token — use `vercel login` or `--token` flag locally

## Live URL

https://faller-homenaje-a-lxs-valientes.vercel.app
