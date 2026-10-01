import { components_HomePage_astro as HomePage } from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// Home: the cover, your receipt, a working life, priorities, where it went, patterns, receipts.
import { Notes } from "../../lib/html.mjs";
import {
  money,
  moneyWords,
  num,
  yearsOfWage,
  date as fmtDate,
} from "../../lib/format.mjs";
import { EXAMPLE } from "../connect.mjs";
import { coverLedger } from "./budget.mjs";
export async function home(D, R, B) {
  const notes = new Notes();
  const S = D.stats;
  const fy = R.year;
  const total = R.total;
  const src = R.source;
  const cite = notes.cite({
    url: src.url,
    page: src.pages[0],
    label: `Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund ${fy}, Statement of Expenditure and Related Revenue by Department (current and capital accounts), gross expenditure, all departments`,
    locator: `PDF pages ${src.pages.join(" and ")}`,
  });
  const citePop = notes.cite({
    url: S.population.url,
    label: `Statistics Canada table ${S.population.table}, population of Newfoundland and Labrador on ${fmtDate(S.population.date)}: ${num(S.population.value)}`,
  });
  const citeWage = notes.cite({
    url: S.median_weekly_wage.url,
    label: `Statistics Canada table ${S.median_weekly_wage.table} (vector ${S.median_weekly_wage.vector}), median weekly wage of full-time employees in Newfoundland and Labrador, ${S.median_weekly_wage.year}: ${money(
      S.median_weekly_wage.value,
      {
        cents: true,
      },
    )}, times 52 weeks = ${money(S.median_annual_wage.value)} a year`,
  });
  const ledger = await coverLedger(B.latest, notes); // cited here so its notes are numbered in page order
  const citeHH = notes.cite({
    url: S.households.url,
    label: `Statistics Canada table ${S.households.table}, private households in Newfoundland and Labrador, 2021 Census: ${num(S.households.value)}`,
  });
  const citeRev = notes.cite({
    url: S.provincial_government.url,
    label: `Statistics Canada table ${S.provincial_government.table}, Newfoundland and Labrador provincial government, ${S.provincial_government.year}: income taxes from households ${moneyWords(S.provincial_government.personal_income_tax)} (vector ${S.provincial_government.vectors["From households"]}) of total revenue ${moneyWords(S.provincial_government.revenue)} (vector ${S.provincial_government.vectors["General governments revenue"]})`,
  });
  const citeTax = notes.cite({
    url: S.nl_tax.source,
    label: `${S.nl_tax.source_label}. The receipt applies the ${S.nl_tax.year} brackets, the basic personal amount, CPP and EI credits and the low-income reduction; other credits are not applied`,
  });
  const people = Math.round(yearsOfWage(total, S));
  const median = S.median_annual_wage.value;
  const career = median * 40;
  const perHour = total / (365 * 24);
  const careerHours = career / perHour;
  const h = Math.floor(careerHours);
  const m = Math.round((careerHours - h) * 60);

  // examples for "what a working life buys"
  const ex = R.timeExamples;
  const depts = R.departments;
  const top = depts.slice(0, 8);
  const max = top[0].gross;
  const levelTotals = R.levels;
  return {
    body: await renderAstro(HomePage, {
      total,
      cite,
      fy,
      S,
      citePop,
      people,
      citeWage,
      ledger,
      R,
      EXAMPLE,
      citeTax,
      depts,
      citeRev,
      median,
      career,
      h,
      m,
      citeHH,
      perHour,
      ex,
      top,
      max,
      D,
      levelTotals,
    }),
    notes,
  };
}
