import {
  components_PrioritiesPage_astro as PrioritiesPage,
  components_DepartmentPage_astro as DepartmentPage,
  components_EstimatesDepartmentPage_astro as EstimatesDepartmentPage,
} from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// Priorities (department and program spending, planned against actual) and one page per department.
import { card, cardAmount, organisationCard } from "../../lib/share-card.mjs";
import { Notes } from "../../lib/html.mjs";
import { moneyWords } from "../../lib/format.mjs";
import { desc, datasetLd, LICENSE } from "../seo.mjs";
import { bodyKeysFor } from "../receiptdata.mjs";
function progTotals(D, fy, kind, dept) {
  // per program: actual (col1), amended (col2), original (col3) gross from object lines
  return D.q(
    `SELECT program_code, program, account, sum(col1) c1, sum(col2) c2, sum(col3) c3, min(page) page, source_url
     FROM programs WHERE fiscal_year=? AND kind=? AND line_type='object' AND lower(department)=lower(?)
     GROUP BY program_code, program, account ORDER BY program_code`,
    fy,
    kind,
    dept,
  );
}
export async function priorities(D, R) {
  const out = [];
  const S = D.stats;
  const fy = R.year;
  const notes = new Notes();
  const depts = R.departments;
  const max = Math.max(...depts.map((d) => Math.max(d.gross, d.original || 0)));
  const citeTot = notes.cite({
    url: R.source.url,
    page: R.source.pages[0],
    label: `Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund ${fy}, Statement of Expenditure and Related Revenue by Department`,
    locator: `PDF pages ${R.source.pages.join(" and ")}`,
  });

  // Interest against health, education, roads
  const interest = D.one(
    `SELECT sum(col1) v, min(page) page, source_url FROM programs WHERE fiscal_year=? AND kind='actual' AND line_type='object'
      AND department='Consolidated Fund Services' AND program_code LIKE '1.1.%'`,
    fy,
  );
  const citeInt = notes.cite({
    url: interest.source_url,
    page: interest.page,
    label: `Consolidated Fund Services, programs 1.1.01 to 1.1.04 (temporary borrowings, treasury bills, debentures, Canada Pension Plan borrowing), ${fy} actual`,
  });
  const citeSC = notes.cite({
    url: S.provincial_government.url,
    label: `Statistics Canada table ${S.provincial_government.table}, Newfoundland and Labrador provincial government, interest on debt, ${S.provincial_government.year} (vector ${S.provincial_government.vectors["Interest on debt"]})`,
  });
  const find = (re) => depts.find((d) => re.test(d.name));
  const health = find(/^Health/);
  const edu = find(/^Education/);
  const roads = find(/^Transportation/);
  // Professional services by program
  const prof = D.q(
    `SELECT department, program, sum(col1) v, min(page) page, source_url FROM programs WHERE fiscal_year=? AND kind='actual'
      AND line_type='detail' AND object='Professional Services' GROUP BY department, program ORDER BY v DESC LIMIT 15`,
    fy,
  );
  const profTotal = D.one(
    `SELECT sum(col1) v FROM programs WHERE fiscal_year=? AND kind='actual' AND line_type='detail' AND object='Professional Services'`,
    fy,
  ).v;

  // Year over year
  const names = depts.map((d) => d.name);
  const years = D.years;
  const yoy = names.slice(0, 12).map((n) => ({
    name: n,
    vals: years.map(
      (y) =>
        D.deptYear[y].find((d) => d.name.toLowerCase() === n.toLowerCase())
          ?.gross,
    ),
  }));

  // Federal money in
  const mtp = D.federal.public_accounts.mtp_2024_25;
  const mtpRows = Object.entries(mtp)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const citeMtp = notes.cite({
    url: "https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/ppt-mtp/ppt-mtp-2025.csv",
    label:
      "Public Accounts of Canada 2025, Volume III, major transfers to other levels of government by province, Newfoundland and Labrador, 2024-25 ($ millions as published)",
  });
  const body = await renderAstro(PrioritiesPage, {
    fy,
    R,
    citeTot,
    depts,
    max,
    citeInt,
    S,
    citeSC,
    interest,
    health,
    edu,
    roads,
    profTotal,
    prof,
    D,
    years,
    yoy,
    citeMtp,
    mtpRows,
  });
  out.push([
    "/priorities/",
    {
      card: card(
        "Provincial spending",
        cardAmount(R.total),
        `Gross department spending · ${fy}`,
      ),
      title: `NL government spending by department, ${fy}`,
      description: desc(
        `The Newfoundland and Labrador government spent ${moneyWords(R.total)} in ${fy}. Every department and program, actual against budget, with the source page for each figure.`,
      ),
      body,
      notes,
      jsonld: [
        datasetLd({
          name: `Newfoundland and Labrador spending by department and program, ${D.years[0]} to ${fy}`,
          description:
            "Gross spending by department and program, actual against amended and original estimates, from the province's Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund.",
          path: "/priorities/",
          license: LICENSE.provincial,
          period: `${D.years[0].slice(0, 4)}/20${fy.slice(-2)}`,
          files: ["/data/departments.json"],
          publishers: [
            {
              name: "Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund",
              url: "https://www.gov.nl.ca/exec/tbs/public-accounts/",
            },
          ],
        }),
      ],
    },
  ]);
  return out;
}
export async function departments(D, R) {
  const out = [];
  const S = D.stats;
  // every department that appears in any year's report, plus the estimates
  const all = new Map();
  for (const y of D.years)
    for (const d of D.deptYear[y]) {
      const k = d.name.toLowerCase();
      if (!all.has(k))
        all.set(k, {
          name: d.name,
          years: [],
        });
      all.get(k).years.push(y);
    }
  const estYear = D.one(
    "SELECT max(fiscal_year) y FROM programs WHERE kind='estimates'",
  ).y;
  const est = D.q(
    "SELECT DISTINCT department FROM programs WHERE kind='estimates' AND fiscal_year=?",
    estYear,
  ).map((r) => r.department);
  for (const n of est) {
    const k = n.toLowerCase();
    if (!all.has(k))
      all.set(k, {
        name: n,
        years: [],
      });
    all.get(k).est = true;
  }
  for (const dep of all.values()) {
    const notes = new Notes();
    const slug = D.slug(dep.name);
    const latest = dep.years[dep.years.length - 1];
    const sum = latest
      ? D.deptYear[latest].find(
          (d) => d.name.toLowerCase() === dep.name.toLowerCase(),
        )
      : null;
    const progs = latest ? progTotals(D, latest, "actual", dep.name) : [];
    const estProgs = dep.est
      ? progTotals(D, estYear, "estimates", dep.name)
      : [];
    const cite = sum
      ? notes.cite({
          url: sum.url,
          page: [...sum.pages][0],
          label: `Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund ${latest}, Statement of Expenditure and Related Revenue by Department`,
        })
      : "";
    const keys = bodyKeysFor(D, dep.name);
    const awards = keys.length
      ? D.q(
          `SELECT * FROM items WHERE dataset='ppa' AND buyer_key IN (${keys.map(() => "?").join(",")}) ORDER BY date DESC LIMIT 400`,
          ...keys,
        )
      : [];
    const awardTotal = awards.reduce((s, a) => s + (a.amount || 0), 0);
    const noComp = awards.filter((a) =>
      (D.itemFlags.get(a.id) || []).includes("no-competition"),
    );
    const prof = latest
      ? D.q(
          `SELECT program, sum(col1) v, min(page) page, source_url FROM programs WHERE fiscal_year=? AND kind='actual' AND line_type='detail'
        AND object='Professional Services' AND lower(department)=lower(?) GROUP BY program ORDER BY v DESC LIMIT 10`,
          latest,
          dep.name,
        )
      : [];
    const trend = dep.years.map((y) => ({
      y,
      v: D.deptYear[y].find(
        (d) => d.name.toLowerCase() === dep.name.toLowerCase(),
      )?.gross,
    }));
    const tmax = Math.max(...trend.map((t) => t.v || 0), 1);
    const body = await renderAstro(DepartmentPage, {
      dep,
      estYear,
      trend,
      tmax,
      prof,
      latest,
      awards,
      awardTotal,
      noComp,
      D,
      sum,
      cite,
      S,
      progs,
      estProgs,
    });
    // The department's budget in the Estimates as tabled, the figure /budget/ shows.
    const budgeted =
      (latest &&
        D.one(
          "SELECT budget v FROM dept_budget WHERE fiscal_year=? AND lower(department)=lower(?)",
          latest,
          dep.name,
        )?.v) ||
      0;
    const spent = sum
      ? `${dep.name} spent ${moneyWords(sum.gross)} in ${latest}${budgeted > 0 ? `, against a budget of ${moneyWords(budgeted)}` : ""}.`
      : `${dep.name}: the ${estYear} budget estimates by program.`;
    out.push([
      `/department/${slug}/`,
      {
        card: sum
          ? organisationCard(
              dep.name,
              cardAmount(sum.gross),
              `Gross department spending · ${latest}`,
            )
          : organisationCard(dep.name, "", `Budget estimates · ${estYear}`),
        title: `${dep.name} spending, ${latest || estYear}`,
        description: desc(
          `${spent} Spending by program and contracts awarded, with sources.`,
        ),
        body,
        notes,
      },
    ]);
  }

  // estimates overview
  const estRows = D.q(
    `SELECT department, sum(col1) c1, sum(col2) c2, sum(col3) c3, min(page) page, source_url FROM programs
      WHERE kind='estimates' AND fiscal_year=? AND line_type='object' GROUP BY department ORDER BY c1 DESC`,
    estYear,
  );
  const notes = new Notes();
  const estTotal = estRows.reduce((s, r) => s + r.c1, 0);
  const cite = notes.cite({
    url: estRows[0].source_url,
    label: `Estimates of the Program Expenditure and Revenue of the Consolidated Revenue Fund ${estYear}, gross expenditure summed from each department's program lines`,
  });
  const body = await renderAstro(EstimatesDepartmentPage, {
    estYear,
    estTotal,
    cite,
    estRows,
    D,
  });
  out.push([
    `/department/estimates-${estYear}/`,
    {
      card: card(
        "Budget estimates",
        cardAmount(estTotal),
        `Planned gross department spending · ${estYear}`,
      ),
      title: `NL budget ${estYear}: spending planned by department`,
      description: desc(
        `What the Newfoundland and Labrador government plans to spend in ${estYear}, department by department and program by program, from the budget estimates.`,
      ),
      body,
      notes,
    },
  ]);
  return out;
}
