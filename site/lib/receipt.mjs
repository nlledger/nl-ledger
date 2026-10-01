// The personal tax receipt. Runs in the static build, in the /receipt Worker route,
// and in the browser (served as a module), so the three always agree.
import { money, moneyWords, nlIncomeTax, pct } from "./format.mjs";

export const RECEIPT_ASSUMPTIONS = "Illustration for a single employee with one job. Pension and self-employment income are outside its scope; age, pension and other credits are not included.";

const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function cents(v) {
  if (v >= 1) return money(v, { cents: true });
  if (v >= 0.01) return `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}¢`;
  return "less than a hundredth of a cent";
}

// R = receipt.json written by the build: { year, total, departments: [{name, slug, gross, share, examples:[...]}], tax }
export function computeReceipt(R, income) {
  const tax = nlIncomeTax(income, R.tax);
  const lines = R.departments.map((d) => ({ ...d, yours: tax * d.share }));
  return { income, tax, lines, fraction: tax / R.total };
}

export function renderReceipt(R, income, stats) {
  const c = computeReceipt(R, income);
  const max = c.lines[0]?.yours || 1;
  const row = (d) => {
      const ex = (d.examples || [])
        .map(
          (x) =>
            `<li><a href="${e(x.href)}">${e(x.title)}</a>: ${moneyWords(x.amount)} in total; illustrated share ${cents(x.amount * c.fraction)}.</li>`
        )
        .join("");
      return `<div class="rc-row"><span><a href="/department/${e(d.slug)}/">${e(d.name)}</a></span><span class="amt">${money(d.yours, { cents: true })}</span>
        <span class="bar" aria-hidden="true"><span style="inline-size:${Math.max(0.5, (d.yours / max) * 100).toFixed(2)}%"></span></span>
        ${ex ? `<details><summary aria-label="Spending examples for ${e(d.name)}">Spending examples</summary><ul>${ex}</ul></details>` : ""}</div>`;
  };
  const head = c.lines.slice(0, 7).map(row).join("");
  const rest = c.lines.slice(7);
  const restTotal = rest.reduce((s, d) => s + d.yours, 0);
  const rows = head + (rest.length ? `<details class="rc-more"><summary><span>${rest.length} more departments</span><span class="amt">${money(restTotal, { cents: true })}</span></summary>${rest.map(row).join("")}</details>` : "");
  const note = c.tax === 0
    ? `<p class="small">This employment-income estimate is zero after the credits included here, so the illustration is empty. Everyone still pays sales tax and other levies.</p>`
    : "";
  return `<article class="receipt" aria-live="polite">
    <h2 class="minor-heading">Receipt, ${e(R.year)}</h2>
    <p class="small">Employment income ${money(c.income)} · estimated provincial income tax ${money(c.tax, { cents: true })} · ${pct(c.tax / Math.max(1, c.income), 1)} of income</p>
    <p class="small">${RECEIPT_ASSUMPTIONS} The amounts below illustrate spending shares, not where a person’s tax was paid.</p>
    ${note}
    ${rows}
    <div class="rc-total"><span>Estimated provincial income tax</span><span>${money(c.tax, { cents: true })}</span></div>
  </article>`;
}
