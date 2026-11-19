// Small fetch helpers. Error messages carry the service's answer but never a token:
// tokens travel in headers or form bodies, and URLs are logged without their query string.

export async function request(url, opts = {}, what = "request") {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const safeUrl = String(url).split("?")[0];
    throw new Error(`${what} failed: HTTP ${res.status} from ${safeUrl}: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return { res, body };
}

export function form(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll `check` until it returns a value other than undefined, or give up after `timeoutMs`.
export async function poll(check, { everyMs = 5000, timeoutMs = 600000, what = "processing" } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await check();
    if (v !== undefined) return v;
    await sleep(everyMs);
  }
  throw new Error(`${what} did not finish within ${Math.round(timeoutMs / 1000)} s`);
}
