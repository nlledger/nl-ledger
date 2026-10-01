import { components_ConsultingBody_astro as ConsultingBody } from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// Consulting and professional services: what the province and Ottawa pay for outside expertise.
// Built from the "Professional Services" account in the province's program report and the federal
// Public Accounts payments to suppliers in the province, so the page answers "how much does the
// government spend on consultants" directly instead of leaving it to a search box.
import { Notes } from "../../lib/html.mjs";
import { moneyWords } from "../../lib/format.mjs";
import { desc } from "../seo.mjs";
export async function consulting(D, R) {
  const notes = new Notes();
  const fy = R.year;
  const Q = `FROM programs WHERE kind='actual' AND line_type='detail' AND object='Professional Services'`;
  const byYear = D.q(
    `SELECT fiscal_year y, sum(col1) v ${Q} GROUP BY fiscal_year ORDER BY fiscal_year`,
  );
  const latest = byYear.find((r) => r.y === fy) || byYear[byYear.length - 1];
  const byDept = D.q(
    `SELECT department, sum(col1) v, min(page) page, source_url ${Q} AND fiscal_year=? GROUP BY department ORDER BY v DESC LIMIT 15`,
    latest.y,
  );
  const byProg = D.q(
    `SELECT department, program, sum(col1) v, min(page) page, source_url ${Q} AND fiscal_year=? GROUP BY department, program ORDER BY v DESC LIMIT 15`,
    latest.y,
  );
  const fed = D.q(
    `SELECT fiscal_year y, count(*) n, sum(amount) v FROM items WHERE dataset='pa_pss' GROUP BY fiscal_year ORDER BY fiscal_year`,
  );
  const src = byDept[0];
  const cite = notes.cite({
    url: src.source_url,
    label: `Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund ${latest.y}, object "Professional Services", all programs`,
  });
  const vmax = Math.max(...byYear.map((r) => r.v), 1);
  const body = await renderAstro(ConsultingBody, {
    latest,
    cite,
    byYear,
    vmax,
    byDept,
    D,
    byProg,
    fed,
  });
  return [
    "/consulting/",
    {
      title: "Government consultants and professional services spending",
      description: desc(
        `The Newfoundland and Labrador government spent ${moneyWords(latest.v)} on professional services, its account for consultants and outside experts, in ${latest.y}. By department and program.`,
      ),
      body,
      notes,
    },
  ];
}
