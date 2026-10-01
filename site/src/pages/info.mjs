import {
  components_SourcesPage_astro as SourcesPage,
  components_MethodsPage_astro as MethodsPage,
  components_ReceiptMethod_astro as ReceiptMethod,
  components_FederalMethod_astro as FederalMethod,
  components_SuppliersMethod_astro as SuppliersMethod,
  components_CorrectionsPage_astro as CorrectionsPage,
  components_AboutPage_astro as AboutPage,
  components_TermsPage_astro as TermsPage,
  components_AskedPage_astro as AskedPage,
  components_HelpPage_astro as HelpPage,
  components_NotFound_astro as NotFound,
  components_ScalePage_astro as ScalePage,
} from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// Sources and report card, methods, corrections, about, data access, the fold-out scale, 404.
import { Notes } from "../../lib/html.mjs";
import { card as shareCard, cardAmount } from "../../lib/share-card.mjs";
import { num, pct } from "../../lib/format.mjs";
import { federalStatement, amountBasis } from "../../lib/federal.mjs";
import { desc } from "../seo.mjs";
import { DATASETS } from "../../lib/search.mjs";
import { connectPage } from "./connect.mjs";
import { LICENCES, SOURCE_LICENCE } from "../licences.mjs";
import { ASKED, ASKED_STATE } from "../asked.mjs";
const SOURCES = [
  {
    ds: "ppa",
    publisher:
      "Public Procurement Agency, Government of Newfoundland and Labrador",
    url: "https://www.gov.nl.ca/ppa/tenders/awarded/",
    what: "Contract award reports filed every two weeks under sections 31 and 32 of the Public Procurement Regulations: limited calls for bids, exceptions to open calls (sole source, emergency and others) and some open calls, for every public body that must report.",
    form: "PDF tables, read with a table parser. Where a fortnight was reissued as REVISED, the revised report replaces the original.",
  },
  {
    ds: "minister",
    publisher: "Executive Council, Government of Newfoundland and Labrador",
    url: "https://www.gov.nl.ca/exec/cabinet/expenseclaims/",
    what: "Each minister's expense claims paid in six-month periods, with a detail page per travel claim.",
    form: "PDF text. Every report's lines are checked against its printed total.",
  },
  {
    ds: "mha",
    publisher: "House of Assembly",
    url: "https://www.assembly.nl.ca/Members/Expenses/",
    what: "Member Accountability and Disclosure Reports: every line charged to each MHA's allowances, with limits by category. Annual reports from 2020-21.",
    form: "PDF text. Every category's lines are checked against its printed Period Activity, and the detail against the summary report.",
  },
  {
    ds: "sunshine",
    publisher:
      "Treasury Board Secretariat, Government of Newfoundland and Labrador",
    url: "https://www.gov.nl.ca/exec/tbs/home/publications/compensation-disclosure/",
    what: "Compensation disclosure lists: everyone paid over $100,000 in a calendar year, by employer, 2022 to 2025.",
    form: "Excel workbooks, read cell by cell.",
  },
  {
    ds: "fed_contract",
    publisher:
      "Government of Canada (Treasury Board Secretariat, open.canada.ca)",
    url: "https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b",
    what: "Proactive disclosure of contracts over $10,000, filtered to vendors with a Newfoundland and Labrador postal code (starting with A).",
    form: "Bulk CSV. Keep the latest running value in each identified amendment chain. Reviewed supplier-name changes are resolved before counting; earlier printings stay as evidence. Address selection does not locate work or benefits.",
  },
  {
    ds: "fed_grant",
    publisher: "Government of Canada (open.canada.ca)",
    url: "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
    what: "Proactive disclosure of grants and contributions whose publisher reports recipient province NL. Conflicting address fields are labelled; that province field does not locate the project or benefit.",
    form: "Open data API, filtered on reported recipient province. Latest running total for most departments; summed amendment changes for Indigenous Services, Crown-Indigenous Relations, Canadian Heritage and the Public Health Agency.",
  },
  {
    ds: "canadabuys",
    publisher: "Public Services and Procurement Canada (CanadaBuys)",
    url: "https://canadabuys.canada.ca/en/tender-opportunities",
    what: "Federal award notices selected by reported NL supplier province or a valid Canadian NL postal code, August 2022 on. Known foreign countries are excluded and address conflicts labelled.",
    form: "Bulk CSV. Notices may overlap contract disclosures. They are excluded from supplier commitment summaries and shown separately in source and body summaries. Native currencies and unstated currency are retained; only supported CAD values enter CAD totals.",
  },
  {
    ds: "pa_pss",
    publisher: "Receiver General for Canada, Public Accounts Volume III",
    url: "https://www.tpsgc-pwgsc.gc.ca/recgen/cpc-pac/index-eng.html",
    what: "Published federal payments over $100,000 for professional and special services, selected by the payee’s trailing reported NL location, 2021-22 to 2024-25. This does not locate work or subsequent spending.",
    form: "Bulk CSV.",
  },
  {
    ds: "pa_tp",
    publisher: "Receiver General for Canada, Public Accounts Volume III",
    url: "https://www.tpsgc-pwgsc.gc.ca/recgen/cpc-pac/index-eng.html",
    what: "Published federal transfer payments over $100,000 selected by reported recipient province Newfoundland and Labrador, 2021-22 to 2024-25. This does not establish subsequent spending location.",
    form: "Bulk CSV.",
  },
  {
    ds: "paradise",
    publisher: "Town of Paradise",
    url: "https://www.paradise.ca/government-engage/cheque-register/",
    what: "Every payment the town made, month by month, from mid-2020.",
    form: "PDF text. The town's page links some months to the wrong file; each register is dated by its own payment dates.",
  },
  {
    ds: "stjohns",
    publisher: "City of St. John's",
    url: "https://www.stjohns.ca/your-government/access-to-information-and-protection-of-privacy/proactive-disclosures/",
    what: "Weekly payment vouchers. A sample: the first pages of the 2026 file.",
    form: "Scanned images read by OCR (tesseract). Text can be misread; every line links to its page.",
  },
];
const OTHER = [
  [
    "Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund, 2019-20 to 2024-25",
    "https://www.gov.nl.ca/exec/tbs/public-accounts/",
    "Department and program spending, actual against amended and original estimates; what departments spent against the budget.",
    "nl",
  ],
  [
    "Estimates of the Program Expenditure and Revenue of the Consolidated Revenue Fund, 2019-20 to 2026-27, and the budgets' Statements and Schedules from 2024-25",
    "https://www.gov.nl.ca/budget/",
    "What each year's budget gave each department and program; the budget's forecast deficit and net debt.",
    "nl",
  ],
  [
    "Public Accounts, Consolidated Summary Financial Statements, 2019-20 to 2024-25",
    "https://www.gov.nl.ca/exec/tbs/public-accounts/",
    "The annual surplus or deficit and net debt, audited, against the original budget.",
    "nl",
  ],
  [
    "Statistics Canada tables 14-10-0064, 17-10-0009, 98-10-0002, 36-10-0450",
    "https://www150.statcan.gc.ca/",
    "Median wage, population, households, provincial revenue and interest.",
    "statcan",
  ],
  [
    "Canada Revenue Agency, Form NL428",
    "https://www.canada.ca/en/revenue-agency.html",
    "Provincial income tax brackets, CPP and EI rates for the personal receipt.",
    "gc",
  ],
];

// The receipt's arithmetic for one income, line by line, so a reader can redo it with a calculator.

export async function info(D, R) {
  const out = [];
  const counts = Object.fromEntries(
    D.q(
      "SELECT dataset, count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) a, min(nullif(date,'')) d0, max(date) d1 FROM items GROUP BY dataset",
    ).map((r) => [r.dataset, r]),
  );

  // ---- sources + report card
  const issuesBySource = {};
  for (const i of D.issues) (issuesBySource[i.source] ||= []).push(i);
  const late = D.flagSummary["late-publication"]?.items || 0;
  const bad = D.flagSummary["date-check"]?.items || 0;
  const ppaN = counts.ppa.n;
  const estChecks = D.one(
    "SELECT sum(ok) ok, count(*) n, count(DISTINCT fiscal_year) years FROM dept_summary WHERE kind='estimates'",
  );
  const card = [
    {
      body: "Public Procurement Agency award reports",
      grade: [
        `${pct(late / ppaN, 1)} of awards reported more than 90 days after the award date`,
        `${num(bad)} printed award dates fall after the report or years before it`,
        "4 fortnights reissued as REVISED",
        "Open-call awards by departments are on MERX, not in these reports",
      ],
    },
    {
      body: "Executive Council, ministers' claims",
      grade: [
        "Every report adds up to its printed total",
        ...(issuesBySource["Ministerial expense claims"] || []).map(
          (i) => `${i.url.split("/").pop()}: ${i.issue}`,
        ),
      ],
    },
    {
      body: "House of Assembly, MHA reports",
      grade: [
        "Every category adds up to its printed period activity",
        `${(issuesBySource["MHA expense report"] || []).length} report links lead to a web page instead of a PDF`,
      ],
    },
    {
      body: "Treasury Board Secretariat, compensation lists",
      grade: [
        `${(issuesBySource["Compensation disclosure"] || []).length} of the workbooks linked from the disclosure page return "page not found"`,
        "Names are withheld for police officers (identifiers only), as the Act allows",
      ],
    },
    {
      body: "Treasury Board Secretariat, program expenditure reports",
      grade: [
        `${R.reportCard.find((x) => /Department totals/.test(x.label)).value} department totals match the printed statement`,
        "The 2024-25 report prints Labrador Affairs' detail pages empty, with the text #MISSING",
        ...(issuesBySource["Program expenditure reports"] || []).map(
          (i) => i.issue,
        ),
      ],
    },
    {
      body: "Department of Finance, budget Estimates",
      grade: [
        `${estChecks.ok} of ${estChecks.n} department totals match the printed Program Funding Summary, in ${estChecks.years} years of Estimates`,
        "One page in each of the 2025-26 and 2026-27 Estimates stores its text as glyph numbers, so a search or copy of that page returns unreadable characters",
      ],
    },
    {
      body: "Province, small purchases",
      grade: ["No line-by-line payment data is published at all"],
    },
  ];
  out.push([
    "/sources/",
    {
      title: "Sources: where every figure comes from",
      description: desc(
        "What each publisher releases, how much is loaded, the licence each source is under, and a report card on how complete and usable the records are.",
      ),
      body: await renderAstro(SourcesPage, {
        SOURCES,
        DATASETS,
        counts,
        LICENCES,
        SOURCE_LICENCE,
        OTHER,
        card,
        D,
      }),
    },
  ]);

  // ---- methods index + receipt + federal + scale
  out.push([
    "/method/",
    {
      card: shareCard(
        "Methods",
        num(D.catalog.flags.length),
        "Spending patterns with published methods",
      ),
      title: "Methods: how each figure is worked out",
      description: desc(
        "How every figure and pattern on NL Ledger is counted, what it leaves out and what it cannot tell you: the tax receipt, federal amendments and each pattern.",
      ),
      body: await renderAstro(MethodsPage, {
        D,
      }),
    },
  ]);
  const S = D.stats;
  out.push([
    "/method/receipt/",
    {
      title: "Method: the personal tax receipt",
      description: desc(
        "How the tax receipt works out provincial income tax from form NL428 with CPP and EI credits, spreads it across departments, and a worked example at the median wage.",
      ),
      body: await renderAstro(ReceiptMethod, {
        S,
        R,
      }),
    },
  ]);
  const F = D.federal;
  out.push([
    "/method/federal/",
    {
      card: shareCard(
        "Method: counting federal contracts once",
        cardAmount(F.contracts.dedup_value),
        "CAD contract values · address-selected · all years",
      ),
      title: "Method: counting federal contracts once",
      description: desc(
        "Federal disclosure files repeat a contract every time it is amended. How NL Ledger counts each contract and grant once, and the totals before and after.",
      ),
      body: await renderAstro(FederalMethod, {
        F,
      }),
    },
  ]);
  const M = D.matching;
  const GH = "https://github.com/nlledger/nl-ledger";
  out.push([
    "/method/suppliers/",
    {
      card: shareCard(
        "Method: matching supplier names",
        num(M.suppliers),
        "Supplier groups matched on evidence · all years",
      ),
      title: "Method: matching supplier names",
      description: desc(
        "How NL Ledger decides that names printed different ways across provincial and federal records are one supplier, and which close names it keeps apart.",
      ),
      body: await renderAstro(SuppliersMethod, {
        M,
        GH,
      }),
    },
  ]);

  // ---- corrections
  out.push([
    "/corrections/",
    {
      title: "Corrections to published figures",
      description: desc(
        "Every change to a published figure on NL Ledger, logged with the date and the reason, and how to report a figure that does not match its source.",
      ),
      body: await renderAstro(CorrectionsPage, {
        GH,
        D,
      }),
    },
  ]);

  // ---- about
  out.push([
    "/about/",
    {
      title: "What is NL Ledger?",
      description: desc(
        "NL Ledger is an independent project, in beta, that gathers Newfoundland and Labrador public spending records in one searchable place, each linked to its source.",
      ),
      body: await renderAstro(AboutPage, {
        R,
        D,
      }),
    },
  ]);

  // ---- terms of use
  out.push([
    "/terms/",
    {
      title: "Terms of use",
      description: desc(
        "NL Ledger's terms of use: what the site is, what its figures are and are not, and the limits of its responsibility.",
      ),
      body: await renderAstro(TermsPage, {}),
    },
  ]);

  // ---- what people asked for (content: src/asked.mjs)
  out.push([
    "/asked/",
    {
      title: "What people asked for",
      description: desc(
        "Suggestions readers have sent about NL Ledger and what was done about each one, without names. Anyone can add one from the box on any page.",
      ),
      body: await renderAstro(AskedPage, {
        ASKED,
        ASKED_STATE,
      }),
    },
  ]);

  // ---- help build this
  const WAYS = [
    {
      id: "source",
      title: "Add a source",
      form: "add-source.yml",
      label: "Suggest a source",
      text: "Know of public spending records this site does not have? A town that publishes its cheque register, a report of awards, a list of payments. Send the link and a sentence about what it holds.",
    },
    {
      id: "method",
      title: "Challenge a method",
      form: "challenge-method.yml",
      label: "Question a method",
      text: "Think something is counted, flagged or worded the wrong way? Say what the site does, what you would do instead, and why. Every method is written down on the Methods page, so there is something concrete to argue with.",
    },
    {
      id: "figure",
      title: "Report a figure",
      form: "figure-mismatch.yml",
      label: "Report a figure",
      text: "Found a figure that does not match the document it links to? Give the page on this site and the page in the source. Confirmed errors are fixed and logged on the Corrections page.",
    },
    {
      id: "request",
      title: "Request data",
      form: "request-data.yml",
      label: "Request data",
      text: "Want records that are not published anywhere? Describe them and who holds them. A good request can become an access to information request, and the answer can be added here.",
    },
  ];
  out.push([
    "/help/",
    {
      title: "Help build NL Ledger",
      description: desc(
        "Add a source, challenge a method, report a figure that does not match its document, or request records that are not published. No programming needed.",
      ),
      body: await renderAstro(HelpPage, {
        WAYS,
      }),
    },
  ]);

  // ---- ask your AI (connect page)
  out.push(await connectPage(D, R));

  // ---- the fold-out scale
  out.push(await scalePage(D, R));

  // ---- 404
  out.push([
    "/404.html",
    {
      title: "Page not found",
      robots: "noindex",
      body: await renderAstro(NotFound, {}),
    },
  ]);
  return out;
}
async function scalePage(D, R) {
  const S = D.stats;
  const BILLION = 1e9;
  const notes = new Notes();
  // Independently compared reported values; never parts of a common spending total.
  const pick = (sql, ...a) => D.one(sql, ...a);
  const fy = R.year;
  const pins = [];
  const add = (label, amount, href, detail) =>
    amount &&
    amount < BILLION &&
    pins.push({
      label,
      amount,
      href,
      detail,
    });
  add(
    "A median full-time wage for a year",
    S.median_annual_wage.value,
    "/method/",
    `Statistics Canada, table ${S.median_weekly_wage.table}`,
  );
  const nurse = R.timeExamples.find((t) => /nurse/i.test(t.title));
  if (nurse) add(nurse.title, nurse.amount, nurse.href, nurse.what);
  const mha = pick(
    "SELECT sum(amount) a FROM items WHERE dataset='mha' AND fiscal_year=?",
    "2024-25",
  );
  if (mha)
    add(
      "Every MHA's allowance spending in 2024-25, together",
      mha.a,
      "/members/",
      "Office, travel and constituency allowances, all members",
    );
  const allMin = pick(
    "SELECT sum(amount) a FROM items WHERE dataset='minister'",
  );
  add(
    "Every minister's expense claim, December 2020 to May 2026, together",
    allMin.a,
    "/members/",
    "Published expense claims, December 2020 to May 2026",
  );
  const para = pick(
    "SELECT sum(amount) a FROM items WHERE dataset='paradise' AND date LIKE '2024%'",
  );
  if (para.a)
    add(
      "Everything the Town of Paradise paid out in 2024",
      para.a,
      "/small-purchases/",
      "Paradise payment registers",
    );
  const ppa = pick(
    "SELECT * FROM items WHERE dataset='ppa' AND method='Emergency' ORDER BY amount DESC LIMIT 1",
  );
  if (ppa)
    add(
      `Largest emergency award: ${ppa.supplier}`,
      ppa.amount,
      `/item/${ppa.id.split("-").pop()}/`,
      `Provincial emergency award value; ${ppa.date}. ${ppa.description}`,
    );
  const ss = pick(
    "SELECT * FROM items WHERE dataset='ppa' AND method='Sole source' ORDER BY amount DESC LIMIT 1",
  );
  if (ss)
    add(
      `Largest sole-source award: ${ss.supplier}`,
      ss.amount,
      `/item/${ss.id.split("-").pop()}/`,
      `Provincial sole-source award value; ${ss.date}. ${ss.description}`,
    );
  const leg = R.departments.find((d) => /^Legislature/.test(d.name));
  if (leg)
    add(
      `The House of Assembly for a year, ${fy}`,
      leg.gross,
      `/department/${leg.slug}/`,
      "Legislature, gross spending",
    );
  const fc = pick(
    "SELECT * FROM items WHERE dataset='fed_contract' ORDER BY amount DESC LIMIT 1",
  );
  if (fc && fc.amount < BILLION)
    add(
      `Largest federal contract with an NL supplier: ${fc.supplier}`,
      fc.amount,
      `/item/${fc.id.split("-").pop()}/`,
      `${amountBasis(fc)}; original date ${fc.date}. ${federalStatement(fc)} Whole commitment, not amount paid.`,
    );
  const prof = pick(
    `SELECT sum(col1) v FROM programs WHERE fiscal_year=? AND kind='actual' AND line_type='detail' AND object='Professional Services' AND program='Physician Services'`,
    fy,
  );
  add(
    `Professional services in the Physician Services program, ${fy}`,
    prof.v,
    "/priorities/",
    "Medical Care Plan",
  );
  pins.sort((a, b) => a.amount - b.amount);
  const body = await renderAstro(ScalePage, {
    fy,
    R,
    BILLION,
    pins,
  });
  return [
    "/scale/",
    {
      title: "How big is $1 billion? Independent comparisons",
      description:
        "Separate reported values compared with CAD 1 billion. Different periods and bases; examples can overlap and are not parts of provincial spending.",
      body,
      notes,
    },
  ];
}
