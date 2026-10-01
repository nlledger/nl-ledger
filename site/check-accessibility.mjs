// Run alongside check-dist: node site/check-accessibility.mjs http://localhost:8787 [report.json]
// Installed Chrome locally: A11Y_BROWSER_CHANNEL=chrome. CI uses Playwright Chromium.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkInteractions } from "./check-accessibility-interactions.mjs";
const base = process.argv[2] || "http://localhost:8787";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(base))
  throw Error("Use a local preview; this check never submits live feedback.");
const routes = JSON.parse(
  readFileSync(new URL("./scripts/compare/routes.json", import.meta.url)),
);
const browser = await chromium.launch({
  channel: process.env.A11Y_BROWSER_CHANNEL || undefined,
});
const page = await browser.newPage({ reducedMotion: "reduce" });
const failures = [],
  report = [];
const axePath = fileURLToPath(
  new URL("./node_modules/axe-core/axe.min.js", import.meta.url),
);
async function scan() {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axeResult = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"],
      },
    });
    const extra = [];
    for (const table of document.querySelectorAll("main table")) {
      if (!(
        table.caption?.textContent.trim() ||
        table.getAttribute("aria-label")?.trim() ||
        document
          .getElementById(table.getAttribute("aria-labelledby"))
          ?.textContent.trim()
      ))
        extra.push("Table has no accessible name");
    }
    if (document.documentElement.scrollWidth > innerWidth + 1)
      extra.push("Page needs horizontal scrolling");
    // overflow-x:hidden can hide a reflow failure rather than solve it.
    for (const el of document.querySelectorAll(
      "main a, main button, main input, main textarea, main select",
    )) {
      if (!el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
      if (
        (r.right > innerWidth + 1 || r.left < -1) &&
        !el.closest(".is-overflowing")
      )
        extra.push(
          "Control clipped at viewport: " + (el.textContent.trim() || el.id),
        );
    }
    return {
      violations: axeResult.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      incomplete: axeResult.incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes.length,
      })),
      extra,
    };
  });
}
try {
  // Discover data-dependent URLs so the same coverage works on full records and the CI sample.
  await page.goto(base + "/flags/");
  for (const href of await page
    .locator('main a[href^="/flags/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    if (!routes.includes(href)) routes.push(href);
    const method = href.replace("/flags/", "/method/");
    if (!routes.includes(method)) routes.push(method);
  }
  await page.goto(base + "/bodies/");
  const body = await page
    .locator('main a[href^="/body/"]')
    .first()
    .getAttribute("href");
  assert.ok(body, "No public body link on /bodies/ to audit");
  routes.push(body);
  await page.goto(base + "/search/?q=snow+clearing");
  const item = await page
    .locator('main a[href^="/item/"]')
    .first()
    .getAttribute("href");
  await page.goto(base + item);
  const supplier = await page
    .locator('main a[href^="/supplier/"]')
    .first()
    .getAttribute("href");
  const resolvedRoutes = new Set();
  for (let route of routes)
    for (const width of [390, 1280])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 844 });
        let response = await page.goto(base + route);
        if (response.status() === 404 && route !== "/missing-page/") {
          const replacement = route.startsWith("/item/")
            ? item
            : route.startsWith("/supplier/")
              ? supplier
              : route.startsWith("/body/")
                ? body
                : null;
          if (replacement) {
            route = replacement;
            response = await page.goto(base + route);
          }
        }
        assert.equal(
          response.status(),
          route === "/missing-page/" ? 404 : 200,
          route,
        );
        await page.evaluate(async (theme) => {
          document.documentElement.dataset.theme = theme;
          await document.fonts.ready;
          document
            .querySelectorAll("main details")
            .forEach((d) => (d.open = true));
        }, theme);
        resolvedRoutes.add(route);
        const result = await scan();
        report.push({ route, width, theme, ...result });
        if (result.violations.length || result.extra.length)
          failures.push({ route, width, theme, ...result });
      }
  // Reflow equivalent to a 1280px desktop at 200% and 400% page zoom.
  for (const width of [640, 320])
    for (const theme of ["light", "dark"])
      for (const route of resolvedRoutes) {
        await page.setViewportSize({ width, height: 450 });
        await page.goto(base + route);
        await page.evaluate(async (theme) => {
          document.documentElement.dataset.theme = theme;
          await document.fonts.ready;
          document
            .querySelectorAll("main details")
            .forEach((d) => (d.open = true));
        }, theme);
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          clipped: [
            ...document.querySelectorAll(
              "main a,main button,main input,main textarea,main select",
            ),
          ]
            .filter((e) => e.checkVisibility() && !e.closest(".is-overflowing"))
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.left < -1 || r.right > innerWidth + 1;
            })
            .map((e) => e.id || e.textContent.trim()),
        }));
        report.push({ route, width, theme, reflow: geometry });
        if (geometry.overflow > 1 || geometry.clipped.length)
          failures.push({ route, width, theme, reflow: geometry });
      }
  // An interaction failure is recorded with the scan results instead of discarding them.
  try {
    report.push({ interactions: await checkInteractions(page, base) });
  } catch (e) {
    failures.push({ interactions: e.message });
  }
  // Prove the real audit detects a reintroduced unlabeled control, not a mock of axe.
  if (process.argv.includes("--prove-regression")) {
    await page.goto(base + "/");
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "a11y-regression";
      document.querySelector("main").prepend(b);
    });
    const result = await scan();
    assert.ok(
      result.violations.some(
        (v) =>
          v.id === "button-name" &&
          v.nodes.some((n) => n.target.includes("#a11y-regression")),
      ),
      "Reintroduced unlabeled button must fail",
    );
    console.log(
      "Regression proof: reintroduced unlabeled button rejected by button-name.",
    );
  }
  if (process.argv[3] && !process.argv[3].startsWith("--"))
    writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
  for (const failure of failures) console.error(JSON.stringify(failure));
  console.log(
    `Accessibility: ${routes.length} routes, ${report.length} theme/width/reflow cases, ${failures.length} failures`,
  );
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
