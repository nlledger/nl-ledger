import { renderComponent } from "../../lib/render.mjs";
// Public sector pay over $100,000 (the compensation disclosure lists), by employer and year.
// No page per person: the lists are shown the way the government publishes them.
import { card, cardAmount, organisationCard } from "../../lib/share-card.mjs";
import {
  esc,
  html,
  icon,
  Notes,
  schedule,
  receipt,
  bar,
  leaders,
} from "../../lib/html.mjs";
import { money, moneyWords, num, pct } from "../../lib/format.mjs";
import { desc, clip, datasetLd, LICENSE } from "../seo.mjs";
import { pagehead, caveat } from "../common.mjs";
import { payData } from "../paydata.mjs";

export async function pay(D, R) {
  const out = [];
  const { emp, years, latest, grid, employers } = payData(D);
  const grp = (f) =>
    D.flagRows
      .filter((r) => r.flag === f && !r.item_id)
      .map((r) => JSON.parse(r.detail));
  const otPeople = grp("overtime-over-base").reduce((s, x) => s + x.people, 0);
  const otAmt = grp("overtime-over-base").reduce((s, x) => s + x.overtime, 0);
  const sevPeople = grp("severance").reduce((s, x) => s + x.people, 0);
  const sevAmt = grp("severance").reduce((s, x) => s + x.severance, 0);
  const broken = D.issues.filter((i) => i.source === "Compensation disclosure");
  const idx = await renderComponent("components_PayIndex_astro", {
    pagehead,
    num,
    grid,
    latest,
    esc,
    otPeople,
    moneyWords,
    otAmt,
    sevAmt,
    sevPeople,
    broken,
    schedule,
    years,
    emp,
    D,
  });
  const latestN = [...grid.values()].reduce(
    (t, g) => t + (g[latest]?.n || 0),
    0,
  );
  out.push([
    "/pay/",
    {
      card: card(
        "Public sector pay over $100,000",
        num(latestN),
        `People on the published lists · ${latest}\nOnly disclosed pay over $100,000; missing lists excluded.`,
      ),
      title: "NL sunshine list: public sector pay over $100,000",
      description: desc(
        `Newfoundland and Labrador's sunshine list for ${latest}: ${num(latestN)} public employees paid over $100,000, by employer, with job titles, overtime and severance.`,
      ),
      body: idx,
      jsonld: [
        datasetLd({
          name: "Newfoundland and Labrador public sector compensation over $100,000 (sunshine list)",
          description:
            "Every public employee paid more than $100,000 in a calendar year, by employer, as disclosed under the Public Sector Compensation Transparency Act.",
          path: "/pay/",
          license: LICENSE.provincial,
          period: `${years[0]}/${latest}`,
          publishers: [
            {
              name: "Compensation disclosure, Treasury Board Secretariat",
              url: "https://www.gov.nl.ca/exec/tbs/home/publications/compensation-disclosure/",
            },
          ],
        }),
      ],
    },
  ]);

  for (const e of emp) {
    const notes = new Notes();
    const { perYear, missing, failures, coverage, top, titles, src, bh } =
      employers.find((x) => x.buyer === e.buyer);
    const body = await renderComponent("components_EmployerPayPage_astro", {
      pagehead,
      e,
      esc,
      perYear,
      src,
      coverage,
      schedule,
      years,
      grid,
      num,
      moneyWords,
      titles,
      money,
      top,
      bh,
      icon,
    });
    const ly = perYear[perYear.length - 1];
    const g = grid.get(e.buyer)[ly];
    out.push([
      `/pay/${D.slug(e.buyer)}/`,
      {
        card: organisationCard(
          e.buyer,
          cardAmount(g.a),
          `Published pay over $100,000 · ${ly}\nDisclosed compensation only; not the whole payroll.`,
        ),
        title: `${clip(e.buyer, 38)} salaries over $100,000, ${ly}`,
        description: desc(
          `${num(g.n)} ${e.buyer} employees paid over $100,000 in ${ly}, ${moneyWords(g.a)} in all. Job titles, overtime and the highest paid, from the sunshine list.`,
        ),
        body,
        notes,
        jsonld: [
          datasetLd({
            name: `${e.buyer}: employees paid over $100,000, ${perYear[0]} to ${ly}`,
            description: `Public employees of ${e.buyer} paid more than $100,000 in a calendar year, from the compensation disclosure lists.`,
            path: `/pay/${D.slug(e.buyer)}/`,
            license: LICENSE.provincial,
            period: `${perYear[0]}/${ly}`,
            publishers: src.map((x) => ({
              name: `${e.buyer} compensation disclosure, ${x.y}`,
              url: x.source_url,
            })),
          }),
        ],
      },
    ]);
  }
  return out;
}
