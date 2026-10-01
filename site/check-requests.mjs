// Request-time pages through the Worker's dispatcher: methods, hostile paths and query strings,
// a combined supplier, and a failing database. Stand-ins for D1 and assets; runs in CI.
import assert from "node:assert/strict";
import { parse } from "parse5";
import worker from "./worker.mjs";
import { SECURITY_HEADERS } from "./lib/headers.mjs";

const hostile = `<img src=x onerror=alert(1)>"'&amp;`;
const stats = { population: { value: 1 }, median_annual_wage: { value: 1 } };
const record = { ds: "canadabuys", i: "abcdef123456", s: hostile, a: 1, c: "CAD", x: {} };
const supplier = {
  name: hostile,
  n: 2,
  total: 2,
  byDs: {},
  byYear: { 2025: 2 },
  top: [],
  combined: [
    { t: "Name One", h: "aaaa11112222", n: 1 },
    { t: hostile, h: "bbbb33334444", n: 1 },
  ],
};
const files = {
  "/data/stats.json": stats,
  "/data/flags.json": { flags: [] },
  "/data/version.json": { v: "requests-check" },
  "/data/links.json": { body: [], pay: [], department: [] },
  "/data/s/461.json": { abcdef1234: supplier },
  "/data/receipt.json": { year: "2025", total: 1, departments: [], tax: { year: "2025", brackets: [[0, null, 0.1]], basic_personal_amount: 0 } },
};
const env = (dbFails) => ({
  ASSETS: {
    fetch: async (u) => {
      const f = files[new URL(u).pathname];
      return f ? Response.json(f) : new Response("asset", { status: 200 });
    },
  },
  DB: {
    prepare: () => ({
      bind: () => ({
        first: async () => {
          if (dbFails) throw new Error("D1 down");
          return { items: JSON.stringify({ ds: "canadabuys", lv: "federal", it: [record] }) };
        },
      }),
    }),
  },
});
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const ctx = { waitUntil: () => {} };
const call = (method, path, dbFails = false) =>
  worker.fetch(new Request(`https://nlledger.ca${path}`, { method }), env(dbFails), ctx);

let checks = 0;
const html = async (label, method, path, status) => {
  const res = await call(method, path);
  assert.equal(res.status, status, `${label}: status ${res.status}`);
  const body = await res.text();
  // Inside a quoted attribute `<` is inert; what matters is that no element or handler appears.
  const found = [];
  (function walk(n) {
    if (n.tagName === "img" || n.attrs?.some((a) => /^on/i.test(a.name))) found.push(n.tagName);
    for (const c of n.childNodes || []) walk(c);
  })(parse(body));
  assert.deepEqual(found, [], `${label}: hostile markup became an element`);
  if (method === "GET" && res.headers.get("content-type")?.includes("html"))
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      // Receipt pages carry an income in the address, so they send no referrer at all.
      const want = k === "Referrer-Policy" && path.startsWith("/receipt/") ? "no-referrer" : v;
      assert.equal(res.headers.get(k), want, `${label}: ${k}`);
    }
  checks++;
  return body;
};

const sup = await html("combined supplier", "GET", "/supplier/abcdef1234/", 200);
assert.ok(sup.includes('href="/search/?s=abcdef1234&amp;n=aaaa11112222"'), "combined name link keeps its filter");
assert.ok(sup.includes("&lt;img src=x onerror"), "hostile name shown as text");
await html("item", "GET", "/item/abcdef123456/", 200);
await html("item, mixed case id", "GET", "/item/ABCDEF123456/", 200);
await html("item, hostile id", "GET", `/item/${encodeURIComponent(hostile)}/`, 404);
await html("supplier, hostile hash", "GET", `/supplier/${encodeURIComponent(hostile)}/`, 404);
await html("receipt", "GET", "/receipt/?income=55000", 200);
await html("receipt, hostile income", "GET", `/receipt/?income=${encodeURIComponent(hostile)}`, 200);
await html("feedback form", "GET", `/feedback/?page=${encodeURIComponent(hostile)}`, 200);
for (const method of ["PUT", "DELETE", "PATCH"]) await html(`${method} on a page`, method, "/supplier/abcdef1234/", 405);
const head = await call("HEAD", "/item/abcdef123456/");
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
checks += 2;

// A failing database must stay one request: a response, never a throw that Astro would retry.
for (const path of ["/item/abcdef123456/"]) {
  const res = await call("GET", path, true).catch((e) => ({ thrown: e }));
  assert.ok(res.thrown || res.status >= 400, `${path}: failing database must not look like success`);
  checks++;
}
console.log(`requests: ${checks} Worker cases; combined supplier, hostile paths and queries, methods, failing database`);
