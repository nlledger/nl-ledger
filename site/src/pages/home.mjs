import { renderComponent } from "../../lib/render.mjs";
// Home: the cover, your receipt, a working life, priorities, where it went, patterns, receipts.
import {
  esc,
  receiptForm,
  icon,
  flagItem,
  Notes,
  leaders,
  bar,
  receipt,
  REPO,
} from "../../lib/html.mjs";
import {
  money,
  moneyWords,
  num,
  pct,
  workTime,
  perPerson,
  perHousehold,
  yearsOfWage,
  nlIncomeTax,
  date as fmtDate,
  SITE,
} from "../../lib/format.mjs";
import { renderReceipt } from "../../lib/receipt.mjs";
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
    label: `Statistics Canada table ${S.median_weekly_wage.table} (vector ${S.median_weekly_wage.vector}), median weekly wage of full-time employees in Newfoundland and Labrador, ${S.median_weekly_wage.year}: ${money(S.median_weekly_wage.value, { cents: true })}, times 52 weeks = ${money(S.median_annual_wage.value)} a year`,
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
  const lvMax = Math.max(...levelTotals.map((l) => l.amount));

  const cover = await renderComponent("components_HomeCover_astro", {
    moneyWords,
    total,
    cite,
    fy,
    money,
    perPerson,
    S,
    citePop,
    num,
    people,
    citeWage,
    ledger,
    R,
    icon,
  });

  const aiSec = await renderComponent("components_HomeAi_astro", {
    num,
    R,
    icon,
    EXAMPLE,
    fmtDate,
  });

  const receiptSec = await renderComponent("components_HomeReceipt_astro", {
    S,
    citeTax,
    fy,
    pct,
    depts,
    citeRev,
    receiptForm,
    num,
    median,
    renderReceipt,
    R,
  });

  const lifeSec = await renderComponent("components_HomeWorkingLife_astro", {
    money,
    median,
    moneyWords,
    career,
    esc,
    fy,
    h,
    m,
    leaders,
    perPerson,
    total,
    S,
    citeHH,
    perHousehold,
    perHour,
    ex,
    workTime,
    receipt,
    icon,
  });

  const prioSec = await renderComponent("components_HomePriorities_astro", {
    fy,
    top,
    bar,
    max,
    moneyWords,
    money,
    perPerson,
    S,
    depts,
    total,
    D,
    icon,
  });

  const whereSec = await renderComponent("components_HomeRecipients_astro", {
    num,
    R,
    icon,
    esc,
    leaders,
    levelTotals,
    moneyWords,
  });

  const flagSec = await renderComponent("components_HomePatterns_astro", {
    esc,
    D,
    num,
    flagItem,
    icon,
  });

  const rcptSec = await renderComponent("components_HomeSources_astro", {
    leaders,
    R,
    esc,
  });

  const helpSec = await renderComponent("components_HomeHelp_astro", {
    SITE,
    REPO,
    icon,
  });

  return {
    body:
      cover +
      receiptSec +
      lifeSec +
      prioSec +
      aiSec +
      whereSec +
      flagSec +
      rcptSec +
      helpSec,
    notes,
  };
}
