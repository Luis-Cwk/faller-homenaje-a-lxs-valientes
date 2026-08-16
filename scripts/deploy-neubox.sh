#!/bin/bash
# deploy-neubox.sh — Stage and upload Faller to petrasynthetic.com/faller/
#
# Pipeline:
#   1. Read JWT from .env-faller (gitignored)
#   2. Copy fuego-avatar.html -> temp dir as index.html
#   3. Inject <meta name="pinata-jwt" content="{jwt}"> after <meta charset="utf-8">
#   4. Update cache-bust suffixes (audio.js?cb=, motion_latest.json?cb=, pinata.js?cb=)
#   5. Copy audio.js, motion_latest.json, pinata.js to temp dir
#   6. Backup fuego-avatar.html to archive/ before mutating
#   7. Upload 4 files via curl -T to Neubox FTP
#   8. Verify SHA256 byte-for-byte against HTTPS prod
#
# Usage:
#   bash scripts/deploy-neubox.sh               # real deploy
#   bash scripts/deploy-neubox.sh --dry-run     # stage only, no FTP, no backup
#
# Requires:
#   - bash + curl + sha256sum (Windows MSYS / git-bash works)
#   - .env-faller with `jwt: <long-jwt>` line
#
# The Neubox FTP URL is hardcoded — adjust if your hosting changes.

set -euo pipefail

# ---- Config ---------------------------------------------------------------

# REPO_ROOT in Windows-native form (C:/Users/...) so Python sees the right path
REPO_ROOT_WIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -W 2>/dev/null)"
# Some MSYS versions return both forms glued together ("C:/path /c/path")
# Take the first token (Windows form comes first when pwd -W succeeds).
REPO_ROOT_WIN="$(echo "$REPO_ROOT_WIN" | awk '{print $1}')"
# If pwd -W didn't work (older MSYS), fall back to converting /c/Users -> C:/Users
if [[ "$REPO_ROOT_WIN" == /c/* ]]; then
  REPO_ROOT_WIN="C:${REPO_ROOT_WIN:2}"
elif [[ "$REPO_ROOT_WIN" == /[a-z]/* ]]; then
  REPO_ROOT_WIN="$(echo "${REPO_ROOT_WIN:1:1}" | tr '[:lower:]' '[:upper:]'):${REPO_ROOT_WIN:2}"
fi

TEMP_DIR="C:/Users/petra/AppData/Local/Temp/faller-upload"
ENV_FILE="${REPO_ROOT_WIN}/.env-faller"
ARCHIVE_DIR="${REPO_ROOT_WIN}/archive"
SOURCE_HTML="${REPO_ROOT_WIN}/fuego-avatar.html"

# FTP creds for huaca@petrasynthetic.com (URL-encoded @ as %40)
FTP_BASE="ftp://huaca%40petrasynthetic.com:jx0WLK8Fm6OfYJpm@ftp.petrasynthetic.com/faller"

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  echo "[dry-run] Will stage files but skip FTP upload and backup."
fi

# ---- Step 1: Read JWT -----------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  echo "[FAIL] .env-faller not found at $ENV_FILE"
  echo "       Generate a scoped Pinata key (V3 Files Write + Legacy pinFile) and put it in this file."
  echo "       Format: jwt: <long-jwt-string>"
  exit 1
fi

JWT="$(grep -E '^jwt:' "$ENV_FILE" | head -1 | sed -E 's/^jwt:[[:space:]]*//')"
if [ -z "$JWT" ]; then
  echo "[FAIL] No 'jwt:' line found in $ENV_FILE"
  exit 1
fi

if [ "${#JWT}" -lt 100 ]; then
  echo "[FAIL] JWT in .env-faller is suspiciously short (${#JWT} chars). Aborting."
  exit 1
fi

echo "[1/8] JWT read (${#JWT} chars)"

# ---- Step 2: Prepare temp dir --------------------------------------------

mkdir -p "$TEMP_DIR"
mkdir -p "$ARCHIVE_DIR"

# Wipe temp dir to avoid stale files
for f in "$TEMP_DIR"/*; do
  [ -e "$f" ] && rm -f "$f"
done

echo "[2/8] Temp dir cleared: $TEMP_DIR"

# ---- Step 3: Backup source HTML -------------------------------------------

if [ "$DRY_RUN" = false ]; then
  TS=$(date +%s)
  BACKUP="${ARCHIVE_DIR}/fuego-avatar.html.bak-before-deploy-${TS}"
  cp "$SOURCE_HTML" "$BACKUP"
  echo "[3/8] Backup created: $BACKUP"
else
  echo "[3/8] (dry-run) Skipped backup of $SOURCE_HTML"
fi

# ---- Step 4: Stage HTML with injected meta tag + cache-bust --------------

CB=$(date -u +%Y%m%d-%H%M%S)
INDEX_HTML="${TEMP_DIR}/index.html"

# Delegate the Python-side work to a separate script (cleaner than
# passing complex bash vars through `python -c` strings).
python "${REPO_ROOT_WIN}/scripts/stage_index_html.py" \
    "${SOURCE_HTML}" "${JWT}" "${CB}" "${INDEX_HTML}"

# ---- Step 5: Copy public assets ------------------------------------------

cp "${REPO_ROOT_WIN}/audio.js"           "${TEMP_DIR}/audio.js"
cp "${REPO_ROOT_WIN}/motion_latest.json" "${TEMP_DIR}/motion_latest.json"
cp "${REPO_ROOT_WIN}/pinata.js"          "${TEMP_DIR}/pinata.js"

echo "[5/8] Copied audio.js, motion_latest.json, pinata.js"

# ---- Step 6: Confirm no JWT leaked into public files (belt + suspenders) -

LEAKED=$(grep -l "eyJhbG" "$TEMP_DIR"/* 2>/dev/null || true)
# The only file allowed to contain the JWT is index.html (which has it via meta tag).
# audio.js / motion_latest.json / pinata.js must NOT contain it.
if echo "$LEAKED" | grep -qE "audio\.js|motion_latest\.json|pinata\.js"; then
  echo "[FAIL] JWT leaked into a public asset. Aborting before FTP."
  exit 1
fi
echo "[6/8] No JWT leaked into public assets"

# ---- Step 7: Upload via FTP ----------------------------------------------

if [ "$DRY_RUN" = true ]; then
  echo "[7/8] (dry-run) Skipped FTP upload"
  echo ""
  echo "Staged files in $TEMP_DIR:"
  ls -lh "$TEMP_DIR"
  echo ""
  echo "First 200 chars of staged index.html:"
  head -c 200 "$INDEX_HTML"
  echo ""
  exit 0
fi

echo "[7/8] Uploading 4 files to Neubox..."
for fname in index.html audio.js motion_latest.json pinata.js; do
  STATUS=$(curl -sS -T "${TEMP_DIR}/${fname}" "${FTP_BASE}/${fname}" -w "%{http_code} %{size_upload}" -o /dev/null)
  echo "       ${fname}: HTTP ${STATUS}"
done

# ---- Step 8: Verify SHA256 against HTTPS ----------------------------------

echo "[8/8] Verifying SHA256 byte-for-byte against prod..."
ALL_OK=true
for fname in index.html audio.js motion_latest.json pinata.js; do
  LOCAL=$(sha256sum "${TEMP_DIR}/${fname}" | awk '{print $1}')
  # Use ?nocache query to bypass nginx cache for the verification read
  REMOTE=$(curl -s "https://petrasynthetic.com/faller/${fname}?nocache=${RANDOM}" | sha256sum | awk '{print $1}')
  if [ "$LOCAL" = "$REMOTE" ]; then
    echo "       OK  ${fname}"
  else
    echo "       FAIL ${fname} (local=${LOCAL:0:16}... remote=${REMOTE:0:16}...)"
    ALL_OK=false
  fi
done

if [ "$ALL_OK" = true ]; then
  echo ""
  echo "[done] Deploy complete. Cache-bust: ?cb=${CB}"
  echo "       Visit https://petrasynthetic.com/faller/?v=${CB} to verify."
else
  echo ""
  echo "[WARN] Some files did not SHA-match. nginx may still be serving cached versions."
  echo "       Wait ~1h for cache to clear and re-run with --skip-upload to just verify."
  exit 2
fi
