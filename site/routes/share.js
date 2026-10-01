import { assets } from "./_shared.js";
import {
  canonicalQuery,
  searchCard,
  supplierCard,
} from "../lib/share-card.mjs";
async function fallback(ctx) {
  try {
    const r = await ctx.env.ASSETS.fetch(new URL("/og.png", ctx.request.url));
    if (r.ok)
      return new Response(await r.arrayBuffer(), {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=60",
          "x-share-card": "fallback",
        },
      });
  } catch {
    /* The normal asset path can retry independently of card generation. */
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL("/og.png", ctx.request.url).href,
      "cache-control": "public, max-age=60",
      "x-share-card": "fallback",
    },
  });
}
export async function onRequestGet(ctx) {
  try {
    const a = await assets(ctx);
    const u = new URL(ctx.request.url);
    const m = u.pathname.match(
      /^\/share\/dynamic\/([a-f0-9]+)\/(search|supplier\/([a-f0-9]{10}))\.png$/,
    );
    if (!m || m[1] !== a.version) return fallback(ctx);
    const q = m[2] === "search" ? canonicalQuery(u.searchParams.get("q")) : "";
    let c = m[2] === "search" ? searchCard(q) : null;
    if (q === null || (m[2] === "search" && !c)) return fallback(ctx);
    const key = new Request(
      u.origin +
        u.pathname +
        (m[2] === "search" ? `?q=${encodeURIComponent(q)}` : ""),
    );
    const cache = globalThis.caches?.default;
    const hit = await cache?.match(key);
    if (hit)
      return new Response(hit.body, {
        headers: { ...Object.fromEntries(hit.headers), "x-share-card": "hit" },
      });
    if (m[2] !== "search") {
      const n = parseInt(m[3].slice(0, 4), 16) % 512;
      const r = await ctx.env.ASSETS.fetch(new URL(`/data/s/${n}.json`, u));
      c = r.ok ? supplierCard((await r.json())[m[3]]) : null;
    }
    if (!c) return fallback(ctx);
    // Hits stay cheap. A single shared key budgets all cache-miss cards per location.
    if (
      !ctx.env.SHARE_RENDER_LIMIT ||
      !(await ctx.env.SHARE_RENDER_LIMIT.limit({ key: "cards" })).success
    )
      return fallback(ctx);
    const render =
      ctx.env.SHARE_RENDER ||
      (await import("../lib/card-render-worker.mjs")).render;
    const png = await render(c, ctx.env.ASSETS, ctx.request.url);
    const response = new Response(png, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "x-share-card": "miss",
      },
    });
    if (cache) ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch (e) {
    console.error("Share card generation failed", e.message);
    return fallback(ctx);
  }
}
