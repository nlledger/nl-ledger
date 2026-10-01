import { countLine } from "../../lib/page-format.mjs";
import {
  components_PatternsIndex_astro as PatternsIndex,
  components_PatternPage_astro as PatternPage,
  components_PatternMethod_astro as PatternMethod,
} from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// Patterns: an index, a results page per flag, and a method page per flag.
import { card } from "../../lib/share-card.mjs";
import { Notes } from "../../lib/html.mjs";
import { moneyWords, num } from "../../lib/format.mjs";
import { desc } from "../seo.mjs";
// Words people search with. The pattern titles come from the pipeline; these keep the site's own wording alongside them.
const SEARCHED = {
  "no-competition": {
    note: "Provincial sole-source awards are those for which reports cite only one reasonably available supplier (clause 6(a)(v)). Federal results describe only the address-selected contract disclosures.",
    title: "Contracts awarded without competition: sole-source",
    description:
      "Reported provincial awards and selected federal contracts coded without competition. Addresses do not establish where the work or benefit occurred.",
  },
  "repeat-sole-source": {
    title: "Repeat sole-source contracts to one supplier",
  },
};
export async function flagPages(D, R) {
  const out = [];
  const cat = D.catalog;
  out.push([
    "/flags/",
    {
      card: card(
        "Patterns people ask about",
        num(cat.flags.length),
        "Patterns checked · a question, not a finding",
      ),
      title: "Sole-source contracts and other spending patterns",
      description: desc(
        `${cat.flags.length} patterns in provincial records and address-selected federal disclosures. A reported value is not expenditure in NL.`,
      ),
      body: await renderAstro(PatternsIndex, {
        cat,
        D,
      }),
    },
  ]);
  for (const f of cat.flags) {
    const notes = new Notes();
    const seo = SEARCHED[f.id];
    out.push([
      `/flags/${f.id}/`,
      {
        card: card(
          f.title,
          num(D.flagSummary[f.id]?.items || D.flagSummary[f.id]?.subjects || 0),
          `${D.flagSummary[f.id]?.items ? "Items matched" : "Groups found"} · all included years\nA question, not a finding`,
        ),
        title: seo?.title || f.title,
        description: desc(
          seo?.description ||
            `${f.short} ${countLine(D, f)}. Each is linked to its source: a question, not a finding.`,
        ),
        body: await renderAstro(PatternPage, {
          f,
          seo,
          cat,
          D,
        }),
        notes,
      },
    ]);
    out.push([
      `/method/${f.id}/`,
      {
        card: card(
          `Method: ${f.title}`,
          num(f.how.length),
          "Steps in the published method · a question, not a finding",
        ),
        title: `Method: ${f.title}`,
        description: desc(
          `Method for "${f.title.toLowerCase()}": how it is counted and what it cannot tell you. ${f.short}`,
        ),
        body: await renderAstro(PatternMethod, {
          f,
          cat,
        }),
      },
    ]);
  }
  return out;
}
