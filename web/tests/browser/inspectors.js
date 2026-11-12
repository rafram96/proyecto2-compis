async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin + "/studio");
  await page.evaluate(() => localStorage.removeItem("cauce-workspace-v1"));
  await page.reload();
  if (await page.getByRole("button", { name: "Cambiar a tema claro" }).count())
    await page.getByRole("button", { name: "Cambiar a tema claro" }).click();
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("theme-fade"),
  );
  await page.locator(".cm-content").waitFor();
  const live = () =>
    page
      .locator('.studio-out[data-origin="en vivo"]')
      .waitFor({ timeout: 65000 });
  const tab = (name) => page.getByRole("button", { name, exact: true }).click();
  const replace = async (code) => {
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(code);
  };
  const selection = () => page.evaluate(() => window.getSelection().toString());
  const resetOutput = async () => {
    await page.locator(".structured-inspector h2").waitFor();
    await page.locator(".studio-out").evaluate((el) => (el.scrollTop = 0));
  };
  const active = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("cauce-workspace-v1")).active,
    );
  const open = async (name) => {
    await page.getByLabel("Abrir ejemplo").selectOption(name);
    await live();
  };
  const expandUntil = async (target) => {
    await page.locator(".ast-tree").waitFor();
    for (let i = 0; i < 90 && !(await target.isVisible()); i++) {
      const closed = page
        .locator(".ast-tree details:not([open]) > summary:visible")
        .first();
      if (!(await closed.count())) break;
      await closed.click();
    }
    await target.waitFor();
  };
  await tab("Compile");
  await live();
  await page.evaluate(() => {
    window.__postsC = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      window.__postsC++;
      return post.apply(this, args);
    };
    window.__editorC = document.querySelector(".cm-editor");
  });
  await tab("AST");
  const step = page.getByRole("button", {
    name: "Seleccionar Step · pagados",
    exact: true,
  });
  await expandUntil(step);
  await page.screenshot({
    path: ".playwright-cli/c-ast-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await step.focus();
  await page.keyboard.press("Enter");
  if (!(await selection()).startsWith("STEP pagados = FILTER"))
    throw new Error("AST ventas no seleccionó el STEP original");
  await tab("Flow");
  await page.getByLabel("Pipeline de FLOW").waitFor();
  await tab("Lista de pasos");
  await tab("Grafo");
  await tab("IR");
  await page.getByLabel("Pipeline de IR").waitFor();
  await tab("Evidencia O1/O3");
  await tab("Comparación");
  await tab("Schemas");
  await page.getByLabel("Pipeline de esquemas").waitFor();
  if (
    !(await page.locator(".structured-inspector").innerText()).includes(
      "conocimiento parcial",
    )
  )
    throw new Error("Esquemas de ventas sin límite parcial");
  await page.screenshot({
    path: ".playwright-cli/c-schemas-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.waitForTimeout(500);
  if (
    await page.evaluate(
      () =>
        window.__postsC !== 0 ||
        window.__editorC !== document.querySelector(".cm-editor"),
    )
  )
    throw new Error("Explorar recompiló o desmontó CodeMirror");
  await open("credit_risk.etl");
  await tab("Flow");
  await page.getByLabel("Pipeline de FLOW").selectOption("order_report");
  if (
    (await page.getByLabel("Pipeline de FLOW").locator("option").count()) !== 3
  )
    throw new Error("Faltan pipelines");
  for (const text of [
    "entrada .orders",
    "salida .cleaned",
    "entrada .left",
    "entrada .right",
  ])
    if (!(await page.getByText(text, { exact: true }).count()))
      throw new Error("Puerto ausente: " + text);
  await page
    .getByRole("button", { name: "clean.cleaned → joined.left", exact: true })
    .click();
  if ((await selection()).trim() !== "clean.cleaned -> joined.left;")
    throw new Error("La conexión no seleccionó el FLOW original");
  const beforePipeline = await page.evaluate(() => window.__postsC);
  await page.getByLabel("Pipeline de FLOW").selectOption("clean_orders");
  await page.getByLabel("Pipeline de FLOW").selectOption("order_report");
  await page.waitForTimeout(450);
  if ((await page.evaluate(() => window.__postsC)) !== beforePipeline)
    throw new Error("Cambiar pipeline recompiló");
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-flow-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });

  await open("joins.etl");
  await tab("Flow");
  for (const name of [
    "pedidos → unidos.left",
    "clientes → unidos.right",
    "unidos → visibles",
  ])
    if (!(await page.getByRole("button", { name, exact: true }).count()))
      throw new Error("JOIN FLOW incompleto");
  await tab("IR");
  if (
    !(await page
      .locator('.ir-row[data-change="cambiado"]')
      .filter({ hasText: "CHECK_JOIN" })
      .count())
  )
    throw new Error("No aparece CHECK_JOIN comparado");
  await tab("Evidencia O1/O3");
  const evidence = page.locator(".optimization-evidence");
  for (const text of [
    "Prueba estática emitida",
    "Obligaciones dinámicas conservadas, sin ejecutar",
    "Unicidad de la clave derecha",
    "sigue siendo una dependencia leída y validada",
  ])
    if (!(await evidence.innerText()).includes(text))
      throw new Error("Falta evidencia JOIN: " + text);
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-join-evidence-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Ver garantía", exact: true }).click();
  if ((await selection()) !== "VERIFY MANY_TO_ONE;")
    throw new Error("Garantía sin span original");

  await open("rangos.etl");
  await tab("IR");
  if (
    !(await page
      .locator('.ir-row[data-change="eliminado"]')
      .filter({ hasText: "no_negativas" })
      .count())
  )
    throw new Error("Filtro retirado sin comparación");
  await tab("Evidencia O1/O3");
  for (const text of [
    "remove_filter",
    "simplify_predicate",
    "Instantáneas intermedias",
  ]) {
    if (text === "Instantáneas intermedias")
      await page.getByText(/Hechos de la etapa de rangos ·/).click();
    if (!(await evidence.innerText()).includes(text))
      throw new Error("Falta evidencia rangos " + text);
  }
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-ranges-evidence-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await tab("Comparación");
  const rev = (await active()).revision;
  await page.getByLabel("Pases de optimización").selectOption("custom");
  if ((await active()).revision <= rev || (await active()).passes === null)
    throw new Error("Predeterminados/lista explícita confundidos");
  await page.getByRole("checkbox", { name: "joins", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "muertos", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "filtros", exact: true }).uncheck();
  await page.getByRole("button", { name: "Subir rangos", exact: true }).click();
  await live();
  if (JSON.stringify((await active()).passes) !== '["rangos","constantes"]')
    throw new Error("No conservó orden personalizado");
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-custom-passes-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  const customDownload = page.waitForEvent("download");
  await tab("Descargar Python");
  await (await customDownload).saveAs(".playwright-cli/custom-passes.py");
  await page.getByLabel("Pases de optimización").selectOption("O0");
  await live();
  if (
    await page
      .locator(
        '.ir-row[data-change="cambiado"], .ir-row[data-change="eliminado"]',
      )
      .count()
  )
    throw new Error("O0 inventó cambios");
  await page
    .getByText("O0: no se aplica ningún pase.", { exact: false })
    .waitFor();
  await page.reload();
  await page.locator(".cm-content").waitFor();
  if ((await page.getByLabel("Pases de optimización").inputValue()) !== "O0")
    throw new Error("No restauró O0");
  await page.getByLabel("Pases de optimización").selectOption("custom");
  for (const pass of ["joins", "muertos", "filtros"])
    await page.getByRole("checkbox", { name: pass, exact: true }).uncheck();
  await page.getByRole("button", { name: "Subir rangos", exact: true }).click();
  const saved = await active();
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await page.waitForURL("**/docs");
  await page.getByRole("link", { name: "Ejemplos", exact: true }).click();
  await page.waitForURL("**/ejemplos");
  await page
    .getByRole("link", { name: "Abrir Studio", exact: true })
    .first()
    .click();
  if (JSON.stringify(await active()) !== JSON.stringify(saved))
    throw new Error("Consultar contenido cambió documento/pases");
  await page.reload();
  await page.locator(".cm-content").waitFor();
  if (JSON.stringify((await active()).passes) !== '["rangos","constantes"]')
    throw new Error("No restauró personalizados");
  await tab("Compile");
  await live();
  if (
    !(await page.locator(".structured-inspector").innerText()).includes(
      "rangos → constantes",
    )
  )
    throw new Error("Orden efectivo no visible");

  // Stale real: retrasar únicamente la entrega de resultados, manteniendo el worker real.
  await page.evaluate(() => {
    const add = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (!window.__heldWorkerC) {
        window.__heldWorkerC = this;
        window.__handlerC = this.onmessage;
        this.onmessage = (e) => setTimeout(() => window.__handlerC(e), 1200);
      }
      return add.apply(this, args);
    };
  });
  await replace("// revisión nueva\n" + (await active()).source);
  await page.locator('.studio-out[data-origin="desactualizado"]').waitFor();
  if (await page.locator(".source-button:enabled").count())
    throw new Error("Inspección antigua seleccionable");
  if (
    await page
      .getByRole("button", { name: "Descargar Python", exact: true })
      .isEnabled()
  )
    throw new Error("Python antiguo descargable");
  await live();

  const unicode =
    'PIPELINE p { INPUT data: TABLE[x: INT?]; STEP f = FILTER { WHERE "😀" == "é" AND x\n IS NULL; } OUTPUT o: TABLE; FLOW { data -> f -> o; } }';
  await replace(unicode);
  await live();
  await tab("AST");
  const binary = page.getByRole("button", {
    name: "Seleccionar BinaryExpr · AND",
    exact: true,
  });
  await expandUntil(binary);
  await binary.click();
  if ((await selection()) !== '"😀" == "é" AND x\n IS NULL')
    throw new Error("AST Unicode/multilínea incorrecto");
  for (const [code, blocked, availableText] of [
    ["PIPELINE p {", "AST", "Artefacto bloqueado"],
    [unicode.replace("IS NULL", "== NULL"), "IR", "Artefacto bloqueado"],
    [
      "PIPELINE p { INPUT i: TABLE[x: INT]; STEP s = SELECT { COLUMNS missing; } OUTPUT o: TABLE; FLOW { i -> s -> o; } }",
      "IR",
      "IR optimizada: Artefacto bloqueado",
    ],
  ]) {
    await replace(code);
    await live();
    await tab(blocked);
    if (
      !(await page.locator(".structured-inspector").innerText()).includes(
        availableText,
      )
    )
      throw new Error("No respetó artefactos parciales");
  }
  await replace(unicode);
  await live();
  if (await page.locator(".diagnostic-link").count())
    throw new Error("No recuperó tras corregir");

  // Dos temas y dos tamaños; grafo, comparación y árbol con teclado y foco visible.
  await page.getByLabel("Pases de optimización").selectOption("default");
  await live();
  await open("rangos.etl");
  await tab("IR");
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-ir-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cambiar a tema oscuro" }).click();
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("theme-fade"),
  );
  await page.screenshot({
    path: ".playwright-cli/c-ir-desktop-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await tab("Inspector");
  await page.screenshot({
    path: ".playwright-cli/c-ir-mobile-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await tab("Flow");
  await page
    .getByRole("button", { name: "ventas → grandes", exact: true })
    .focus();
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-flow-mobile-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Enter");
  if (!(await page.locator(".cm-content").isVisible()))
    throw new Error("FLOW móvil no volvió al editor");
  await tab("Inspector");
  await page.getByRole("button", { name: "Cambiar a tema claro" }).click();
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("theme-fade"),
  );
  await page.screenshot({
    path: ".playwright-cli/c-flow-mobile-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await tab("Lista de pasos");
  await resetOutput();
  await page.screenshot({
    path: ".playwright-cli/c-list-mobile-light.png",
    fullPage: true,
    animations: "disabled",
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Desbordamiento móvil");
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    inspectors: true,
    astSource: true,
    flowPorts: true,
    compareIR: true,
    rangeEvidence: true,
    joinObligations: true,
    customPassesRestored: true,
    partialArtifacts: true,
    staleSourceBlocked: true,
    noRecompileOnExplore: true,
    unicode: true,
    themes: 2,
    mobile: true,
    keyboard: true,
    productionCompatible: true,
    pageErrors: errors,
  };
};
