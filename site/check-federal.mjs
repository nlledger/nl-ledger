// Real federal counterexamples across the export, HTML, standalone shares, shards and MCP.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { itemPage, itemMeta, resultItem, supplierPage } from "./lib/views.mjs";
import { itemRow } from "./src/common.mjs";
import { buildSupplierShards } from "./src/shards.mjs";
import { flagResultsJSON } from "./src/mcpdata.mjs";
import { handleMcp, PROMPTS, serverJson, serverCard } from "./lib/mcp.mjs";
import { getItem } from "./lib/search.mjs";
import { datasetLd } from "./src/seo.mjs";
import {
  nativeAmount,
  reportedBreakdown,
  federalStatement,
  currencyOf,
  FEDERAL_RULE,
} from "./lib/federal.mjs";
import { esc } from "./lib/html.mjs";
import { slug } from "./lib/format.mjs";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../tests/fixtures/federal/published-counterexamples.json",
      import.meta.url,
    ),
  ),
);
const db = new DatabaseSync(":memory:");
db.exec(
  gunzipSync(
    readFileSync(new URL("../sample/ledger.sql.gz", import.meta.url)),
  ).toString(),
);
db.exec("DELETE FROM items; DELETE FROM flags;");
const columns = db
  .prepare("PRAGMA table_info(items)")
  .all()
  .map((r) => r.name);
const insert = db.prepare(
  `INSERT INTO items (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
);
for (const r of fixture.ledger) insert.run(...columns.map((k) => r[k] ?? null));
db.exec(readFileSync(new URL("../sample/schema.sql", import.meta.url), "utf8"));
db.exec("DELETE FROM docs;");
const docCols = [
  "body",
  "tags",
  "doc_id",
  "dataset",
  "title",
  "buyer",
  "total",
  "n",
  "date_min",
  "date_max",
  "h",
  "items",
];
const insDoc = db.prepare(
  `INSERT INTO docs (${docCols.join(",")}) VALUES (${docCols.map(() => "?").join(",")})`,
);
for (const d of fixture.docs) insDoc.run(...docCols.map((k) => d[k]));
const q = (sql, ...args) => db.prepare(sql).all(...args);
const D = {
  q,
  one: (sql, ...args) => db.prepare(sql).get(...args),
  itemFlags: new Map(),
  flagRows: [],
  keyHash: (s) =>
    createHash("sha1")
      .update(s || "")
      .digest("hex")
      .slice(0, 10),
  slug,
};
const stats = JSON.parse(
  D.one("SELECT value FROM facts WHERE key='stats'").value,
);
const links = { body: [], pay: [], department: [] };
const d1 = {
  prepare(sql) {
    const st = db.prepare(sql);
    const run = (args) => ({
      all: async () => ({ results: st.all(...args) }),
      first: async () => st.get(...args) || null,
    });
    return { ...run([]), bind: (...args) => run(args) };
  },
};
const { files } = buildSupplierShards(D);
const io = {
  db: d1,
  json: async (path) => {
    if (path === "/data/stats.json") return stats;
    const shard = path.match(/^\/data\/s\/(\d+)\.json$/);
    if (shard) return files[shard[1]] || {};
    if (path === "/data/flags.json")
      return {
        caveat: "A question, not a finding",
        flags: D.catalog?.flags || [],
      };
    if (path === "/data/flag_results.json") return flagResultsJSON(D);
    throw new Error(`Unexpected test read ${path}`);
  },
};
async function rpc(method, params = {}) {
  const r = await handleMcp(
    new Request("https://nlledger.ca/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    io,
  );
  const j = await r.json();
  assert.equal(j.error, undefined);
  return j.result;
}
async function tool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  assert.equal(r.isError, false, JSON.stringify(r));
  return r.structuredContent;
}

const initialized = await rpc("initialize");
assert.match(initialized.instructions, /Never infer where money was spent/);
assert.match(initialized.instructions, /native currency/);
assert.match(
  initialized.instructions,
  /Public Accounts payments and CanadaBuys notices are excluded/,
);
for (const r of fixture.ledger) {
  const id = r.id.split("-").at(-1);
  const it = await getItem(d1, id);
  const x = JSON.parse(r.extra);
  assert.deepEqual(
    it.x.source_fields,
    x.source_fields,
    `${id}: source fields lost in export`,
  );
  const statement = federalStatement(it);
  const body = (await itemPage(it, { stats, flags: {}, links })).body;
  assert.doesNotMatch(body, /per person in the province|of work at the median/);
  assert.match(body, /Selected because/);
  assert.ok(body.includes(nativeAmount(it.a, currencyOf(it))), id);
  assert.match(await resultItem(it, {}, links), /Selected because/);
  assert.ok(
    (await resultItem(it, {}, links)).includes(esc(statement)),
    `${id}: search qualification`,
  );
  if (x.scope_review_state === "unreviewed") {
    assert.match(
      x.scope_statement,
      /^NL Ledger has not established the work, benefit or jurisdiction/,
    );
    for (const text of [
      body,
      await resultItem(it, {}, links),
      itemMeta(it).description,
    ]) {
      assert.doesNotMatch(
        text,
        /source does not establish|No separately established work or benefit/,
      );
    }
  }
  assert.match(itemRow(D, r).cells[2], /Selected because/);
  const meta = itemMeta(it);
  assert.ok(meta.description.includes(statement), id);
  assert.ok(meta.title.includes(x.amount_kind), id);
  assert.ok(meta.description.includes(nativeAmount(it.a, currencyOf(it))), id);
  const c = await tool("get_record", { id });
  assert.equal(c.human_scale, undefined);
  assert.equal(c.scope_status, x.scope_status);
  assert.equal(c.scope_review_state, x.scope_review_state);
  assert.deepEqual(c.scope_evidence || [], x.scope_evidence);
  assert.deepEqual(c.inclusion_rule, x.inclusion_rule);
  assert.equal(c.native_currency, r.currency);
  assert.deepEqual(
    c.details.source_fields,
    x.source_fields,
    `${id}: MCP lost raw source evidence`,
  );
  if (r.currency !== "CAD") assert.equal(c.amount_cad, undefined);
  const fetched = JSON.parse((await tool("fetch", { id })).text);
  assert.equal(fetched.human_scale, undefined);
  assert.equal(fetched.qualification, statement);
  assert.equal(fetched.scope_review_state, x.scope_review_state);
  const supplier = await tool("get_supplier", {
    supplier_id: D.keyHash(r.supplier_key),
  });
  assert.equal(supplier.human_scale, undefined);
  assert.match(supplier.overlap_and_exclusion_policy, /not total receipts/);
  assert.ok(
    supplier.by_source_basis_period_currency_location.some(
      (g) =>
        g.scope_status === x.scope_status &&
        g.scope_review_state === x.scope_review_state &&
        g.currency === r.currency,
    ),
  );
  const shard =
    files[parseInt(D.keyHash(r.supplier_key).slice(0, 4), 16) % 512][
      D.keyHash(r.supplier_key)
    ];
  assert.equal(
    shard.top.find((t) => t.i === id).x.scope_status,
    x.scope_status,
  );
  assert.doesNotMatch(
    (
      await supplierPage(shard, {
        flags: {},
        stats,
        hash: D.keyHash(r.supplier_key),
        links,
      })
    ).body,
    /per person in the province|of work at the median/,
  );
}
// N1 expectations are independent of generated fixture classifications.
for (const [id, status, place, kind] of [
  ["352559efa91e", "NL", "Goose Bay, Labrador", "work_or_delivery"],
  [
    "3b111bcf74a5",
    "national_or_multiple_or_other",
    "Ottawa",
    "work_or_delivery",
  ],
  [
    "da13771f1372",
    "NL",
    "Province of Newfoundland and Labrador",
    "beneficiary_or_jurisdiction",
  ],
]) {
  const record = await tool("get_record", { id });
  assert.equal(record.scope_status, status);
  assert.equal(record.scope_review_state, "reviewed");
  assert.ok(record.source_geography[kind].some((p) => p.includes(place)));
  assert.ok(record.scope_evidence.length);
}
const unreviewed = await tool("get_record", { id: "63300ec95fb3" });
assert.equal(unreviewed.scope_review_state, "unreviewed");
assert.match(unreviewed.qualification, /NL Ledger has not established/);
assert.deepEqual(unreviewed.scope_evidence || [], []);
assert.doesNotMatch(
  federalStatement({ ds: "fed_contract" }),
  /source does not establish/,
);

// Source narratives and incomplete review wording must also survive search.
for (const [id, query, source, state] of [
  ["352559efa91e", "Golder contaminated Goose Bay", "fed_contract", "reviewed"],
  ["3b111bcf74a5", "Shirley", "fed_contract", "reviewed"],
  ["da13771f1372", "Canada Health Transfer", "pa_tp", "reviewed"],
  ["63300ec95fb3", "Stepped", "pa_pss", "unreviewed"],
]) {
  const results = await tool("search_records", { query, source });
  const record = results.records.find((r) => r.id === id);
  assert.ok(record, `${id}: absent from evidence search`);
  assert.equal(record.scope_review_state, state);
  if (state === "unreviewed")
    assert.match(record.qualification, /NL Ledger has not established/);
  const short = await tool("search", { query });
  assert.ok(
    short.results
      .find((r) => r.id === id)
      ?.title.includes(record.qualification),
  );
}
// Queries must reach retained evidence, not just a title or generic programme field.
const national = await tool("search_records", {
  query: "nationally",
  source: "fed_contract",
});
assert.ok(national.records.some((r) => r.id === "c5500509042d"));
const results = await tool("search", { query: "Kongsberg" });
assert.ok(results.results.some((r) => r.title.includes("USD 473,000.00")));
const scale = await tool("human_scale", { amount: 255261335.35 });
assert.match(scale.assumption, /Hypothetical/);
assert.match(scale.assumption, /does not establish geographic spending/);
assert.doesNotMatch(
  PROMPTS.find((p) => p.name === "follow_the_money").text({ name: "Example" }),
  /everything.*received/i,
);
assert.equal(
  datasetLd({
    name: "Federal records",
    path: "/federal/",
    description: FEDERAL_RULE,
  }).spatialCoverage,
  undefined,
);
assert.equal(
  datasetLd({
    name: "Provincial accounts",
    path: "/priorities/",
    spatialCoverage: "Newfoundland and Labrador, Canada",
  }).spatialCoverage,
  "Newfoundland and Labrador, Canada",
);
for (const discovery of [serverJson(), serverCard()])
  assert.match(discovery.description, /Addresses do not locate/);

// Missing, zero and foreign values remain distinct across totals and display.
const groups = reportedBreakdown([
  { ds: "canadabuys", a: null, c: "CAD" },
  { ds: "canadabuys", a: 0, c: "CAD" },
  { ds: "canadabuys", a: 473000, c: "USD" },
  { ds: "canadabuys", a: 394250, c: "unstated" },
]);
const cad = groups.find((g) => g.currency === "CAD");
assert.equal(cad.missing_amounts, 1);
assert.equal(cad.zero_amounts, 1);
assert.equal(cad.value, 0);
assert.equal(reportedBreakdown([{ ds: "canadabuys", a: null }])[0].value, null);
assert.equal(
  groups
    .filter((g) => g.currency !== "CAD")
    .every((g) => !g.included_in_summary),
  true,
);
assert.doesNotMatch(nativeAmount(394250, "unstated"), /\$/);
assert.doesNotMatch(nativeAmount(473000, "USD"), /CAD|\$/);

// Unknown conclusions and incomplete reviews must remain separate summary groups.
const unknownGroups = reportedBreakdown([
  {
    ds: "fed_contract",
    a: 1,
    x: { scope_status: "unknown", scope_review_state: "unreviewed" },
  },
  {
    ds: "fed_contract",
    a: 2,
    x: { scope_status: "unknown", scope_review_state: "reviewed" },
  },
]);
assert.equal(unknownGroups.length, 2);
assert.equal(
  unknownGroups.find((g) => g.scope_review_state === "unreviewed").value,
  1,
);

// The actual flag export must retain the same evidence, not only id/amount.
D.catalog = JSON.parse(
  readFileSync(new URL("../sample/flag_catalog.json", import.meta.url)),
);
D.flagRows = [
  { flag: "contract-growth", item_id: "fed_contract-c5500509042d" },
];
D.flagSummary = { "contract-growth": { items: 1, amount: 255261335.35 } };
const flag = await tool("get_flag", { id: "contract-growth" });
assert.match(flag.why, /reported value grew/i);
assert.equal(
  flag.results.top_items[0].scope_status,
  "national_or_multiple_or_other",
);
assert.match(flag.results.federal_selection_rule, /address selects/);

if (process.argv.includes("--built")) {
  for (const path of [
    "federal",
    "sources",
    "about",
    "data",
    "method/federal",
    "scale",
  ]) {
    const html = readFileSync(
      new URL(`./dist/${path}/index.html`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      html,
      /Federal money in the province|that land in Newfoundland|money that was never competed|gold above adds up/,
    );
    if (["federal", "data"].includes(path))
      assert.doesNotMatch(html, /"spatialCoverage"/);
  }
  assert.ok(existsSync(new URL("./dist/index.html", import.meta.url)));
}
console.log(
  `federal surfaces: ${fixture.ledger.length} real records retain evidence and basis in HTML, metadata, shards, MCP get/fetch/search/supplier/flag; native currencies and missing/zero checked`,
);
