// Compensation figures consumed by both the pay pages and MCP build output.
import { payIssues } from "./pay-coverage.mjs";
export const PAY_CAVEAT =
  "Only published compensation above $100,000 is included, not the employer's entire payroll. Amounts are rounded to $100 by the publisher. Missing years are not zero people or zero pay. A rise in names does not establish a rise in salaries.";
export function payData(D) {
  const emp = D.q(
    `SELECT buyer, count(*) n, sum(amount) amount, group_concat(DISTINCT substr(fiscal_year,10)) yrs FROM items WHERE dataset='sunshine' GROUP BY buyer ORDER BY amount DESC`,
  );
  const loadedYears = D.q(
    "SELECT DISTINCT substr(fiscal_year,10) y FROM items WHERE dataset='sunshine' ORDER BY y",
  ).map((r) => Number(r.y));
  const years = Array.from(
    { length: Math.max(...loadedYears) - Math.min(...loadedYears) + 1 },
    (_, i) => String(Math.min(...loadedYears) + i),
  );
  const latest = years[years.length - 1];
  const grid = new Map();
  for (const r of D.q(
    "SELECT buyer, substr(fiscal_year,10) y, count(*) n, sum(amount) a FROM items WHERE dataset='sunshine' GROUP BY buyer, y",
  )) {
    (grid.get(r.buyer) || grid.set(r.buyer, {}).get(r.buyer))[r.y] = r;
  }
  const employers = emp.map((e) => {
    const perYear = years.filter((y) => grid.get(e.buyer)?.[y]);
    const missing = years.filter((y) => !grid.get(e.buyer)?.[y]);
    const failures = payIssues(D.issues, e.buyer).filter((i) =>
      missing.includes(i.year),
    );
    const coverage = missing.map((year) => ({
      year,
      issue: failures.find((i) => i.year === year),
    }));
    const top = D.q(
      `SELECT * FROM items WHERE dataset='sunshine' AND buyer=? AND fiscal_year=? ORDER BY amount DESC LIMIT 100`,
      e.buyer,
      `calendar ${perYear[perYear.length - 1]}`,
    );
    const titlesByYear = Object.fromEntries(
      perYear.map((year) => [
        year,
        D.q(
          `SELECT description, count(*) n, sum(amount) a, avg(amount) avg FROM items WHERE dataset='sunshine' AND buyer=? AND fiscal_year=? GROUP BY description ORDER BY n DESC LIMIT 15`,
          e.buyer,
          `calendar ${year}`,
        ),
      ]),
    );
    const titles = titlesByYear[perYear.at(-1)];
    const src = D.q(
      `SELECT DISTINCT substr(fiscal_year,10) y, source_url FROM items WHERE dataset='sunshine' AND buyer=? ORDER BY y`,
      e.buyer,
    );
    const bh = D.keyHash(
      D.one(
        "SELECT buyer_key k FROM items WHERE dataset='sunshine' AND buyer=? LIMIT 1",
        e.buyer,
      ).k,
    );
    const components = D.q(
      `SELECT substr(fiscal_year,10) y, sum(json_extract(extra,'$.overtime')) overtime, sum(json_extract(extra,'$.severance')) severance FROM items WHERE dataset='sunshine' AND buyer=? GROUP BY y`,
      e.buyer,
    );
    return {
      ...e,
      perYear,
      missing,
      failures,
      coverage,
      top,
      titles,
      titlesByYear,
      src,
      bh,
      components,
    };
  });
  return { emp, loadedYears, years, latest, grid, employers };
}
export function payJSON(D) {
  const P = payData(D);
  return {
    years: P.years,
    caveat: PAY_CAVEAT,
    employers: P.employers.map((e) => ({
      employer: e.buyer,
      page_url: `/pay/${D.slug(e.buyer)}/`,
      latest_year: e.perYear.at(-1),
      by_year: P.years.map((year) => {
        const g = P.grid.get(e.buyer)?.[year];
        const c = e.components.find((x) => x.y === year);
        return {
          year,
          status: g ? "published" : "not available",
          people: g?.n ?? null,
          total_cad: g?.a ?? null,
          overtime_cad: c?.overtime ?? null,
          severance_cad: c?.severance ?? null,
          sources: e.src.filter((x) => x.y === year).map((x) => x.source_url),
          missing_reason: g
            ? null
            : e.failures.find((x) => x.year === year) ||
              "No list loaded; reason not established",
        };
      }),
      titles: e.titles.map((t) => ({
        title: t.description,
        people: t.n,
        total_cad: t.a,
        average_cad: t.avg,
      })),
      title_year: e.perYear.at(-1),
      titles_by_year: Object.fromEntries(
        Object.entries(e.titlesByYear).map(([year, titles]) => [
          year,
          titles.map((t) => ({
            title: t.description,
            people: t.n,
            total_cad: t.a,
            average_cad: t.avg,
          })),
        ]),
      ),
    })),
  };
}
