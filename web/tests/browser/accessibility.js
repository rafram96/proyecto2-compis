async (page) => {
  // Install the optional, isolated audit tool as documented in web/README.md.
  // Themes are restored before navigation so scans inspect settled colors.
  const origin = new URL(page.url()).origin;
  const reports = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  const inject = () => page.addScriptTag({ path: ".playwright-cli/audit-tools/node_modules/axe-core/axe.min.js" });
  async function scan(surface, width, theme) {
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(async () => await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }));
    reports.push({ surface, width, theme, violations: result.violations.map((v) => ({
      id: v.id, count: v.nodes.length, samples: v.nodes.slice(0, 3).map((n) => ({ target: n.target, summary: n.failureSummary })),
    })) });
  }
  for (const [width, height, theme] of [[1440, 1000, "light"], [390, 844, "dark"]]) {
    await page.setViewportSize({ width, height });
    for (const route of ["/", "/docs/tutorial", "/docs/primer-programa", "/ejemplos", "/ejemplos/ventas", "/evaluacion"]) {
      await page.evaluate((theme) => localStorage.setItem("cauce-theme", theme), theme);
      await page.goto(origin + route);
      await page.locator(route === "/" ? ".hero-foot" : route.startsWith("/docs/") ? ".reading" : route === "/ejemplos" ? ".example-list" : route === "/ejemplos/ventas" ? ".example-layout" : "#tabla-resultados tbody tr").first().waitFor();
      await inject();
      await scan(route, width, theme);
    }
    await page.goto(origin + "/studio");
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await page.locator('.studio-out[data-origin="en vivo"]').waitFor({ state: "attached", timeout: 65000 });
    if (width < 860) await page.getByRole("button", { name: "Inspector", exact: true }).click();
    await inject();
    for (const tab of ["AST", "Tokens", "IR", "Flow", "Parse tree", "Blocks"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await page.locator(tab === "Blocks" ? ".block-builder h2" : ".structured-inspector h2").waitFor();
      await scan(tab, width, theme);
    }
  }
  const failures = reports.filter((r) => r.violations.length);
  if (failures.length) throw new Error(JSON.stringify(failures));
  return { accessibility: true, surfaces: reports.length, violations: 0, themes: 2, engine: "Chromium", scope: "WCAG 2 A/AA + 2.1 AA automated rules" };
};
