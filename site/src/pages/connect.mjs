import { renderComponent } from "../../lib/render.mjs";
// /data/: connect your own AI assistant to the records, ask it something, and see what it gets back.
import { esc, html, icon, schedule } from "../../lib/html.mjs";
import { num, SITE } from "../../lib/format.mjs";
import { TOOLS } from "../../lib/mcp.mjs";
import { desc, datasetLd, LICENSE } from "../seo.mjs";
import { pagehead, caveat } from "../common.mjs";
import {
  MCP_URL,
  CLIENTS,
  MORE,
  QUESTIONS,
  askClaude,
  askChatGPT,
  asked,
} from "../connect.mjs";

const VERIFIED = {
  tested:
    "Tested on 29 September 2026: it connected and answered questions from the records.",
  seen: "",
  docs: "",
};

// A copyable block: a label, the text, and a Copy button (the button works with JavaScript; the text is selectable without it).
export async function copyBlock(label, text, { inline = false } = {}) {
  const body = inline
    ? esc(text)
    : esc(text)
        .replaceAll(
          `&quot;${MCP_URL}&quot;`,
          `<span class="nobr">&quot;${MCP_URL}&quot;</span>`,
        )
        .replaceAll(
          new RegExp(
            `(?<!>&quot;)${MCP_URL.replaceAll(".", "\\.")}(?!&quot;<)`,
            "g",
          ),
          (u) => `<span class="nobr">${u}</span>`,
        );
  return await renderComponent("components_ConnectCopyBlock_astro", {
    inline,
    label,
    body,
    icon,
  });
}

function actionButton(a) {
  return html`<p class="client-act">
    <a
      class="btn solo"
      href="${esc(a.href)}"
      ${a.app ? "" : ' target="_blank" rel="noopener"'}${a.copies ? ` data-copy-open="${esc(a.copies)}"` : ""}
      >${icon(a.app ? "plug" : "out")}${esc(a.label)}</a
    >${a.app ? `<span class="small muted">Opens the app if it is installed on this computer.</span>` : ""}
  </p>`;
}

async function clientPanel(c) {
  const at = c.action ? (c.action.after ?? c.steps.length) : -1;
  const step = (s) =>
    typeof s === "string"
      ? esc(s)
      : `${esc(s.text)}<span class="step-dl"><a class="btn ghost" href="${esc(s.download.href)}" download>${icon("out")}${esc(s.download.label)}</a></span>`;
  const list = (steps, start) =>
    steps.length
      ? `<ol class="steps"${start > 1 ? ` start="${start}"` : ""}>${steps.map((s) => `<li>${step(s)}</li>`).join("")}</ol>`
      : "";
  // Chat apps: address first, then the button, then the steps. Coding tools: button, steps, then the config to copy.
  const chat = c.group === "chat";
  return await renderComponent("components_ConnectClientPanel_astro", {
    c,
    esc,
    chat,
    copyBlock,
    at,
    actionButton,
    list,
    icon,
    VERIFIED,
  });
}

export async function connectPage(D, R) {
  const groups = [
    ["chat", "Chat apps"],
    ["code", "Coding tools"],
  ];
  const body = await renderComponent("components_ConnectBody_astro", {
    pagehead,
    num,
    R,
    html,
    copyBlock,
    MCP_URL,
    groups,
    CLIENTS,
    esc,
    clientPanel,
    SITE,
    MORE,
    schedule,
    QUESTIONS,
    asked,
    icon,
    askClaude,
    askChatGPT,
    TOOLS,
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
