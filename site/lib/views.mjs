import { renderComponent } from "../lib/render.mjs";
// Views rendered on request by the Worker routes: search results, one record, one supplier.
import {
  esc,
  html,
  icon,
  flagItem,
  standing,
  receipt,
  query,
  schedule,
  leaders,
  bar,
  pager,
  spotError,
} from "./html.mjs";
import {
  money,
  moneyWords,
  num,
  pct,
  date as fmtDate,
  workTime,
  perPerson,
  DATASET_LABEL,
  AMOUNT_LABEL,
  BUYER_LABEL,
  fit,
} from "./format.mjs";
import { DATASETS } from "./search.mjs";
import {
  isFederal,
  nativeAmount,
  currencyOf,
  federalStatement,
  federalDetails,
  amountBasis,
  moneyLimit,
  FEDERAL_RULE,
  OVERLAP_RULE,
  SCOPE_LABEL,
  REVIEW_LABEL,
  periodText,
} from "./federal.mjs";

export const slug = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

// Plain text is also used in metadata; HTML callers escape it at the insertion.
function amountText(it) {
  if (isFederal(it)) return nativeAmount(it.a, currencyOf(it));
  if (it.a != null)
    return money(it.a, { cents: Math.round(it.a * 100) % 100 !== 0 });
  if (it.o) return `US${money(it.o)}`;
  return "as printed";
}

function who(it) {
  if (it.s && it.k && it.ds !== "sunshine")
    return `<a href="/supplier/${esc(it.k)}/">${esc(it.s)}</a>`;
  return esc(
    it.s || it.p || (it.x?.payee_withheld ? "Payee not published" : ""),
  );
}

export async function resultItem(it, flags, links) {
  const party =
    it.s && it.ds !== "sunshine"
      ? ["fed_grant", "pa_tp"].includes(it.ds)
        ? "Recipient"
        : it.ds === "mha"
          ? "Paid to"
          : "Supplier"
      : "";
  const meta = [
    `<a class="tag" href="/sources/#${esc(it.ds)}" title="Where these records come from">${esc(DATASET_LABEL[it.ds] || it.ds)}</a>`,
    it.b
      ? `<span>${esc(BUYER_LABEL[it.ds] || "Public body")}: ${bodyLink(it.b, links, { sunshine: it.ds === "sunshine" })}</span>`
      : "",
    it.p && it.s ? `<span>${esc(it.p)}</span>` : "",
    it.t || it.fy ? `<span>${esc(fmtDate(it.t) || it.fy)}</span>` : "",
    it.m ? `<span>${esc(it.m)}</span>` : "",
  ].filter(Boolean);
  return await renderComponent("components_SearchResult_astro", {
    party,
    who,
    it,
    esc,
    amountText,
    query,
    flags,
    isFederal,
    amountBasis,
    AMOUNT_LABEL,
    federalStatement,
    moneyLimit,
    meta,
    receipt,
  });
}

const DS_OPTIONS = DATASETS.map((d) => [d, DATASET_LABEL[d]]);

export async function searchPage({ params, result, flags, page, links }) {
  const p = result?.params || params;
  const years = [];
  for (let y = 2026; y >= 2009; y--) years.push([String(y), String(y)]);
  const flagOpts = Object.values(flags).map((f) => [f.id, f.title]);
  const base =
    "/search/?" +
    new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString();
  const active = ["s", "n", "b", "p", "i"].filter((k) => p[k]);
  const items = result?.items || [];
  const near = result?.near || [];
  const suggest = result?.suggest || [];
  const corrected = result?.corrected;
  const sorted = [...items].sort((a, b) => (b.a || 0) - (a.a || 0));
  const filterCount = ["ds", "y", "f", "lv", ...active].filter(
    (k) => p[k],
  ).length;
  const empty = !p.q && !Object.keys(p).some((k) => k !== "q" && p[k]);
  const examples = [
    "ferry",
    "snow clearing",
    "consulting",
    "legal services",
    "helicopter",
    "catering",
    "software licence",
    "Marine Atlantic",
  ];
  const body = await renderComponent("components_SearchPage_astro", {
    icon,
    p,
    empty,
    filterCount,
    DS_OPTIONS,
    years,
    flagOpts,
    active,
    standing,
    examples,
    corrected,
    items,
    num,
    result,
    sorted,
    resultItem,
    flags,
    links,
    pager,
    base,
    page,
    near,
    suggest,
  });
  return body;
}

// Title and description for a record page, built from its own fields so no two records read alike.
export function itemMeta(it) {
  if (isFederal(it))
    return {
      title: `${amountBasis(it)}: ${amountText(it)} · ${federalDetails(it).scope_statement || "Location not established."}`,
      description: `${amountBasis(it)}: ${amountText(it)}. ${federalStatement(it)} ${moneyLimit(it)} Source: ${it.b || "Government of Canada"}.`,
    };
  const who = it.s || it.p || it.d || "Record";
  const name =
    who.length > 34 ? who.slice(0, 34).replace(/\s+\S*$/, "") + "…" : who;
  const year = String(it.t || "").slice(0, 4) || String(it.fy || "").slice(-4);
  const same =
    it.b && who.toLowerCase().slice(0, 10) === it.b.toLowerCase().slice(0, 10);
  const buyer =
    it.b && !same
      ? it.b.length > 30
        ? it.b.slice(0, 30).replace(/\s+\S*$/, "") + "…"
        : it.b
      : "";
  const amt =
    it.a != null
      ? money(it.a, { cents: Math.round(it.a * 100) % 100 !== 0 })
      : "";
  const title = [name, amt, buyer, /^\d{4}$/.test(year) ? year : ""]
    .filter(Boolean)
    .join(", ");
  const label = DATASET_LABEL[it.ds] || "Record";
  const d = String(it.d || "").trim();
  const text =
    `${label}: ${it.s || it.p || "payee not published"}${amt ? `, ${amt}` : ""}${it.b && !same ? `, ${it.ds === "sunshine" ? "at" : "from"} ${it.b}` : ""}${it.t ? ` on ${fmtDate(it.t)}` : year ? ` in ${year}` : ""}. ${d ? d.replace(/\.$/, "") + ". " : ""}${it.m ? `${it.m}. ` : ""}`.trim();
  return { title, description: fit(text) };
}

// A link to the page about a public body, only where the build wrote one (links.json lists the slugs of every
// /body/, /pay/ and /department/ page). Anything else is plain text, never a link that ends in a 404.
export function bodyLink(name, links, { sunshine = false } = {}) {
  const sl = slug(name);
  const href = links?.body?.includes(sl)
    ? `/body/${sl}/`
    : sunshine && links?.pay?.includes(sl)
      ? `/pay/${sl}/`
      : links?.department?.includes(sl)
        ? `/department/${sl}/`
        : null;
  return href ? `<a href="${href}">${esc(name)}</a>` : esc(name);
}

export async function itemPage(it, { flags, stats, links }) {
  const fl = (it.f || []).map((f) => flags[f]).filter(Boolean);
  const x = it.x || {};
  const facts = [
    it.s
      ? {
          label:
            it.ds === "mha"
              ? "Paid to"
              : it.ds === "fed_grant" || it.ds === "pa_tp"
                ? "Recipient"
                : "Supplier",
          value: who(it),
        }
      : null,
    x.supplier_as_printed
      ? { label: "Name as printed", value: esc(x.supplier_as_printed) }
      : null,
    it.p
      ? {
          label:
            it.ds === "sunshine"
              ? "Name as published"
              : it.ds === "mha"
                ? "Member"
                : "Minister",
          value: esc(it.p),
        }
      : null,
    it.b
      ? {
          label: it.ds === "sunshine" ? "Employer" : "Public body",
          value: bodyLink(it.b, links, { sunshine: it.ds === "sunshine" }),
        }
      : null,
    {
      label:
        it.ds === "fed_grant"
          ? "Agreement start"
          : it.ds === "canadabuys"
            ? "Award date"
            : it.ds === "sunshine"
              ? "Year"
              : "Date",
      value: esc(
        it.ds === "sunshine"
          ? String(it.t || "").slice(0, 4)
          : fmtDate(it.t) || it.fy || "not printed",
      ),
    },
    it.m
      ? {
          label:
            it.ds === "mha"
              ? "Allowance"
              : it.ds === "fed_grant"
                ? "Program"
                : "Method",
          value: esc(it.m),
        }
      : null,
    x.clause ? { label: "Clause cited", value: esc(x.clause) } : null,
    x.reason ? { label: "Reason given", value: esc(x.reason) } : null,
    x.limited_reason
      ? { label: "Limited tendering reason", value: esc(x.limited_reason) }
      : null,
    x.original_value
      ? { label: "Original value", value: money(x.original_value) }
      : null,
    x.contract_no
      ? { label: "Contract number", value: esc(x.contract_no) }
      : null,
    x.term ? { label: "Term", value: esc(x.term) } : null,
    x.district ? { label: "District", value: esc(x.district) } : null,
    x.routes ? { label: "Flights", value: esc(x.routes) } : null,
    x.unit ? { label: "Unit", value: esc(x.unit) } : null,
    x.base != null ? { label: "Base salary", value: money(x.base) } : null,
    x.overtime ? { label: "Overtime", value: money(x.overtime) } : null,
    x.bonus ? { label: "Bonuses", value: money(x.bonus) } : null,
    x.shift ? { label: "Shift premium", value: money(x.shift) } : null,
    x.retro ? { label: "Retroactive salary", value: money(x.retro) } : null,
    x.severance ? { label: "Severance", value: money(x.severance) } : null,
    x.other && it.ds === "sunshine"
      ? { label: "Other compensation", value: money(x.other) }
      : null,
    x.invoice ? { label: "Invoice", value: esc(x.invoice) } : null,
    x.report_period
      ? {
          label: "Reported in",
          value: `the report for ${esc(x.report_period.replace(" to ", " to "))}`,
        }
      : null,
    x.weeks ? { label: "Voucher weeks", value: esc(x.weeks) } : null,
    x.amount_text
      ? { label: "Price as printed", value: esc(x.amount_text) }
      : null,
    { label: "Record type", value: esc(DATASET_LABEL[it.ds] || it.ds) },
  ].filter(Boolean);
  const pdf = /\.pdf($|\?)/i.test(it.u || "");
  const href = pdf && it.g ? `${it.u}#page=${it.g}` : it.u;
  const title = it.s || it.p || it.d || "Record";
  const body = await renderComponent("components_RecordPage_astro", {
    esc,
    title,
    it,
    standing,
    amountText,
    isFederal,
    amountBasis,
    AMOUNT_LABEL,
    federalStatement,
    moneyLimit,
    money,
    perPerson,
    stats,
    workTime,
    leaders,
    facts,
    href,
    pdf,
    icon,
    x,
    REVIEW_LABEL,
    receipt,
    nativeAmount,
    fmtDate,
    fl,
    flagItem,
    spotError,
  });
  return { title, body };
}

// The printed names a supplier page combines, each linking to its own records.
async function combinedNames(s, hash) {
  return await renderComponent("components_SupplierNames_astro", {
    num,
    s,
    hash,
  });
}

export async function supplierPage(s, { flags, stats, hash, links }) {
  const dsRows = Object.entries(s.byDs).sort((a, b) => b[1][1] - a[1][1]);
  const years = Object.entries(s.byYear).sort();
  const ymax = Math.max(...years.map(([, v]) => v), 1);
  const flagRows = Object.entries(s.flags || {})
    .map(([f, n]) => ({ f: flags[f], n }))
    .filter((x) => x.f);
  const body = await renderComponent("components_SupplierPage_astro", {
    esc,
    s,
    num,
    moneyWords,
    money,
    combinedNames,
    hash,
    standing,
    FEDERAL_RULE,
    OVERLAP_RULE,
    schedule,
    DATASET_LABEL,
    SCOPE_LABEL,
    REVIEW_LABEL,
    periodText,
    nativeAmount,
    dsRows,
    bodyLink,
    links,
    years,
    bar,
    ymax,
    flagRows,
    flagItem,
    resultItem,
    flags,
    icon,
    spotError,
  });
  return { title: s.name, body };
}
