// Imported text remains text in static schedules, Worker views, metadata and JSON-LD.
import assert from "node:assert/strict";
import { parse } from "parse5";
import { itemPage, itemMeta, resultItem, supplierPage } from "./lib/views.mjs";
import { departments } from "./src/pages/priorities.mjs";
import { slug } from "./lib/format.mjs";
import { mobileTables } from "./lib/tables.mjs";
import { itemRow, federalSummary } from "./src/common.mjs";
import { esc, layout, ldScript, receipt, receiptForm } from "./lib/html.mjs";
import { nativeAmount, reportedBreakdown } from "./lib/federal.mjs";
import { page as workerPage } from "./routes/_shared.js";
import { onRequestGet as itemRoute } from "./routes/item/[id].js";
import { onRequestGet as receiptRoute } from "./routes/receipt/index.js";
import { onRequestGet as supplierRoute } from "./routes/supplier/[h].js";

const marker = "<em data-audit=\"source\">USD & 'text'</em>";
const links = { body: [], pay: [], department: [] };
const stats = { population: { value: 1 }, median_annual_wage: { value: 1 } };
let checks = 0;
const failures = [];
function check(label, body, text = marker) {
  checks++;
  try {
    assert.ok(!body.includes(text), `${label}: imported markup emitted raw`);
    assert.ok(
      body.includes(esc(text)),
      `${label}: escaped source evidence absent`,
    );
  } catch (e) {
    failures.push(e.message);
  }
}
for (const currency of ["CAD", "USD", "unstated", marker]) {
  for (const amount of [null, 0, 1234.56]) {
    const it = {
      ds: "canadabuys",
      i: "abcdef123456",
      s: "Source supplier",
      a: amount,
      c: currency,
      x: {},
    };
    const row = {
      dataset: it.ds,
      level: "federal",
      id: `canadabuys-${it.i}`,
      amount,
      currency,
    };
    const D = { q: () => [row], itemFlags: new Map(), flagById: {} };
    const renders = {
      "Worker result": await resultItem(it, {}, links),
      "Worker record": (await itemPage(it, { flags: {}, stats, links })).body,
      "static item row": itemRow(D, row).cells.join(""),
      "static federal summary": await federalSummary(D, "1=1"),
      "Worker supplier breakdown": (
        await supplierPage(
          {
            name: "Supplier",
            n: 1,
            total: 0,
            byDs: {},
            byYear: {},
            top: [],
            breakdown: reportedBreakdown([it]),
          },
          { flags: {}, stats, links, hash: "abcdef1234" },
        )
      ).body,
    };
    for (const [label, body] of Object.entries(renders)) {
      checks++;
      const expected = nativeAmount(amount, currency);
      if (!body.includes(esc(expected)))
        failures.push(
          `${label}: ${currency === marker ? "marker" : currency}/${amount} not escaped`,
        );
      if (currency === marker && body.includes(marker))
        failures.push(`${label}: imported currency emitted raw`);
    }
    assert.ok(
      itemMeta(it).title.includes(nativeAmount(amount, currency)),
      "Metadata must remain plain text",
    );
    assert.equal(
      nativeAmount(amount, marker).includes(marker),
      true,
      "JSON/MCP formatter must remain plain text",
    );
  }
}
const fields = {
  supplier_as_printed: marker,
  amount_kind: marker,
  scope_statement: marker,
  inclusion_rule: { statement: marker },
  reported_location: { province: marker },
  how_counted: marker,
  amount_period: { start: marker, end: marker, reported: marker },
  amount_coverage: marker,
  source_fields: { [marker]: marker },
  scope_evidence: [
    {
      field: marker,
      value: marker,
      source_url: `https://source.test/"${marker}`,
      locator: marker,
    },
  ],
};
const sourceRecord = {
  ds: "canadabuys",
  i: "abcdef123456",
  s: marker,
  b: marker,
  d: marker,
  p: marker,
  m: marker,
  a: 1,
  c: "CAD",
  u: "https://source.test/file.pdf",
  g: marker,
  l: marker,
  x: fields,
};
check(
  "Worker source fields and receipt page",
  (await itemPage(sourceRecord, { flags: {}, stats, links })).body,
);
check("source receipt helper", receipt(sourceRecord.u, marker, marker));
check(
  "supplier source years",
  (
    await supplierPage(
      {
        name: marker,
        n: 2,
        total: 2,
        byDs: {},
        byYear: { [marker]: 1, 2025: 1 },
        top: [],
      },
      { flags: {}, stats, links, hash: "abcdef1234" },
    )
  ).body,
);
const program = {
  program: marker,
  program_code: marker,
  department: "Health",
  c1: 1,
  c2: 1,
  c3: 1,
  page: marker,
  source_url: "https://source.test/file.pdf",
};
const buildData = {
  stats,
  slug,
  itemFlags: new Map(),
  years: [marker],
  deptYear: {
    [marker]: [
      {
        name: "Health",
        gross: 1,
        pages: new Set([marker]),
        url: program.source_url,
      },
    ],
  },
  one: (sql) => (sql.includes("max(fiscal_year)") ? { y: marker } : { v: 1 }),
  q: (sql) =>
    sql.includes("FROM items")
      ? []
      : sql.includes("DISTINCT department")
        ? [{ department: "Health" }]
        : [program],
};
for (const [path, view] of await departments(buildData, {}))
  check(`static department source years/program code ${path}`, view.body);
const meta = itemMeta(sourceRecord);
const shell = {
  ...meta,
  body: await resultItem(sourceRecord, {}, links),
  jsonld: [{ name: "</script>" + marker, description: marker }],
  feedback: false,
};
check("static page attributes and source text", await layout(shell));
const workerResponse = await workerPage(
  { request: new Request("https://nlledger.ca/item/abcdef123456/"), env: {} },
  {},
  shell,
);
check(
  "Worker response attributes and source text",
  await workerResponse.text(),
);
// Use the actual Worker routes with imported D1/asset documents and a disposable cache.
const supplier = {
  name: marker,
  n: 2,
  total: 2,
  byDs: {},
  byYear: { [marker]: 1, 2025: 1 },
  top: [],
  breakdown: reportedBreakdown([{ ...sourceRecord, c: marker }]),
};
const assetFiles = {
  "/data/stats.json": stats,
  "/data/flags.json": { flags: [] },
  "/data/version.json": { v: "escaping-check" },
  "/data/links.json": links,
  "/data/s/461.json": { abcdef1234: supplier },
};
const env = {
  ASSETS: {
    fetch: async (url) => Response.json(assetFiles[new URL(url).pathname]),
  },
  DB: {
    prepare: () => ({
      bind: () => ({
        first: async () => ({
          items: JSON.stringify({
            ds: "canadabuys",
            lv: "federal",
            it: [{ ...sourceRecord, c: marker }],
          }),
        }),
      }),
    }),
  },
};
globalThis.caches = {
  default: { match: async () => null, put: async () => {} },
};
for (const [label, route, path, params] of [
  [
    "Worker item route",
    itemRoute,
    "/item/abcdef123456/",
    { id: "abcdef123456" },
  ],
  [
    "Worker supplier route",
    supplierRoute,
    "/supplier/abcdef1234/",
    { h: "abcdef1234" },
  ],
]) {
  const response = await route({
    request: new Request(`https://nlledger.ca${path}`),
    env,
    params,
    waitUntil: () => {},
  });
  assert.equal(response.status, 200);
  check(label, await response.text());
}
const receiptFiles = {
  ...assetFiles,
  "/data/receipt.json": {
    year: marker,
    total: 1,
    departments: [],
    tax: { year: marker, brackets: [[0, null, 0.1]], basic_personal_amount: 0 },
  },
};
const receiptResponse = await receiptRoute({
  request: new Request("https://nlledger.ca/receipt/?income=55000"),
  env: {
    ASSETS: {
      fetch: async (url) => Response.json(receiptFiles[new URL(url).pathname]),
    },
  },
});
check("Worker receipt source years", await receiptResponse.text());
const ld = ldScript({ name: "</script>" + marker });
assert.equal(
  (ld.match(/<\/script>/g) || []).length,
  1,
  "JSON-LD closes only its own script",
);
assert.deepEqual(
  JSON.parse(ld.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]),
  { name: "</script>" + marker },
  "JSON-LD preserves source evidence",
);
assert.deepEqual(failures, [], failures.join("\n"));
// Entity-looking source text must stay literal in native Astro attributes.
const literal = '&amp; &quot; &lt;script&gt; " plain';
const native = parse(
  await layout({
    title: literal,
    description: literal,
    bodyClass: literal,
    body: await receiptForm({ id: "literal", value: literal }),
  }),
);
const elements = [];
function collect(node) {
  if (node.tagName) elements.push(node);
  for (const child of node.childNodes || []) collect(child);
}
collect(native);
const attr = (node, name) => node.attrs.find((a) => a.name === name)?.value;
assert.equal(
  attr(
    elements.find((node) => node.tagName === "body"),
    "class",
  ),
  literal,
);
assert.equal(
  attr(
    elements.find((node) => attr(node, "id") === "literal"),
    "value",
  ),
  literal,
);
assert.equal(
  attr(
    elements.find((node) => attr(node, "name") === "description"),
    "content",
  ),
  literal,
);
checks += 3;

// Combined supplier names link to their own filter: one `&` between the parameters, no entity.
{
  const body = (
    await supplierPage(
      {
        name: "Supplier",
        n: 2,
        total: 2,
        byDs: {},
        byYear: {},
        top: [],
        combined: [
          { t: "Supplier One", h: "aaaa11112222", n: 1 },
          { t: "Supplier Two", h: "bbbb33334444", n: 1 },
        ],
      },
      { flags: {}, stats, links, hash: "abcdef1234" },
    )
  ).body;
  assert.ok(body.includes('href="/search/?s=abcdef1234&amp;n=aaaa11112222"'), "combined name link keeps its filter");
  assert.ok(!body.includes("&amp;amp;"), "combined name link is not double-escaped");
  checks += 2;
}

// Angle brackets inside an attribute must not let table code read data as markup.
{
  const hostile = '/x</td><td><img src=x onerror=alert(1)>';
  const table =
    '<table class="sched"><thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead>' +
    `<tbody><tr><td><a href="${hostile.replace(/"/g, "&quot;")}">Row</a></td><td>$1</td></tr></tbody></table>`;
  for (const [label, html] of [
    ["mobileTables", mobileTables(table)],
    ["layout", await layout({ title: "t", body: table })],
  ]) {
    const hits = [];
    (function walk(node) {
      if (node.tagName === "img") hits.push(node);
      for (const child of node.childNodes || []) walk(child);
    })(parse(html));
    assert.equal(hits.length, 0, `${label}: attribute text became an element`);
    assert.ok(!html.includes("<img"), `${label}: raw <img in output`);
    assert.ok(html.includes("onerror=alert(1)&gt;"), `${label}: value lost`);
  }
  checks += 4;
}

console.log(
  `source escaping: ${checks} static/Worker checks; missing/zero/CAD/USD/unstated/marker; source fields, attributes and JSON-LD; plain-text MCP formatter retained`,
);
