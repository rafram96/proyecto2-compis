async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const origin = new URL(page.url()).origin;
  const unicode =
    'PIPELINE p { INPUT data: TABLE[x: INT?]; STEP f = FILTER { WHERE "😀" == "é" AND x\n == NULL; } OUTPUT o: TABLE; FLOW { data -> f -> o; } }';
  const fixed = unicode.replace("== NULL", "IS NULL");
  const waitLive = () =>
    page.locator('.studio-out[data-origin="en vivo"]').waitFor({ state: "attached" });
  const replaceCode = async (source) => {
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(source);
  };
  const editorState = () =>
    page.evaluate(async () => {
      const module = (
        await (await fetch("/src/editor/Editor.tsx")).text()
      ).match(/from "([^"]*codemirror_view[^"]*)"/);
      if (!module) throw new Error("No se encontró CodeMirror");
      const { EditorView } = await import(module[1]);
      const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
      window.__cauceEditor = view;
      return {
        text: view.state.doc.toString(),
        selection: view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to,
        ),
        from: view.state.selection.main.from,
        scroll: view.scrollDOM.scrollTop,
      };
    });

  // La paridad anterior dejó el ejemplo con emoji y error multilínea en la demo.
  await page.getByRole("switch", { name: "Optimizar" }).click();
  await page
    .getByRole("link", { name: "Continuar en el estudio", exact: true })
    .click();
  await page.waitForURL((u) => u.pathname === "/studio");
  await waitLive();
  if ((await page.getByLabel("Pases de optimización").inputValue()) !== "O0")
    throw new Error("No se transfirieron los pases de la demo");
  if ((await editorState()).text !== unicode)
    throw new Error("No se transfirió el texto editado");
  await page.getByRole("button", { name: "Python", exact: true }).click();
  await page.getByRole("button", { name: /E_NULL_COMPARISON/ }).focus();
  await page.keyboard.press("Enter");
  if (
    !(await page
      .locator(".cm-content")
      .evaluate((el) => el === document.activeElement))
  )
    throw new Error("El diagnóstico no enfocó CodeMirror");
  if ((await editorState()).selection !== "x\n == NULL")
    throw new Error("Selección Unicode multilínea incorrecta");

  await page.evaluate(() => {
    window.__caucePosts = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      window.__caucePosts++;
      return post.apply(this, args);
    };
  });
  const before = await editorState();
  for (const name of ["AST", "Tokens", "Parse tree", "IR", "Resultado"])
    await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(400);
  const after = await editorState();
  if (
    (await page.evaluate(() => window.__caucePosts)) !== 0 ||
    before.from !== after.from ||
    before.scroll !== after.scroll
  )
    throw new Error("Cambiar inspector compiló o perdió la selección/posición");
  if (
    !(await page.evaluate(
      () => window.__cauceEditor.dom === document.querySelector(".cm-editor"),
    ))
  )
    throw new Error("Se recreó el editor");
  await replaceCode(fixed);
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await waitLive();
  if (await page.locator(".diagnostic-link").count())
    throw new Error("Persisten diagnósticos después de corregir");
  await page.getByRole("button", { name: "Python", exact: true }).click();
  await page
    .getByRole("button", { name: "Descargar Python", exact: true })
    .waitFor({ state: "visible" });
  if (
    !(await page
      .getByRole("button", { name: "Descargar Python", exact: true })
      .isEnabled())
  )
    throw new Error("Python vigente no descargable");

  // Descargas reales: el verificador Python compara luego sus bytes con el fuente y el puente CPython.
  let downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Descargar .etl", exact: true })
    .click();
  let download = await downloadEvent;
  if (download.suggestedFilename() !== "pendientes.etl")
    throw new Error("Nombre de exportación ETL incorrecto");
  await download.saveAs(".playwright-cli/workspace-export.etl");
  downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Descargar Python", exact: true })
    .click();
  download = await downloadEvent;
  if (download.suggestedFilename() !== "pendientes.py")
    throw new Error("Nombre de exportación Python incorrecto");
  await download.saveAs(".playwright-cli/workspace-export.py");
  // Editar invalida de inmediato Python, antes del debounce.
  await replaceCode(fixed + "\n// revisión siguiente");
  if (
    await page
      .getByRole("button", { name: "Descargar Python", exact: true })
      .isEnabled()
  )
    throw new Error("Descarga habilitada para una revisión anterior");
  await page.locator('.studio-out[data-origin="desactualizado"]').waitFor();
  await waitLive();

  const imported =
    "// importación café 😀\r\nPIPELINE importado { INPUT i: TABLE[x: INT]; OUTPUT o: TABLE; FLOW { i -> o; } }\r\n";
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "importado.etl",
      mimeType: "text/plain",
      buffer: Buffer.from(imported, "utf8"),
    });
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="Nombre del documento"]')
        ?.value === "importado.etl",
  );
  await waitLive();
  // CodeMirror normaliza CRLF a LF al construir el documento. El importador conserva el texto hasta editar.
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cauce-workspace-v1")),
  );
  if (
    saved.active.source !== imported ||
    !saved.drafts.some((d) => d.source === fixed + "\n// revisión siguiente")
  )
    throw new Error("Importación perdió el texto o el borrador anterior");
  await page.getByRole("button", { name: "IR", exact: true }).click();
  await page.reload();
  await page.locator(".cm-content").waitFor();
  if (
    (await page.getByLabel("Nombre del documento").inputValue()) !==
      "importado.etl" ||
    (await page
      .getByRole("button", { name: "IR", exact: true })
      .getAttribute("aria-pressed")) !== "true"
  )
    throw new Error("No se restauró el documento o el inspector");
  if (!(await page.locator(".save-status").innerText()).includes("restaurado"))
    throw new Error("Falta aviso de restauración");
  await page
    .getByRole("link", { name: "Volver al inicio", exact: true })
    .click();
  await page.waitForURL(origin + "/");
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/studio");
  if (
    (await page.getByLabel("Nombre del documento").inputValue()) !==
    "importado.etl"
  )
    throw new Error("Atrás perdió el documento");
  await page.goForward();
  await page.waitForURL(origin + "/");
  await page.goto(origin + "/ruta-inexistente");
  await page.getByRole("heading", { name: "Página no encontrada" }).waitFor();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Abrir Studio" })
    .click();
  await page.waitForURL((u) => u.pathname === "/studio");

  // Fallo real de descarga inicial de Pyodide en el worker, seguido de recuperación.
  await page
    .context()
    .route("**/pyodide/v314.0.7/full/pyodide.mjs", (route) =>
      route.abort("failed"),
    );
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page
    .locator('.studio-status[data-status="error"]')
    .waitFor({ timeout: 20000 });
  if (
    (await page.getByLabel("Nombre del documento").inputValue()) !==
    "importado.etl"
  )
    throw new Error("Fallo de carga perdió el documento");
  await page.context().unroute("**/pyodide/v314.0.7/full/pyodide.mjs");
  await page
    .getByRole("button", { name: "Reiniciar compilador", exact: true })
    .click();
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  // Cambios de ejemplo durante la carga y ediciones rápidas: termina con la última revisión.
  await page.getByLabel("Abrir ejemplo").selectOption("credit_risk.etl");
  await page.getByLabel("Abrir ejemplo").selectOption("ventas.etl");
  await replaceCode(fixed + "\n// última edición");
  await page.keyboard.insertText(" rápida");
  await page
    .locator('.studio-status[data-status="ready"]')
    .waitFor({ timeout: 60000 });
  await waitLive();
  const final = await page.evaluate(
    () => JSON.parse(localStorage.getItem("cauce-workspace-v1")).active,
  );
  if (final.source !== fixed + "\n// última edición rápida")
    throw new Error("Se perdió una edición rápida");

  // EOF: el intervalo vacío lleva el cursor al final.
  await replaceCode("PIPELINE p {\n");
  await waitLive();
  await page.locator(".diagnostic-link").first().click();
  const eof = await editorState();
  if (eof.from !== eof.text.length || eof.selection)
    throw new Error("El diagnóstico EOF no seleccionó el final");
  await replaceCode(fixed);
  await waitLive();
  await page.getByRole("button", { name: "Python", exact: true }).click();
  const displaySource = await page.evaluate(async () => (await import("/src/data/index.ts")).programs["ventas.etl"].source);
  await replaceCode(displaySource);
  await waitLive();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".playwright-cli/studio-desktop-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cambiar a tema oscuro" }).click();
  await page.screenshot({
    path: ".playwright-cli/studio-desktop-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  if (
    !(await page.evaluate(
      () => window.__cauceEditor.dom === document.querySelector(".cm-editor"),
    ))
  )
    throw new Error("Cambiar tema recreó el editor");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  if (
    (await page.locator(".cm-content").isVisible()) ||
    !(await page.locator(".studio-out").isVisible())
  )
    throw new Error("Paneles móviles comprimidos o superpuestos");
  await page.screenshot({
    path: ".playwright-cli/studio-mobile-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Cambiar a tema claro" }).click();
  await page.getByRole("button", { name: "Código", exact: true }).click();
  await page.screenshot({
    path: ".playwright-cli/studio-mobile-light.png",
    fullPage: true,
    animations: "disabled",
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Desbordamiento horizontal móvil");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  if (
    await page
      .locator(".cm-content")
      .evaluate((el) => el === document.activeElement)
  )
    throw new Error("No se puede salir del editor con teclado");
  // El diagnóstico también regresa desde el inspector móvil al editor, con foco.
  await replaceCode(unicode);
  await waitLive();
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await page.locator(".diagnostic-link").first().focus();
  await page.keyboard.press("Enter");
  if (!await page.locator(".cm-content").isVisible() || (await editorState()).selection !== "x\n == NULL") throw new Error("Diagnóstico móvil sin foco/selección");
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    workspace: true,
    transfer: true,
    diagnostics: ["unicode", "multiline", "EOF"],
    imports: true,
    downloads: true,
    restored: true,
    history: true,
    unknownRoute: true,
    loadFailureRecovery: true,
    rapidEdits: true,
    themes: 2,
    mobile: true,
    keyboard: true,
    pageErrors: errors,
  };
}
