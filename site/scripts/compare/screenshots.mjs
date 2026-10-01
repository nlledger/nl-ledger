const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import fs from "node:fs";
const phase = process.argv[2] || "before",
  base = process.argv[3] || "http://localhost:8890";
const routes = JSON.parse(
  fs.readFileSync(process.argv[4] || new URL("./routes.json", import.meta.url)),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto(base + "/bodies/");
if (!process.argv[4])
  routes.push(
    await page.locator('main a[href^="/body/"]').first().getAttribute("href"),
  );
const directory = phase;
fs.mkdirSync(directory, { recursive: true });
const results = [];
for (const route of routes)
  for (const width of [390, 1280])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 844 });
      const response = await page.goto(base + route);
      if (response.status() !== (route === "/missing-page/" ? 404 : 200))
        throw Error(route + " HTTP " + response.status());
      await page.evaluate(async (theme) => {
        document.documentElement.dataset.theme = theme;
        await document.fonts.ready;
      }, theme);
      await page.addStyleTag({
        content:
          "*,*::before,*::after{transition:none!important;animation:none!important}",
      });
      const filename =
        route.replace(/[^a-z0-9]/gi, "_") + "-" + width + "-" + theme + ".png";
      await page.screenshot({
        path: directory + "/" + filename,
        fullPage: true,
        animations: "disabled",
      });
      results.push({ route, width, theme, filename });
    }
await browser.close();
fs.writeFileSync(
  directory + "/manifest.json",
  JSON.stringify(results, null, 2),
);
console.log(phase, results.length, "screenshots");
