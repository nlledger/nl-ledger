// Plain-text labels shared by page data and Astro templates.
import { num, money, moneyWords } from "./format.mjs";
import { isFederal, nativeAmount, currencyOf } from "./federal.mjs";
export function nameOrder(n) {
  // "Dinn, Paul" -> "Paul Dinn"
  const m = /^([^,]+),\s*(.+)$/.exec(n || "");
  return m ? `${m[2]} ${m[1]}` : n;
}
export function countLine(D, f) {
  const s = D.flagSummary[f.id] || {};
  if (s.items)
    return `${num(s.items)} items${s.amount ? `, ${moneyWords(s.amount)}` : ""}`;
  if (s.subjects) return `${num(s.subjects)} found`;
  return "none found";
}
export function amountText(it) {
  if (isFederal(it)) return nativeAmount(it.a, currencyOf(it));
  if (it.a != null)
    return money(it.a, {
      cents: Math.round(it.a * 100) % 100 !== 0,
    });
  if (it.o) return `US${money(it.o)}`;
  return "as printed";
}

export function isBrokenPublisherLink(issue) {
  return /^(?:[45]\d\d\b|link returns a web page\b)|page not found/i.test(
    issue,
  );
}
