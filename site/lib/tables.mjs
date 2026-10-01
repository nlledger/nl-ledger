// One server-rendered treatment for schedules and the custom financial statements.
// Only our generated table markup is handled here; cell HTML and links stay intact.
// Astro writes attribute values with only `&` and `"` escaped, so a `<` or `>` inside a quoted
// value would fool the tag regexes below (`</td><td>` in a value reads as real cells). Escape
// them in every tag's quoted values first; browsers decode them back to the same text.
const TAG = /<[a-zA-Z][^\s>\/]*(?:\s+[^\s=>\/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*\s*\/?>/g;
const QUOTED = /"[^"]*"|'[^']*'/g;
export function escapeAttributeBrackets(html) {
  return String(html)
    .split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(TAG, tag =>
            tag.replace(QUOTED, v => v.replace(/</g, "&lt;").replace(/>/g, "&gt;")),
          ),
    )
    .join("");
}

export function mobileTables(body) {
  return escapeAttributeBrackets(body).replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/g, (table, attrs, content) => {
    if (!/class="[^"]*\bsched\b/.test(attrs) || attrs.includes("data-mobile-table")) return table;
    const head = content.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] || "";
    const graphicHeaders = [...head.matchAll(/<th\b([^>]*)>/g)].map(m => m[1].includes("data-graphic-header"));
    const labels = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, "").trim());
    let primary = labels.findIndex((label, i) => i > 0 && /^(total|value|reported value|included value)$/i.test(label));
    if (primary < 0) primary = labels.findIndex((label, i) => i > 0 && /^(spent|paid|value|total|actual|amount|without competition|professional services|published pay|included value|reported value|non-competitive|severance|overtime)$/i.test(label));
    if (primary < 0) {
      const firstRow = content.match(/<tbody[^>]*>\s*<tr[^>]*>([\s\S]*?)<\/tr>/)?.[1] || "";
      const cells = [...firstRow.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/g)];
      primary = cells.findIndex((cell, i) => i > 0 && /\$|\bCAD\b/.test(cell[1]));
    }
    content = content.replace(/<(tbody|tfoot)\b([^>]*)>([\s\S]*?)<\/\1>/g, (_, group, groupAttrs, rows) => {
      const marked = rows.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g, (_, rowAttrs, cells) => {
        let index = 0;
        const row = cells.replace(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g, (_, tag, cellAttrs, value) => {
          const i = index++;
          if (i === 0) return `<${tag}${cellAttrs} role="rowheader">${value}</${tag}>`;
          const label = labels[i];
          const figure = i === primary ? ' data-main-figure' : '';
          const isGraphic = !label || graphicHeaders[i];
          const graphic = isGraphic ? ' data-graphic' : '';
          const visibleLabel = label && !isGraphic ? `<span class="cell-label" aria-hidden="true">${label}: </span>` : "";
          // Blank source values stay blank in the data; the phone gives their absence a name.
          const missing = label && !isGraphic && !value.trim() ? '<span class="cell-missing" aria-hidden="true">Not stated</span>' : '';
          return `<${tag}${cellAttrs} role="cell"${figure}${graphic}>${visibleLabel}<span class="cell-value">${value}${missing}</span></${tag}>`;
        });
        return `<tr${rowAttrs} role="row">${row}</tr>`;
      });
      return `<${group}${groupAttrs} role="rowgroup">${marked}</${group}>`;
    });
    content = content.replace(/<thead\b([^>]*)>/g, '<thead$1 role="rowgroup">')
      .replace(/(<thead[\s\S]*?)<tr>/, '$1<tr role="row">')
      .replace(/(<th\b[^>]*scope="col"[^>]*)>/g, '$1 role="columnheader">');
    return `<table${attrs} role="table" data-mobile-table>${content}</table>`;
  });
}
