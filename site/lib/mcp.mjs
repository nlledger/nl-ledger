// Read-only MCP server (Model Context Protocol, streamable HTTP transport, JSON responses).
// Served by the site's Worker at /mcp (routes/mcp.js).
// `io` supplies: db (D1), json(path) -> fetches one of the site's /data files.
import { find, getItem, sha10, DATASETS } from "./search.mjs";
import { SITE, money, moneyWords, workTime, perPerson, perHousehold, DATASET_LABEL } from "./format.mjs";
import { isFederal, currencyOf, nativeAmount, amountBasis, federalStatement, FEDERAL_RULE, OVERLAP_RULE, OVERLAP, AMOUNT_KIND } from "./federal.mjs";

import { summaryTool } from "./mcp-summaries.mjs";

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `NL Ledger: provincial accounts, awards and expenses, and federal records selected by reported supplier or recipient location, with conflicts labelled.

Rules for answers:
- Answer only from tool results. If the records do not answer the question, say so.
- Cite every figure. Each record has source_url, locator and page_url. Give the source link with each figure.
- Tell the user once per conversation: automated scripts gathered and combined these figures from public records, and nobody has independently vetted them. The user should open the source before relying on a figure.
- Patterns ("flags") are questions, not findings. Never call a flagged record wrongdoing, waste or corruption.
- ${FEDERAL_RULE} Never infer where money was spent or who benefited from a payee's address.
- Distinguish a reported commitment or award value, a payment to a recipient, and evidenced work, benefit or jurisdiction. A jurisdiction's receipt does not establish its later expenditure.
- Amounts retain native currency, including unstated currency. amount_cad exists only when the source supports CAD. Missing is not zero. Contract and grant values can span several years and dates can be original award/agreement starts, not spending years.
- ${OVERLAP_RULE} Use source/basis/period/currency/location breakdowns; do not add overlapping commitments, notices, payments, major transfers or provincial accounts as one spending total.
- Federal records and mixed supplier summaries have no automatic NL per-person, household or wage-time figures. human_scale is hypothetical division under an explicit denominator assumption, never a bill to residents or geographic allocation.

Location review: scope_review_state separates incomplete review (unreviewed) from assessed evidence (reviewed). Unknown scope on an unreviewed record does not mean the publisher gives no location; consult the retained source fields. A jurisdictional receipt does not establish subsequent expenditure.

How to start: use get_pay for employer pay, get_body for public bodies, tax_receipt for an employment-income illustration, get_totals for full-record totals and rankings (never add search pages yourself), search_records for words or names, get_supplier for one company or recipient, get_budget for what was budgeted against what was spent, the deficit and net debt, get_department for one department's programs, get_members to compare MHA or minister expenses, list_flags for patterns, human_scale to make an amount easy to picture.`;

const PAGE = 25;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const SOURCE_IDS = DATASETS.filter((k) => DATASET_LABEL[k]);
const SOURCE_HELP = SOURCE_IDS.map((k) => `${k} = ${DATASET_LABEL[k]}`).join("; ");

export const TOOLS = [
  {
    name: "get_pay", title: "Pay by employer",
    description: "Published pay above $100,000 by employer and calendar year, people, common titles, overtime and severance. Missing lists are not zero; this is not total payroll. Omit employer to list employers. Individuals use search_records.",
    inputSchema: { type: "object", properties: { employer: { type: "string" }, year: { type: "string", pattern: "^\\d{4}$" } } },
    annotations: { title: "Pay by employer", ...READ_ONLY },
  },
  {
    name: "get_body", title: "Public body records",
    description: "A public body's reported values by year and source, and largest suppliers, matching its page. Award values are not payments; overlapping and federal sources stay labelled. Omit name to list bodies.",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
    annotations: { title: "Public body records", ...READ_ONLY },
  },
  {
    name: "tax_receipt", title: "Employment income tax receipt",
    description: "Estimate provincial income tax on annual employment income and illustrate department spending shares, using the receipt page's assumptions. Not a personal tax assessment or a trace of your tax payments.",
    inputSchema: { type: "object", properties: { income: { type: "number", minimum: 0, maximum: 10000000 } }, required: ["income"] },
    annotations: { title: "Employment income tax receipt", ...READ_ONLY },
  },
  {
    name: "get_totals", title: "Totals and rankings",
    description: "Full-record totals or rankings filtered by supplier, named buyer, year or source. Groups by supplier, buyer/department, year or source, separately by source and currency with overlap exclusions. Awards are not payments; use get_department for program spending. No paginated-search sums.",
    inputSchema: { type: "object", properties: {
      group_by: { type: "string", enum: ["supplier", "body", "department", "year", "source"] },
      supplier: { type: "string" }, supplier_id: { type: "string" }, body: { type: "string" }, body_id: { type: "string" }, department: { type: "string" },
      year: { type: "string", description: "Original record calendar year or published fiscal period; not annual spending." },
      source: { type: "string", enum: SOURCE_IDS }, limit: { type: "integer", minimum: 1, maximum: 100 },
    } }, annotations: { title: "Totals and rankings", ...READ_ONLY },
  },

  {
    name: "search_records",
    title: "Search spending records",
    description: `Search every line item: contract awards, federal contracts and grants, minister and MHA expense lines, and pay over $100,000. records holds exact matches: every word matches (by prefix), largest amount first, up to ${PAGE} per page (use page for more). A misspelled word is corrected when nothing matches exactly (see corrected). On page 1, related_by_meaning adds up to 20 records about the same thing that do not contain every word, closest first. Give a query, a filter, or both. Each record has its source citation. Sources: ${SOURCE_HELP}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find, e.g. 'ferry repair', a company name, a town or a job title." },
        source: { type: "string", enum: SOURCE_IDS, description: "Limit to one source." },
        year: { type: "string", pattern: "^\\d{4}$", description: "Calendar year of the record date, e.g. 2024." },
        pattern: { type: "string", description: "Flag id from list_flags, e.g. no-competition." },
        supplier_id: { type: "string", description: "Supplier id from get_supplier." },
        page: { type: "integer", minimum: 1, maximum: 20, description: "Page number. Default 1." },
      },
    },
    annotations: { title: "Search spending records", ...READ_ONLY },
  },
  {
    name: "get_record",
    title: "Get one record",
    description: "Get one line item by its 12-character id. Returns retained source fields, evidence, inclusion rule, reported address/conflicts, separately supported location, native currency, amount kind and period, and citations. Federal amounts have no automatic provincial scaling.",
    inputSchema: { type: "object", properties: { id: { type: "string", pattern: "^[0-9a-fA-F]{12}$", description: "Record id, e.g. 2ebb7ad3bd29." } }, required: ["id"] },
    annotations: { title: "Get one record", ...READ_ONLY },
  },
  {
    name: "get_supplier",
    title: "Get a supplier or recipient",
    description: "Get included reported record values, all years, for a supplier or recipient, with explicit overlap/exclusion policy and breakdowns by source, amount kind, period, native currency and location evidence. These are not everything received, unique spending or spending in NL. Give a name or supplier_id; unmatched names return close matches.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Company or recipient name, e.g. 'Pennecon'." }, supplier_id: { type: "string", description: "10-character id from an earlier result." } } },
    annotations: { title: "Get a supplier or recipient", ...READ_ONLY },
  },
  {
    name: "get_department",
    title: "Get a provincial department's spending",
    description: "Get a provincial department's gross spending by program: actual against amended and original estimates, for a fiscal year from 2019-20 to 2024-25, or the 2025-26 and 2026-27 estimates. Leave out name to list the departments and years.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Department name or part of it, e.g. 'Health'." }, year: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Fiscal year, e.g. 2024-25 or 2026-27. Default: the latest year with actual spending." } } },
    annotations: { title: "Get a provincial department's spending", ...READ_ONLY },
  },
  {
    name: "get_budget",
    title: "Budget against actual, the deficit and net debt",
    description: "Get what the province budgeted and what it spent in a fiscal year, the difference, the annual surplus or deficit, net debt, and every department's budget against its spending, largest difference first. Years from 2019-20; the newest budgets have no published results yet. Two bases that must not be added together: departments_spending is modified cash (the Estimates given to the House against the Report on the Program Expenditures and Revenues); whole_government is the audited Public Accounts (accrual, all government bodies), the only source for the surplus or deficit and net debt. Every figure has its source link. Leave out year for the latest year with published results.",
    inputSchema: { type: "object", properties: {
      year: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Fiscal year, e.g. 2024-25. Default: the latest year with published results." },
      department: { type: "string", description: "Part of a department name, to return only matching departments, e.g. 'Health'." },
    } },
    annotations: { title: "Budget against actual, the deficit and net debt", ...READ_ONLY },
  },
  {
    name: "get_members",
    title: "Compare MHA and minister expenses",
    description: "Rank Members of the House of Assembly by allowance spending for a fiscal year, overall or for one category (for example travel), with the average. Give a name to get one member's spending by year and category. Set group to ministers for ministers' expense claim totals.",
    inputSchema: { type: "object", properties: {
      group: { type: "string", enum: ["mha", "ministers"], description: "Default mha." },
      year: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "MHA fiscal year, e.g. 2024-25. Default: the latest full year." },
      category: { type: "string", description: "Words in the category name, e.g. 'travel', 'office', 'constituency'." },
      name: { type: "string", description: "Part of a member's name." },
    } },
    annotations: { title: "Compare MHA and minister expenses", ...READ_ONLY },
  },
  {
    name: "list_flags",
    title: "List spending patterns",
    description: "List the patterns people read as waste or perks (for example sole-source awards, contracts that grew, purchases just under a limit), with counts. Each pattern is a question, not a finding.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "List spending patterns", ...READ_ONLY },
  },
  {
    name: "get_flag",
    title: "Get one spending pattern",
    description: "Get one pattern by id (from list_flags): why people look at it, exactly how it is computed, what it cannot tell you, and its largest results.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Pattern id, e.g. no-competition." } }, required: ["id"] },
    annotations: { title: "Get one spending pattern", ...READ_ONLY },
  },
  {
    name: "human_scale",
    title: "Put an amount in human terms",
    description: "Hypothetically divide a supported CAD amount by the NL population, households and reference median wage. Result states the denominator assumption and carries no geographic allocation, resident liability or local wage/employment claim. Includes Statistics Canada sources.",
    inputSchema: { type: "object", properties: { amount: { type: "number", minimum: 0, description: "Amount in Canadian dollars, e.g. 50000000." } }, required: ["amount"] },
    annotations: { title: "Put an amount in human terms", ...READ_ONLY },
  },
  {
    name: "search",
    title: "Search (for ChatGPT deep research)",
    description: "Search the records and return a short list of results, each with id, title and url. Use fetch with an id to get the full record. Prefer search_records when you can pass filters.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to find." } }, required: ["query"] },
    annotations: { title: "Search", ...READ_ONLY },
  },
  {
    name: "fetch",
    title: "Fetch one record (for ChatGPT deep research)",
    description: "Fetch the full text of one result from search, by id.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Id from search." } }, required: ["id"] },
    annotations: { title: "Fetch", ...READ_ONLY },
  },
];

// Starter questions, offered to clients that show MCP prompts (for example as slash commands).
export const PROMPTS = [
  { name: "no_open_call", title: "Awards without an open call", description: "What the province awarded without an open call in a year, and to whom.", arguments: [{ name: "year", description: "Calendar year, e.g. 2025", required: false }],
    text: (a) => `Using NL Ledger, what did Newfoundland and Labrador public bodies award without an open call in ${a.year || "the most recent full year"}? List the largest awards with buyer, supplier and amount, and cite the source of each.` },
  { name: "follow_the_money", title: "Follow one company's records", description: "Reported records for one company, separated by source, period, value type and evidenced location.", arguments: [{ name: "name", description: "Company or recipient name", required: true }],
    text: (a) => `Using NL Ledger, show reported records for ${a.name || "this company"} by source, amount kind, period and supported location. Distinguish commitments from payments, state the overlap and exclusions, and never infer spending location from a payee address. Cite the largest records.` },
  { name: "budget_check", title: "Was that the plan?", description: "What the province budgeted against what it spent, with the deficit and net debt.", arguments: [{ name: "year", description: "Fiscal year, e.g. 2024-25", required: false }],
    text: (a) => `Using NL Ledger, what did Newfoundland and Labrador budget for ${a.year || "the latest year with published results"}, what did it spend, and what were the deficit and net debt? Name the departments furthest over and under their budgets, say which figures are on which basis of accounting, and cite each source.` },
  { name: "mha_travel", title: "MHA travel", description: "How MHA travel spending compares across members.", arguments: [],
    text: () => "Using NL Ledger, which MHAs charged the most travel to their allowances in 2024-25, and how does that compare with the average member? Cite the reports." },
  { name: "make_it_human", title: "Make an amount human", description: "Turn any amount into per person, per household and time to earn.", arguments: [{ name: "amount", description: "Amount in dollars", required: true }],
    text: (a) => `Using NL Ledger, give a hypothetical comparison of ${a.amount || "CAD 50 million"} with the NL population, households and reference median wage. State the denominator assumption; this does not establish spending in NL, resident liability or local wages paid.` },
];

// ---- discovery: MCP registry server.json and the (draft) MCP server card
export const REGISTRY_NAME = "ca.nlledger/nl-ledger";
// The MCP Registry rejects a description over 100 characters.
const DESCRIPTION = "NL provincial and federal spending records, each with its source. Addresses do not locate work.";
export const SERVER_VERSION = "0.4.0";
// The logo, for clients that show one beside the server's name (icons in server info, server.json and the server card).
export const ICONS = () => [
  { src: `${SITE.url}/nl-ledger-icon-256.png`, mimeType: "image/png", sizes: ["256x256"] },
  { src: `${SITE.url}/app-icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
];

export function serverJson() {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: REGISTRY_NAME,
    title: SITE.name,
    description: DESCRIPTION,
    version: SERVER_VERSION,
    websiteUrl: `${SITE.url}/data/`,
    icons: ICONS(),
    remotes: [{ type: "streamable-http", url: `${SITE.url}/mcp` }],
  };
}

export function serverCard() {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: REGISTRY_NAME,
    title: SITE.name,
    description: DESCRIPTION,
    version: SERVER_VERSION,
    websiteUrl: `${SITE.url}/data/`,
    icons: ICONS(),
    remotes: [{ type: "streamable-http", url: `${SITE.url}/mcp`, supportedProtocolVersions: PROTOCOLS }],
  };
}

export function aiCatalog() {
  return {
    specVersion: "1.0",
    entries: [{ identifier: `urn:air:${new URL(SITE.url).host}:mcp:nl-ledger`, type: "application/mcp-server-card+json", url: `${SITE.url}/mcp/server-card` }],
  };
}

// Same normalisation as pipeline/common.py entity_key (pipeline/check_matching.py checks they agree).
function unescapeHtml(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#"
    ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : named[e.toLowerCase()] ?? m);
}
// "(NLDC)" after "Newfoundland and Labrador Dairy Co-operative": letters in order from the name, starting with its first word.
function acronymOf(words, acronym) {
  const letters = acronym.toLowerCase().replace(/[^a-z]/g, "");
  const text = words.toLowerCase().replace(/[^a-z ]/g, "");
  if (!letters || !text || text[0] !== letters[0]) return false;
  const flat = text.replace(/ /g, "");
  let i = 0;
  for (const c of letters) { i = flat.indexOf(c, i); if (i < 0) return false; i++; }
  return true;
}
const TAIL = /(\s*[,(-]?\s*\b(o\/a|o\.a\.|operating as|c\/o|dba|d\/b\/a|doing business as|t\/a|trading as|carrying on business as)\b|\s*[,(-]\s*(care of|formerly|previously|now known as)\b).*$/i;
const SUFFIX = /\b(incorporated|inc|ltd|limited|corp|corporation|co|company|llc|plc|ulc|ltee|ltée|limitee|limitée|l\.?t\.?d|the)\b\.?/g;
export function entityKey(name) {
  let s = unescapeHtml(String(name || "")).replace(/\s+/g, " ").trim();
  s = s.replace(/\blimited partnership\b|\bl\.\s?p\.?(?=\W|$)|\blp\b/gi, " LP ").replace(/[\u2018\u2019`]/g, "'");
  s = s.replace(TAIL, "") || s;
  const m = s.match(/\s*\(([A-Z][A-Z&.\- ]{1,11})\)\s*$/);
  if (m && acronymOf(s.slice(0, m.index), m[1])) s = s.slice(0, m.index);
  s = s.replace(/\s(and|&)\s+(co|company)\b\.?/gi, " ").replace(/\bco-?op(erative)?\b/gi, "cooperative");
  s = s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  s = s.replace(/'/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim().replace(/\s(l td|limit ed|limite d|limi ted|lim ited|inc orporated)$/, "");
  if (String(name || "").length >= 33) s = s.replace(/\s(limite|limit|limi|lim|lt|incorp|incorpor|incorporat|corporat)$/, "");
  s = s.replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
  return s.replace(/\bn l\b|\bnl\b/g, "newfoundland and labrador").replace(/\bnfld\b/g, "newfoundland");
}

// Drop empty fields so every answer stays small enough for any client's context.
function compact(o) {
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return o;
}

function cite(it) {
  const pdf = /\.pdf($|\?)/i.test(it.u || "");
  return compact({
    id: it.i,
    source: DATASET_LABEL[it.ds] || it.ds,
    level: it.lv,
    buyer: it.b || null,
    supplier: it.s || null,
    supplier_id: it.k || null,
    person: it.p || null,
    description: it.d || null,
    native_amount: it.a ?? null,
    native_currency: currencyOf(it),
    amount_cad: currencyOf(it) === "CAD" ? it.a ?? null : null,
    amount_kind: isFederal(it) ? amountBasis(it) : undefined,
    inclusion_rule: it.x?.inclusion_rule,
    reported_location: it.x?.reported_location,
    location_conflict: it.x?.location_conflict,
    scope_status: it.x?.scope_status,
    scope_review_state: isFederal(it) ? it.x?.scope_review_state || "unreviewed" : undefined,
    scope_evidence: it.x?.scope_evidence,
    source_geography: it.x?.source_geography,
    qualification: isFederal(it) ? federalStatement(it) : undefined,
    amount_period: it.x?.amount_period,
    how_counted: it.x?.how_counted,
    amount_coverage: it.x?.amount_coverage || (it.a == null ? "not stated" : it.a === 0 ? "published zero" : "published value"),
    amount_original: it.o ? { value: it.o, currency: it.c || "USD" } : undefined,
    date: it.t || it.fy || null,
    method: it.m || null,
    flags: it.f || [],
    details: it.x || undefined,
    source_url: pdf && it.g ? `${it.u}#page=${it.g}` : it.u,
    locator: it.l,
    page_url: `${SITE.url}/item/${it.i}/`,
  });
}

const CAUTION = "Figures come from public records, gathered by automated scripts, and have not been independently vetted. Open source_url before relying on a figure.";

// A tool-level error the model can act on: what went wrong and what to try.
function problem(error, extra = {}) {
  return { error, ...extra };
}

async function call(name, args, io) {
  if (["get_pay", "get_body", "tax_receipt", "get_totals"].includes(name)) return summaryTool(name, args, io);
  const stats = await io.json("/data/stats.json");
  switch (name) {
    case "search_records": {
      const q = String(args.query || "").trim();
      if (!q && !args.source && !args.year && !args.pattern && !args.supplier_id) return problem("Give a query or at least one filter (source, year, pattern or supplier_id).");
      if (args.source && !SOURCE_IDS.includes(args.source)) return problem(`Unknown source "${args.source}".`, { sources: DATASET_LABEL });
      // One window of matching documents, flattened to line items and sorted once; pages slice that list.
      const page = Math.min(20, Math.max(1, Math.floor(Number(args.page) || 1)));
      const r = await find(io, { q, ds: args.source, y: args.year, f: args.pattern, s: args.supplier_id }, { limit: 40, order: "amount", meaning: page === 1 });
      const all = r.items.sort((a, b) => (b.a || 0) - (a.a || 0));
      const items = all.slice((page - 1) * PAGE, page * PAGE).map(cite);
      const near = r.near?.length ? r.near.map((it) => ({ ...cite(it), closeness: it.near })) : undefined;
      const corrected = r.corrected ? `No record contains "${q}"; these are for "${r.corrected.q}".` : undefined;
      const suggest = r.suggest?.length ? r.suggest : undefined;
      if (!all.length && !near) return { records: [], suggested_queries: suggest, note: "Nothing matched. Try fewer or shorter words, or drop a filter. Names match by the start of each word." };
      if (!all.length) return { records: [], note: "No record contains every word. related_by_meaning lists records about the same thing; check each one against the question.", suggested_queries: suggest, caution: CAUTION, related_by_meaning: near };
      if (!items.length) return { records: [], note: `Page ${page} is past the end. There are ${all.length} records in ${Math.ceil(all.length / PAGE)} pages.` };
      const more = all.length > page * PAGE;
      return {
        records_found: all.length,
        page,
        pages: Math.ceil(all.length / PAGE),
        next_page: more ? page + 1 : undefined,
        corrected,
        truncated: r.more ? "More records match than one search returns. These are the largest; add words or a filter (source, year) to see smaller ones." : undefined,
        caution: CAUTION,
        records: items,
        related_by_meaning: near,
        search_page_url: `${SITE.url}/search/?${new URLSearchParams(Object.entries({ q, ds: args.source, y: args.year, f: args.pattern, s: args.supplier_id }).filter(([, v]) => v))}`,
      };
    }
    case "get_record": {
      const id = String(args.id || "").trim().toLowerCase();
      if (!/^[0-9a-f]{12}$/.test(id)) return problem("A record id is 12 characters, 0-9 and a-f. Get ids from search_records.");
      const it = await getItem(io.db, id);
      if (!it) return problem("No record with that id. Get ids from search_records.");
      const out = cite(it);
      if (!isFederal(it) && currencyOf(it) === "CAD" && it.a != null) out.human_scale = scale(it.a, stats);
      out.caution = CAUTION;
      return out;
    }
    case "get_supplier": {
      let h = String(args.supplier_id || "").trim().toLowerCase();
      const nm = String(args.name || "").trim();
      if (!h && nm) h = await sha10(entityKey(nm));
      if (!h || !/^[0-9a-f]{10}$/.test(h)) return problem("Give a supplier name or a 10-character supplier_id.");
      const shardOf = (x) => io.json(`/data/s/${parseInt(x.slice(0, 4), 16) % 512}.json`);
      let s = (await shardOf(h))?.[h];
      // A name the supplier is also printed under points to the supplier.
      if (s?.to) {
        h = s.to;
        s = (await shardOf(h))?.[h];
      }
      if (!s) {
        if (!nm) return problem("No supplier with that id.");
        // Offer close matches: suppliers whose records contain every word of the name (spelling corrected when none do).
        const r = await find(io, { q: nm }, { limit: 20, meaning: false });
        const seen = new Map();
        for (const it of r.items) if (it.s && it.k && !seen.has(it.k)) seen.set(it.k, { supplier_id: it.k, name: it.s, source: DATASET_LABEL[it.ds] || it.ds });
        const want = entityKey(r.corrected ? r.corrected.q : nm).split(" ").filter(Boolean);
        const named = [...seen.values()].filter((m) => want.every((w) => entityKey(m.name).split(" ").some((x) => x.startsWith(w))));
        const matches = named.slice(0, 12);
        return problem(`No supplier is named exactly "${nm}".`, matches.length ? { close_matches: matches, next_step: "Call get_supplier with one of these supplier_id values." } : { next_step: "Try search_records with part of the name." });
      }
      return {
        supplier_id: h, name: s.name, total_cad: s.total, records: s.n,
        summary_label: "Included reported record values, all years",
        overlap_and_exclusion_policy: OVERLAP_RULE,
        federal_selection_rule: FEDERAL_RULE,
        excluded_overlap_cad: s.overlap,
        by_source_basis_period_currency_location: s.breakdown,
        also_printed_as: s.combined ? s.combined.map((c) => c.t).filter((t) => t !== s.name) : s.names?.filter((t) => t !== s.name),
        names_matched_how: s.combined ? `${SITE.url}/method/suppliers/` : undefined,
        by_source: Object.fromEntries(Object.entries(s.byDs).map(([k, [n, a]]) => [DATASET_LABEL[k] || k, { records: n, total_cad: a, amount_kind: AMOUNT_KIND[k] || "Reported provincial award or payment values", period: "all published years; use detailed periods below", included_in_summary: !OVERLAP.has(k), exclusion_reason: OVERLAP.has(k) ? "Source can overlap contracts and grants; no individual duplicate is asserted" : null, location_breakdown: s.breakdown?.filter(g => g.source === k) }])),
        by_year: s.byYear, buyers: s.buyers, flags: s.flags,
        largest_records: s.top.slice(0, 20).map((it) => cite({ ...it, s: s.name })),
        page_url: `${SITE.url}/supplier/${h}/`,
        caution: CAUTION,
      };
    }
    case "get_department": {
      const d = await io.json("/data/departments.json");
      if (!args.name) return { departments: Object.keys(d.departments), years: d.years };
      const want = String(args.name).toLowerCase();
      const key = Object.keys(d.departments).find((k) => k.toLowerCase() === want)
        || Object.keys(d.departments).find((k) => k.toLowerCase().includes(want));
      if (!key) return problem("No department by that name.", { departments: Object.keys(d.departments) });
      const dep = d.departments[key];
      const year = args.year || Object.keys(dep).sort().filter((y) => !dep[y].estimates).pop() || Object.keys(dep).sort().pop();
      const y = dep[year];
      if (!y) return problem(`No figures for ${year}.`, { years: Object.keys(dep) });
      return { department: key, fiscal_year: year, ...y, page_url: `${SITE.url}/department/${y.slug}/` };
    }
    case "get_budget": {
      const b = await io.json("/data/budget.json");
      if (!b) return problem("Budget figures are not available right now.");
      const year = args.year || b.latest_year;
      const y = b.years[year];
      if (!y) return problem(`No figures for ${year}.`, { years: Object.keys(b.years) });
      const want = String(args.department || "").toLowerCase();
      const departments = want ? y.departments.filter((d) => d.department.toLowerCase().includes(want)) : y.departments;
      if (want && !departments.length) return problem("No department by that name.", { departments: y.departments.map((d) => d.department) });
      return {
        fiscal_year: year, years: Object.keys(b.years), bases: b.bases,
        departments_spending: y.departments_spending, whole_government: y.whole_government, departments,
        page_url: `${SITE.url}/budget/${year === b.latest_year || !y.departments_spending || y.departments_spending.actual_status !== "published" ? "" : `${year}/`}`,
        method_url: `${SITE.url}/method/budget/`,
        caution: CAUTION,
      };
    }
    case "get_members": {
      const M = await io.json("/data/members.json");
      if (!M) return problem("Member data is not available right now.");
      const abs = (u) => `${SITE.url}${u}`;
      if (args.group === "ministers") {
        const list = M.ministers.filter((m) => !args.name || m.name.toLowerCase().includes(String(args.name).toLowerCase()));
        return { source: M.minister_source, ministers: list.map((m) => ({ ...m, page_url: abs(m.page_url) })), caution: CAUTION };
      }
      if (args.name) {
        const want = String(args.name).toLowerCase();
        const hits = Object.entries(M.mha).filter(([n]) => n.toLowerCase().includes(want)).slice(0, 5);
        if (!hits.length) return problem("No MHA by that name.", { members: Object.keys(M.mha) });
        return { source: M.mha_source, members: hits.map(([n, m]) => ({ name: n, district: m.district, years: m.years, page_url: abs(m.page_url) })), caution: CAUTION };
      }
      const year = args.year || M.mha_years[M.mha_years.length - 2] || M.mha_years[M.mha_years.length - 1];
      if (!M.mha_years.includes(year)) return problem(`No MHA reports for ${year}.`, { years: M.mha_years });
      const cat = String(args.category || "").toLowerCase().trim();
      const rows = [];
      const cats = new Set();
      for (const [n, m] of Object.entries(M.mha)) {
        const y = m.years[year];
        if (!y) continue;
        let amt = y.total;
        if (cat) {
          const keys = Object.keys(y.by_category).filter((k) => k.toLowerCase().includes(cat));
          keys.forEach((k) => cats.add(k));
          amt = keys.reduce((t, k) => t + y.by_category[k], 0);
        }
        rows.push({ name: n, district: m.district, amount_cad: Math.round(amt * 100) / 100, page_url: abs(m.page_url) });
      }
      if (cat && !cats.size) {
        const all = new Set(Object.values(M.mha).flatMap((m) => Object.values(m.years).flatMap((y) => Object.keys(y.by_category))));
        return problem(`No category matches "${args.category}".`, { categories: [...all] });
      }
      rows.sort((a, b) => b.amount_cad - a.amount_cad);
      const avg = rows.reduce((t, r) => t + r.amount_cad, 0) / (rows.length || 1);
      return {
        source: M.mha_source, fiscal_year: year, categories: cat ? [...cats] : "all allowances", members: rows.length,
        average_cad: Math.round(avg * 100) / 100,
        note: "Members who served part of the year, or who are ministers or party leaders with other budgets, spend less from these allowances. This is not a ranking of thrift.",
        ranking: rows, caution: CAUTION,
      };
    }
    case "list_flags": {
      const f = await io.json("/data/flags.json");
      const r = await io.json("/data/flag_results.json");
      return { caveat: f.caveat, flags: f.flags.map((x) => ({ id: x.id, title: x.title, short: x.short, count: r[x.id]?.count })) };
    }
    case "get_flag": {
      const f = await io.json("/data/flags.json");
      const r = await io.json("/data/flag_results.json");
      const x = f.flags.find((x) => x.id === args.id);
      if (!x) return problem("Unknown pattern id.", { ids: f.flags.map((x) => x.id) });
      return { ...x, caveat: f.caveat, results: r[x.id], page_url: `${SITE.url}/flags/${x.id}/`, method_url: `${SITE.url}/method/${x.id}/` };
    }
    case "human_scale": {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount < 0) return problem("amount must be a number of dollars, 0 or more, e.g. 50000000.");
      return scale(amount, stats);
    }
    // OpenAI's search/fetch shape, used by ChatGPT deep research and company knowledge.
    case "search": {
      const q = String(args.query || "").trim();
      if (!q) return { results: [] };
      const r = await find(io, { q }, { limit: 20 });
      return {
        results: [...r.items.sort((a, b) => (b.a || 0) - (a.a || 0)).slice(0, PAGE), ...(r.near || [])].map((it) => ({
          id: it.i,
          title: [it.s || it.p, isFederal(it) ? amountBasis(it) : it.d, isFederal(it) ? nativeAmount(it.a, currencyOf(it)) : it.a != null ? money(it.a) : null, isFederal(it) ? federalStatement(it) : null, it.t || it.fy].filter(Boolean).join(" · "),
          url: `${SITE.url}/item/${it.i}/`,
        })),
      };
    }
    case "fetch": {
      const id = String(args.id || "").trim().toLowerCase();
      const it = /^[0-9a-f]{12}$/.test(id) ? await getItem(io.db, id) : null;
      if (!it) return problem("No record with that id.");
      const c = cite(it);
      return {
        id: it.i,
        title: [it.s || it.p, it.d].filter(Boolean).join(" · ") || c.source,
        text: JSON.stringify({ ...c, human_scale: !isFederal(it) && currencyOf(it) === "CAD" && it.a != null ? scale(it.a, stats) : undefined, caution: CAUTION }, null, 1),
        url: c.page_url,
        metadata: { source: c.source, source_url: c.source_url, locator: c.locator },
      };
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}. Call tools/list for the tool names.`), { code: -32602 });
  }
}

function scale(amount, stats) {
  return {
    assumption: "Hypothetical comparison: divide this supported CAD amount evenly by the NL population or households, or compare it with one reference annual wage. This assumes a denominator only; it does not establish geographic spending, benefit, resident liability or local wages paid.",
    amount: money(amount),
    in_words: moneyWords(amount),
    per_resident: money(perPerson(amount, stats), { cents: true }),
    per_household: money(perHousehold(amount, stats), { cents: true }),
    time_to_earn_at_median_wage: workTime(amount, stats),
    basis: {
      population: `${stats.population.value} (Statistics Canada table ${stats.population.table}, ${stats.population.date})`,
      households: `${stats.households.value} (Statistics Canada table ${stats.households.table}, 2021 Census)`,
      median_full_time_wage: `${money(stats.median_annual_wage.value)} a year (table ${stats.median_weekly_wage.table}, vector ${stats.median_weekly_wage.vector}, ${stats.median_weekly_wage.year}, weekly x 52)`,
    },
  };
}

// Any origin may call this read-only server from a browser.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id, authorization",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function reply(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, "cache-control": "no-store", ...(body === null ? {} : { "content-type": "application/json" }) },
  });
}

const ABOUT = `${SITE.name} MCP server: provincial accounts and federal records selected by reported NL addresses. ${FEDERAL_RULE} No sign-in.

Address: ${SITE.url}/mcp (streamable HTTP; POST JSON-RPC here)
How to connect your AI assistant: ${SITE.url}/data/
Tools: ${TOOLS.map((t) => t.name).join(", ")}
`;

// Bound actual streamed bytes before JSON parsing; Content-Length is not trusted.
const MAX_BODY_BYTES = 64 * 1024;
async function readMessage(request) {
  if (!request.body) return JSON.parse("");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        // Stop consuming immediately; a disconnect/cancellation failure must not delay the rejection.
        void reader.cancel().catch(() => {});
        throw Object.assign(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`), { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function handleMcp(request, io) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET") {
    const accept = request.headers.get("accept") || "";
    // No server-initiated stream: every answer comes back on the POST.
    if (accept.includes("text/event-stream")) return new Response(null, { status: 405, headers: { ...CORS, allow: "POST, DELETE, OPTIONS" } });
    return new Response(ABOUT, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8" } });
  }
  if (request.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...CORS, allow: "GET, POST, DELETE, OPTIONS" } });
  let msg;
  try {
    msg = await readMessage(request);
  } catch (error) {
    if (error?.status === 413) return reply({ jsonrpc: "2.0", id: null, error: { code: -32600, message: error.message } }, 413);
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: the body must be JSON-RPC 2.0." } }, 400);
  }
  if (Array.isArray(msg)) return reply({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported: send one JSON-RPC call per HTTP request." } }, 400);
  const res = await one(msg, io);
  return res ? reply(res) : reply(null, 202);
}

async function one(msg, io) {
  if (!msg || typeof msg !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } };
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return null; // notification or response: nothing to send back
  if (typeof method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request: method is missing." } };
  try {
    if (method === "initialize") {
      const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
      return { jsonrpc: "2.0", id, result: {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "nl-ledger", title: SITE.name, version: SERVER_VERSION, websiteUrl: `${SITE.url}/data/`, icons: ICONS() },
        instructions: INSTRUCTIONS,
      } };
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (method === "tools/call") {
      const out = await call(params.name, params.arguments || {}, io);
      const isError = !!out?.error;
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError } };
    }
    if (method === "prompts/list") return { jsonrpc: "2.0", id, result: { prompts: PROMPTS.map(({ text, ...p }) => p) } };
    if (method === "prompts/get") {
      const p = PROMPTS.find((x) => x.name === params.name);
      if (!p) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown prompt: ${params.name}` } };
      return { jsonrpc: "2.0", id, result: { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(params.arguments || {}) } }] } };
    }
    if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [] } };
    if (method === "resources/templates/list") return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: e.code || -32603, message: String(e.message || e) } };
  }
}
