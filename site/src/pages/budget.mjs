import {
  components_BudgetPage_astro as BudgetPage,
  components_BudgetMethod_astro as BudgetMethod,
} from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// Budget against actual: what the House was given with the budget, what departments spent, and how
// the year ended (surplus or deficit, net debt). Two bases of accounting, shown side by side and never
// added together. Figures come from site/src/budgetdata.mjs.
import { card, cardAmount } from "../../lib/share-card.mjs";
import { Notes } from "../../lib/html.mjs";
import { money, moneyWords } from "../../lib/format.mjs";
import { desc, datasetLd, LICENSE } from "../seo.mjs";
import { DOCS } from "../budgetdata.mjs";
import { LICENCES, DOCUMENT_LICENCE } from "../licences.mjs";

// "$11.01 billion", "$368 million": two decimals in the billions so a difference of a few hundred million shows.
export const words = (v) =>
  v == null
    ? ""
    : Math.abs(v) >= 1e9
      ? `$${(Math.abs(v) / 1e9).toFixed(2)} billion`
      : moneyWords(Math.abs(v));
// A figure in a schedule: a negative one in parentheses (red ink, by the `neg` class).
// In a `tight` schedule on a phone the unit is set as one letter ("$11.01B"), so three figures fit beside a label.

const march = (fy) => `31 March ${Number(fy.slice(0, 4)) + 1}`;
const docName = (s, fy) =>
  `${DOCS[s.doc]}${s.doc === "public_accounts" ? ` for the year ended ${march(fy)}` : ` ${fy}`}`;

// Over or under, in words, for a sentence.
const overUnder = (d) => (d < 0 ? "under" : "over");

// ---- the row under the home page's headline figure
export async function coverLedger(y, notes) {
  const c = y.cash,
    a = y.accounts;
  const citeBudget = notes.cite({
    url: c.budget_source.url,
    page: c.budget_source.page,
    label: `${docName(c.budget_source, y.year)}, Summary of Cash Requirements: gross expenditure, current account ${money(c.current.budget)} and capital account ${money(c.capital.budget)}`,
  });
  const citeSpent = notes.cite({
    url: c.actual_source.url,
    page: c.actual_source.page,
    label: `${docName(c.actual_source, y.year)}, Statement of Budgetary Contribution: gross expenditure, current account ${money(c.current.actual)} and capital account ${money(c.capital.actual)} (Actuals), against ${money(c.current.budget)} and ${money(c.capital.budget)} (Original Estimates)`,
  });
  const citeBal = notes.cite({
    url: a.balance.source.url,
    page: a.balance.source.page,
    label: `${docName(a.balance.source, y.year)}, Consolidated Statement of Operations: annual ${a.balance.actual < 0 ? "deficit" : "surplus"} ${money(Math.abs(a.balance.actual))} (Actuals), ${money(Math.abs(a.balance.budget))} (Original Budget)`,
  });
  const citeDebt = notes.cite({
    url: a.net_debt.source.url,
    page: a.net_debt.source.page,
    label: `${docName(a.net_debt.source, y.year)}, Consolidated Statement of Financial Position: net debt ${money(a.net_debt.actual)}`,
  });
  const pp = a.net_debt_per_person;
  const citePP = pp
    ? notes.cite({
        url: pp.source.url,
        page: pp.source.page,
        label: `${docName(pp.source, y.year)}, financial statement discussion and analysis: net debt per capita ${money(pp.value)}`,
      })
    : "";
  const deficit = a.balance.actual < 0;
  return {
    y,
    c,
    citeBudget,
    citeSpent,
    deficit,
    a,
    citeBal,
    citeDebt,
    pp,
    citePP,
    march,
  };
}

// ---- one year's page
async function yearPage(D, B, y, isLatest) {
  const notes = new Notes();
  const fy = y.year;
  const c = y.cash,
    a = y.accounts;
  const deficit = a.balance.actual < 0;
  const citeBudget = notes.cite({
    url: c.budget_source.url,
    page: c.budget_source.page,
    label: `${docName(c.budget_source, fy)}, Summary of Cash Requirements (Statement I): gross expenditure, current account ${money(c.current.budget)} and capital account ${money(c.capital.budget)}`,
  });
  const citeSpent = notes.cite({
    url: c.actual_source.url,
    page: c.actual_source.page,
    label: `${docName(c.actual_source, fy)}, Statement of Budgetary Contribution: gross expenditure, current account ${money(c.current.actual)} and capital account ${money(c.capital.actual)} (Actuals); the Original Estimates column beside them reprints the budget's figures`,
  });
  const citeOps = notes.cite({
    url: a.balance.source.url,
    page: a.balance.source.page,
    label: `${docName(a.balance.source, fy)}, Consolidated Statement of Operations: total revenue ${money(a.revenue.actual)}, total expense ${money(a.expense.actual)}, annual ${deficit ? "deficit" : "surplus"} ${money(Math.abs(a.balance.actual))} (Actuals); ${money(a.revenue.budget)}, ${money(a.expense.budget)} and ${money(Math.abs(a.balance.budget))} (Original Budget, unaudited)`,
  });
  const citeDebt = notes.cite({
    url: a.net_debt.source.url,
    page: a.net_debt.source.page,
    label: `${docName(a.net_debt.source, fy)}, Consolidated Statement of Financial Position: net debt ${money(a.net_debt.actual)} at ${march(fy)}`,
  });
  const citeDebtBudget = a.net_debt.budget_source
    ? notes.cite({
        url: a.net_debt.budget_source.url,
        page: a.net_debt.budget_source.page,
        label: `${docName(a.net_debt.budget_source, fy)}, Consolidated Statement of Change in Net Debt: net debt at the end of the period ${money(a.net_debt.budget)} (Original Budget)`,
      })
    : "";
  const pp = a.net_debt_per_person;
  const citePP = pp
    ? notes.cite({
        url: pp.source.url,
        page: pp.source.page,
        label: `${docName(pp.source, fy)}, financial statement discussion and analysis: net debt per capita ${money(pp.value)}`,
      })
    : "";
  const published = B.years.filter(
    (x) => x.spent_published && x.accounts.published,
  );
  // The province's own cash statement: budgeted, spent, the difference.
  const need = {
    budget: -c.cash_balance.budget,
    actual: -c.cash_balance.actual,
  }; // a requirement is printed as a negative contribution

  // Departments, largest difference first. A department links to its page when it has one under this name.
  const pages = new Set(
    D.years.flatMap((yr) => D.deptYear[yr].map((d) => D.slug(d.name))),
  );
  const depts = y.departments.filter((d) => d.spent != null);
  const maxDiff = Math.max(...depts.map((d) => Math.abs(d.difference ?? 0)), 1);
  const fromReport = depts.filter((d) => d.budget_doc === "report");
  // Year by year (on the main page only).
  const maxYear = Math.max(
    ...B.years.map((x) =>
      Math.max(x.cash.gross.budget || 0, x.cash.gross.actual || 0),
    ),
  );
  const restated = B.years.filter(
    (x) =>
      x.accounts.balance.restated != null ||
      x.accounts.net_debt.restated != null,
  );
  const accord = B.years.find((x) => x.year === "2019-20")?.accounts.balance
    .source;
  const K = B.checks;
  const body = await renderAstro(BudgetPage, {
    isLatest,
    fy,
    deficit,
    citeBudget,
    citeSpent,
    citeOps,
    citeDebt,
    published,
    maxDiff,
    B,
    y,
    c,
    need,
    a,
    citeDebtBudget,
    pp,
    citePP,
    depts,
    pages,
    fromReport,
    maxYear,
    accord,
    restated,
    K,
  });
  const d = c.difference;
  return {
    card: card(
      "Budget against actual",
      cardAmount(c.gross.actual),
      `Actual gross department spending · ${fy}`,
    ),
    title: isLatest
      ? `NL budget against actual spending, deficit and net debt, ${fy}`
      : `NL budget against actual spending, ${fy}`,
    description: desc(
      `Newfoundland and Labrador budgeted ${words(c.gross.budget)} for departments in ${fy} and spent ${words(c.gross.actual)}. The ${deficit ? "deficit" : "surplus"} was ${words(a.balance.actual)}; net debt ${words(a.net_debt.actual)}.`,
    ),
    body,
    notes,
    jsonld: isLatest
      ? [
          datasetLd({
            name: `Newfoundland and Labrador budget against actual spending, deficit and net debt, ${B.years[0].year} to ${fy}`,
            description: `Budgeted and actual gross spending by department (${overUnder(d)} budget by ${words(d)} in ${fy}), and the province's annual surplus or deficit and net debt, from the Estimates, the Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund and the Public Accounts.`,
            path: "/budget/",
            license: LICENSE.provincial,
            period: `${B.years[0].year.slice(0, 4)}/20${fy.slice(-2)}`,
            files: ["/data/budget.json"],
            publishers: [
              {
                name: "Public Accounts of Newfoundland and Labrador",
                url: "https://www.gov.nl.ca/exec/tbs/public-accounts/",
              },
              {
                name: "Budget documents, Government of Newfoundland and Labrador",
                url: "https://www.gov.nl.ca/budget/",
              },
            ],
          }),
        ]
      : [],
  };
}

// ---- method: how the budget and the accounts line up
async function methodPage(D, B) {
  const y = B.latest,
    fy = y.year,
    c = y.cash,
    a = y.accounts,
    K = B.checks;
  const notes = new Notes();
  const report = notes.cite({
    url: c.actual_source.url,
    label: `${DOCS.report} ${fy}, Introduction (printed page 1)`,
  });
  const pp = a.net_debt_per_person;
  const ownPP = a.net_debt.actual / D.stats.population.value;
  const body = await renderAstro(BudgetMethod, {
    report,
    fy,
    c,
    a,
    pp,
    D,
    ownPP,
    K,
    B,
    DOCS,
    LICENCES,
    DOCUMENT_LICENCE,
  });
  return [
    "/method/budget/",
    {
      card: card(
        "Method: budget against actual",
        cardAmount(c.gross.actual),
        `Actual gross department spending · ${fy}`,
      ),
      title: "Method: budget against actual, the deficit and net debt",
      description: desc(
        "Which budget is compared with which actual, why the deficit and net debt come from the Public Accounts on a different basis, and how each figure is checked.",
      ),
      body,
      notes,
    },
  ];
}
export async function budget(D, R, B) {
  const out = [];
  for (const y of B.years.filter(
    (x) => x.spent_published && x.accounts.published,
  )) {
    out.push([
      y === B.latest ? "/budget/" : `/budget/${y.year}/`,
      await yearPage(D, B, y, y === B.latest),
    ]);
  }
  out.push(await methodPage(D, B));
  return out;
}
