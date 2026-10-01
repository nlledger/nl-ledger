// Financial claims and coverage regressions. Uses the committed sample, no services or accounts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  searchPage,
  itemPage,
  resultItem,
  supplierPage,
} from "./lib/views.mjs";
import { buildSupplierShards } from "./src/shards.mjs";
import { pay } from "./src/pages/pay.mjs";
import { payIssues } from "./src/pay-coverage.mjs";
import { isBrokenPublisherLink } from "./src/pages/info.mjs";
import { slug } from "./lib/format.mjs";

const db = new DatabaseSync(":memory:");
db.exec(
  gunzipSync(
    readFileSync(new URL("../sample/ledger.sql.gz", import.meta.url)),
  ).toString(),
);
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
  issues: q("SELECT * FROM publisher_issues"),
};
const stats = JSON.parse(
  D.one("SELECT value FROM facts WHERE key='stats'").value,
);
const links = {
  body: ["town-of-gander"],
  pay: ["nl-health-services"],
  department: [],
};
const record = {
  i: "test",
  ds: "ppa",
  s: "Town of Gander",
  k: "town",
  b: "NL Health Services",
  a: 306400,
  t: "2025-03-20",
  d: "Temporary lease space",
  u: "https://example.org/source.pdf",
  g: 2,
};

const mixed = await searchPage({
  params: { q: "town" },
  result: { items: [record, { ...record, ds: "fed_grant", a: 75000 }] },
  flags: {},
  links,
  page: 1,
});
assert.doesNotMatch(mixed, /together|\$381,400/);
assert.match(mixed, /largest values on this page first/);
assert.doesNotMatch(mixed, /autofocus/);
assert.match(mixed, /<details class="search-filters">/);
assert.match(
  await searchPage({
    params: { ds: "ppa", y: "2025", b: "town" },
    result: { items: [] },
    flags: {},
    links,
    page: 1,
  }),
  /<details class="search-filters" open>/,
);
assert.match(await resultItem(record, {}, links), /Supplier: /);
assert.match(
  await resultItem({ ...record, b: "Town of Gander" }, {}, links),
  /Bought by: <a href="\/body\/town-of-gander\/">/,
);
assert.match(
  await resultItem({ ...record, ds: "fed_grant" }, {}, links),
  /Recipient: /,
);
assert.match(
  await resultItem({ ...record, ds: "fed_grant" }, {}, links),
  /Granted by: /,
);
assert.doesNotMatch(
  await resultItem({ ...record, b: "<Unknown>" }, {}, links),
  /href="\/body\/unknown/,
);
assert.match(
  await resultItem({ ...record, b: "<Unknown>" }, {}, links),
  /&lt;Unknown&gt;/,
);
for (const [ds, label] of Object.entries({
  ppa: "Award value",
  canadabuys: "Reported federal award notice value",
  fed_contract: "Latest reported federal contract value",
  fed_grant: "Reported federal agreement value",
  pa_pss: "Reported federal payment",
  pa_tp: "Reported federal payment",
  sunshine: "Published compensation",
  minister: "Expense claim",
  mha: "Published expense",
})) {
  assert.match(
    (await itemPage({ ...record, ds }, { flags: {}, stats, links })).body,
    new RegExp(label),
  );
}

// A counted-once award still exposes the other source printing, without a second sum.
const repeat = {
  source_url: "https://www.gov.nl.ca/ppa/files/repeat.pdf",
  source_file: "ppa/repeat.pdf",
  page: 3,
  locator: "page 3, award 2",
  supplier: "Supplier <Inc>",
  buyer: "Town of Gander",
  description: "Repeated purchase <script>",
  contract_no: "PO123",
  award_date: "2025-03-20",
  amount: 306400,
  term: "1 Year",
  note: "Shown here for comparison; not added again. Same full identifiers and award details.",
};
const repeatedBody = (
  await itemPage(
    { ...record, x: { repeat_printings: [repeat] } },
    { flags: {}, stats, links },
  )
).body;
assert.match(repeatedBody, /Other printings, counted once/);
assert.match(repeatedBody, /repeat\.pdf#page=3/);
assert.match(repeatedBody, /not added again/);
assert.match(repeatedBody, /Supplier &lt;Inc&gt;/);
assert.doesNotMatch(repeatedBody, /<script>/);

// Every buyer's included/excluded split reconciles independently to the sample's rows,
// including suppliers whose only records are notices or payments.
const { files } = buildSupplierShards(D);
for (const shard of Object.values(files))
  for (const [hash, s] of Object.entries(shard)) {
    if (s.to) continue;
    const buyers = q(
      `SELECT buyer, sum(CASE WHEN dataset IN ('pa_pss','pa_tp','canadabuys') THEN 0 ELSE coalesce(amount,0) END) included,
    sum(CASE WHEN dataset IN ('pa_pss','pa_tp','canadabuys') THEN coalesce(amount,0) ELSE 0 END) excluded FROM items WHERE supplier_key=? AND dataset!='sunshine' GROUP BY buyer`,
      s.key,
    );
    assert.equal(s.buyers.length, buyers.length);
    for (const want of buyers) {
      const got = s.buyers.find((b) => b.name === want.buyer);
      assert.ok(Math.abs(got.included - want.included) < 0.01);
      assert.ok(Math.abs(got.excluded - want.excluded) < 0.01);
    }
    assert.ok(
      Math.abs(s.buyers.reduce((a, b) => a + b.included, 0) - s.total) < 0.01,
    );
    assert.ok(
      Math.abs(s.buyers.reduce((a, b) => a + b.excluded, 0) - s.overlap) < 0.01,
    );
    const body = (await supplierPage(s, { flags: {}, stats, hash, links }))
      .body;
    assert.doesNotMatch(
      body,
      /repeat money already counted|repeats money counted above|<caption>Paid by/,
    );
  }

// One printed name can now belong to several evidenced identities. Its old name link
// must neither choose one arbitrarily nor overwrite the page for unresolved records.
db.exec("SAVEPOINT split_suppliers");
const insert =
  db.prepare(`INSERT INTO items (id,dataset,level,supplier,supplier_key,supplier_name_key,amount,buyer)
  VALUES (?, 'fed_grant', 'federal', ?, ?, ?, ?, 'Test buyer')`);
for (const [id, name, key, nameKey, amount] of [
  ["split-a1", "Example Inc.", "example [bn 107876468]", "example", 100],
  ["split-a2", "Example North", "example [bn 107876468]", "example north", 200],
  ["split-b1", "Example Corporation", "example [bn 107910176]", "example", 300],
  ["split-b2", "Example South", "example [bn 107910176]", "example south", 400],
  ["split-unknown", "Example", "example", "example", 500],
])
  insert.run(id, name, key, nameKey, amount);
const pageAt = (result, key) =>
  Object.values(result.files)
    .flatMap((f) => Object.entries(f))
    .find(([h]) => h === D.keyHash(key))?.[1];
const split = buildSupplierShards({
  ...D,
  matching: {
    identities: {
      "example [bn 107876468]": {
        business_numbers: ["107876468RP0001", "119229896RR1068"],
      },
    },
  },
});
assert.equal(pageAt(split, "example").total, 500);
for (const key of [
  "example",
  "example [bn 107876468]",
  "example [bn 107910176]",
]) {
  const s = pageAt(split, key);
  assert.equal(s.related.length, 2);
  assert.equal(s.identityUnresolved, true);
  assert.equal(s.total + s.related.reduce((sum, r) => sum + r.total, 0), 1500);
  const body = (
    await supplierPage(s, { flags: {}, stats, hash: D.keyHash(key), links })
  ).body;
  assert.match(body, /Identity unresolved/);
  for (const other of s.related) {
    assert.ok(body.includes(`/supplier/${other.h}/`));
    assert.ok(body.includes(other.total.toFixed(2)));
  }
}
const joinedBody = (
  await supplierPage(pageAt(split, "example [bn 107876468]"), {
    flags: {},
    stats,
    hash: "test",
    links,
  })
).body;
assert.match(joinedBody, /more than one business number/);
assert.match(joinedBody, /107876468RP0001/);
assert.match(joinedBody, /119229896RR1068/);
assert.equal(pageAt(split, "example [bn 107876468]").total, 300);
assert.equal(pageAt(split, "example [bn 107910176]").total, 700);
assert.equal(
  pageAt(split, "example north").to,
  D.keyHash("example [bn 107876468]"),
);
db.exec("DELETE FROM items WHERE id='split-unknown'");
assert.equal(pageAt(buildSupplierShards(D), "example"), undefined);
db.exec("ROLLBACK TO split_suppliers; RELEASE split_suppliers");

// A missing employer-year is a coverage gap, with both cells unavailable, never zero.
const employers = (await pay(D, {})).filter(([path]) => path !== "/pay/");
for (const [, p] of employers)
  assert.match(p.body, /not\s+the\s+employer(?:&#39;|')s\s+entire\s+payroll/);
const health = employers.find(([path]) => path === "/pay/nl-health-services/");
assert.ok(health);
assert.match(health[1].body, /2023[\s\S]*?Not available[\s\S]*?Not available/);
assert.match(health[1].body, /2023 list could not be downloaded/);
assert.match(health[1].body, /compensation-disclosure-2023/);
// Only the checked government file can supply a known employer/year explanation.
assert.equal(
  payIssues(
    [
      {
        source: "Compensation disclosure",
        url: "https://example.org/exec/tbs/files/Newfoundland-and-Labrador-Health-Services-Compensation-Disclosure.xlsx",
      },
    ],
    "NL Health Services",
  ).length,
  0,
);
assert.equal(
  payIssues(
    [
      {
        source: "Compensation disclosure",
        url: "https://www.gov.nl.ca/exec/tbs/files/Future-Undated-File.xlsx",
      },
    ],
    "NL Health Services",
  ).length,
  0,
);
assert.equal(payIssues(D.issues, "Core public service").length, 0);
// Publisher failures and total discrepancies must remain distinct; every discrepancy receipt is external.
for (const issue of D.issues) {
  if (issue.source === "Ministerial expense claims") {
    assert.match(
      issue.url,
      /^https:\/\/www\.gov\.nl\.ca\/exec\/files\/[^/]+\.pdf$/,
    );
    assert.equal(isBrokenPublisherLink(issue.issue), false);
  }
  if (
    issue.source === "MHA expense report" ||
    issue.source === "Compensation disclosure"
  ) {
    assert.equal(isBrokenPublisherLink(issue.issue), true);
  }
}
assert.equal(
  isBrokenPublisherLink(
    "web page total $404.00 vs PDF total $504.00 (publisher discrepancy)",
  ),
  false,
);
assert.equal(isBrokenPublisherLink("404"), true);
assert.equal(isBrokenPublisherLink("link returns a web page, not a PDF"), true);
console.log("financial claims and coverage checks: pass");
