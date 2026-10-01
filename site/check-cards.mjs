import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { cardImageName } from "./lib/card-image-name.mjs";
import {
  card,
  cardAmount,
  organisationCard,
  supplierCard,
  searchCard,
  dynamicShare,
  FALLBACK,
  cardAlt,
} from "./lib/share-card.mjs";
import { fitText } from "./lib/card-fit.mjs";
import { layout } from "./lib/html.mjs";
import { onRequestGet } from "./routes/share.js";
import { onRequestGet as search } from "./routes/search/index.js";
import { onRequestGet as supplier } from "./routes/supplier/[h].js";
import worker from "./worker.mjs";
const digest = (png) => createHash("sha256").update(png).digest("hex");
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
for (const name of [
  "Tracy Dow",
  "carol rahal",
  "C.A. Pippy Park Commission",
  "A newly published unknown body",
]) {
  assert.equal(
    organisationCard(name, "1", "Published records"),
    null,
    `unreviewed entity falls back: ${name}`,
  );
}
check(cardAmount(0) === "$0", "zero is a figure");
check(
  cardAmount(null) === null &&
    cardAmount(NaN) === null &&
    cardAmount(Infinity) === null,
  "missing and invalid values stay missing",
);
check(
  cardAmount(0.01) === "$0.01" && cardAmount(-0.01) === "($0.01)",
  "cents and negative cents do not become zero",
);
for (const name of [
  "Jane Doe",
  "Jane Doe Consulting Ltd.",
  "Jean Tremblay",
  "John Smith Inc.",
  "Memorial University of Newfoundland / Jane Doe",
])
  check(
    supplierCard({ name, total: 100 }) === null,
    `no personal card: ${name}`,
  );
check(
  supplierCard({ name: "Memorial University of Newfoundland", total: 0 })
    ?.figure === "$0",
  "reviewed organisation has a zero card",
);
check(
  supplierCard({ name: "Memorial University of Newfoundland", total: null }) ===
    null,
  "missing supplier total falls back",
);
check(
  searchCard("Jane Doe") === null && searchCard("health Jane") === null,
  "search does not picture a person's name",
);
check(
  searchCard("Dépenses publiques")?.title === "Search: Dépenses publiques",
  "accented query preserved",
);
check(
  searchCard("snow removal")?.figure === "",
  "search card never contains results",
);
check(searchCard("health ".repeat(100)) === null, "bounded query text");
check(
  searchCard(" ".repeat(301) + "roads") === null,
  "raw query is bounded before normalization",
);
check(
  dynamicShare(card("x".repeat(1000)), "abc", "search") === FALLBACK,
  "unbroken oversized word falls back",
);
check(
  dynamicShare(card("Unsupported 😀"), "abc", "search") === FALLBACK,
  "unsupported glyph falls back instead of missing glyph",
);
const c = card("Dépenses publiques", "$0.01", "Included values");
const meta = dynamicShare(c, "abc", "search", "Dépenses publiques");
const text = await layout({
  title: "Search",
  body: "",
  share: meta,
  sharePath: "/search/?q=snow+removal",
  path: "/search/",
});
check(
  text.includes('og:url" content="https://nlledger.ca/search/?q=snow+removal"'),
  "search share URL retains words",
);
check(
  text.includes('rel="canonical" href="https://nlledger.ca/search/"'),
  "canonical remains deliberate",
);
check(
  text.includes('og:image:alt" content="' + cardAlt(c) + '"'),
  "alt carries the card text",
);
check(
  text.includes('og:image:width" content="1200"') &&
    text.includes('og:image:height" content="630"'),
  "dimensions declared",
);
check(
  text.includes(
    'twitter:image" content="https://nlledger.ca' + meta.image + '"',
  ),
  "Twitter uses the same image",
);
for (const path of [
  "/member/jane-doe/",
  "/minister/jane-doe/",
  "/item/pay-record/",
])
  check(
    (await layout({ title: "Jane Doe", path, body: "" })).includes(
      'og:image" content="https://nlledger.ca/og.png"',
    ),
    "person pages use generic card",
  );
const store = new Map(),
  waits = [];
globalThis.caches = {
  default: {
    match: async (k) => store.get(k.url)?.clone(),
    put: async (k, r) => store.set(k.url, r),
  },
};
let calls = 0,
  fail = false,
  renderAllowed = true,
  charges = 0;
const name = "Fisheries and Marine Institute of Memorial University",
  h = "1234567890";
const files = {
  "/data/stats.json": {
    population: { value: 500000 },
    median_annual_wage: { value: 50000 },
  },
  "/data/flags.json": { flags: [] },
  "/data/version.json": { v: "ab", data: "cd", code: "ef" },
  "/data/links.json": {},
  [`/data/s/${parseInt(h.slice(0, 4), 16) % 512}.json`]: {
    [h]: {
      name,
      total: 8300000,
      n: 2,
      byDs: {},
      byYear: {},
      buyers: [],
      flags: {},
      top: [],
    },
  },
};
const env = {
  SHARE_RENDER_LIMIT: {
    limit: async ({ key }) => {
      check(
        key === "cards",
        "one render budget per location, across visitors and card types",
      );
      charges++;
      return { success: renderAllowed };
    },
  },
  ASSETS: {
    fetch: async (url) => {
      const path = new URL(typeof url === "string" ? url : url.url || url)
        .pathname;
      return path === "/og.png"
        ? new Response(new Uint8Array([137, 80, 78, 71]))
        : new Response(JSON.stringify(files[path] || {}), {
            headers: { "content-type": "application/json" },
          });
    },
  },
  SHARE_RENDER: async () => {
    calls++;
    if (fail) throw Error("intentional renderer failure");
    return new Uint8Array([137, 80, 78, 71]);
  },
};
const ctx = (path, params = {}) => ({
  request: new Request("https://example.test" + path),
  env,
  params,
  waitUntil: (p) => waits.push(p),
});
const first = await onRequestGet(
  ctx("/share/dynamic/abcdef/search.png?q=snow%20removal"),
);
check(
  first.headers.get("x-share-card") === "miss" &&
    first.headers.get("cache-control").includes("immutable"),
  "first card rendered with immutable versioned cache",
);
await Promise.all(waits);
const second = await onRequestGet(
  ctx("/share/dynamic/abcdef/search.png?q=snow%20removal"),
);
check(
  second.headers.get("x-share-card") === "hit" && calls === 1,
  "second request reads edge cache without rendering",
);
for (const q of [" snow  removal ", "snow\tremoval", "snow\nremoval"]) {
  const equivalent = await onRequestGet(
    ctx("/share/dynamic/abcdef/search.png?q=" + encodeURIComponent(q)),
  );
  check(
    equivalent.headers.get("x-share-card") === "hit" && calls === 1,
    "whitespace variants reuse the canonical card",
  );
}
check(charges === 1, "hits do not use the render budget");
renderAllowed = false;
check(
  (
    await onRequestGet(ctx("/share/dynamic/abcdef/search.png?q=education"))
  ).headers.get("x-share-card") === "fallback" && calls === 1,
  "exhausted render budget uses the generic image",
);
check(
  (
    await onRequestGet(ctx("/share/dynamic/abcdef/supplier/" + h + ".png"))
  ).headers.get("x-share-card") === "fallback" && calls === 1,
  "supplier misses share the same budget",
);
check(
  (
    await onRequestGet({
      ...ctx("/share/dynamic/abcdef/search.png?q=health"),
      env: { ...env, SHARE_RENDER_LIMIT: undefined },
    })
  ).headers.get("x-share-card") === "fallback" && calls === 1,
  "missing limiter fails closed",
);
renderAllowed = true;
for (const q of ["éducation", "éducation"]) {
  await onRequestGet(
    ctx("/share/dynamic/abcdef/search.png?q=" + encodeURIComponent(q)),
  );
  await Promise.all(waits);
}
check(calls === 2, "NFC equivalents render once");

check(
  (await onRequestGet(ctx("/share/dynamic/000/search.png?q=snow"))).headers.get(
    "x-share-card",
  ) === "fallback",
  "obsolete version gets generic card, never new data under old cache key",
);
check(
  (
    await onRequestGet(ctx("/share/dynamic/abcdef/search.png?q=Jane"))
  ).headers.get("x-share-card") === "fallback",
  "endpoint enforces privacy even without HTML page",
);
fail = true;
const failed = await onRequestGet(
  ctx("/share/dynamic/abcdef/search.png?q=roads"),
);
check(
  failed.headers.get("x-share-card") === "fallback" &&
    !failed.headers.get("cache-control").includes("immutable"),
  "generation failure returns a short-lived real generic PNG",
);
fail = false;
const head = await worker.fetch(
  new Request(
    "https://example.test/share/dynamic/abcdef/search.png?q=snow%20removal",
    { method: "HEAD" },
  ),
  env,
  { waitUntil: (p) => waits.push(p) },
);
check(
  (await head.arrayBuffer()).byteLength === 0 &&
    head.headers.get("content-type") === "image/png",
  "HEAD returns image headers without body",
);
check(
  (
    await worker.fetch(
      new Request("https://example.test/share/dynamic/abcdef/search.png", {
        method: "POST",
      }),
      env,
      { waitUntil() {} },
    )
  ).status === 405,
  "card routes reject writes",
);
const html = await (await supplier(ctx("/supplier/" + h + "/", { h }))).text();
check(
  html.includes(`${name}: government contracts and payments · NL Ledger`),
  "supplier title carries full name",
);
check(
  html.includes("/share/dynamic/abcdef/supplier/" + h + ".png"),
  "supplier page uses its server-owned card",
);
check(
  html.includes('content="$8.3 million in included CAD record values'),
  "supplier description preserves the whole decimal amount and currency",
);
check(
  html.includes(
    "Federal addresses do not locate work or benefits. Not total payments.",
  ),
  "supplier share text retains geography and payment qualification",
);
const searched = await (await search(ctx("/search/?q=snow+removal"))).text(); // failed search lacks DB, still tested above at shell
check(searched.includes("og:image"), "search error has a usable generic image");
if (existsSync("site/dist/data/share-cards.json")) {
  const cards = JSON.parse(readFileSync("site/dist/data/share-cards.json"));
  for (const entry of cards) {
    const png = readFileSync("site/dist" + entry.image);
    check(
      png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630,
      `PNG dimensions ${entry.path}`,
    );
    if (!entry.fallback)
      check(
        entry.image === `/share/static/${digest(png)}.png`,
        `PNG bytes name the image: ${entry.path}`,
      );
    fitText(entry.title, { maxSize: 54, minSize: 28, maxLines: 3 });
    fitText(entry.label, { maxSize: 26, minSize: 22, maxLines: 3 });
  }
  for (const prefix of [
    "/",
    "/priorities/",
    "/budget/",
    "/department/",
    "/body/",
    "/pay/",
    "/flags/",
    "/method/",
  ])
    check(
      cards.some((x) =>
        prefix === "/" ? x.path === "/" : x.path.startsWith(prefix),
      ),
      `card type ${prefix}`,
    );
}
if (existsSync(new URL("./node_modules/satori", import.meta.url))) {
  const { render } = await import("./src/card-render-node.mjs");
  const original = Buffer.from(
    await render(card("Stable image", "$0", "Published values")),
  );
  const identical = Buffer.from(
    await render({
      ...card("Stable image", "$0", "Published values"),
      unused: "code-only input",
    }),
  );
  check(
    original.equals(identical) &&
      cardImageName(original) === cardImageName(identical),
    "byte-identical renders retain their name when render inputs differ",
  );
  const changed = Buffer.from(
    await render(card("Changed image", "$1", "Published values")),
  );
  check(
    !original.equals(changed) &&
      cardImageName(original) !== cardImageName(changed),
    "changed PNG gets a new name",
  );
  for (const c of [
    card("Dépenses publiques", "$0.01", "Valeurs publiées"),
    card("Large values", "$999.9 billion", "Published values"),
    card("Zero", "$0", "Published values"),
    card(
      "Longest organisation name: Newfoundland and Labrador public infrastructure procurement and maintenance services",
      "1",
      "Published records",
    ),
  ]) {
    const png = Buffer.from(await render(c));
    check(
      png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630,
      "actual renderer dimensions for boundary cases",
    );
  }
}
console.log(`Share cards: ${checks} checks passed`);
