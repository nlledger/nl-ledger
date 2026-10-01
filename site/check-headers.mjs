// The HTML baseline must survive errors, private responses and an edge-cache round trip.
import assert from "node:assert/strict";
import { page, cached } from "./routes/_shared.js";

const expected = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "interest-cohort=()",
  "strict-transport-security": "max-age=15552000",
  "content-security-policy":
    "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
};
function check(res) {
  for (const [name, value] of Object.entries(expected))
    assert.equal(res.headers.get(name), value, name);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
}
const pending = [];
const ctx = {
  request: new Request("https://nlledger.ca/search/"),
  waitUntil: (p) => pending.push(p),
  env: {
    ASSETS: {
      fetch: async (u) =>
        Response.json(
          {
            "/data/stats.json": {},
            "/data/flags.json": { flags: [], caveat: "" },
            "/data/version.json": {
              v: "test",
              code: "headers",
              updated: "2026-09-30",
            },
            "/data/links.json": {},
          }[new URL(u).pathname],
        ),
    },
  },
};
const a = { updated: "2026-09-30" };
for (const status of [200, 400, 404, 429, 503]) {
  const res = await page(ctx, a, {
    title: "Test",
    body: "<p>Test</p>",
    status,
    maxAge: 60,
  });
  check(res);
  assert.equal(res.status, status);
  assert.equal(res.headers.get("cache-control"), "public, max-age=60");
}
const privateRes = await page(ctx, a, {
  title: "Receipt",
  body: "",
  maxAge: 0,
});
privateRes.headers.set("cache-control", "private, no-store");
check(privateRes);
assert.equal(privateRes.headers.get("cache-control"), "private, no-store");
const entries = new Map();
globalThis.caches = {
  default: {
    match: async (req) => entries.get(req.url)?.clone(),
    put: async (req, res) => {
      check(res);
      entries.set(req.url, res);
    },
  },
};
let renders = 0;
const make = async () => {
  renders++;
  return await page(ctx, a, { title: "Search", body: "<p>Test</p>" });
};
check(await cached(ctx, make));
await Promise.all(pending.splice(0));
check(await cached(ctx, make));
assert.equal(renders, 1, "second request uses the hardened cached response");
entries.clear();
await cached(
  ctx,
  async () => await page(ctx, a, { title: "Missing", body: "", status: 404 }),
);
await Promise.all(pending.splice(0));
assert.equal(entries.size, 0, "404 cache behavior is unchanged");
console.log(
  "HTML headers: success, errors, private receipt and cache hit pass",
);
