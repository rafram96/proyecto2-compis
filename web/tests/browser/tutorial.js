async (page) => {
  // Tutorial «De un CSV a un resultado» de punta a punta con UI, Pyodide y la API reales.
  // Escritorio/claro y móvil/oscuro recorren todo; las capturas cubren las cuatro combinaciones.
  const origin = new URL(page.url()).origin;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const fail = (message) => {
    throw new Error(message);
  };
  // En móvil la salida vive en el panel Inspector; en escritorio show() no hace nada.
  const live = async () => {
    await show("Inspector");
    await page.locator('.studio-out[data-origin="en vivo"]').waitFor({ timeout: 65000 });
  };
  const workspace = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("cauce-workspace-v1")));
  // Llega al control con el teclado (Mayús+Tab y Tab) para medir el foco que vería quien navega así.
  const focusVisible = async (locator) => {
    await locator.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    return locator.evaluate(
      (el) =>
        el === document.activeElement &&
        el.matches(":focus-visible") &&
        getComputedStyle(el).outlineStyle !== "none" &&
        getComputedStyle(el).outlineWidth !== "0px",
    );
  };
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const setTheme = (theme) =>
    page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("cauce-theme", theme);
    }, theme);
  const shot = async (path) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.playwright-cli/${path}.png`, fullPage: true, animations: "disabled" });
  };
  const show = async (panel) => {
    // Móvil: Código/Inspector alternan; en escritorio el botón no existe o no está visible.
    const toggle = page.getByRole("button", { name: panel, exact: true });
    if ((await toggle.count()) && (await toggle.isVisible())) await toggle.click();
  };
  const readArticle = async (size, theme) => {
    await page.goto(origin + "/docs/tutorial");
    const title = page.getByRole("heading", { name: "De un CSV a un resultado", level: 1 });
    await title.waitFor();
    await setTheme(theme);
    if (!(await title.evaluate((el) => el === document.activeElement))) fail("Tutorial sin foco al entrar");
    const captions = new Set(await page.locator(".reading figcaption").allTextContents());
    for (const caption of [
      "Contenido del archivo CSV",
      "Fragmento de referencia · incompleto",
      "Comando de terminal",
      "Salida obtenida al ejecutarlo",
    ])
      if (!captions.has(caption)) fail("Falta la leyenda " + caption);
    // Los comandos y salidas son texto literal: sin resaltado del DSL.
    const command = page.locator('.reading pre[aria-label="Comando de terminal, desplazable"]').first();
    if (await command.locator("span").count()) fail("Comando resaltado como DSL");
    // Un comando no se parte en líneas: si no cabe, el bloque se desplaza y se alcanza con teclado.
    const lines = await command.evaluate((el) => ({ white: getComputedStyle(el).whiteSpace, text: el.innerText }));
    if (lines.white !== "pre" || lines.text.trim() !== "python main.py demo/tutorial.etl --format check")
      fail("Comando partido o alterado: " + JSON.stringify(lines));
    if (!(await focusVisible(command))) fail("Bloque de comando sin foco visible");
    const caret = await page.locator(".reading figure").filter({ hasText: "E_COLUMN: Columna inexistente" }).innerText();
    if (!caret.includes("WHERE importes > 0;") || !caret.includes("^")) fail("Salida del error incompleta");
    for (const href of ["/studio?vista=ejecucion", "/studio?vista=flow", "/ejemplos/gasto-por-cliente", "/docs/primer-programa"])
      if (!(await page.locator(`.reading a[href="${href}"]`).count())) fail("Falta enlace " + href);
    if (await page.locator('.reading a[href$=".md"], .reading a[href$=".etl"]').count()) fail("Enlace a archivo no publicado");
    if (await overflow()) fail(`Desbordamiento en el tutorial ${size} ${theme}`);
    await shot(`t-article-${size}-${theme}`);
  };
  const journey = async ({ width, height, theme, size }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto(origin + "/docs/tutorial");
    await page.evaluate(() => localStorage.removeItem("cauce-workspace-v1"));
    await readArticle(size, theme);
    // Índice del artículo con teclado: el ancla recibe foco y desplaza.
    const anchor = page
      .getByRole("navigation", { name: "En este artículo" })
      .getByRole("link", { name: "4. Provocar y corregir un error", exact: true });
    await anchor.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/docs/tutorial#4-provocar-y-corregir-un-error");
    if (!(await page.locator('[id="4-provocar-y-corregir-un-error"]').evaluate((el) => el === document.activeElement)))
      fail("Ancla sin foco");
    // Enlace del cuerpo → ejemplo del catálogo → atrás.
    await page.locator('.reading a[href="/ejemplos/gasto-por-cliente"]').first().click();
    await page.getByRole("heading", { name: "Gasto por cliente desde un CSV", level: 1 }).waitFor();
    const exampleText = await page.locator(".example-context").innerText();
    if (!exampleText.includes("gasto_por_cliente.pedidos → join-orders@1")) fail("Ejemplo sin dataset declarado");
    await page.goBack();
    await page.waitForURL("**/docs/tutorial#4-provocar-y-corregir-un-error");
    // Paginación coherente con el orden de articles.json.
    if (!(await page.locator('a[rel="prev"][href="/docs/primer-programa"]').count())) fail("Paginación anterior");
    if (!(await page.locator('a[rel="next"][href="/docs/estructura"]').count())) fail("Paginación siguiente");
    // Copia del programa canónico, con teclado y foco visible.
    const program = await page.locator('.reading pre[aria-label="Código del programa, desplazable"]').innerText();
    const open = page.getByRole("button", { name: "Abrir una copia en Studio" });
    await open.focus();
    if (!(await focusVisible(open))) fail("Abrir copia sin foco visible");
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => u.pathname === "/studio");
    await page.locator(".cm-content").waitFor({ state: "attached" });
    let state = await workspace();
    if (state.active.name !== "tutorial.etl" || state.active.source.trimEnd() !== program.trimEnd())
      fail("La copia no es el programa del tutorial");
    const source = state.active.source;
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await live();
    await show("Inspector");
    if (await page.locator(".diagnostic-link").count()) fail("El tutorial no compila");
    // Paso 4: el error real, su diagnóstico y la corrección desde el intervalo.
    await show("Código");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(source.replace("WHERE importe > 0;", "WHERE importes > 0;"));
    await live();
    await show("Inspector");
    const diagnostic = page.getByRole("button", { name: /E_COLUMN/ });
    await diagnostic.waitFor();
    if (!(await diagnostic.innerText()).includes("Columna inexistente: importes.")) fail("Mensaje de diagnóstico distinto");
    await diagnostic.focus();
    if (!(await focusVisible(diagnostic))) fail("Diagnóstico sin foco visible");
    await page.keyboard.press("Enter");
    const selected = await page.evaluate(() => window.getSelection().toString());
    if (selected !== "importes") fail("El diagnóstico seleccionó " + JSON.stringify(selected));
    await page.keyboard.insertText("importe");
    await live();
    state = await workspace();
    if (state.active.source !== source) fail("La corrección alteró el programa");
    await show("Inspector");
    if (await page.locator(".diagnostic-link").count()) fail("El diagnóstico persiste tras corregir");
    // Paso 5: enlace a vista desde el tutorial, sin cambiar el documento.
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Docs" }).click();
    await page.getByRole("heading", { name: "Aprende Cauce" }).waitFor();
    await page.getByRole("link", { name: "De un CSV a un resultado" }).first().click();
    await page.getByRole("heading", { name: "De un CSV a un resultado", level: 1 }).waitFor();
    await page.locator('.reading a[href="/studio?vista=flow"]').click();
    await page.waitForURL((u) => u.pathname === "/studio");
    if ((await workspace()).active.source !== source) fail("El enlace a FLOW cambió el documento");
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await live();
    if ((await workspace()).active.inspector !== "flow") fail("La vista FLOW no se aplicó");
    // Paso 6: Resultados desde el enlace del tutorial y ejecución real.
    await page.goBack();
    await page.getByRole("heading", { name: "De un CSV a un resultado", level: 1 }).waitFor();
    await page.locator('.reading a[href="/studio?vista=ejecucion"]').click();
    await page.waitForURL((u) => u.pathname === "/studio");
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await live();
    await page.getByText("Servicio conectado · demo privada", { exact: true }).waitFor();
    await page.getByLabel("Pipeline a ejecutar").selectOption("gasto_por_cliente");
    const dataset = page.getByLabel("Dataset para gasto_por_cliente.pedidos", { exact: true });
    const option = dataset.locator('option[value="join-orders@1"]');
    if ((await option.innerText()) !== "JOIN · pedidos · join-orders@1" || (await option.isDisabled()))
      fail("Dataset del tutorial no disponible con el texto documentado");
    await dataset.selectOption("join-orders@1");
    const run = page.getByRole("button", { name: "Run", exact: true });
    await run.focus();
    if (!(await focusVisible(run))) fail("Ejecutar sin foco visible");
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/runs" && r.request().method() === "POST"),
      page.keyboard.press("Enter"),
    ]);
    if (response.status() !== 202) fail("Ejecución no aceptada: " + (await response.text()));
    const body = response.request().postDataJSON();
    if (JSON.stringify(body.bindings) !== JSON.stringify([{ pipeline: "gasto_por_cliente", declaration: "pedidos", dataset_id: "join-orders", version: "1" }]))
      fail("Bindings enviados distintos");
    await page.locator('.execution-job[data-state="succeeded"]').waitFor({ timeout: 20000 });
    if (!(await page.locator(".execution-job h3").innerText()).startsWith("Completado")) fail("Estado sin etiqueta Completado");
    const rows = await page
      .locator(".execution-results tbody")
      .first()
      .locator("tr")
      .evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td, th")].map((c) => c.textContent.trim())));
    if (JSON.stringify(rows) !== JSON.stringify([["2", "2", "70", "82.60"], ["1", "1", "10", "11.80"]]))
      fail("Filas distintas del tutorial: " + JSON.stringify(rows));
    // Paso 7: descarga del archivo de salida con el nombre documentado.
    const link = page.getByRole("link", { name: /Descargar gasto_por_cliente\.csv/ });
    await link.focus();
    if (!(await focusVisible(link))) fail("Descarga sin foco visible");
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    await download.saveAs(`.playwright-cli/t-${size}-${theme}.csv`);
    if (await overflow()) fail(`Desbordamiento en Resultados ${size} ${theme}`);
    await page.locator("#resultados").scrollIntoViewIfNeeded();
    await shot(`t-results-${size}-${theme}`);
    const other = theme === "light" ? "dark" : "light";
    await setTheme(other);
    if (await overflow()) fail(`Desbordamiento en Resultados ${size} ${other}`);
    await shot(`t-results-${size}-${other}`);
    await readArticle(size, other);
  };
  await journey({ width: 1440, height: 1000, theme: "light", size: "desktop" });
  await journey({ width: 390, height: 844, theme: "dark", size: "mobile" });
  if (errors.length) fail(errors.join("\n"));
  return {
    tutorial: true,
    journeys: 2,
    links: true,
    diagnosticCorrection: true,
    execution: true,
    downloads: 2,
    screenshots: 8,
    pageErrors: errors,
  };
};
