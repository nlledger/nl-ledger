import { components_ConnectBody_astro as ConnectBody } from "../../.render/components.mjs";
import { renderAstro } from "../../lib/render.mjs";
// /data/: connect your own AI assistant to the records, ask it something, and see what it gets back.

import { num } from "../../lib/format.mjs";
import { desc, datasetLd, LICENSE } from "../seo.mjs";
// A copyable block: a label, the text, and a Copy button (the button works with JavaScript; the text is selectable without it).

export async function connectPage(D, R) {
  const groups = [
    ["chat", "Chat apps"],
    ["code", "Coding tools"],
  ];
  const body = await renderAstro(ConnectBody, {
    R,
    groups,
  });
  return [
    "/data/",
    {
      title: "Ask your AI",
      description: desc(
        `Connect Claude, ChatGPT or another AI assistant to ${num(R.itemCount)} Newfoundland and Labrador spending records. Free, read-only, no sign-in.`,
      ),
      body,
      jsonld: [
        datasetLd({
          name: "Provincial accounts and federal records linked to NL addresses",
          description: `${num(R.itemCount)} public spending records (provincial contract awards, minister and MHA expenses, public sector pay over $100,000, department and program spending, federal records selected by reported addresses; addresses do not locate work or benefits), each linked to its source, with summary files and an MCP server for AI assistants.`,
          path: "/data/",
          license: [LICENSE.provincial, LICENSE.federal],
          files: [
            "/data/departments.json",
            "/data/members.json",
            "/data/flag_results.json",
          ],
        }),
      ],
    },
  ];
}
