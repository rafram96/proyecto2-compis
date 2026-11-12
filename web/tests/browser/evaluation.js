async (page) => {
  const origin = new URL(page.url()).origin;
  const errors = [];
  const api = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    // Solo cuentan las peticiones hechas mientras la página activa es /evaluacion.
    if (new URL(request.url()).pathname.startsWith("/api") && new URL(page.url()).pathname === "/evaluacion")
      api.push(request.url());
  });
  const fail = (message) => {
    throw new Error(message);
  };
  const workspace = () => page.evaluate(() => localStorage.getItem("cauce-workspace-v1"));
  // CodeMirror, Pyodide/worker, cliente de ejecución, estudio e inspectores (dev y build).
  const heavy = /pyodide|codemirror|(?:Editor|ExecutionPanel|StudioPage|worker|Inspector)-[^/]*\.js|\/src\/(?:editor\/Editor|execution\/|compiler\/worker|components\/inspectors\/|pages\/StudioPage)/i;
  const loaded = () => page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name));
  // CSV publicado, leído por el navegador desde el mismo origen que las descargas.
  const csv = async (name) =>
    page.evaluate(async (path) => {
      const text = await (await fetch(path, { cache: "no-store" })).text();
      const rows = [];
      let row = [], field = "", quoted = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
          if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (ch === '"') quoted = false;
          else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
        else field += ch;
      }
      const [head, ...body] = rows;
      return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    }, "/evidencia/c5-representativa/" + name);
  const table = () =>
    page.locator("#tabla-resultados tbody tr").evaluateAll((rows) =>
      rows.map((tr) => {
        const cells = [...tr.children];
        return {
          configuration: tr.dataset.config,
          n: cells[2].textContent,
          values: cells.filter((c) => c.dataset.value !== undefined).map((c) => Number(c.dataset.value)),
          shown: cells.filter((c) => c.dataset.value !== undefined).map((c) => c.textContent),
          reading: tr.querySelector("[data-reading]").dataset.reading,
        };
      }),
    );
  const summary = await (async () => {
    await page.goto(origin + "/evaluacion");
    return csv("summary.csv");
  })();
  const compare = async (phase, workload, size, scenario, label) => {
    const expected = summary.filter(
      (r) => r.phase === phase && r.workload === workload && r.size === String(size) && r.scenario === scenario,
    );
    await page.locator("#tabla-resultados tbody tr").first().waitFor();
    const rows = await table();
    if (!rows.length) fail(`${label}: tabla vacía`);
    for (const row of rows) {
      const ref = expected.find((r) => r.configuration === row.configuration);
      if (!ref) fail(`${label}: ${row.configuration} no está en summary.csv`);
      const want = ["median", "p25", "p75", "iqr", "speedup_vs_O0"].map((f) => Number(ref[f]));
      if (row.n !== ref.n || JSON.stringify(row.values) !== JSON.stringify(want))
        fail(`${label}: ${row.configuration} difiere de summary.csv`);
      const decimals = [4, 4, 4, 4, 3];
      row.shown.forEach((text, i) => {
        if (Math.abs(Number(text) - want[i]) > 0.5 * 10 ** -decimals[i] + 1e-12)
          fail(`${label}: redondeo incorrecto ${text} vs ${want[i]}`);
      });
    }
    return rows;
  };

  // 1. Acceso directo, sin herramientas de edición, ejecución ni API.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.evaluate(() => localStorage.removeItem("cauce-workspace-v1"));
  await page.goto(origin + "/evaluacion");
  await page.getByRole("heading", { name: "Evaluación del compilador" }).waitFor();
  if ((await page.title()) !== "Evaluación · Cauce") fail("Título incorrecto");
  if ((await loaded()).some((url) => heavy.test(url))) fail("La evaluación cargó editor, Python o ejecución");
  if ((await workspace()) !== null) fail("Leer la evaluación creó un documento");
  if ((await page.getByRole("link", { name: "Evaluación", exact: true }).getAttribute("aria-current")) !== "page")
    fail("Navegación sin página actual");
  await page.getByText("Campaña histórica, no una medición en vivo.").waitFor();
  await page.getByText("efe13996d9201788c9fc8cd7c6f458ca68035a04").waitFor();
  const defaults = await compare("execute", "rangos", 1000000, "normal", "predeterminada");
  if (defaults.length !== 8) fail("La vista inicial debe mostrar todas las configuraciones");

  // 2-3. Casos con y sin mejora, URL y atrás/adelante entre selecciones.
  await page.getByRole("button", { name: /Mejora observada/ }).click();
  await page.waitForURL(/workload=join/);
  const join = await compare("execute", "join", 1000000, "normal", "join");
  if (join.find((r) => r.configuration === "default").reading !== "faster") fail("join sin mejora observada");
  if (join.find((r) => r.configuration === "manual").reading !== "within") fail("manual mal interpretado");
  await page.getByRole("button", { name: /Sin mejora clara/ }).click();
  await page.waitForURL(/workload=rangos/);
  const rangos = await compare("execute", "rangos", 1000000, "normal", "rangos");
  if (rangos.find((r) => r.configuration === "default").reading !== "within") fail("rangos presentado como mejora");
  await page.goBack();
  await page.waitForURL(/workload=join/);
  if ((await page.getByLabel("Programa").inputValue()) !== "join") fail("Atrás no restauró el filtro");
  await page.goForward();
  await page.waitForURL(/workload=rangos/);
  if ((await page.getByLabel("Programa").inputValue()) !== "rangos") fail("Adelante no restauró el filtro");

  // 4. Compilación: sin tamaño, escenario ni manual.
  await page.getByLabel("Programa").selectOption("combinado");
  await page.getByRole("radio", { name: "Compilación" }).check();
  await page.waitForURL(/fase=compilacion/);
  if (/filas=|escenario=/.test(page.url())) fail("La compilación serializó tamaño o escenario");
  if (await page.getByRole("group", { name: "Filas izquierdas" }).count()) fail("Compilación con selector de filas");
  const compile = await compare("compile", "combinado", 0, "not_applicable", "compilación");
  if (compile.some((r) => r.configuration === "manual") || compile.length !== 7) fail("Compilación manual o incompleta");
  await page.getByText("El baseline manual no se compila").waitFor();
  await page.getByRole("radio", { name: "Ejecución" }).check();
  await page.waitForURL(/fase=ejecucion/);

  // 5. Escenarios separados con su explicación.
  await page.getByLabel("Programa").selectOption("join");
  await page.getByRole("radio", { name: "final_flags_none" }).check();
  await page.waitForURL(/escenario=final_flags_none/);
  const context = await page.locator(".eval-context").innerText();
  if (!context.includes("solo en las materializaciones finales") || !context.includes("No es «Polars sin optimización»"))
    fail("Explicación de final_flags_none incorrecta");
  await compare("execute", "join", 1000000, "final_flags_none", "final_flags_none");
  await page.getByRole("radio", { name: "10 000" }).check();
  await compare("execute", "join", 10000, "final_flags_none", "10 000");
  await page.getByRole("checkbox", { name: "constantes" }).uncheck();
  await page.waitForURL(/config=/);
  if ((await table()).some((r) => r.configuration === "constantes")) fail("No filtró configuraciones");
  if (!(await page.getByRole("checkbox", { name: "O0" }).isDisabled())) fail("O0 debe quedar como referencia");

  // 6. Evidencia JOIN y abstenciones.
  await page.goto(origin + "/evaluacion?fase=ejecucion&workload=join&filas=1000000&escenario=normal");
  const proof = page.locator(".eval-proof").first();
  for (const term of ["Declaración", "Prueba estática", "Obligaciones dinámicas", "Mejora temporal observada"])
    await proof.getByText(term, { exact: true }).waitFor();
  const proofText = await proof.innerText();
  if (!proofText.includes("unique_right_key") || !proofText.includes("all_consumers_select_only_left_columns"))
    fail("Faltan prueba u obligaciones");
  await page.getByRole("button", { name: /Abstención de O3/ }).click();
  await page.waitForURL(/workload=control_join/);
  await page.getByText("es una abstención comprobada").waitFor();
  const structure = await page.locator('section[aria-labelledby="estructura"] tbody td:nth-child(3)').allInnerTexts();
  if (!structure.length || structure.some((t) => t !== "No")) fail("Control JOIN con cambios");
  const control = await compare("execute", "control_join", 1000000, "normal", "control_join");
  if (control.find((r) => r.configuration === "joins").reading !== "no-rewrite") fail("Abstención atribuida al pase");

  // URL inválida: valores predeterminados y aviso.
  await page.goto(origin + "/evaluacion?fase=x&workload=..%2F&filas=7&config=O9");
  await page.getByRole("status").filter({ hasText: "Se ignoraron parámetros" }).waitFor();
  if ((await page.getByLabel("Programa").inputValue()) !== "rangos") fail("Fallback incorrecto");

  // 7. Descargas reales y verificación de hashes en el navegador.
  const files = await page.locator(".eval-downloads li").evaluateAll((items) => items.map((li) => li.dataset.file));
  for (const name of files) {
    const download = page.waitForEvent("download");
    await page.locator(`.eval-downloads li[data-file="${name}"] a`).click();
    await (await download).saveAs(`.playwright-cli/e-download-${name}`);
  }
  for (const name of ["summary.csv", "metadata.public.json", "manifest.json"]) {
    await page.getByRole("button", { name: `Verificar SHA-256 de ${name}` }).click();
    await page.locator(`.eval-downloads li[data-file="${name}"] [data-check="ok"]`).waitFor();
  }

  // 11. Teclado y foco visible en los filtros.
  await page.goto(origin + "/evaluacion");
  const radio = page.getByRole("radio", { name: "Ejecución" });
  await radio.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  if (!(await radio.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).outlineStyle !== "none")))
    fail("Radio sin foco visible");
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(/fase=compilacion/);
  await page.getByRole("button", { name: /Mejora observada/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/workload=join/);
  if (!(await page.locator("#tabla-resultados").evaluate((el) => document.activeElement === el)))
    fail("El caso no llevó el foco a la tabla");

  // Capturas: escritorio/móvil, claro/oscuro, movimiento reducido; sin desbordamiento global.
  let screenshots = 0;
  for (const [width, height, label] of [[1440, 1000, "desktop"], [390, 844, "mobile"]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.goto(origin + "/evaluacion?fase=ejecucion&workload=join&filas=1000000&escenario=normal");
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.getByRole("heading", { name: "Evaluación del compilador" }).waitFor();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) fail(`Desbordamiento ${label}/${theme}`);
      const small = await page.locator(".eval-choice, .eval-presets .ui-btn, .eval-download-head a, .eval-verify .ui-btn").evaluateAll(
        (els) => els.filter((el) => el.getBoundingClientRect().height < 44).length,
      );
      if (small) fail(`${small} objetivos táctiles menores de 44 px en ${label}`);
      await page.screenshot({ path: `.playwright-cli/e-${label}-${theme}-top.png`, animations: "disabled" });
      await page.locator("#tabla-resultados").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.playwright-cli/e-${label}-${theme}-table.png`, animations: "disabled" });
      await page.locator(".eval-chart").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.playwright-cli/e-${label}-${theme}-chart.png`, animations: "disabled" });
      screenshots += 3;
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Evaluación", exact: true }).waitFor();
  await page.screenshot({ path: ".playwright-cli/e-mobile-full.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  // 8. Evaluación ↔ estudio ↔ docs/ejemplos sin perder documento ni pases personalizados.
  await page.goto(origin + "/studio");
  await page.locator(".cm-content").waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n// borrador evaluación ñ");
  await page.getByLabel("Pases de optimización").selectOption("custom");
  for (const pass of ["joins", "muertos", "filtros"])
    await page.getByRole("checkbox", { name: pass, exact: true }).uncheck();
  await page.getByRole("button", { name: "Subir rangos", exact: true }).click();
  const saved = await workspace();
  if (JSON.stringify(JSON.parse(saved).active.passes) !== '["rangos","constantes"]') fail("Preparación de pases fallida");
  await page.getByRole("link", { name: "Evaluación", exact: true }).click();
  await page.waitForURL("**/evaluacion");
  await page.getByRole("button", { name: /Sin mejora clara/ }).click();
  await page.getByRole("radio", { name: "final_flags_none" }).check();
  const filtered = page.url();
  await page.getByRole("link", { name: "Abrir Studio" }).click();
  await page.waitForURL((u) => u.pathname === "/studio");
  await page.locator(".cm-content").waitFor();
  if (!(await page.locator(".cm-content").innerText()).includes("borrador evaluación ñ")) fail("Se perdió el documento");
  if ((await page.getByLabel("Pases de optimización").inputValue()) !== "custom") fail("Se perdieron los pases");
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await page.waitForURL("**/docs");
  await page.getByRole("link", { name: "Ejemplos", exact: true }).click();
  await page.waitForURL("**/ejemplos");
  await page.goBack();
  await page.goBack();
  await page.goBack();
  await page.waitForURL((url) => url.href === filtered);
  if ((await page.getByLabel("Programa").inputValue()) !== "rangos" || !(await page.getByRole("radio", { name: "final_flags_none" }).isChecked()))
    fail("Atrás no recuperó los filtros de evaluación");
  await page.getByRole("link", { name: "Evaluación", exact: true }).click();
  if ((await workspace()) !== saved) fail("La evaluación modificó el documento o los pases");

  // 9. Disponible con la API desconectada.
  await page.route("**/api/**", (route) => route.abort());
  await page.goto(origin + "/evaluacion?fase=ejecucion&workload=agregados&filas=200000&escenario=normal");
  await compare("execute", "agregados", 200000, "normal", "sin API");
  await page.unroute("**/api/**");
  const evaluationApi = api.length;
  if (evaluationApi) fail("La evaluación consultó la API: " + api.join(", "));
  if (errors.length) fail("Errores de página: " + errors.join(" | "));
  return {
    evaluation: true,
    csvMatches: true,
    phases: true,
    scenarios: true,
    joinEvidence: true,
    downloads: files.length,
    workspacePreserved: true,
    apiWhileReading: evaluationApi,
    screenshots,
  };
};
