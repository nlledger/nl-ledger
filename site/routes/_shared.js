import { feedbackContext } from "../lib/privacy.mjs";
// Shared helpers for the Worker routes.
import { layout, setAssetVersion } from "../lib/html.mjs";
import { SECURITY_HEADERS } from "../lib/headers.mjs";

let cache = null;
export async function assets(ctx) {
  if (cache) return cache;
  const get = async (p) =>
    (await ctx.env.ASSETS.fetch(new URL(p, ctx.request.url))).json();
  const [stats, flags, version, links] = await Promise.all([
    get("/data/stats.json"),
    get("/data/flags.json"),
    get("/data/version.json"),
    get("/data/links.json"),
  ]);
  setAssetVersion(version.v);
  cache = {
    stats,
    links,
    flags: Object.fromEntries(flags.flags.map((f) => [f.id, f])),
    caveat: flags.caveat,
    updated: version.updated,
    version: version.v + (version.data || "") + (version.code || ""),
  };
  return cache;
}

export async function page(
  ctx,
  a,
  {
    title,
    description,
    body,
    status = 200,
    path,
    maxAge = 3600,
    jsonld,
    robots,
    feedback,
    share,
    sharePath,
  },
) {
  const u = new URL(ctx.request.url);
  // Search context keeps its words; receipt context leaves out income.
  const htmlText = await layout({
    title,
    description,
    body,
    path: path || u.pathname,
    updated: a.updated,
    jsonld,
    robots,
    feedback,
    share,
    sharePath,
    shareOrigin: ctx.env.SHARE_ORIGIN || undefined,
    at: feedbackContext(u.pathname + u.search),
  });
  return new Response(htmlText, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

// Serve from the edge cache when we can; D1 reads are the scarce resource on the free plan.
export async function cached(ctx, make) {
  // Keyed on the build version, so a new deploy never serves pages rendered from old data.
  const a = await assets(ctx);
  const u = new URL(ctx.request.url);
  u.searchParams.set("__v", a.version);
  const cacheKey = new Request(u.toString(), { method: "GET" });
  const c = caches.default;
  const hit = await c.match(cacheKey);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) ctx.waitUntil(c.put(cacheKey, res.clone()));
  return res;
}

// What search.mjs's find() needs from the Worker. Bindings that are absent (local dev) switch
// the matching feature off, and search stays keyword only.
let vocab = null;
export function searchIO(ctx) {
  const env = ctx.env;
  return {
    db: env.DB,
    ai: env.AI,
    vec: env.MEANING,
    limiter: env.MEANING_LIMIT,
    cache: globalThis.caches?.default,
    waitUntil: ctx.waitUntil,
    // Words the records contain, for spelling help (build.mjs writes it; about 90 KB compressed, read once per isolate).
    vocab: async () => {
      if (!vocab) {
        const res = await env.ASSETS.fetch(
          new URL("/data/words.json", ctx.request.url),
        );
        if (!res.ok) throw new Error("no vocabulary");
        vocab = await res.json();
      }
      return vocab;
    },
  };
}
