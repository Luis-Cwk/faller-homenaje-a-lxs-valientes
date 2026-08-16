// pinata.js — Pinata IPFS module for Faller per-visitor capture
// Loads JWT from <meta name="pinata-jwt"> (injected at deploy time) or .env-faller (local dev)
// Pins JSON blobs via /pinning/pinFileToIPFS multipart (legacy endpoint, only one that works
// with scoped keys in 2026 — /pinning/pinJSON and /v3/files both return 404)
//
// API:
//   await pinata.init()        — load JWT
//   await pinata.pinJSON(obj)  — returns CID string
//   await pinata.unpin(cid)    — cleanup
//   await pinata.fetchManifest(cid) — fetch + parse JSON from IPFS gateway

const pinata = (() => {
  const PINATA_API = 'https://api.pinata.cloud';
  // Gateway: use the default public one (works for any pinned CID, no auth needed)
  const GATEWAY = 'https://gateway.pinata.cloud/ipfs';

  let jwt = null;

  async function init() {
    if (jwt) return jwt;

    // 1. Try <meta name="pinata-jwt"> in HTML head (deploy-time injection)
    const meta = document.querySelector('meta[name="pinata-jwt"]');
    if (meta && meta.content && meta.content.length > 50) {
      jwt = meta.content.trim();
      console.log('[pinata] JWT loaded from <meta> tag (deploy-time)');
      return jwt;
    }

    // 2. Try fetch .env-faller (local dev only — will 404 in prod)
    try {
      const r = await fetch('.env-faller');
      if (r.ok) {
        const text = await r.text();
        const match = text.match(/^jwt:\s*(.+)$/m);
        if (match) {
          jwt = match[1].trim();
          console.log('[pinata] JWT loaded from .env-faller (local dev)');
          return jwt;
        }
      }
    } catch (e) {
      // ignore — prod will hit this
    }

    console.warn('[pinata] No JWT found. Per-visitor capture will be DISABLED (replay only).');
    return null;
  }

  function buildMultipart(filename, jsonContent) {
    const boundary = '----FallerPinataBoundary' + Math.random().toString(36).slice(2);
    const head = `--${boundary}\r\n` +
                 `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
                 `Content-Type: application/json\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const body = head + jsonContent + tail;
    return {
      body,
      contentType: `multipart/form-data; boundary=${boundary}`
    };
  }

  async function pinJSON(obj, nameHint = 'faller-session') {
    if (!jwt) {
      throw new Error('pinata not initialized — call init() first');
    }
    const filename = `${nameHint}-${Date.now()}.json`;
    const jsonContent = JSON.stringify(obj);
    const { body, contentType } = buildMultipart(filename, jsonContent);

    const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': contentType
      },
      body
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`pinFileToIPFS failed: HTTP ${res.status} — ${errText.slice(0, 200)}`);
    }

    const j = await res.json();
    if (!j.IpfsHash) {
      throw new Error('pinFileToIPFS returned no IpfsHash');
    }
    return j.IpfsHash;
  }

  async function unpin(cid) {
    if (!jwt || !cid) return false;
    try {
      const res = await fetch(`${PINATA_API}/pinning/unpin/${cid}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${jwt}` }
      });
      return res.ok;
    } catch (e) {
      console.warn('[pinata] unpin failed (non-fatal):', e.message);
      return false;
    }
  }

  async function fetchJSON(cid) {
    if (!cid) return null;
    try {
      const res = await fetch(`${GATEWAY}/${cid}`);
      if (!res.ok) {
        console.warn(`[pinata] gateway fetch ${cid} failed: HTTP ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.warn(`[pinata] gateway fetch ${cid} error:`, e.message);
      return null;
    }
  }

  return { init, pinJSON, unpin, fetchJSON };
})();

// Auto-init on load — fire and forget, don't block
pinata.init().catch(e => console.warn('[pinata] init error:', e.message));

// Expose to window for ad-hoc testing from devtools (no production impact)
if (typeof window !== 'undefined') {
  window.__pinata = pinata;
}

export default pinata;
