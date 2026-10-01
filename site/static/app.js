// Small enhancements. Every page works without this file.
(() => {
  const root = document.documentElement;

  // Theme toggle: follows the system until the reader picks one.
  const btn = document.querySelector("[data-theme-toggle]");
  if (btn) {
    const systemTheme = matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : systemTheme.matches;
      btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    };
    btn.hidden = false;
    syncTheme();
    systemTheme.addEventListener("change", syncTheme);
    btn.addEventListener("click", () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      root.dataset.theme = next;
      syncTheme();
      try {
        localStorage.setItem("theme", next);
      } catch (e) {}
    });
  }

  // Phone navigation is a non-modal native disclosure: no scroll lock or focus trap.
  const menu = document.querySelector("[data-menu]");
  if (menu) {
    const trigger = menu.querySelector("summary");
    const panel = menu.querySelector("nav");
    const narrow = matchMedia("(max-width: 59.999rem)");
    const sync = () => trigger.setAttribute("aria-expanded", String(menu.open));
    const size = () => {
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : innerHeight;
      panel.style.setProperty("--menu-space", `${Math.max(0, bottom - document.querySelector(".mast").getBoundingClientRect().bottom)}px`);
    };
    const close = (restore = true) => {
      if (!menu.open) return;
      menu.open = false;
      sync();
      if (restore) trigger.focus({ preventScroll: true });
    };
    sync();
    menu.addEventListener("toggle", () => { sync(); if (menu.open) size(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.open) { event.preventDefault(); close(); }
    });
    let outsidePress = false;
    document.addEventListener("pointerdown", (event) => {
      outsidePress = menu.open && !menu.contains(event.target);
    });
    document.addEventListener("pointercancel", () => { outsidePress = false; });
    document.addEventListener("click", (event) => {
      if (menu.open && !menu.contains(event.target)) close();
      outsidePress = false;
    });
    panel.addEventListener("click", (event) => {
      if (event.target.closest("a")) close();
    });
    // Tabbing onward leaves the document in its normal order, with no covered focus.
    document.addEventListener("focusin", (event) => {
      if (menu.open && !outsidePress && !menu.contains(event.target)) close(false);
    });
    const resize = () => {
      if (!narrow.matches) close(false);
      else if (menu.open) size();
    };
    addEventListener("resize", resize);
    addEventListener("scroll", () => { if (menu.open) size(); }, { passive: true });
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    addEventListener("pagehide", () => close(false));
    addEventListener("pageshow", () => { close(false); sync(); });
    addEventListener("popstate", () => close());
  }

  // Native table scrolling, with persistent row labels and a keyboard scrollport.
  for (const [index, wrap] of [...document.querySelectorAll(".sched-wrap")].entries()) {
    const table = wrap.querySelector("table");
    const hint = wrap.previousElementSibling;
    if (!table || !hint?.classList.contains("sched-hint")) continue;
    hint.id = `schedule-hint-${index}`;
    if (table.classList.contains("pin-rows")) {
      for (const cell of table.querySelectorAll("tr > :first-child")) {
        const label = document.createElement("span");
        label.className = "row-label";
        label.append(...cell.childNodes);
        cell.append(label);
      }
    }
    const update = () => {
      // Phones always get records. Between phone and tablet, switch each table
      // at its own natural width, including every previously hidden column.
      wrap.classList.remove("is-overflowing");
      if (table.hasAttribute("data-mobile-table")) {
        const phone = matchMedia("(max-width: 40rem)").matches;
        if (phone && innerWidth > 430) {
          table.setAttribute("data-table-fits", "");
          table.setAttribute("data-measuring", "");
          const fits = wrap.scrollWidth <= wrap.clientWidth + 1;
          table.removeAttribute("data-measuring");
          table.toggleAttribute("data-table-fits", fits);
        } else {
          table.removeAttribute("data-table-fits");
        }
      }
      const cards = getComputedStyle(table).display === "block";
      const overflow = !cards && wrap.scrollWidth > wrap.clientWidth + 1;
      wrap.classList.toggle("is-overflowing", overflow);
      hint.hidden = !overflow;
      if (overflow) {
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "region");
        wrap.setAttribute("aria-label", table.caption?.textContent.trim() || [...table.querySelectorAll("thead th")].map(th => th.textContent.trim()).filter(Boolean).join(", "));
        wrap.setAttribute("aria-describedby", hint.id);
      } else {
        wrap.removeAttribute("tabindex");
        wrap.removeAttribute("role");
        wrap.removeAttribute("aria-label");
        wrap.removeAttribute("aria-describedby");
      }
    };
    new ResizeObserver(update).observe(wrap);
    document.addEventListener("toggle", update, true);
    document.fonts.ready.then(update);
    update();
  }

  // Live receipt: recompute in the browser as the income changes.
  const out = document.querySelector("[data-receipt-out]");
  const forms = document.querySelectorAll("[data-receipt-form]");
  if (out && forms.length) {
    let ready;
    const prepare = () => ready ||= Promise.all([
      fetch("/data/receipt.json").then((r) => { if (!r.ok) throw new Error("Receipt unavailable"); return r.json(); }),
      fetch("/data/stats.json").then((r) => { if (!r.ok) throw new Error("Statistics unavailable"); return r.json(); }),
      import("/lib/receipt.mjs"),
    ]);
    let revision = 0;
    for (const form of forms) {
      const input = form.querySelector("input[name=income]");
      const error = form.querySelector("[data-receipt-error]");
      let timer;
      const clearError = () => {
        input.removeAttribute("aria-invalid");
        error.hidden = true;
        error.textContent = "";
      };
      const update = async (submitted = false) => {
        const current = ++revision;
        const cleaned = input.value.replace(/[\s,$]/g, "");
        if (!/^\d{1,8}(\.\d{0,2})?$/.test(cleaned)) {
          input.setAttribute("aria-invalid", "true");
          error.hidden = false;
          error.textContent = "Enter an amount in dollars, for example 55000. The receipt has not been updated.";
          if (submitted) input.focus();
          return;
        }
        clearError();
        try {
          const [r, stats, module] = await prepare();
          if (current !== revision) return;
          out.innerHTML = module.renderReceipt(r, Math.min(10000000, Math.floor(Number(cleaned))), stats);
          for (const other of forms) {
            if (other === form) continue;
            other.querySelector("input[name=income]").value = input.value;
            other.querySelector("input[name=income]").removeAttribute("aria-invalid");
            const message = other.querySelector("[data-receipt-error]");
            message.hidden = true;
            message.textContent = "";
          }
          const sec = document.getElementById("receipt");
          if (submitted && sec && !sec.contains(form)) sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        } catch {
          if (current !== revision) return;
          if (submitted) form.submit();
          else {
            error.hidden = false;
            error.textContent = "The receipt has not been updated. Press the button to load it as a page.";
          }
        }
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        clearTimeout(timer);
        update(true);
      });
      input.addEventListener("focus", () => { prepare().catch(() => {}); }, { once: true });
      input.addEventListener("input", () => {
        ++revision;
        clearTimeout(timer);
        timer = setTimeout(() => update(), 180);
      });
    }
  }
})();

// Ask your AI: copy buttons, the assistant picker, and the live "try it here" panel.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- copy to clipboard, with a fallback for browsers without the async API
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;inset-block-start:-100px;opacity:0";
      document.body.append(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) {}
      t.remove();
      return ok;
    }
  }
  function flash(btn, ok) {
    const label = btn.querySelector("span");
    const was = label.dataset.was || label.textContent;
    label.dataset.was = was;
    label.textContent = ok ? "Copied" : "Select and copy";
    btn.classList.toggle("is-done", ok);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      label.textContent = was;
      btn.classList.remove("is-done");
    }, 2000);
  }
  for (const btn of document.querySelectorAll("[data-copy], [data-copy-text]")) {
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copyText ?? btn.closest(".copy").querySelector("pre").textContent;
      flash(btn, await copyText(text));
    });
  }

  // Buttons that open an assistant also copy the address, so it is ready to paste there.
  for (const a of document.querySelectorAll("[data-copy-open]")) {
    a.addEventListener("click", () => {
      copyText(a.dataset.copyOpen);
    });
  }

  // ---- the picker: one assistant at a time; the hash (#claude) and the last choice select it
  const picker = document.querySelector("[data-picker]");
  if (picker) {
    const panels = [...document.querySelectorAll("[data-client]")];
    const picks = [...picker.querySelectorAll("[data-pick]")];
    const ids = panels.map((p) => p.dataset.client);
    document.querySelector(".clients").classList.add("is-tabbed");
    const select = (id, { scroll = false, remember = true } = {}) => {
      if (!ids.includes(id)) id = ids[0];
      for (const p of panels) p.hidden = p.dataset.client !== id;
      for (const a of picks) a.setAttribute("aria-current", a.dataset.pick === id ? "true" : "false");
      if (remember) try { localStorage.setItem("ai-client", id); } catch (e) {}
      if (scroll) document.getElementById(id).scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
    };
    let saved = null;
    try { saved = localStorage.getItem("ai-client"); } catch (e) {}
    const fromHash = () => location.hash.slice(1);
    select(ids.includes(fromHash()) ? fromHash() : saved || "claude", { remember: false });
    for (const a of picks) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        select(a.dataset.pick, { scroll: true });
        history.replaceState(null, "", `#${a.dataset.pick}`);
      });
    }
    addEventListener("hashchange", () => ids.includes(fromHash()) && select(fromHash(), { scroll: true }));
  }

  // ---- try it here: one call to the live MCP server per press, never on load
  const box = document.querySelector("[data-try]");
  if (box) {
    box.hidden = false;
    const form = box.querySelector("[data-try-form]");
    const out = box.querySelector("[data-try-out]");
    const tool = form.elements.tool;
    const arg = form.elements.arg;
    const argLabel = form.querySelector('label[for="try-arg"]');
    const LABELS = { query: "Words", name: "Company or recipient", category: "Kind of spending", amount: "Amount in dollars" };
    const opt = () => tool.selectedOptions[0];
    const hint = box.querySelector("[data-try-hint]");
    tool.addEventListener("change", () => {
      argLabel.textContent = LABELS[opt().dataset.arg];
      hint.textContent = opt().dataset.hint || "";
      arg.value = opt().dataset.ph;
      arg.inputMode = opt().dataset.arg === "amount" ? "numeric" : "text";
    });
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const $ = (v) => (v == null ? "" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v).replace("CA", ""));
    const safe = (u) => (/^https?:\/\//.test(u || "") ? esc(u) : "#");
    const rec = (r) => `<li><span>${esc(r.supplier || r.person || r.buyer || "")}${r.description ? ` · ${esc(r.description)}` : ""}</span><span class="amt">${$(r.amount_cad)}</span>
      <span class="meta">${esc(r.source)}${r.buyer && r.supplier ? `, ${esc(r.buyer)}` : ""}${r.date ? `, ${esc(r.date)}` : ""} · <a href="${safe(r.source_url)}" rel="noopener">source</a> · <a href="${safe(r.page_url)}">record</a></span></li>`;

    function readable(name, d) {
      if (d.error) {
        const m = d.close_matches;
        return `<p class="try-err"><strong>The server says:</strong> ${esc(d.error)}</p>${m ? `<p class="small">Close matches, as your assistant would see them:</p><div class="chipbtns">${m.map((x) => `<button type="button" data-sid="${esc(x.supplier_id)}">${esc(x.name)}</button>`).join("")}</div>` : ""}${d.next_step ? `<p class="small muted">${esc(d.next_step)}</p>` : ""}`;
      }
      if (name === "search_records") {
        if (!d.records?.length) return `<p>${esc(d.note || "Nothing matched.")}</p>`;
        return `<h3>${d.records_found} records${d.truncated ? ", largest first" : ""}</h3><ul class="try-list">${d.records.slice(0, 8).map(rec).join("")}</ul>${d.records_found > 8 ? `<p class="small muted">Showing 8. Your assistant gets ${d.records.length} per page and can ask for more.</p>` : ""}`;
      }
      if (name === "get_supplier") {
        return `<h3>${esc(d.name)}: ${$(d.total_cad)}</h3><p class="small">${d.records} records. ${esc(d.human_scale?.per_resident)} per resident.</p><ul class="try-list">${d.largest_records.slice(0, 6).map(rec).join("")}</ul>`;
      }
      if (name === "get_members") {
        return `<h3>${esc(d.fiscal_year)}: average ${$(d.average_cad)}</h3><p class="small muted">${esc(Array.isArray(d.categories) ? d.categories.join("; ") : d.categories)}</p><ul class="try-list">${d.ranking.slice(0, 8).map((m) => `<li><span>${esc(m.name)}</span><span class="amt">${$(m.amount_cad)}</span><span class="meta">${esc(m.district || "")} · <a href="${safe(m.page_url)}">claims</a></span></li>`).join("")}</ul><p class="small muted">${esc(d.note)}</p>`;
      }
      if (name === "human_scale") {
        return `<h3>${esc(d.in_words || d.amount)}</h3><ul class="try-list"><li><span>Per resident</span><span class="amt">${esc(d.per_resident)}</span></li><li><span>Per household</span><span class="amt">${esc(d.per_household)}</span></li><li><span>Time to earn at the median wage</span><span class="amt">${esc(d.time_to_earn_at_median_wage)}</span></li></ul>`;
      }
      return "";
    }

    let busy = false;
    async function run(name, args) {
      if (busy) return;
      busy = true;
      out.innerHTML = `<p class="status">Asking the server…</p>`;
      const req = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
      try {
        const res = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(req) });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        const d = j.result.structuredContent;
        const text = j.result.content[0].text;
        out.innerHTML = readable(name, d) + `<details class="try-raw"><summary>What your assistant receives (${new Intl.NumberFormat("en-CA").format(text.length)} characters)</summary><p class="small muted">It sent:</p><pre><code>${esc(JSON.stringify(req, null, 1))}</code></pre><p class="small muted">It got back:</p><pre><code>${esc(JSON.stringify(d, null, 1))}</code></pre></details>`;
        for (const b of out.querySelectorAll("[data-sid]")) b.addEventListener("click", () => run("get_supplier", { supplier_id: b.dataset.sid }));
      } catch (e) {
        out.innerHTML = `<p class="try-err"><strong>That did not work.</strong> The server could not be reached (${esc(e.message)}). Check your connection and press Run it again.</p>`;
      } finally {
        busy = false;
      }
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = opt().dataset.arg;
      const v = arg.value.trim();
      if (!v) { arg.focus(); return; }
      let args = { [key]: v };
      if (key === "amount") {
        // "$50 million", "50,000,000", "2.5 billion", "50m"
        const m = /^\$?\s*([\d.,]+)\s*(million|mil|m|billion|bn|b|thousand|k)?$/i.exec(v.replace(/\s+/g, " ").trim());
        const mult = { million: 1e6, mil: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, thousand: 1e3, k: 1e3 };
        const n = m ? Number(m[1].replace(/,/g, "")) * (mult[(m[2] || "").toLowerCase()] || 1) : NaN;
        if (!Number.isFinite(n)) { out.innerHTML = `<p class="try-err">Write the amount as a number, for example 50000000 or $50 million.</p>`; return; }
        args = { amount: n };
      }
      run(tool.value, args);
    });
  }
})();

// The feedback box: sends the note without leaving the page. Without this script the form posts as any form does.
(() => {
  for (const form of document.querySelectorAll("[data-feedback]")) {
    const status = form.querySelector("[data-feedback-status]");
    const check = form.querySelector("[data-feedback-check]");
    const btn = form.querySelector("button[type=submit]");
    const note = form.elements.note;
    const at = form.elements.page;
    // File the note under the address in the address bar: a search keeps its words.
    if (!location.pathname.startsWith("/feedback")) at.value = location.pathname + (/^\/receipt(?:\/|$)/.test(location.pathname) ? "" : location.search);
    const here = at.value;

    // Characters left, once the limit is near.
    const count = document.createElement("span");
    count.className = "fb-count";
    count.setAttribute("aria-live", "polite");
    form.querySelector("#fb-note-help").append(" ", count);
    note.addEventListener("input", () => {
      const left = note.maxLength - note.value.length;
      count.textContent = left <= 200 ? `${left} characters left.` : "";
    });

    const say = (text, error) => {
      status.textContent = text;
      status.classList.toggle("is-error", !!error);
    };
    let sending = false;
    const busy = (on) => {
      sending = on;
      btn.setAttribute("aria-disabled", String(on));
      btn.textContent = on ? "Sending…" : "Send";
    };
    // Back from the check page: the form is usable again.
    addEventListener("pageshow", () => busy(false));

    // The check that a person is sending it (Cloudflare Turnstile) loads only once someone starts a note:
    // the first character typed, the first kind picked, or Send.
    let token = "";
    let widget = null;
    let loading = null;
    let asked = false; // Turnstile is showing its box and waiting for a click
    const load = () =>
      (loading ||= new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.onload = () => {
          try {
            widget = window.turnstile.render(check, {
              sitekey: form.dataset.sitekey,
              appearance: "interaction-only",
              size: "flexible",
              theme: document.documentElement.dataset.theme || "auto",
              "response-field": false,
              callback: (t) => ((token = t), (asked = false)),
              "expired-callback": () => (token = ""),
              "error-callback": () => ((token = ""), (asked = false), true),
              "before-interactive-callback": () => {
                asked = true;
                if (sending) say("One more step: tick the box above. The note is sent as soon as you do.");
              },
            });
          } catch (e) {}
          resolve();
        };
        s.onerror = () => resolve();
        document.head.append(s);
      }));
    form.addEventListener("input", load, { once: true });
    form.addEventListener("change", load, { once: true });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // The token, or "" when Turnstile cannot give one in `ms` (two minutes while it waits for a click).
    const waitToken = async (ms) => {
      await Promise.race([load(), wait(ms)]);
      for (let t = 0; !token && widget !== null && t < (asked ? 120000 : ms); t += 100) await wait(100);
      return token;
    };
    const renew = () => {
      token = "";
      try { window.turnstile.reset(widget); } catch (e) {}
    };

    const thanks = () => {
      const done = document.createElement("div");
      done.className = "fb-done";
      done.innerHTML = `<h3 tabindex="-1">Thank you. Your note was sent.</h3>
        <p>Every note is read by a person. A question gets a reply at the email address left with it; without an address there is no way to reply.</p>
        <p><button type="button" class="btn solo ghost">Send another note</button></p>`;
      done.querySelector("button").addEventListener("click", () => {
        form.reset();
        at.value = here;
        count.textContent = "";
        say("");
        form.hidden = false;
        done.remove();
        note.focus();
      });
      form.hidden = true;
      form.after(done);
      done.querySelector("h3").focus();
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (sending) return;
      for (const el of form.querySelectorAll("[aria-invalid]")) {
        el.removeAttribute("aria-invalid");
        if (el !== note) el.removeAttribute("aria-describedby");
        else el.setAttribute("aria-describedby", "fb-note-help");
      }
      busy(true);
      say("");
      const t = await waitToken(8000);
      // No check available (blocked, offline, slow): post the plain form, and the server asks for one more press.
      if (!t) return form.submit();
      const body = new URLSearchParams(new FormData(form));
      body.set("cf-turnstile-response", t);
      try {
        const res = await fetch(form.action, { method: "POST", headers: { accept: "application/json" }, body, signal: AbortSignal.timeout(20000) });
        const j = await res.json();
        if (j.ok) return thanks();
        if (j.fallback) return form.submit();
        say(j.error || "The note was not sent. Press Send again.", true);
        const el = j.field && form.elements[j.field];
        if (el) {
          el.setAttribute("aria-invalid", "true");
          el.setAttribute("aria-describedby", `${el === note ? "fb-note-help " : ""}fb-status`);
          el.focus();
        }
      } catch (err) {
        say("The note was not sent: the site could not be reached. Your note is still here. Check the connection and press Send again.", true);
      } finally {
        renew();
        busy(false);
      }
    });
  }
})();
