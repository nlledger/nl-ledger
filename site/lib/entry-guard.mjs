import { guarded } from "./guard.mjs";
import { SECURITY_HEADERS } from "./headers.mjs";

// Match Astro's ten-round decode limit before it returns an empty 400. Keep the
// original URL intact: decoding here must never turn encoded separators into routes.
function tooDeep(path) {
  for (let round = 0; round <= 10; round++) {
    let decoded;
    try {
      decoded = decodeURI(path);
    } catch {
      return false;
    }
    if (decoded === path) return false;
    if (round === 10) return true;
    path = decoded;
  }
  return false;
}

// Astro can respond before page middleware runs (redirects, errors, assets).
// Add the baseline at the outer boundary, preserving stricter route policies.
export function protectEntry(handle) {
  return async (request, env, ctx) => {
    const response = await guarded(async () => {
      if (!tooDeep(new URL(request.url).pathname))
        return handle(request, env, ctx);
      const page = await env.ASSETS.fetch(
        new Request(new URL("/404.html", request.url)),
      );
      const headers = new Headers(page.headers);
      headers.set("cache-control", "no-store");
      return new Response(request.method === "HEAD" ? null : page.body, {
        status: 404,
        headers,
      });
    }, request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      if (!headers.has(name)) headers.set(name, value);
    // Receipt addresses can carry an income even when Astro redirects first.
    if (/^\/receipt(?:\/|$)/.test(new URL(request.url).pathname)) {
      headers.set("referrer-policy", "no-referrer");
      headers.set("cache-control", "no-store");
    }
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
