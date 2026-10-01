import assert from "node:assert/strict";
import { mobileTables } from "./lib/tables.mjs";
import { schedule, layout } from "./lib/html.mjs";
const table = await schedule({
  cols: [
    { label: "Name" },
    { label: "Records", num: true },
    { label: "Value", num: true },
    { label: "Source" },
  ],
  rows: [
    {
      cells: ["Thing", "0", "$0", "1"],
    },
    { cells: ["Unknown", "2", "", ""] },
  ],

  foot: [{ cells: ["Total", "2", "$0", ""] }],
});
assert.equal(mobileTables(table), table);
assert.match(
  table,
  /data-main-figure><span class="cell-label" aria-hidden="true">Value: /,
);
assert.match(table, /<th scope="row" role="rowheader">Thing/);
assert.match(table, /Source: <\/span><span class="cell-value">1/);
assert.match(table, />\$0<\/span>/);
assert.match(table, /cell-missing/);
assert.match(table, /<tfoot role="rowgroup">/);
assert.match(
  await schedule({
    cols: [{ label: "Name" }],
    rows: [{ cells: ['<a href="/thing/">Thing</a>'] }],
  }),
  /&lt;a/,
);
const linked = mobileTables(
  '<table class="sched"><thead><tr><th scope="col">Name</th><th scope="col">Source</th></tr></thead><tbody><tr><th scope="row"><a href="/thing/">Thing</a></th><td><a href="#note-1">1</a></td></tr></tbody></table>',
);
assert.match(
  linked,
  /<th scope="row" role="rowheader"><a href="\/thing\/">Thing<\/a>/,
);
assert.match(
  linked,
  /Source: <\/span><span class="cell-value"><a href="#note-1">1<\/a>/,
);
const custom =
  '<table class="sched tight"><thead><tr><th scope="col">Year</th><th scope="col">Spent</th></tr></thead><tbody><tr><th scope="row">2025</th><td class="n hide-sm">$1</td></tr></tbody></table>';
assert.match(await layout({ title: "Test", body: custom }), /data-main-figure/);
assert.equal(
  mobileTables("<table><tr><td>Other</td></tr></table>"),
  "<table><tr><td>Other</td></tr></table>",
);

const years = await schedule({
  cols: [{ label: "Employer" }, { label: "2025-26", num: true }],
  rows: [{ cells: ["Employer", "$12"] }],
});
assert.match(years, /data-main-figure/);

const pay = await schedule({
  cols: [
    { label: "Name" },
    { label: "Base", num: true },
    { label: "Overtime", num: true },
    { label: "Total", num: true },
  ],
  rows: [{ cells: ["Person", "$100", "$0", "$100"] }],
});
assert.match(
  pay,
  /data-main-figure><span class="cell-label" aria-hidden="true">Total: /,
);
console.log(
  "PASS: shared/custom tables, idempotence, semantics, zero/missing amounts, totals, links",
);
