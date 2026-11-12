async (page) => {
  // Cierre de W1: divisor editor/inspector, persistencia de la disposición y enlaces /studio?vista=….
  // Funciona en Vite y en el build servido (sin imports de /src/); necesita la API para el trabajo en memoria.
  const origin = new URL(page.url()).origin;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fail = (message) => {
    throw new Error(message);
  };
  const WS = "cauce-workspace-v1";
  const LAYOUT = "cauce-studio-layout-v1";
  const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);
  const active = async () => JSON.parse(await stored(WS)).active;
  const sep = () => page.getByRole("separator", { name: "Ancho del editor y del inspector" });
  const now = async () => Number(await sep().getAttribute("aria-valuenow"));
  const pressed = (name) =>
    page.locator(".studio-formats").getByRole("button", { name, exact: true });
  const isPressed = async (name) => (await pressed(name).getAttribute("aria-pressed")) === "true";
  const search = () => new URL(page.url()).search;
  const path = () => new URL(page.url()).pathname;
  const widths = () =>
    page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect().width;
      return {
        code: box("studio-code"),
        inspector: box("studio-inspector"),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  const live = () => page.locator('.studio-out[data-origin="en vivo"]').waitFor({ timeout: 65000 });
  const clean = async () => {
    await page.goto(origin + "/studio");
    await page.evaluate(([a, b]) => {
      localStorage.removeItem(a);
      localStorage.removeItem(b);
    }, [WS, LAYOUT]);
    await page.reload();
    await page.locator(".cm-content").waitFor();
  };

  // 1. Divisor accesible en escritorio, sin escribir nada hasta que se ajusta.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await clean();
  const attrs = await sep().evaluate((el) =>
    Object.fromEntries(
      ["aria-orientation", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-controls", "tabindex"].map((a) => [
        a,
        el.getAttribute(a),
      ]),
    ),
  );
  if (
    JSON.stringify(attrs) !==
    JSON.stringify({
      "aria-orientation": "vertical",
      "aria-valuemin": "30",
      "aria-valuemax": "70",
      "aria-valuenow": "50",
      "aria-controls": "studio-code studio-inspector",
      tabindex: "0",
    })
  )
    fail("Atributos del separador: " + JSON.stringify(attrs));
  const hit = await sep().boundingBox();
  if (hit.width < 44 || hit.height < 44) fail("Objetivo del divisor menor de 44 px");
  if ((await stored(LAYOUT)) !== null) fail("Se guardó una disposición sin ajustar");
  const even = await widths();
  if (Math.abs(even.code - even.inspector) > 2) fail("El 50 % inicial no reparte el ancho");

  // 2. Estado del editor que el ajuste no debe tocar: texto largo, selección, scroll e historial.
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await live();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(
    "\n" + Array.from({ length: 70 }, (_, i) => `// línea de relleno ${i} ñ`).join("\n"),
  );
  await live();
  await page.keyboard.insertText("\n// marcador-deshacer");
  await live();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");
  // CodeMirror aplica el scrollIntoView de la selección en el siguiente cuadro: se espera antes de fijar el scroll.
  await page.locator(".cm-scroller").evaluate(async (el) => {
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await settle();
    el.scrollTop = 420;
    await settle();
  });
  const before = await page.evaluate(() => {
    window.__postsS = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      window.__postsS++;
      return post.apply(this, args);
    };
    window.__editorS = document.querySelector(".cm-editor");
    window.__noReloadS = true;
    return { scroll: document.querySelector(".cm-scroller").scrollTop };
  });
  if (before.scroll < 300) fail("No se pudo preparar el scroll del editor: " + before.scroll);
  const docBefore = await stored(WS);
  const firstLine = (await active()).source.split("\n")[0];

  // 3. Ratón: arrastrar, límites y doble clic para restablecer.
  const drag = async (fraction) => {
    const panels = await page.locator(".workspace-panels").boundingBox();
    const box = await sep().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const x = panels.x + 22 + fraction * (panels.width - 44);
    await page.mouse.move(x, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
  };
  await drag(0.36);
  const dragged = await now();
  if (Math.abs(dragged - 36) > 1) fail(`Arrastre impreciso: ${dragged}`);
  if (JSON.parse(await stored(LAYOUT)).editor !== dragged) fail("No se guardó el arrastre");
  const narrow = await widths();
  if (!(narrow.code < narrow.inspector) || narrow.overflow) fail("Arrastre sin efecto o con desbordamiento");
  await drag(0.02);
  if ((await now()) !== 30) fail("Sin límite mínimo");
  await page.screenshot({ path: ".playwright-cli/s-desktop-light-30.png", animations: "disabled" });
  await drag(0.99);
  if ((await now()) !== 70) fail("Sin límite máximo");
  const wide = await widths();
  if (!(wide.code > wide.inspector * 1.8) || wide.overflow) fail("El máximo no ensancha el editor");
  await page.screenshot({ path: ".playwright-cli/s-desktop-light-70.png", animations: "disabled" });
  await sep().dblclick();
  if ((await now()) !== 50) fail("Doble clic no restablece");

  // 4. Teclado: foco visible, flechas, Mayús, Inicio/Fin e Intro.
  await pressed("Resultado").focus();
  await page.keyboard.press("Shift+Tab");
  if (!(await sep().evaluate((el) => document.activeElement === el && el.matches(":focus-visible") && getComputedStyle(el).outlineStyle !== "none")))
    fail("Separador sin foco visible por teclado");
  await page.screenshot({ path: ".playwright-cli/s-desktop-light-focus.png", animations: "disabled" });
  const keys = [];
  for (const key of ["ArrowLeft", "Shift+ArrowLeft", "Home", "End", "Shift+ArrowLeft", "Enter", "ArrowRight", "ArrowRight"]) {
    await page.keyboard.press(key);
    keys.push(await now());
  }
  if (JSON.stringify(keys) !== JSON.stringify([48, 38, 30, 70, 60, 50, 52, 54])) fail("Teclado: " + JSON.stringify(keys));
  if ((await sep().getAttribute("aria-valuetext")) !== "Editor 54 %, inspector 46 %") fail("aria-valuetext incorrecto");

  // Nada de lo anterior recompiló, recreó CodeMirror, recargó ni tocó el documento.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await page.evaluate(() => ({
    posts: window.__postsS,
    same: window.__editorS === document.querySelector(".cm-editor"),
    scroll: document.querySelector(".cm-scroller").scrollTop,
    noReload: window.__noReloadS === true,
  }));
  if (after.posts !== 0 || !after.same || !after.noReload) fail("Ajustar recompiló o desmontó el editor: " + JSON.stringify(after));
  if (Math.abs(after.scroll - before.scroll) > 1) fail(`Scroll perdido: ${before.scroll} → ${after.scroll}`);
  if ((await stored(WS)) !== docBefore) fail("Ajustar el tamaño modificó cauce-workspace-v1");
  // Selección e historial: escribir sustituye la primera línea seleccionada; deshacer la recupera.
  await page.locator(".cm-content").focus();
  await page.keyboard.insertText("// sustituida");
  const replaced = (await active()).source;
  if (replaced.split("\n")[0] !== "// sustituida") fail("Se perdió la selección del editor");
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForFunction((line) => JSON.parse(localStorage.getItem("cauce-workspace-v1")).active.source.split("\n")[0] === line, firstLine);
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("cauce-workspace-v1")).active.source.includes("marcador-deshacer"));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("cauce-workspace-v1")).active.source.includes("marcador-deshacer"));

  // 5. Persistencia tras recargar; valor dañado y almacenamiento que falla.
  await page.reload();
  await page.locator(".cm-content").waitFor();
  if ((await now()) !== 54) fail("La disposición no sobrevivió a la recarga");
  const reloaded = await widths();
  if (!(reloaded.code > reloaded.inspector)) fail("La recarga no aplicó la proporción");
  await page.evaluate((k) => localStorage.setItem(k, '{"version":1,"editor":95}'), LAYOUT);
  await page.reload();
  await page.locator(".cm-content").waitFor();
  if ((await now()) !== 50) fail("Una disposición fuera de rango no volvió al 50 %");
  await page.evaluate((k) => {
    window.__setItemS = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === k) throw new DOMException("cuota", "QuotaExceededError");
      return window.__setItemS.call(this, key, value);
    };
  }, LAYOUT);
  await sep().focus();
  await page.keyboard.press("End");
  if ((await now()) !== 70) fail("Con almacenamiento fallido el ajuste debe seguir en memoria");
  if ((await stored(LAYOUT)) !== '{"version":1,"editor":95}') fail("Se escribió pese al fallo");
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__setItemS;
  });
  await page.keyboard.press("Enter");
  if (JSON.parse(await stored(LAYOUT)).editor !== 50) fail("No se recuperó el guardado");

  // 6. ?vista directo para cada vista: solo cambia el inspector, sin revisión nueva.
  const views = [
    ["resultado", "Resultado"],
    ["tokens", "Tokens"],
    ["arbol", "Parse tree"],
    ["ast", "AST"],
    ["flow", "Flow"],
    ["ir", "IR"],
    ["esquemas", "Schemas"],
    ["python", "Python"],
  ];
  const doc0 = await active();
  for (const [slug, label] of views) {
    await page.goto(origin + "/studio?vista=" + slug);
    await page.locator(".cm-content").waitFor();
    if (!(await isPressed(label))) fail(`?vista=${slug} no seleccionó ${label}`);
    const doc = await active();
    if (doc.inspector === undefined || doc.id !== doc0.id || doc.revision !== doc0.revision || doc.source !== doc0.source)
      fail(`?vista=${slug} modificó el documento`);
    if (search() !== "?vista=" + slug) fail("La URL válida cambió");
  }
  await page.goto(origin + "/studio?vista=ejecucion");
  await page.locator("#results-title").waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "results-title");
  if (!(await isPressed("Python"))) fail("?vista=ejecucion cambió el inspector");
  if (!(await page.locator("#results-title").evaluate((el) => el.getBoundingClientRect().top < innerHeight)))
    fail("?vista=ejecucion no llevó a Resultados");

  // 7. Valor inválido: aviso visible, vista del documento y URL limpia.
  await page.goto(origin + "/studio?vista=bloques&doc=123");
  const notice = page.locator(".view-notice");
  await notice.waitFor();
  const noticeText = await notice.innerText();
  if (!noticeText.includes("vista=bloques") || !noticeText.includes("doc") || !noticeText.includes("Python"))
    fail("Aviso de vista inválida incompleto: " + noticeText);
  if (search() !== "" || !(await isPressed("Python"))) fail("Fallback de vista inválida incorrecto");
  await page.goto(origin + "/studio?vista=ir&doc=abc");
  await notice.waitFor();
  if (search() !== "?vista=ir" || !(await isPressed("IR"))) fail("Se perdió la vista válida con parámetros extra");

  // 8. Elegir vista reemplaza la entrada del historial; un enlace con otra consulta no recarga.
  const length0 = await page.evaluate(() => history.length);
  await pressed("AST").click();
  if (search() !== "?vista=ast") fail("La URL no siguió a la vista");
  await pressed("Flow").click();
  if (search() !== "?vista=flow" || (await page.evaluate(() => history.length)) !== length0)
    fail("Cambiar de vista debe usar replaceState");
  if (await notice.count()) fail("El aviso sigue tras elegir una vista");
  await page.evaluate(() => {
    window.__noReloadS = true;
    const a = document.createElement("a");
    a.href = "/studio?vista=esquemas";
    a.textContent = "enlace interno de prueba";
    a.id = "s-link";
    document.querySelector(".app-page").append(a);
  });
  await page.locator("#s-link").click();
  await page.waitForURL((u) => u.search === "?vista=esquemas");
  if (!(await isPressed("Schemas")) || !(await page.evaluate(() => window.__noReloadS === true)))
    fail("Enlace con la misma ruta recargó o no aplicó la vista");
  await page.goBack();
  await page.waitForURL((u) => u.search === "?vista=flow");
  if (!(await isPressed("Flow"))) fail("Atrás dentro de Studio no recuperó la vista");
  await page.goForward();
  await page.waitForURL((u) => u.search === "?vista=esquemas");
  if (!(await isPressed("Schemas"))) fail("Adelante dentro de Studio no recuperó la vista");

  // 9. Preparar trabajo real: pases personalizados y ejecución en memoria.
  await page.getByRole("button", { name: "Compile", exact: true }).click();
  await page.getByLabel("Pases de optimización").selectOption("custom");
  for (const pass of ["joins", "muertos", "filtros"]) await page.getByRole("checkbox", { name: pass, exact: true }).uncheck();
  await page.getByRole("button", { name: "Subir rangos", exact: true }).click();
  await live();
  await page.getByText("Servicio conectado · demo privada", { exact: true }).waitFor();
  await page.getByLabel("Dataset para ventas.pedidos", { exact: true }).selectOption("orders@1");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator('.execution-job[data-state="succeeded"]').waitFor({ timeout: 20000 });
  await page.locator(".execution-results tbody").first().waitFor();
  const runId = await page.locator(".execution-job").getAttribute("data-run-id");
  const saved = await stored(WS);
  if (JSON.stringify(JSON.parse(saved).active.passes) !== '["rangos","constantes"]') fail("Preparación de pases fallida");
  await page.evaluate(() => {
    window.__noReloadS = true;
  });

  // Atrás/adelante desde otras páginas recupera la vista.
  await pressed("Python").click();
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await page.waitForURL("**/docs");
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/studio" && u.search === "?vista=python");
  if (!(await isPressed("Python"))) fail("Atrás desde docs no recuperó la vista");

  // 10. Recorridos docs → enlace → estudio y evaluación → enlace → estudio.
  const kept = async (label) => {
    if ((await stored(WS)) !== saved.replace(/"inspector":"[a-z]+"/, (await stored(WS)).match(/"inspector":"[a-z]+"/)[0]))
      fail(`${label}: el documento cambió más allá del inspector`);
    if ((await page.getByLabel("Pases de optimización").inputValue()) !== "custom") fail(`${label}: se perdieron los pases`);
    await page.locator(`.execution-job[data-run-id="${runId}"][data-state="succeeded"]`).waitFor();
    if (!(await page.evaluate(() => window.__noReloadS === true))) fail(`${label}: hubo recarga completa`);
  };
  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await page.locator(".docs-nav").getByRole("link", { name: "PIPELINE, STEP y FLOW", exact: true }).click();
  await page.waitForURL("**/docs/estructura");
  await page.getByRole("link", { name: "Ver el FLOW de tu documento en Studio" }).click();
  await page.waitForURL((u) => u.pathname === "/studio" && u.search === "?vista=flow");
  await page.locator(".cm-content").waitFor();
  if (!(await isPressed("Flow"))) fail("El enlace de docs no abrió FLOW");
  await kept("docs → estudio");
  await page.goBack();
  await page.waitForURL("**/docs/estructura");
  await page.goForward();
  await page.waitForURL((u) => u.search === "?vista=flow");
  await page.getByRole("link", { name: "Benchmarks", exact: true }).click();
  await page.waitForURL("**/evaluacion");
  await page.getByRole("button", { name: /Mejora observada/ }).click();
  await page.waitForURL(/workload=join/);
  const evalLink = page.getByRole("link", { name: "Abrir la vista IR de Studio" });
  await evalLink.scrollIntoViewIfNeeded();
  await evalLink.click();
  await page.waitForURL((u) => u.pathname === "/studio" && u.search === "?vista=ir");
  await page.locator(".cm-content").waitFor();
  if (!(await isPressed("IR"))) fail("El enlace de la evaluación no abrió IR");
  await kept("evaluación → estudio");

  // 11. Resultados (tabla y gráfico) con distintos anchos y proporciones; sin desbordamiento global.
  await page.getByText("Gráfico de esta página", { exact: true }).click();
  await page.getByRole("img", { name: /por fila de la página actual/ }).waitFor();
  let checks = 0;
  for (const width of [861, 1100, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const key of ["Home", "End"]) {
      await sep().focus();
      await page.keyboard.press(key);
      const w = await widths();
      if (w.overflow) fail(`Desbordamiento a ${width}px con ${key}`);
      if (w.code < 270 || w.inspector < 300) fail(`Panel demasiado estrecho a ${width}px: ${JSON.stringify(w)}`);
      const results = await page.locator(".execution-panel").evaluate((el) => {
        const table = el.querySelector(".inspector-table-scroll");
        const chart = el.querySelector(".preview-chart svg, .preview-chart [role=img]");
        return {
          panel: el.getBoundingClientRect().width <= innerWidth,
          table: !!table && table.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1,
          chart: !!chart && chart.getBoundingClientRect().width > 100 && chart.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1,
        };
      });
      if (!results.panel || !results.table || !results.chart) fail(`Resultados mal dispuestos a ${width}px: ${JSON.stringify(results)}`);
      checks++;
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await sep().focus();
  await page.keyboard.press("Enter");

  // 12. Capturas: escritorio y móvil, ambos temas, movimiento reducido.
  let screenshots = 0;
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + "/studio?vista=ir");
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.locator(".cm-content").waitFor();
    await sep().focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.screenshot({ path: `.playwright-cli/s-desktop-${theme}.png`, animations: "disabled" });
    await page.keyboard.press("Enter");
    await page.goto(origin + "/studio?vista=bloques");
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.locator(".view-notice").waitFor();
    await page.screenshot({ path: `.playwright-cli/s-desktop-${theme}-aviso.png`, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/studio?vista=ir");
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.locator(".workspace-panels[data-pane='inspector']").waitFor();
    if (await sep().isVisible()) fail("El divisor aparece en móvil");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) fail(`Desbordamiento móvil ${theme}`);
    if (!(await isPressed("IR"))) fail("Móvil sin la vista del enlace");
    await page.screenshot({ path: `.playwright-cli/s-mobile-${theme}-inspector.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Código", exact: true }).click();
    await page.locator(".cm-content").waitFor();
    if (!(await page.locator(".cm-content").isVisible())) fail("Alternancia móvil rota");
    await page.screenshot({ path: `.playwright-cli/s-mobile-${theme}-code.png`, animations: "disabled" });
    screenshots += 5;
  }
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  if (errors.length) fail("Errores de página: " + errors.join(" | "));
  return {
    studio: true,
    splitterMouse: true,
    splitterKeyboard: true,
    layoutPersisted: true,
    layoutStorageFailure: true,
    editorPreserved: true,
    noRecompileOnResize: true,
    viewLinks: views.length + 1,
    invalidView: true,
    history: true,
    linkJourneys: true,
    resultsWidths: checks,
    screenshots,
  };
};
