async (page) => {
  const origin = new URL(page.url()).origin;
  const errors = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => errors.push(error.message));
  const workspace = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("cauce-workspace-v1")));
  const same = (a, b, message) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message);
  };
  let stage = "initial";
  const live = async () => {
    try {
      await page
        .locator('.studio-out[data-origin="en vivo"]')
        .waitFor({ timeout: 65000 });
    } catch (error) {
      throw new Error(
        `${stage}: ${await page.locator(".studio-status").innerText()} / ${await page.locator(".studio-out").innerText()} / ${error.message}`,
      );
    }
  };
  const edit = async (source) => {
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(source);
  };
  const openCopy = async () => {
    await page
      .getByRole("button", { name: "Abrir una copia en Studio" })
      .click();
    await page.waitForURL((u) => u.pathname === "/studio");
    await page.locator(".cm-content").waitFor();
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin + "/ejemplos");
  await page.evaluate(() => localStorage.removeItem("cauce-workspace-v1"));
  await page.reload();
  await page.getByRole("heading", { name: "Elige un problema" }).waitFor();
  if ((await page.locator(".example-list article").count()) !== 6)
    throw new Error("Catálogo incompleto");
  // Acceso directo a detalle y compilación real desde copia, sin inicializar Python en el catálogo.
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => r.name),
  );
  if (
    resources.some((url) =>
      /pyodide|(?:Editor|AstInspector|FlowInspector|IRInspector|SchemaInspector|Inspector)-[^/]+\.js|\/src\/(?:editor\/Editor|components\/inspectors\/)/.test(url),
    )
  )
    throw new Error("Editor, inspectores o Python cargados en catálogo");
  await page.goto(origin + "/ejemplos/ventas");
  await page
    .getByRole("heading", { name: "Ventas por cliente", exact: true })
    .waitFor();
  const ventas = await page.locator(".example-source").innerText();
  await page
    .getByRole("button", { name: "Abrir una copia en Studio" })
    .focus();
  if (
    !(await page
      .getByRole("button", { name: "Abrir una copia en Studio" })
      .evaluate(
        (el) =>
          el.matches(":focus-visible") &&
          getComputedStyle(el).outlineStyle !== "none",
      ))
  )
    throw new Error("Acción sin foco visible");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname === "/studio");
  await page.locator(".cm-content").waitFor();
  same(
    (await workspace()).active.source,
    ventas,
    "La copia no conserva el fuente",
  );
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  stage = "ventas abierta";
  await live();
  if (await page.locator(".diagnostic-link").count())
    throw new Error("Ventas no compiló");
  const own = ventas + "\n// mi documento editado café 😀";
  await edit(own);
  stage = "ventas editada";
  await live();
  await page.getByLabel("Nombre del documento").fill("mi-ventas.etl");
  await page.getByLabel("Pases de optimización").selectOption("O0");
  await page.getByRole("button", { name: "IR", exact: true }).click();
  stage = "nombre, O0 e inspector IR";
  await live();
  const beforeDocs = await workspace();
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Docs" })
    .click();
  await page.getByRole("heading", { name: "Aprende Cauce" }).waitFor();
  await page
    .getByRole("heading", { name: "Operaciones y expresiones" })
    .getByRole("link")
    .click();
  await page
    .getByRole("heading", { name: "Operaciones y expresiones", level: 1 })
    .waitFor();
  await page
    .getByRole("navigation", { name: "En este artículo" })
    .getByRole("link", { name: "Expresiones", exact: true })
    .click();
  await page.waitForURL("**#expresiones");
  same(
    await workspace(),
    beforeDocs,
    "Consultar un artículo modificó el documento",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Expresiones", exact: true })
    .waitFor();
  if (
    !(await page
      .locator("#expresiones")
      .evaluate(
        (el) =>
          el === document.activeElement &&
          el.getBoundingClientRect().top < innerHeight,
      ))
  )
    throw new Error("Ancla directa sin foco o scroll");
  await page.getByRole("link", { name: "Volver a tu documento" }).click();
  await page.locator(".cm-content").waitFor();
  same(
    (await workspace()).active,
    beforeDocs.active,
    "Volver perdió texto, revisión, pases o inspector",
  );
  await page.goBack();
  await page.waitForURL("**/docs/operaciones#expresiones");
  await page.goForward();
  await page.waitForURL((u) => u.pathname === "/studio");
  same(
    (await workspace()).active,
    beforeDocs.active,
    "Historial perdió el documento",
  );

  // Ejercicio inválido: seleccionar el diagnóstico real con teclado y corregir su intervalo.
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Ejemplos" })
    .click();
  await page
    .getByRole("heading", { name: "Corregir una comparación con NULL" })
    .getByRole("link")
    .click();
  const invalid = await page.locator(".example-source").innerText();
  await openCopy();
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  stage = "ejercicio inválido";
  await live();
  const diagnostic = page.getByRole("button", { name: /E_NULL_COMPARISON/ });
  await diagnostic.focus();
  await page.keyboard.press("Enter");
  if (
    !(await page
      .locator(".cm-content")
      .evaluate(
        (el) =>
          el === document.activeElement &&
          window.getSelection().toString() === "status == NULL",
      ))
  )
    throw new Error("Diagnóstico sin intervalo seleccionado");
  await page.keyboard.insertText("status IS NULL");
  stage = "ejercicio corregido";
  await live();
  if (await page.locator(".diagnostic-link").count())
    throw new Error("Corrección falló");
  same(
    (await workspace()).active.source,
    invalid.replace("status == NULL", "status IS NULL"),
    "Corrección alteró otra parte del programa",
  );
  let state = await workspace();
  if (
    !state.drafts.some(
      (d) => JSON.stringify(d) === JSON.stringify(beforeDocs.active),
    )
  )
    throw new Error("Copia perdió borrador editado");
  await page.locator(".drafts summary").click();
  await page
    .locator(".drafts li")
    .filter({ hasText: "mi-ventas.etl" })
    .getByRole("button", { name: "Recuperar" })
    .click();
  same(
    (await workspace()).active,
    beforeDocs.active,
    "Recuperar no conserva todas las opciones",
  );

  // Artículo → ejemplo → estudio, luego otra copia independiente del mismo ejemplo.
  await page.goto(origin + "/docs/composicion");
  await page
    .locator(".reading")
    .getByRole("link", { name: "Riesgo crediticio y composición", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Riesgo crediticio y composición", level: 1 })
    .waitFor();
  await openCopy();
  if ((await workspace()).active.name !== "credit_risk.etl")
    throw new Error("Artículo abrió programa incorrecto");
  const firstCopy = (await workspace()).active;
  await page.goto(origin + "/ejemplos/riesgo-crediticio");
  await openCopy();
  state = await workspace();
  if (
    state.active.id === firstCopy.id ||
    !state.drafts.some((d) => d.id === firstCopy.id)
  )
    throw new Error("Copias comparten identidad");

  for (const [path, title] of [
    ["/ejemplos/no-existe", "Ejemplo no encontrado"],
    ["/docs/no-existe", "Artículo no encontrado"],
    ["/ruta-inexistente", "Página no encontrada"],
    ["/ejemplos/ventas/extra", "Página no encontrada"],
  ]) {
    const before = await workspace();
    await page.goto(origin + path);
    await page.getByRole("heading", { name: title }).waitFor();
    same(await workspace(), before, "Ruta inexistente modificó documento");
  }
  // Límites reales: ocho anteriores bloquean la copia sin expulsar ninguno.
  await page.goto(origin + "/ejemplos/ventas");
  const limited = await workspace();
  while (limited.drafts.length < 8)
    limited.drafts.push({
      ...limited.active,
      id: "limite-" + limited.drafts.length,
    });
  await page.evaluate(
    (state) =>
      localStorage.setItem("cauce-workspace-v1", JSON.stringify(state)),
    limited,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Abrir una copia en Studio" })
    .click();
  await page.getByRole("alert").filter({ hasText: "8 borradores" }).waitFor();
  same(await workspace(), limited, "Límite expulsó un borrador");
  if (!page.url().endsWith("/ejemplos/ventas"))
    throw new Error("Navegó pese a bloquear copia");
  await page
    .getByRole("link", { name: "Gestionar borradores en el estudio" })
    .click();
  await page.locator(".drafts summary").click();
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page
    .locator(".drafts li")
    .last()
    .getByRole("button", { name: "Eliminar" })
    .click();
  await page.goto(origin + "/ejemplos/ventas");
  // Fallo de cuota: aviso visible en estudio y copia en memoria; el sobre persistido queda intacto.
  const persisted = await workspace();
  await page.evaluate(() => {
    window.__cauceSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("Sin cuota", "QuotaExceededError");
    };
  });
  await openCopy();
  await page.getByRole("status").filter({ hasText: "Sin guardar:" }).waitFor();
  same(
    await workspace(),
    persisted,
    "Fallo de almacenamiento sobrescribió borrador persistido",
  );
  if (
    (await page.getByLabel("Nombre del documento").inputValue()) !==
    "ventas.etl"
  )
    throw new Error("No abrió en memoria");
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__cauceSetItem;
  });
  await page.getByLabel("Nombre del documento").fill("ventas-recuperada.etl");
  await page
    .getByRole("status")
    .filter({ hasText: "Guardado en este navegador." })
    .waitFor();
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Docs" })
    .click();

  // Capturas en lote: ambas superficies e índices, escritorio/móvil y ambos temas.
  for (const [width, height, size] of [
    [1440, 1000, "desktop"],
    [390, 844, "mobile"],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("cauce-theme", theme);
      }, theme);
      for (const [path, name] of [
        ["/ejemplos", "catalog"],
        ["/ejemplos/join-verificado", "example"],
        ["/docs", "docs"],
        ["/docs/operaciones", "article"],
      ]) {
        await page.goto(origin + path);
        await page.locator(".content-heading h1").waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )
        )
          throw new Error("Desbordamiento en " + path + " " + size);
        if (name === "article" && await page.locator('.reading ol').evaluate(el => getComputedStyle(el).listStyleType) !== 'decimal') throw new Error('Precedencia sin numeración visible');
        const headingFocused = await page
          .locator("h1")
          .evaluate((el) => el === document.activeElement);
        if (!headingFocused) throw new Error("Página sin foco al entrar");
        await page.screenshot({
          path: `.playwright-cli/content-${name}-${size}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (size === "mobile") {
          for (const name of ["Ejemplos", "Docs"]) {
            const link = page
              .getByRole("navigation", { name: "Principal" })
              .getByRole("link", { name, exact: true });
            if (
              !(await link.isVisible()) ||
              (await link.evaluate(
                (el) => el.getBoundingClientRect().height < 44,
              ))
            )
              throw new Error("Navegación móvil inaccesible");
          }
        }
      }
    }
  }
  // Navegación de teclado real: Tab desde el encabezado, Enter en la primera ancla.
  await page
    .getByRole("navigation", { name: "En este artículo" })
    .getByRole("link", { name: "Expresiones", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**#expresiones");
  await page.keyboard.press("Tab");
  if (
    !(await page.evaluate(
      () =>
        document.activeElement.matches(":focus-visible") &&
        getComputedStyle(document.activeElement).outlineStyle !== "none",
    ))
  )
    throw new Error("Foco de teclado invisible");
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    content: true,
    directRoutes: true,
    validCompile: true,
    invalidCorrection: true,
    docsPreserve: true,
    draftRecovery: true,
    articleExampleStudio: true,
    independentCopies: true,
    history: true,
    missing: true,
    storageLimit: true,
    storageFailure: true,
    screenshots: 16,
    themes: 2,
    mobile: true,
    keyboard: true,
    pageErrors: errors,
  };
};
