import { renderComponent } from "../../lib/render.mjs";
// Patterns: an index, a results page per flag, and a method page per flag.
import { card, cardAmount } from "../../lib/share-card.mjs";
import {
  esc,
  html,
  icon,
  Notes,
  schedule,
  receipt,
  bar,
  flagItem,
  methodCode,
} from "../../lib/html.mjs";
import {
  money,
  moneyWords,
  num,
  pct,
  date as fmtDate,
} from "../../lib/format.mjs";
import { desc } from "../seo.mjs";
import {
  pagehead,
  itemRow,
  ITEM_COLS,
  caveat,
  datasetLabel,
  bodyAnchor,
  federalSummary,
} from "../common.mjs";

// Words people search with. The pattern titles come from the pipeline; these keep the site's own wording alongside them.
const SEARCHED = {
  "no-competition": {
    note: "Provincial sole-source awards are those for which reports cite only one reasonably available supplier (clause 6(a)(v)). Federal results describe only the address-selected contract disclosures.",
    title: "Contracts awarded without competition: sole-source",
    description:
      "Reported provincial awards and selected federal contracts coded without competition. Addresses do not establish where the work or benefit occurred.",
  },
  "repeat-sole-source": {
    title: "Repeat sole-source contracts to one supplier",
  },
};

function countLine(D, f) {
  const s = D.flagSummary[f.id] || {};
  if (s.items)
    return `${num(s.items)} items${s.amount ? `, ${moneyWords(s.amount)}` : ""}`;
  if (s.subjects) return `${num(s.subjects)} found`;
  return "none found";
}

export async function flagPages(D, R) {
  const out = [];
  const cat = D.catalog;

  out.push([
    "/flags/",
    {
      card: card(
        "Patterns people ask about",
        num(cat.flags.length),
        "Patterns checked · a question, not a finding",
      ),
      title: "Sole-source contracts and other spending patterns",
      description: desc(
        `${cat.flags.length} patterns in provincial records and address-selected federal disclosures. A reported value is not expenditure in NL.`,
      ),
      body: await renderComponent("components_PatternsIndex_astro", {
        pagehead,
        esc,
        cat,
        flagItem,
        countLine,
        D,
      }),
    },
  ]);

  for (const f of cat.flags) {
    const notes = new Notes();
    const subjects = D.flagRows.filter((r) => r.flag === f.id && !r.item_id);
    const itemIds = D.flagRows
      .filter((r) => r.flag === f.id && r.item_id)
      .map((r) => r.item_id);
    let results = "";

    if (f.id === "no-competition") {
      const prov = subjects
        .filter((s) => JSON.parse(s.detail).source === "ppa")
        .map((s) => ({ ...s, x: JSON.parse(s.detail) }))
        .filter((s) => s.x.amount > 250000)
        .sort((a, b) => b.x.exception_amount - a.x.exception_amount);
      const fed = subjects
        .filter((s) => JSON.parse(s.detail).source === "fed_contract")
        .map((s) => ({ ...s, x: JSON.parse(s.detail) }))
        .sort((a, b) => b.x.exception_amount - a.x.exception_amount)
        .slice(0, 15);
      results = await renderComponent("components_CompetitionResults_astro", {
        schedule,
        prov,
        bodyAnchor,
        D,
        num,
        bar,
        moneyWords,
        pct,
        fed,
      });
    } else if (f.id === "repeat-sole-source") {
      const pairs = subjects
        .map((s) => ({ ...s, x: JSON.parse(s.detail) }))
        .sort((a, b) => b.value - a.value);
      results = await schedule({
        cols: [
          { label: "Public body and supplier" },
          { label: "Awards", num: true },
          { label: "Value", num: true },
          { label: "Period" },
        ],
        rows: pairs
          .slice(0, 80)
          .map((s) => ({
            cells: [
              `${bodyAnchor(D, s.x.buyer)} → <a href="/supplier/${D.keyHash(s.x.supplier_key)}/">${esc(s.x.supplier)}</a>`,
              num(s.x.awards),
              moneyWords(s.value),
              `${esc(fmtDate(s.x.first))} to ${esc(fmtDate(s.x.last))}`,
            ],
          })),
      });
    } else if (["year-end", "dominant-supplier"].includes(f.id)) {
      const rows = subjects
        .map((s) => ({ ...s, x: JSON.parse(s.detail) }))
        .sort((a, b) => b.value - a.value);
      results =
        f.id === "year-end"
          ? await schedule({
              cols: [
                { label: "Public body" },
                { label: "Source" },
                { label: "Last month's share", num: true },
                { label: "Times an even share", num: true },
              ],
              rows: rows.map((s) => ({
                cells: [
                  `${bodyAnchor(D, s.subject)}`,
                  esc(datasetLabel(s.x.source)),
                  `${moneyWords(s.x.last_month_amount)} of ${moneyWords(s.x.amount)}`,
                  `${s.value.toFixed(1)}×`,
                ],
              })),
            })
          : await schedule({
              cols: [
                { label: "Public body" },
                { label: "Supplier" },
                { label: "Share", num: true },
                { label: "Value", num: true },
              ],
              rows: rows.map((s) => ({
                cells: [
                  `${bodyAnchor(D, s.subject)}`,
                  `<a href="/supplier/${D.keyHash(s.x.supplier_key)}/">${esc(s.x.supplier)}</a>`,
                  pct(s.value),
                  `${moneyWords(s.x.supplier_amount)} of ${moneyWords(s.x.body_total)}`,
                ],
              })),
            });
    } else if (f.id === "overtime-over-base" || f.id === "severance") {
      const rows = subjects
        .map((s) => ({ ...s, x: JSON.parse(s.detail) }))
        .sort((a, b) => b.value - a.value);
      results = await renderComponent("components_PayPatternResults_astro", {
        schedule,
        f,
        rows,
        D,
        esc,
        num,
        money,
      });
    } else if (f.id === "split-invoices" || f.id === "possible-duplicate") {
      const groups = subjects
        .map((s) => ({ ...s, x: JSON.parse(s.detail) }))
        .sort((a, b) => b.value - a.value);
      results = await schedule({
        cols: [
          {
            label:
              f.id === "possible-duplicate"
                ? "Vendor and invoice"
                : "Supplier, buyer and date",
          },
          {
            label: f.id === "possible-duplicate" ? "Times paid" : "Invoices",
            num: true,
          },
          {
            label: f.id === "possible-duplicate" ? "Each" : "Together",
            num: true,
          },
          { label: "Lines", num: true },
        ],
        rows: groups
          .slice(0, 100)
          .map((s) => ({
            cells: [
              `<a href="/supplier/${D.keyHash(s.x.supplier_key || "")}/">${esc(s.subject)}</a>${s.x.dates ? `<span class="meta">${s.x.dates.map((d) => esc(fmtDate(d))).join(", ")}</span>` : ""}`,
              num(s.x.invoices || s.x.times),
              money(s.value),
              s.x.items
                .map(
                  (i, n) =>
                    `<a class="rcpt" href="/item/${i.split("-").pop()}/">${n + 1}</a>`,
                )
                .join(" "),
            ],
          })),
      });
      if (groups.length > 100)
        results += `<p class="muted">Showing the 100 largest of ${num(groups.length)}.</p>`;
    } else if (f.id === "over-allowance") {
      const rows = subjects.map((s) => ({ ...s, x: JSON.parse(s.detail) }));
      results = rows.length
        ? await schedule({
            cols: [
              { label: "Member" },
              { label: "Year and category" },
              { label: "Over by", num: true },
            ],
            rows: rows.map((s) => ({
              cells: [
                esc(s.subject),
                `${esc(s.x.fiscal_year)}: ${esc(s.x.category)}`,
                money(s.value, { cents: true }),
              ],
            })),
          })
        : await renderComponent("components_AllowanceResults_astro", {
            num,
            reports: D.one(
              "SELECT count(DISTINCT source_file) n FROM items WHERE dataset='mha'",
            ).n,
            broken: D.issues.filter((i) => i.source === "MHA expense report")
              .length,
          });
    } else {
      // item-level list: largest first
      const rows = itemIds.length
        ? D.q(
            `SELECT * FROM items WHERE id IN (${itemIds
              .slice(0, 5000)
              .map(() => "?")
              .join(",")}) ORDER BY amount DESC LIMIT 120`,
            ...itemIds.slice(0, 5000),
          )
        : [];
      if (f.id === "just-under-limit") {
        const dist = JSON.parse(D.flagSummary[f.id].detail || "{}");
        const drows = [];
        for (const [src, lims] of Object.entries(dist))
          for (const [lim, v] of Object.entries(lims))
            drows.push({
              cells: [
                esc(datasetLabel(src)),
                `${money(+lim)} (${esc(v.label)})`,
                num(v.below),
                num(v.above),
              ],
            });
        results += html`<h2 style="margin-block-end:1rem">
            Just below against just above
          </h2>
          ${await schedule({ cols: [{ label: "Source" }, { label: "Limit" }, { label: "Within 5% below", num: true }, { label: "Within 5% above", num: true }], rows: drows })}
          <h2 style="margin-block:2.5rem 1rem">The largest</h2>`;
      }
      results += await schedule({
        cols: ITEM_COLS,
        rows: rows.map((r) => itemRow(D, r)),
      });
      if (itemIds.length > 120)
        results += `<p><a href="/search/?f=${f.id}">All ${num(itemIds.length)} in search</a></p>`;
    }

    const seo = SEARCHED[f.id];
    out.push([
      `/flags/${f.id}/`,
      {
        card: card(
          f.title,
          num(D.flagSummary[f.id]?.items || D.flagSummary[f.id]?.subjects || 0),
          `${D.flagSummary[f.id]?.items ? "Items matched" : "Groups found"} · all included years\nA question, not a finding`,
        ),
        title: seo?.title || f.title,
        description: desc(
          seo?.description ||
            `${f.short} ${countLine(D, f)}. Each is linked to its source: a question, not a finding.`,
        ),
        body: await renderComponent("components_PatternPage_astro", {
          pagehead,
          f,
          esc,
          seo,
          icon,
          cat,
          results,
          federalSummary,
          D,
        }),
        notes,
      },
    ]);

    out.push([
      `/method/${f.id}/`,
      {
        card: card(
          `Method: ${f.title}`,
          num(f.how.length),
          "Steps in the published method · a question, not a finding",
        ),
        title: `Method: ${f.title}`,
        description: desc(
          `Method for "${f.title.toLowerCase()}": how it is counted and what it cannot tell you. ${f.short}`,
        ),
        body: await renderComponent("components_PatternMethod_astro", {
          pagehead,
          f,
          esc,
          datasetLabel,
          cat,
          methodCode,
        }),
      },
    ]);
  }
  return out;
}
