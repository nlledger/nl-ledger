// Page parity and full-record counting checks, portable on the committed sample.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { slug, money, moneyWords, num } from "./lib/format.mjs";
import { handleMcp, TOOLS } from "./lib/mcp.mjs";
import { payJSON } from "./src/paydata.mjs";
import { pay } from "./src/pages/pay.mjs";
import { bodiesJSON, bodyList, bodyData } from "./src/bodydata.mjs";
import { bodies } from "./src/pages/bodies.mjs";
import { totalsData, totalsFiles } from "./src/totalsdata.mjs";
import { groupTotals } from "./lib/totals.mjs";
import { computeReceipt, renderReceipt } from "./lib/receipt.mjs";
import { buildReceiptData } from "./src/receiptdata.mjs";
const db = new DatabaseSync(":memory:");
db.exec(
  gunzipSync(
    readFileSync(new URL("../sample/ledger.sql.gz", import.meta.url)),
  ).toString(),
);
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const fact = (k) =>
  JSON.parse(one("SELECT value FROM facts WHERE key=?", k).value);
const years = q(
  "SELECT DISTINCT fiscal_year y FROM dept_summary WHERE kind='actual' ORDER BY y",
).map((r) => r.y);
const deptYear = Object.fromEntries(
  years.map((year) => [
    year,
    q(
      "SELECT department name, sum(gross) gross, source_url url, source_file file, group_concat(page) pages FROM dept_summary WHERE kind='actual' AND fiscal_year=? GROUP BY department ORDER BY gross DESC",
      year,
    ).map((d) => ({ ...d, pages: new Set(d.pages.split(",").map(Number)) })),
  ]),
);
const D = {
  q,
  one,
  slug,
  keyHash: (s) =>
    createHash("sha1")
      .update(s || "")
      .digest("hex")
      .slice(0, 10),
  issues: q("SELECT * FROM publisher_issues"),
  flagRows: [],
  itemFlags: new Map(),
  flagSummary: {},
  flagById: {},
  years,
  deptYear,
  stats: fact("stats"),
  federal: fact("federal_report"),
};
const P = payJSON(D),
  B = bodiesJSON(D),
  R = buildReceiptData(D),
  totals = totalsFiles(D);
const data = {
  "/data/pay.json": P,
  "/data/bodies.json": B,
  "/data/receipt.json": R,
  ...Object.fromEntries(Object.entries(totals).map(([p, v]) => ["/" + p, v])),
};
const io = { json: async (path) => data[path] ?? null };
async function tool(name, args = {}) {
  const res = await handleMcp(
    new Request("https://nlledger.ca/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    io,
  );
  const j = await res.json();
  assert.equal(j.error, undefined);
  return j.result;
}
// One HTTP request must never fan out into several tool calls, or buffer an unbounded body.
const BODY_LIMIT = 64 * 1024;
const rpcCall = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "get_pay", arguments: {} },
};
let rejectedReads = 0;
const rejectIO = {
  json: async () => {
    rejectedReads++;
    throw new Error("Rejected request dispatched a tool");
  },
};
const post = (body, headers = {}) =>
  new Request("https://nlledger.ca/mcp", {
    method: "POST",
    body,
    headers,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
for (const batch of [
  [],
  [rpcCall],
  [rpcCall, { ...rpcCall, id: 2 }],
  Array(100).fill(rpcCall),
]) {
  const response = await handleMcp(post(JSON.stringify(batch)), rejectIO);
  assert.equal(response.status, 400);
  const error = await response.json();
  assert.equal(error.id, null);
  assert.equal(error.error.code, -32600);
  assert.match(error.error.message, /one.*request|batch/i);
}
const ping = { jsonrpc: "2.0", id: 7, method: "ping" };
const padded = (bytes) => {
  const raw = JSON.stringify(ping);
  return raw + " ".repeat(bytes - new TextEncoder().encode(raw).byteLength);
};
const oversized = await handleMcp(post(padded(BODY_LIMIT + 1)), rejectIO);
assert.equal(oversized.status, 413);
assert.equal((await oversized.json()).error.code, -32600);
// No Content-Length, and a dishonest small length, must both be bounded during reads.
for (const headers of [{}, { "content-length": "1" }]) {
  let pulls = 0,
    cancelled = false;
  const stream = new ReadableStream(
    {
      pull(controller) {
        pulls++;
        if (pulls <= 3)
          controller.enqueue(new Uint8Array(BODY_LIMIT / 2).fill(32));
        else
          throw new Error(
            "Read beyond the first chunk crossing the body limit",
          );
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const response = await handleMcp(post(stream, headers), rejectIO);
  assert.equal(response.status, 413);
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
}
// Count encoded bytes, not JS string length, including multibyte UTF-8.
const unicodeBody = JSON.stringify({
  ...ping,
  padding: "é".repeat(BODY_LIMIT / 2),
});
assert.ok(unicodeBody.length < BODY_LIMIT);
assert.equal((await handleMcp(post(unicodeBody), rejectIO)).status, 413);
const boundary = await handleMcp(post(padded(BODY_LIMIT)), rejectIO);
assert.equal(boundary.status, 200);
assert.deepEqual((await boundary.json()).result, {});
for (const raw of ["", "{invalid"]) {
  const response = await handleMcp(post(raw), rejectIO);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32700);
}
const notification = await handleMcp(
  post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })),
  rejectIO,
);
assert.equal(notification.status, 202);
assert.equal(rejectedReads, 0);
const result = async (name, args) => {
  const r = await tool(name, args);
  assert.equal(r.isError, false, JSON.stringify(r));
  return r.structuredContent;
};
assert.equal(TOOLS.length, 15);
for (const name of ["get_pay", "get_body", "tax_receipt", "get_totals"])
  assert.equal(
    TOOLS.find((t) => t.name === name).annotations.readOnlyHint,
    true,
  );
const payPages = new Map(await pay(D, R));
for (const employer of P.employers) {
  const got = await result("get_pay", { employer: employer.employer });
  const page = payPages.get(employer.page_url).body;
  assert.doesNotMatch(JSON.stringify(got), /"person"/);
  for (const year of got.by_year) {
    const want = one(
      "SELECT count(*) people, sum(amount) total FROM items WHERE dataset='sunshine' AND buyer=? AND fiscal_year=?",
      employer.employer,
      `calendar ${year.year}`,
    );
    if (want.people) {
      assert.equal(year.people, want.people);
      assert.equal(year.total_cad, want.total);
      const components = one(
        "SELECT sum(json_extract(extra,'$.overtime')) ot,sum(json_extract(extra,'$.severance')) sev FROM items WHERE dataset='sunshine' AND buyer=? AND fiscal_year=?",
        employer.employer,
        `calendar ${year.year}`,
      );
      assert.equal(year.overtime_cad, components.ot);
      assert.equal(year.severance_cad, components.sev);
      assert.ok(page.includes(moneyWords(year.total_cad)));
    } else {
      assert.equal(year.people, null);
      assert.equal(year.total_cad, null);
      assert.equal(year.status, "not available");
    }
    const filtered = await result("get_pay", {
      employer: employer.employer,
      year: year.year,
    });
    assert.equal(filtered.by_year.length, 1);
    assert.deepEqual(filtered.titles, employer.titles_by_year[year.year] || []);
  }
  for (const t of got.titles) assert.ok(page.includes(money(t.average_cad)));
}
assert.equal(
  (await tool("get_pay", { employer: "nonexistent" })).isError,
  true,
);
assert.equal((await tool("get_pay", { year: "2024-25" })).isError, true);
assert.equal((await tool("get_pay", { year: "1900" })).isError, true);
const payYear = await result("get_pay", { year: P.years[0] });
assert.ok(payYear.employers.every((e) => e.by_year.length === 1));
const bodyPages = new Map(await bodies(D, R));
for (const body of B) {
  const got = await result("get_body", { name: body.buyer });
  assert.equal(got.reported_record_values_cad, body.amount);
  assert.deepEqual(
    got.by_year,
    JSON.parse(JSON.stringify(bodyData(D, body).byYear)),
  );
  const page = bodyPages.get(body.page_url).body;
  assert.ok(page.includes(moneyWords(body.amount)));
  for (const supplier of got.largest_suppliers)
    assert.ok(page.includes(moneyWords(supplier.reported_value_cad || 0)));
  for (const source of got.by_source) {
    const ps = got.separated_by_year_and_source.filter(
      (p) => p.source === source.dataset && p.currency === "CAD",
    );
    const amount = ps
      .flatMap((p) => p.groups)
      .reduce((sum, g) => sum + (g.value || 0), 0);
    assert.ok(Math.abs(amount - (source.amount || 0)) < 0.01);
  }
}
assert.equal((await tool("get_body", { name: "nonexistent" })).isError, true);
for (const income of [
  0, 10000, 25000, 55000, 88382, 150000, 10000000, 55000.99,
]) {
  const got = await result("tax_receipt", { income });
  const c = computeReceipt(R, Math.floor(income));
  assert.equal(got.estimated_provincial_income_tax_cad, c.tax);
  assert.deepEqual(
    got.departments.map((d) => d.illustrated_tax_share_cad),
    c.lines.map((d) => d.yours),
  );
  assert.ok(
    renderReceipt(R, Math.floor(income), D.stats).includes(
      money(c.tax, { cents: true }),
    ),
  );
  assert.match(got.assumptions, /single employee/);
  assert.ok(got.tax_parameters.source);
}
for (const income of [-1, 10000001, "55000", null])
  assert.equal((await tool("tax_receipt", { income })).isError, true);
const cubes = totalsData(D);
for (const [source, rows] of Object.entries(cubes)) {
  const got = await result("get_totals", { source, group_by: "source" });
  for (const p of got.partitions) {
    const g = p.groups[0];
    const want = one(
      "SELECT count(*) n,sum(amount) value,sum(amount IS NULL) missing,sum(amount=0) zeros FROM items WHERE dataset=? AND coalesce(currency,'CAD')=?",
      source,
      p.currency,
    );
    assert.equal(g.records, want.n);
    assert.ok(Math.abs((g.value || 0) - (want.value || 0)) < 0.01);
    assert.equal(g.missing_amounts, want.missing);
    assert.equal(g.zero_amounts, want.zeros || 0);
    assert.equal(
      p.included_in_summary,
      !["canadabuys", "pa_pss", "pa_tp"].includes(source) &&
        p.currency === "CAD",
    );
  }
  const year = rows.find((r) => /^\d{4}$/.test(r.year))?.year;
  if (year) {
    const got = await result("get_totals", {
      source,
      year,
      group_by: "supplier",
      limit: 100,
    });
    const expected = groupTotals(rows, {
      group_by: "supplier",
      year,
      limit: 100,
    });
    assert.deepEqual(
      got.partitions.map((p) =>
        p.groups.map((g) => [g.id, g.value, g.records]),
      ),
      expected.map((p) => p.groups.map((g) => [g.id, g.value, g.records])),
    );
  }
}
for (const group_by of ["supplier", "body", "department", "year", "source"]) {
  const got = await result("get_totals", { group_by, limit: 3 });
  assert.ok(got.partitions.every((p) => p.groups.length <= 3));
}
// Homepage rankings and the tool share the aggregation, and reconcile to independent SQL.
for (const source of ["ppa", "fed_contract", "fed_grant"]) {
  const got = await result("get_totals", {
    source,
    group_by: "supplier",
    limit: 5,
  });
  const cad = got.partitions.find((p) => p.currency === "CAD").groups;
  const want = q(
    "SELECT supplier_key,sum(amount) value FROM items WHERE dataset=? AND currency='CAD' AND supplier_key IS NOT NULL AND supplier_key!='' GROUP BY supplier_key ORDER BY value DESC LIMIT 5",
    source,
  );
  assert.deepEqual(
    cad.map((g) => g.id),
    want.map((g) => D.keyHash(g.supplier_key)),
  );
  for (let i = 0; i < want.length; i++)
    assert.ok(Math.abs(cad[i].value - want[i].value) < 0.01);
  assert.deepEqual(
    R.topRecipients
      .filter((r) =>
        r.sources.startsWith(
          {
            ppa: "provincial awards",
            fed_contract: "federal contracts",
            fed_grant: "federal grants",
          }[source],
        ),
      )
      .map((r) => r.amount),
    cad.map((g) => g.value),
  );
}
const example = Object.values(cubes)
  .flat()
  .find((r) => r.supplier_id && r.body_id && /^\d{4}$/.test(r.year));
const filtered = await result("get_totals", {
  source: example.source,
  year: example.year,
  supplier_id: example.supplier_id,
  body_id: example.body_id,
  group_by: "year",
});
assert.ok(filtered.partitions.length);
for (const p of filtered.partitions)
  for (const g of p.groups) {
    assert.ok(g.records_url.includes(`ds=${example.source}`));
    assert.ok(g.records_url.includes(`y=${example.year}`));
    assert.ok(g.records_url.includes(`s=${example.supplier_id}`));
    assert.ok(g.records_url.includes(`b=${example.body_id}`));
  }
const idx = totals["data/totals/index.json"];
for (const [id, aliases] of Object.entries(idx.supplier_aliases))
  for (const alias of aliases) {
    const ambiguous =
      Object.entries(idx.supplier_aliases).filter(([, names]) =>
        names.some((n) => n.toLowerCase() === alias.toLowerCase()),
      ).length > 1;
    if (ambiguous) continue;
    const got = await result("get_totals", {
      supplier: alias,
      group_by: "source",
    });
    assert.equal(got.filters.supplier_id, id);
  }
const conflict = Object.values(totals["data/totals/index.json"].suppliers).find(
  (n) => n !== example.supplier,
);
assert.equal(
  (
    await tool("get_totals", {
      supplier: conflict,
      supplier_id: example.supplier_id,
    })
  ).isError,
  true,
);
const rankingPath = "/data/totals/rankings/source.json",
  saved = data[rankingPath];
delete data[rankingPath];
assert.equal((await tool("get_totals", {})).isError, true);
data[rankingPath] = saved;
assert.equal(
  (await result("get_totals", { supplier_id: "0000000000" })).no_matches,
  true,
);
for (const args of [
  { source: "fake" },
  { year: "../../secret" },
  { year: 2024 },
  { limit: 0 },
  { limit: 101 },
  { supplier_id: "invalid" },
  { group_by: "fake" },
])
  assert.equal((await tool("get_totals", args)).isError, true);
// Native currency, absent amounts, published zero and overlap remain separate.
const base = {
  source: "canadabuys",
  level: "federal",
  year: "2024",
  body: "Buyer",
  body_id: "1",
  supplier: "Supplier",
  supplier_id: "2",
  scope_status: "unknown",
  scope_review_state: "unreviewed",
  counting_basis: "notice",
  records: 1,
  missing_amounts: 0,
  zero_amounts: 0,
  page_url: "/search/",
  representative_source: { url: "https://example.org" },
};
const partitions = groupTotals(
  [
    { ...base, currency: "USD", value: 473000 },
    { ...base, currency: "CAD", value: 0, zero_amounts: 1 },
    { ...base, currency: "unstated", value: null, missing_amounts: 1 },
  ],
  { group_by: "supplier" },
);
assert.equal(partitions.length, 3);
assert.ok(partitions.every((p) => !p.included_in_summary));
assert.equal(
  partitions.find((p) => p.currency === "unstated").groups[0].value,
  null,
);
assert.equal(partitions.find((p) => p.currency === "CAD").groups[0].value, 0);
assert.equal(
  partitions.find((p) => p.currency === "USD").groups[0].value,
  473000,
);
console.log(
  "MCP page parity, full-record totals, privacy, currency and coverage checks: pass",
);
db.close();
