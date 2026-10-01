import { nameOrder } from "../../lib/page-format.mjs";
import {
  components_MembersIndex_astro as MembersIndex,
  components_MemberPage_astro as MemberPage,
  components_MinisterPage_astro as MinisterPage,
} from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// MHAs and ministers: expense records as published, per member.
import { Notes } from "../../lib/html.mjs";
import { money, num, date as fmtDate } from "../../lib/format.mjs";
import { desc, personLd, datasetLd, LICENSE } from "../seo.mjs";
export async function members(D, R) {
  const out = [];
  const mhas =
    D.q(`SELECT person, count(*) n, sum(amount) amount, min(fiscal_year) y0, max(fiscal_year) y1,
      json_extract(extra,'$.district') district FROM items WHERE dataset='mha' GROUP BY person ORDER BY person`);
  const years = D.q(
    "SELECT DISTINCT fiscal_year y FROM items WHERE dataset='mha' ORDER BY y",
  ).map((r) => r.y);
  const mins = D.q(
    `SELECT person, count(*) n, sum(amount) amount, min(date) d0, max(date) d1 FROM items WHERE dataset='minister' GROUP BY person ORDER BY amount DESC`,
  );

  // MHA annual totals per member for the index
  const perYear = new Map();
  for (const r of D.q(
    "SELECT person, fiscal_year, sum(amount) a FROM items WHERE dataset='mha' GROUP BY person, fiscal_year",
  )) {
    (perYear.get(r.person) || perYear.set(r.person, {}).get(r.person))[
      r.fiscal_year
    ] = r.a;
  }
  const latestFull = years[years.length - 2] || years[years.length - 1];
  const ranked = mhas
    .filter((m) => perYear.get(m.person)?.[latestFull])
    .sort(
      (a, b) =>
        perYear.get(b.person)[latestFull] - perYear.get(a.person)[latestFull],
    );
  const rmax = ranked[0] ? perYear.get(ranked[0].person)[latestFull] : 1;
  const idxBody = await renderAstro(MembersIndex, {
    latestFull,
    ranked,
    D,
    perYear,
    rmax,
    mins,
    mhas,
  });
  out.push([
    "/members/",
    {
      title: "MHA expenses in Newfoundland and Labrador",
      description: desc(
        `What every MHA claimed in allowances in ${latestFull}, ranked, plus minister expense claims. Each line links to the published report.`,
      ),
      body: idxBody,
      jsonld: [
        datasetLd({
          name: "Newfoundland and Labrador MHA expenses and minister expense claims",
          description:
            "Every line charged to each Member of the House of Assembly's allowances, and every minister's expense claim, as published by the House of Assembly and Executive Council.",
          path: "/members/",
          license: [LICENSE.assembly, LICENSE.provincial],
          period: `${years[0].slice(0, 4)}/..`,
          files: ["/data/members.json"],
          publishers: [
            {
              name: "Member Accountability and Disclosure Reports, House of Assembly",
              url: "https://www.assembly.nl.ca/Members/Expenses/",
            },
            {
              name: "Ministers' expense claims, Executive Council",
              url: "https://www.gov.nl.ca/exec/cabinet/expenseclaims/",
            },
          ],
        }),
      ],
    },
  ]);

  // Per MHA
  for (const m of mhas) {
    const notes = new Notes();
    const lines = D.q(
      "SELECT * FROM items WHERE dataset='mha' AND person=? ORDER BY fiscal_year DESC, method, date",
      m.person,
    );
    const byYearCat = new Map();
    for (const l of lines) {
      const k = `${l.fiscal_year}|${l.method}`;
      const e = byYearCat.get(k) || {
        y: l.fiscal_year,
        cat: l.method,
        n: 0,
        a: 0,
        url: l.source_url,
        page: l.page,
      };
      e.n++;
      e.a += l.amount || 0;
      e.page = Math.min(e.page, l.page);
      byYearCat.set(k, e);
    }
    const yrs = [...new Set(lines.map((l) => l.fiscal_year))];
    const vendors = D.q(
      "SELECT supplier, supplier_key, count(*) n, sum(amount) a FROM items WHERE dataset='mha' AND person=? AND supplier IS NOT NULL GROUP BY supplier_key ORDER BY a DESC LIMIT 12",
      m.person,
    );
    const big = lines
      .slice()
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, 25);
    const phash = D.keyHash(m.person.toLowerCase());
    const body = await renderAstro(MemberPage, {
      m,
      yrs,
      byYearCat,
      vendors,
      D,
      big,
      phash,
    });
    const nm = nameOrder(m.person);
    const latestYr = yrs.includes(latestFull) ? latestFull : yrs[0];
    const latestTotal = lines
      .filter((l) => l.fiscal_year === latestYr)
      .reduce((s, l) => s + (l.amount || 0), 0);
    out.push([
      `/mha/${D.slug(m.person)}/`,
      {
        title: `${nm} MHA expenses, ${latestYr}`,
        description: desc(
          `${nm}, MHA${m.district ? ` for ${m.district}` : ""}: ${money(latestTotal)} in allowances in ${latestYr}, ${num(m.n)} expense lines since ${m.y0}, each linked to its source.`,
        ),
        body,
        notes,
        jsonld: [
          personLd({
            name: nm,
            path: `/mha/${D.slug(m.person)}/`,
            jobTitle: "Member of the House of Assembly",
            description: m.district ? `MHA for ${m.district}` : undefined,
          }),
        ],
      },
    ]);
  }

  // Per minister
  for (const m of mins) {
    const claims = D.q(
      "SELECT * FROM items WHERE dataset='minister' AND person=? ORDER BY date DESC",
      m.person,
    );
    const depts = [...new Set(claims.map((c) => c.buyer))];
    const travel = claims.filter((c) => c.method !== "Payroll allowance");
    const payroll = claims.filter((c) => c.method === "Payroll allowance");
    const cats = {
      accommodations: 0,
      meals: 0,
      travel: 0,
      other: 0,
      hospitality: 0,
    };
    for (const c of travel) {
      const x = JSON.parse(c.extra || "{}");
      for (const k of Object.keys(cats)) cats[k] += x[k] || 0;
    }
    const body = await renderAstro(MinisterPage, {
      m,
      depts,
      cats,
      payroll,
      claims,
    });
    out.push([
      `/ministers/${D.slug(m.person)}/`,
      {
        title: `${m.person} expense claims`,
        description: desc(
          `${m.person}: minister expense claims paid ${fmtDate(m.d0)} to ${fmtDate(m.d1)}, ${money(m.amount)} in ${num(m.n)} lines, each linked to its source.`,
        ),
        body,
        jsonld: [
          personLd({
            name: m.person,
            path: `/ministers/${D.slug(m.person)}/`,
            jobTitle: "Minister, Government of Newfoundland and Labrador",
          }),
        ],
      },
    ]);
  }
  return out;
}
