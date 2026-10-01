import assert from "node:assert/strict";

// Keyboard behavior and palette checks complement axe's structural/contrast scan.
export async function checkInteractions(page, base) {
  const evidence = [];
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/receipt/?income=30000");
    await page.evaluate((theme) => {
      localStorage.setItem("theme", theme);
    }, theme);
    await page.reload();
    const toggle = page.locator("[data-theme-toggle]");
    assert.equal(
      await toggle.getAttribute("aria-label"),
      `Switch to ${theme === "light" ? "dark" : "light"} theme`,
    );
    await toggle.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      theme === "light" ? "dark" : "light",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.getAttribute("href")),
      "/priorities/",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("[data-menu] summary").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "SUMMARY",
    );
    await page.keyboard.press("Enter");
    // All menu links can be traversed, then the panel closes as focus continues into the page.
    for (let i = 0; i < 10; i++) await page.keyboard.press("Tab");
    assert.equal(await page.locator("[data-menu]").getAttribute("open"), null);
    const input = page.getByLabel("Yearly employment income");
    await input.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("55000");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page
      .locator(".receipt")
      .getByText("Employment income $55,000", { exact: false })
      .waitFor();
    assert.equal(await page.locator(".receipt h2").count(), 1);
    await page.locator(".rc-more > summary").focus();
    await page.keyboard.press("Enter");
    assert.notEqual(await page.locator(".rc-more").getAttribute("open"), null);
    await input.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("invalid");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    assert.ok(await page.locator("[data-receipt-error]").isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), "inc");
    // Inspect the native feedback controls without sending a note or solving Turnstile.
    await page.getByRole("radio", { name: "No category", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    assert.ok(
      await page
        .getByRole("radio", { name: "Something's wrong", exact: true })
        .isChecked(),
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "fb-note",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "fb-email",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      "Send",
    );
    const focus = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return {
        style: s.outlineStyle,
        width: s.outlineWidth,
        color: s.outlineColor,
      };
    });
    assert.equal(focus.style, "solid");
    assert.ok(parseFloat(focus.width) >= 2);
    // Test the palette by its actual roles. Hairlines and ghost bars are
    // decorative; adjacent figures and words convey their information.
    const palette = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const color = (n) => styles.getPropertyValue("--" + n).trim();
      const luminance = (hex) => {
        const rgb = hex
          .replace("#", "")
          .match(/../g)
          .map((v) => parseInt(v, 16) / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const pairs = [];
      for (const fg of ["ink", "ink-2", "ink-3", "link", "red", "graphite"])
        for (const bg of ["paper", "paper-2"]) pairs.push([fg, bg, 4.5]);
      pairs.push(["ink", "paper-3", 4.5]); // command blocks and protocol strip
      for (const bg of ["blue", "blue-deep"])
        for (const fg of ["on-blue", "on-blue-2"]) pairs.push([fg, bg, 4.5]);
      pairs.push(
        ["on-gold", "gold", 4.5],
        ["mark-ink", "lv-provincial", 3],
        ["focus", "paper", 3],
        ["bar", "paper", 3],
      );
      for (const fg of ["lv-provincial", "lv-federal", "lv-municipal"])
        pairs.push([fg, "paper", 3]);
      return pairs.map(([fg, bg, min]) => {
        const a = luminance(color(fg)),
          b = luminance(color(bg));
        return {
          fg,
          bg,
          min,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    for (const p of palette)
      assert.ok(p.ratio >= p.min, `${theme} ${p.fg} on ${p.bg}: ${p.ratio}`);
    evidence.push({
      theme,
      keyboard: "menu, theme, receipt, disclosure, feedback navigation pass",
      focus,
      palette,
    });
  }
  await page.goto(base + "/scale/");
  assert.ok(
    await page
      .getByRole("table", {
        name: "Independent comparisons against CAD 1 billion",
      })
      .isVisible(),
  );
  assert.ok(
    (await page
      .locator("main .vh")
      .getByText("% of CAD 1 billion", { exact: false })
      .count()) > 0,
  );
  await page.goto(base + "/data/");
  const motion = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((e) => {
        const s = getComputedStyle(e);
        return (
          s.animationName !== "none" || parseFloat(s.transitionDuration) > 0
        );
      })
      .map((e) => e.className),
  );
  assert.deepEqual(
    motion,
    [],
    "Reduced motion must disable authored animations/transitions",
  );
  return evidence;
}
