# Deployment Workflow

This site auto-deploys to Vercel on every push to the `main` branch.

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