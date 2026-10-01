import "./scripts/compile-astro.mjs";
// Static site build: reads data/build/ledger.db, writes site/dist.
// Search, supplier, item and receipt pages are rendered on request by the Worker
// (worker.mjs, routes/) from D1 and from the JSON this build writes under dist/data.
import { card, cardAlt, cardAmount } from "./lib/share-card.mjs";
import { render } from "./src/card-render-node.mjs";
import { cardImageName } from "./lib/card-image-name.mjs";
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { transformSync } from "esbuild";
import { SECURITY_HEADERS } from "./lib/headers.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load, DB_PATH as D_PATH } from "./src/data.mjs";
import { layout, setAssetVersion } from "./lib/html.mjs";
import { home } from "./src/pages/home.mjs";
import { priorities, departments } from "./src/pages/priorities.mjs";
import { bodies } from "./src/pages/bodies.mjs";
import { flagPages } from "./src/pages/flags.mjs";
import { members } from "./src/pages/members.mjs";
import { pay } from "./src/pages/pay.mjs";
import { consulting } from "./src/pages/consulting.mjs";
import { info } from "./src/pages/info.mjs";
import { buildReceiptData } from "./src/receiptdata.mjs";
import { buildBudget, budgetJSON } from "./src/budgetdata.mjs";
import { budget } from "./src/pages/budget.mjs";
import { buildSupplierShards } from "./src/shards.mjs";
import {
  departmentsJSON,
  flagResultsJSON,
  membersJSON,
} from "./src/mcpdata.mjs";
import { serverJson, TOOLS } from "./lib/mcp.mjs";
import { payJSON } from "./src/paydata.mjs";
import { bodiesJSON } from "./src/bodydata.mjs";
import { totalsFiles } from "./src/totalsdata.mjs";
import { llmsTxt } from "./src/llms.mjs";
import { desc, siteLd } from "./src/seo.mjs";
import {
  supplierIndexable,
  SUPPLIER_MIN_RECORDS,
  SUPPLIER_MIN_TOTAL,
} from "./lib/indexing.mjs";
import { SITE } from "./lib/format.mjs";
import { buildVocab } from "./lib/spell.mjs";
import { words } from "./lib/search.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(HERE, "static"), DIST, { recursive: true });
mkdirSync(join(DIST, "lib"), { recursive: true });
for (const f of ["format.mjs", "receipt.mjs"])
  cpSync(join(HERE, "lib", f), join(DIST, "lib", f));

// Only remove CSS whitespace/comments; leave selectors, declarations and fallbacks intact.
const css = transformSync(readFileSync(join(DIST, "site.css"), "utf8"), {
  loader: "css",
  minifyWhitespace: true,
  legalComments: "none",
});
writeFileSync(join(DIST, "site.css"), css.code);

// Cache-busting version from the bytes actually served, after minification.
const v = createHash("sha1")
  .update(readFileSync(join(DIST, "site.css")))
  .update(readFileSync(join(DIST, "app.js")))
  .digest("hex")
  .slice(0, 8);
setAssetVersion(v);

const D = load();
let pages = 0;
const PATHS = [];
const cards = new Map();
const cardManifest = [];
const pageHTML = async (page, path) =>
  await layout({
    ...page,
    path,
    updated: D.gathered,
    shareOrigin: process.env.NL_LEDGER_SHARE_ORIGIN || undefined,
  });
const cardHash = createHash("sha256").update(readFileSync(D_PATH));
for (const f of [
  "lib/share-card.mjs",
  "lib/card-organisations.json",
  "lib/card-template.mjs",
  "lib/wordmark.mjs",
  "lib/card-fit.mjs",
  "lib/html.mjs",
  "package-lock.json",
  "lib/card-render.mjs",
  "lib/card-font-metrics.json",
  "static/fonts/archivo-card.ttf",
])
  cardHash.update(readFileSync(join(HERE, f)));
const templateVersion = cardHash.digest("hex");
export async function write(path, page) {
  if (path !== "/404.html" && path.endsWith("/")) PATHS.push(path);
  const file = path.endsWith("/")
    ? join(DIST, path, "index.html")
    : join(DIST, path);
  mkdirSync(dirname(file), { recursive: true });
  if (typeof page !== "string") {
    let c = page.card;
    if (!c && path.startsWith("/method/"))
      c = card(page.title, "", "How the figures are worked out and checked");
    if (c) {
      // Code/data changes invalidate rendering, but only PNG bytes name the asset.
      const renderKey = createHash("sha256")
        .update(templateVersion)
        .update(JSON.stringify(c))
        .digest("hex");
      let image = "/og.png";
      let fallback = false;
      try {
        if (!cards.has(renderKey)) cards.set(renderKey, await render(c));
        const png = cards.get(renderKey);
        image = cardImageName(png);
        const imageFile = join(DIST, image);
        mkdirSync(dirname(imageFile), { recursive: true });
        writeFileSync(imageFile, png);
        page = { ...page, share: { image, alt: cardAlt(c) } };
      } catch (e) {
        console.warn(`Card fallback for ${path}: ${e.message}`);
        page = { ...page, share: null };
        fallback = true;
      }
      cardManifest.push({ path, image, ...c, ...(fallback ? { fallback } : {}) });
    }
  }
  writeFileSync(
    file,
    typeof page === "string" ? page : await pageHTML(page, path),
  );
  pages++;
}
export function writeJSON(path, obj) {
  const file = join(DIST, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj));
}

const R = buildReceiptData(D);
writeJSON("data/receipt.json", R);
writeJSON("data/stats.json", D.stats);
writeJSON("data/flags.json", D.catalog);
// The code that renders pages on request; part of the edge cache key, so a code change is never served from an old render.
const codeHash = createHash("sha1").update(templateVersion);
for (const f of [
  "worker.mjs",
  ".render/components.mjs",
  "scripts/compile-astro.mjs",
  ...readdirSync(join(HERE, "src"), { recursive: true })
    .filter((n) => n.endsWith(".astro"))
    .map((n) => join("src", n)),
  ...readdirSync(join(HERE, "lib")).map((n) => join("lib", n)),
  ...readdirSync(join(HERE, "routes"), { recursive: true }).map((n) =>
    join("routes", n),
  ),
].sort()) {
  if (statSync(join(HERE, f)).isFile())
    codeHash.update(f).update(readFileSync(join(HERE, f)));
}
writeJSON("data/version.json", {
  v,
  data: createHash("sha1")
    .update(readFileSync(D_PATH))
    .digest("hex")
    .slice(0, 8),
  code: codeHash.digest("hex").slice(0, 8),
  updated: D.gathered,
});
writeJSON("data/departments.json", departmentsJSON(D));
writeJSON("data/flag_results.json", flagResultsJSON(D));
writeJSON("data/members.json", membersJSON(D));
writeJSON("data/pay.json", payJSON(D));
writeJSON("data/bodies.json", bodiesJSON(D));
for (const [path, data] of Object.entries(totalsFiles(D)))
  writeJSON(path, data);
const B = buildBudget(D);
writeJSON("data/budget.json", budgetJSON(B));
// Every word the search documents contain, with how many hold it: spelling help in search (lib/spell.mjs).
// From the same docs.jsonl the D1 sync loads, so a corrected word always has records behind it.
const docsPath = join(dirname(D_PATH), "d1", "docs.jsonl");
if (!existsSync(docsPath))
  throw new Error(
    `${docsPath} is missing: run the pipeline's export step (or ./dev.sh for the sample)`,
  );
writeJSON(
  "data/words.json",
  buildVocab(
    readFileSync(docsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).body),
    words,
  ),
);

const h = await home(D, R, B);
await write("/", {
  card: card(
    "The Newfoundland and Labrador government spent",
    cardAmount(R.total),
    `Gross department spending · ${R.year}`,
  ),
  title: "NL government spending: every contract, expense and salary",
  description: desc(
    `Every Newfoundland and Labrador government contract, grant, expense claim and $100,000+ salary in one place. Each figure links to its source.`,
  ),
  body: h.body,
  notes: h.notes,
  bodyClass: "home",
  jsonld: siteLd(),
});

for (const [path, page] of [
  ...(await priorities(D, R)),
  ...(await budget(D, R, B)),
  ...(await departments(D, R)),
  ...(await bodies(D, R)),
  ...(await flagPages(D, R)),
  ...(await members(D, R)),
  ...(await pay(D, R)),
  await consulting(D, R),
  ...(await info(D, R)),
])
  await write(path, page);

writeJSON("data/share-cards.json", cardManifest);
const shards = buildSupplierShards(D);
for (const [n, obj] of Object.entries(shards.files))
  writeJSON(`data/s/${n}.json`, obj);

// Which /body/, /pay/ and /department/ pages exist, so pages rendered on request link only to pages that are there.
const under = (prefix) =>
  PATHS.filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length, -1))
    .filter((x) => x && !x.includes("/"));
writeJSON("data/links.json", {
  body: under("/body/"),
  pay: under("/pay/"),
  department: under("/department/"),
});

// sitemap.xml: every static page, /receipt/, and the suppliers with enough on record. Record pages are left out on purpose.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const urls = [...PATHS, "/receipt/"];
let supplierUrls = 0;
for (const file of Object.values(shards.files))
  for (const [h, sup] of Object.entries(file))
    if (supplierIndexable(sup)) {
      urls.push(`/supplier/${h}/`);
      supplierUrls++;
    }
const lastmod = D.gathered;
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(SITE.url + u)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`,
);
writeFileSync(
  join(DIST, "robots.txt"),
  `# ${SITE.name}: public spending records. Everything is open to crawlers and AI assistants.\nUser-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes\n\nSitemap: ${SITE.url}/sitemap.xml\n`,
);

// Discovery: MCP registry entry, AI catalog (draft), llms.txt
writeFileSync(
  join(DIST, "server.json"),
  JSON.stringify(serverJson(), null, 2) + "\n",
);
writeFileSync(join(DIST, "llms.txt"), llmsTxt(D, R, TOOLS));

writeFileSync(
  join(DIST, "_headers"),
  `/*
${Object.entries(SECURITY_HEADERS)
  .map(([name, value]) => `  ${name}: ${value}`)
  .join("\n")}
/share/static/*
  Cache-Control: public, max-age=31536000, immutable
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/site.css
  Cache-Control: public, max-age=31536000, immutable
/app.js
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=3600
  Access-Control-Allow-Origin: *
/server.json
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600
/llms.txt
  Content-Type: text/plain; charset=utf-8
  Access-Control-Allow-Origin: *
`,
);

console.log(
  `${pages} pages, ${shards.count} suppliers in ${Object.keys(shards.files).length} shards; sitemap ${urls.length} URLs (${supplierUrls} suppliers with ${SUPPLIER_MIN_RECORDS}+ records or ${SUPPLIER_MIN_TOTAL}+ dollars)`,
);
