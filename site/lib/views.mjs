import { amountText } from "./page-format.mjs";
import {
  components_SearchResult_astro as SearchResult,
  components_SearchPage_astro as SearchPage,
  components_RecordPage_astro as RecordPage,
  components_SupplierPage_astro as SupplierPage,
} from "../.render/components.mjs";
import { renderAstro } from "../lib/render.mjs";
// Views rendered on request by the Worker routes: search results, one record, one supplier.

import { money, date as fmtDate, DATASET_LABEL, fit } from "./format.mjs";
import { DATASETS } from "./search.mjs";
import {
  isFederal,
  nativeAmount,
  currencyOf,
  federalStatement,
  federalDetails,
  amountBasis,
  moneyLimit,
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
export async function resultItem(it, flags, links) {
  return await renderAstro(SearchResult, {
    it,
    flags,
    links,
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
  const body = await renderAstro(SearchPage, {
    p,
    empty,
    filterCount,
    DS_OPTIONS,
    years,
    flagOpts,
    active,
    examples,
    corrected,
    items,
    result,
    sorted,
    flags,
    links,
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
      ? money(it.a, {
          cents: Math.round(it.a * 100) % 100 !== 0,
        })
      : "";
  const title = [name, amt, buyer, /^\d{4}$/.test(year) ? year : ""]
    .filter(Boolean)
    .join(", ");
  const label = DATASET_LABEL[it.ds] || "Record";
  const d = String(it.d || "").trim();
  const text =
    `${label}: ${it.s || it.p || "payee not published"}${amt ? `, ${amt}` : ""}${it.b && !same ? `, ${it.ds === "sunshine" ? "at" : "from"} ${it.b}` : ""}${it.t ? ` on ${fmtDate(it.t)}` : year ? ` in ${year}` : ""}. ${d ? d.replace(/\.$/, "") + ". " : ""}${it.m ? `${it.m}. ` : ""}`.trim();
  return {
    title,
    description: fit(text),
  };
}

// A link to the page about a public body, only where the build wrote one (links.json lists the slugs of every
// /body/, /pay/ and /department/ page). Anything else is plain text, never a link that ends in a 404.

export async function itemPage(it, { flags, stats, links }) {
  const fl = (it.f || []).map((f) => flags[f]).filter(Boolean);
  const x = it.x || {};
  const pdf = /\.pdf($|\?)/i.test(it.u || "");
  const href = pdf && it.g ? `${it.u}#page=${it.g}` : it.u;
  const title = it.s || it.p || it.d || "Record";
  const body = await renderAstro(RecordPage, {
    title,
    it,
    stats,
    href,
    pdf,
    x,
    fl,
    links,
  });
  return {
    title,
    body,
  };
}

// The printed names a supplier page combines, each linking to its own records.

export async function supplierPage(s, { flags, stats, hash, links }) {
  const dsRows = Object.entries(s.byDs).sort((a, b) => b[1][1] - a[1][1]);
  const years = Object.entries(s.byYear).sort();
  const ymax = Math.max(...years.map(([, v]) => v), 1);
  const flagRows = Object.entries(s.flags || {})
    .map(([f, n]) => ({
      f: flags[f],
      n,
    }))
    .filter((x) => x.f);
  const body = await renderAstro(SupplierPage, {
    s,
    hash,
    dsRows,
    links,
    years,
    ymax,
    flagRows,
    flags,
  });
  return {
    title: s.name,
    body,
  };
}
