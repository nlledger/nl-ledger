import {
  components_PublicBodyPage_astro as PublicBodyPage,
  components_BodiesIndex_astro as BodiesIndex,
  components_FederalPage_astro as FederalPage,
  components_SmallPurchasesPage_astro as SmallPurchasesPage,
} from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// A page per buyer: provincial public bodies from the award reports, federal departments,
// and the two towns. Plus the federal overview and the small-purchases page.
import { card, organisationCard } from "../../lib/share-card.mjs";
import { Notes } from "../../lib/html.mjs";
import { moneyWords, num, pct, date as fmtDate } from "../../lib/format.mjs";
import { desc, datasetLd, orgPageLd, LICENSE } from "../seo.mjs";
import { FEDERAL_RULE } from "../../lib/federal.mjs";
import { bodyList, bodyData } from "../bodydata.mjs";
export async function bodies(D, R) {
  const out = [];
  const list = bodyList(D);
  for (const b of list) {
    const notes = new Notes();
    const slug = D.slug(b.buyer);
    const sets = b.ds.split(",");
    const { byDs, top, recent, methods, suppliers, byYear } = bodyData(D, b);
    const mmax = Math.max(...methods.map((m) => m.amount || 0), 1);
    const smax = suppliers[0]?.amount || 1;
    const subjectFlags = D.flagRows.filter(
      (f) => f.subject_type === "buyer" && f.subject_key === b.buyer_key,
    );
    const ymax = Math.max(...byYear.map((y) => y.amount || 0), 1);
    const dept = D.years
      .flatMap((y) => D.deptYear[y])
      .find(
        (d) =>
          D.slug(d.name) === D.slug(b.buyer.replace(/^Department of /, "")),
      );
    const flagNotes = subjectFlags.map((f) => {
      const x = JSON.parse(f.detail || "{}");
      const cat = D.flagById[f.flag];
      if (f.flag === "no-competition")
        return `${pct(f.value)} of the reported values in ${x.source === "ppa" ? "its reported provincial awards" : "its selected federal contracts with suppliers listing an NL postal code"} were coded as awarded without open competition (${num(x.exception_awards)} of ${num(x.awards)} records).`;
      if (f.flag === "year-end")
        return `${pct(x.last_month_amount / x.amount)} of its dated ${x.source === "paradise" ? "payments" : "awards"} by value fell in the last month of the fiscal year, ${f.value.toFixed(1)} times an even share.`;
      if (f.flag === "dominant-supplier")
        return `${x.supplier} appears on ${pct(f.value)} of its reported award values.`;
      return cat?.title || f.flag;
    });
    const body = await renderAstro(PublicBodyPage, {
      b,
      sets,
      dept,
      D,
      byDs,
      flagNotes,
      subjectFlags,
      methods,
      mmax,
      byYear,
      ymax,
      suppliers,
      smax,
      top,
      recent,
    });
    const what =
      b.level === "federal"
        ? "federal contracts and grants"
        : b.level === "municipal"
          ? "published record values"
          : "contract awards";
    out.push([
      `/body/${slug}/`,
      {
        card: organisationCard(
          b.buyer,
          num(b.n),
          b.level === "federal"
            ? "NL-address-selected records\nAddresses do not locate work or benefits."
            : "Published records · all years\nSources can overlap; records are not payments.",
        ),
        title: `${b.buyer}: contracts, grants and payments`,
        description:
          b.level === "federal"
            ? `${b.buyer}: NL-address-selected records. Addresses do not locate work or benefits.`
            : desc(
                `${b.buyer}: ${num(b.n)} records, ${moneyWords(b.amount || 0)} in ${what}. Biggest suppliers, and the source of each record.`,
              ),
        body,
        notes,
        jsonld: [
          orgPageLd({
            name: b.buyer,
            path: `/body/${slug}/`,
            description: `Public body in the records: ${num(b.n)} contracts, grants and payments.`,
          }),
        ],
      },
    ]);
  }

  // index
  const groups = [
    ["Provincial public bodies", list.filter((b) => b.ds.includes("ppa"))],
    [
      "Federal departments and agencies",
      list.filter((b) => !b.ds.includes("ppa") && b.level === "federal"),
    ],
    ["Towns and cities", list.filter((b) => b.level === "municipal")],
  ].filter(([, rows]) => rows.length);
  const body = await renderAstro(BodiesIndex, {
    groups,
    D,
  });
  out.push([
    "/bodies/",
    {
      card: card(
        "Public bodies",
        num(list.length),
        "Departments and agencies in the records",
      ),
      title: "Government departments and agencies in the records",
      description: desc(
        `Every department, agency, health authority and federal department in the records: ${num(list.length)} public bodies, each with its contracts and grants.`,
      ),
      body,
    },
  ]);
  out.push(await federal(D, R));
  if (D.one("SELECT count(*) n FROM items WHERE dataset='paradise'").n)
    out.push(await smallPurchases(D, R));
  return out;
}
async function federal(D, R) {
  const notes = new Notes();
  const F = D.federal;
  const c = F.contracts;
  const g = F.grants;
  const citeC = notes.cite({
    url: "https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b",
    label:
      "Proactive disclosure of contracts over $10,000 (open.canada.ca), vendors reporting a Canadian NL postal code, one row per contract after amendments",
  });
  const citeG = notes.cite({
    url: "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
    label:
      "Proactive disclosure of grants and contributions (open.canada.ca), recipient province NL, one row per agreement after amendments",
  });
  const deps = D.q(
    `SELECT (SELECT buyer FROM buyers WHERE buyers.buyer_key = items.buyer_key) buyer, count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) amount, sum(CASE WHEN currency='CAD' AND method='Non-competitive' THEN amount ELSE 0 END) nc FROM items WHERE dataset='fed_contract' GROUP BY buyer_key ORDER BY amount DESC LIMIT 15`,
  );
  const gdeps = D.q(
    `SELECT (SELECT buyer FROM buyers WHERE buyers.buyer_key = items.buyer_key) buyer, count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) amount FROM items WHERE dataset='fed_grant' GROUP BY buyer_key ORDER BY amount DESC LIMIT 15`,
  );
  const mtp = Object.entries(F.public_accounts.mtp_2024_25)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const body = await renderAstro(FederalPage, {
    c,
    citeC,
    g,
    citeG,
    D,
    deps,
    gdeps,
    mtp,
  });
  return [
    "/federal/",
    {
      title: "Federal records linked to NL suppliers and recipients",
      description:
        "Federal records selected by reported NL addresses, including labelled conflicts. Whole reported values; addresses do not locate work, benefits or spending.",
      body,
      notes,
      jsonld: [
        datasetLd({
          name: "Federal records linked to NL suppliers and recipients",
          description: FEDERAL_RULE,
          path: "/federal/",
          license: LICENSE.federal,
          publishers: [
            {
              name: "Proactive disclosure of contracts over $10,000",
              url: "https://open.canada.ca/data/en/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b",
            },
            {
              name: "Proactive disclosure of grants and contributions",
              url: "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
            },
          ],
        }),
      ],
    },
  ];
}
async function smallPurchases(D, R) {
  const notes = new Notes();
  const p = D.one(
    "SELECT count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) amount, min(date) d0, max(date) d1 FROM items WHERE dataset='paradise'",
  );
  const under1k = D.one(
    "SELECT count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) amount FROM items WHERE dataset='paradise' AND amount < 1000",
  ).n;
  const amounts = D.q(
    "SELECT amount FROM items WHERE dataset='paradise' AND amount > 0 ORDER BY amount",
  ).map((r) => r.amount);
  const median = amounts[Math.floor(amounts.length / 2)];
  const vendors = D.q(
    "SELECT supplier, supplier_key, count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) amount FROM items WHERE dataset='paradise' GROUP BY supplier_key ORDER BY amount DESC LIMIT 15",
  );
  const months = D.q(
    "SELECT substr(date,1,7) m, sum(CASE WHEN currency='CAD' THEN amount END) amount, count(*) n FROM items WHERE dataset='paradise' AND date >= '2023-01' GROUP BY m ORDER BY m",
  );
  const mmax = Math.max(...months.map((m) => m.amount));
  const sj = D.one(
    "SELECT count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) amount, sum(json_extract(extra,'$.payee_withheld')) w FROM items WHERE dataset='stjohns'",
  );
  const sjTop = D.q(
    "SELECT * FROM items WHERE dataset='stjohns' ORDER BY amount DESC LIMIT 15",
  );
  const citeP = notes.cite({
    url: "https://www.paradise.ca/government-engage/cheque-register/",
    label: "Town of Paradise, cheque and payment registers, monthly PDFs",
  });
  const body = await renderAstro(SmallPurchasesPage, {
    p,
    citeP,
    median,
    under1k,
    months,
    mmax,
    vendors,
    D,
    sj,
    sjTop,
  });
  return [
    "/small-purchases/",
    {
      title: "Small purchases: every Town of Paradise payment",
      description: desc(
        `The Town of Paradise publishes every payment: ${num(p.n)} payments from ${fmtDate(p.d0)} to ${fmtDate(p.d1)}, ${pct(under1k / p.n)} of them under $1,000. The province publishes none.`,
      ),
      body,
      notes,
    },
  ];
}
