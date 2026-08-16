#!/usr/bin/env python3
"""stage_index_html.py — Prepare index.html for Neubox deploy.

Reads the source fuego-avatar.html, injects a <meta name="pinata-jwt"> tag
with the JWT from .env-faller, updates cache-bust suffixes on local assets,
and writes the result to a temp directory as index.html.

Used by deploy-neubox.sh. Can also be run directly:
    python scripts/stage_index_html.py <source_html> <jwt> <cb> <dest_html>

Args:
    source_html: absolute path to fuego-avatar.html
    jwt: Pinata scoped key JWT
    cb: cache-bust timestamp (e.g. 20260816-224917)
    dest_html: absolute path where to write the staged index.html
"""

import re
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 5:
        print(f"usage: {sys.argv[0]} <source_html> <jwt> <cb> <dest_html>", file=sys.stderr)
        sys.exit(1)

    source_html = Path(sys.argv[1])
    jwt = sys.argv[2]
    cb = sys.argv[3]
    dest_html = Path(sys.argv[4])

    if not source_html.exists():
        print(f"[FAIL] source HTML not found: {source_html}", file=sys.stderr)
        sys.exit(1)

    src = source_html.read_text(encoding="utf-8")

    # 0. Inject <meta http-equiv="Cache-Control" content="no-cache"> to bust
    #    nginx caches when the user does a hard refresh. Petra's site has
    #    nginx caching with Vary: Accept-Encoding,User-Agent that holds onto
    #    stale HTML for ~1h after deploy. The cache-bust on asset URLs helps
    #    the JS reload, but the HTML itself needs the meta tag too.
    cache_meta = '  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n'
    cache_meta_pragma = '  <meta http-equiv="Pragma" content="no-cache">\n'
    cache_meta_expires = '  <meta http-equiv="Expires" content="0">\n'
    if 'http-equiv="Cache-Control"' not in src:
        src = src.replace(
            '<meta charset="utf-8">',
            '<meta charset="utf-8">\n' + cache_meta + cache_meta_pragma + cache_meta_expires,
            1,
        )

    # 1. Inject <meta name="pinata-jwt"> after <meta charset="utf-8"> if not present.
    #    If already present (re-deploy), replace it.
    meta_tag = f'  <meta name="pinata-jwt" content="{jwt}">\n'
    if 'name="pinata-jwt"' in src:
        print("[warn] pinata-jwt meta tag already present, replacing it")
        src = re.sub(
            r'<meta\s+name="pinata-jwt"\s+content="[^"]*">\s*\n?',
            meta_tag.rstrip() + "\n",
            src,
            count=1,
        )
    else:
        src = src.replace(
            '<meta charset="utf-8">',
            '<meta charset="utf-8">\n' + meta_tag,
            1,
        )

    # 2. Update cache-bust suffixes on local assets (force ?cb=NEWCB).
    for asset in ("audio.js", "motion_latest.json", "pinata.js"):
        pattern = re.compile(rf"{re.escape(asset)}(\?cb=[0-9\-]+)?")
        if pattern.search(src):
            src = pattern.sub(f"{asset}?cb={cb}", src)

    dest_html.write_text(src, encoding="utf-8")
    print(f"[4/8] Staged index.html ({len(src):,} bytes, cb={cb})")


if __name__ == "__main__":
    main()
