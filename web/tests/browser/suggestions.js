async (page) => {
  // W4: sugerencias del editor desde el último análisis válido y «¿quisiste decir?» de E_COLUMN, con teclado.
  // Funciona en Vite y en el build servido (sin imports de /src/). No ejecuta trabajos ni usa datasets.
  const origin = new URL(page.url()).origin;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fail = (message) => {
    throw new Error(message);
  };
  const workspace = () => page.evaluate(() => JSON.parse(localStorage.getItem("cauce-workspace-v1")));
  const show = async (panel) => {
    const toggle = page.getByRole("button", { name: panel, exact: true });
    if ((await toggle.count()) && (await toggle.isVisible())) await toggle.click();
  };
  const live = async () => {
    await show("Inspector");
    await page.locator('.studio-out[data-origin="en vivo"]').waitFor({ timeout: 65000 });
    await show("Código");
  };
  const setTheme = (theme) =>
    page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("cauce-theme", theme);
    }, theme);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const shot = async (path) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.playwright-cli/${path}.png`, animations: "disabled" });
  };
  // Cuenta mensajes al worker: pedir, recorrer o cerrar sugerencias no debe enviar ninguno.
  const resetPosts = () =>
    page.evaluate(() => {
      window.__postsW = 0;
      if (!window.__patchedW) {
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (...args) {
          window.__postsW++;
          return post.apply(this, args);
        };
        window.__patchedW = true;
      }
    });
  const posts = () => page.evaluate(() => window.__postsW);
  const popup = () => page.locator(".cm-tooltip-autocomplete");
  const labels = () => popup().locator('li[role="option"] .cm-completionLabel').allTextContents();
  const selected = () => popup().locator('li[aria-selected="true"] .cm-completionLabel').textContent();
  const headers = () => popup().locator("completion-section").allTextContents();
  const open = async () => {
    await page.keyboard.press("Control+Space");
    await popup().waitFor();
    // CodeMirror ignora Intro durante los primeros 75 ms (interactionDelay).
    await page.waitForTimeout(120);
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await popup().waitFor({ state: "detached" });
  };
  /** Cursor justo después de `after`, dentro de la línea que contiene `marker`. */
  const caret = async (marker, after) => {
    const line = page.locator(".cm-line", { hasText: marker }).first();
    await line.click();
    const text = await line.textContent();
    const index = text.indexOf(after);
    if (index < 0) fail(`No está ${after} en la línea ${text}`);
    await page.keyboard.press("End");
    for (let i = 0; i < text.length - index - after.length; i++) await page.keyboard.press("ArrowLeft");
  };
  const lineText = (marker) => page.locator(".cm-line", { hasText: marker }).first().textContent();
  const same = (a, b, what) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  };
  const openExample = async (name) => {
    await page.getByLabel("Abrir ejemplo").selectOption(name);
    await page.locator(".cm-content").waitFor();
    await page.getByRole("button", { name: "Compilar", exact: true }).click();
    await live();
    if (await page.locator(".diagnostic-link").count()) fail(`${name} no compila`);
  };
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

  async function journey({ width, height, theme, size, full }) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto(origin + "/estudio");
    await page.evaluate(() => localStorage.removeItem("cauce-workspace-v1"));
    await page.reload();
    await setTheme(theme);
    await openExample("tutorial.etl");
    const original = (await workspace()).active.source;
    await resetPosts();
    await page.evaluate(() => (window.__editorW = document.querySelector(".cm-editor")));

    // 1. Escribir con el texto ya distinto del análisis: columnas del último análisis válido, marcadas como tales.
    await caret("WHERE importe > 0;", "WHERE ");
    for (let i = 0; i < "importe".length; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.type("imp");
    await popup().waitFor();
    await page.waitForTimeout(120);
    same(await labels(), ["importe"], "Filtrado de columnas");
    const staleHeader = (await headers()).join(" | ");
    if (!staleHeader.includes("Columnas de pedidos") || !staleHeader.includes("Último análisis válido · revisión 1; el texto cambió después"))
      fail("Encabezado de análisis anterior: " + staleHeader);
    if (full) await shot(`w-${size}-${theme}-stale`);
    await page.keyboard.press("Enter");
    await popup().waitFor({ state: "detached" });
    if (!(await lineText("WHERE importe")).includes("WHERE importe > 0;")) fail("No se aceptó importe");
    await live();
    if ((await workspace()).active.source !== original) fail("La sugerencia aceptada alteró el programa");
    const afterAccept = await posts();
    // Una compilación por la edición (pausa de 320 ms); nunca una por pedir la lista.
    if (afterAccept < 1 || afterAccept > 2) fail("Compilaciones al escribir y aceptar: " + afterAccept);

    // 2. Ctrl+Espacio, recorrer y cerrar: cero mensajes al worker, sin recrear CodeMirror ni tocar el documento.
    await resetPosts();
    const before = await workspace();
    await caret("WHERE importe > 0;", "WHERE ");
    await open();
    const header = (await headers()).join(" | ");
    if (!header.includes("Análisis vigente · revisión")) fail("Encabezado vigente: " + header);
    same((await labels()).slice(0, 2), ["cliente", "importe"], "Columnas de la entrada de validos");
    if ((await selected()) !== "cliente") fail("Primera opción no seleccionada");
    const highlight = await popup()
      .locator('li[aria-selected="true"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(highlight)) fail("La opción activa no se distingue");
    await page.keyboard.press("ArrowDown");
    if ((await selected()) !== "importe") fail("Flecha abajo no recorre");
    await page.waitForTimeout(100);
    const info = await page.locator(".cm-completionInfo").textContent();
    // El panel de información debe verse entero, dentro de la ventana.
    const box = await page.locator(".cm-completionInfo").boundingBox();
    const view = page.viewportSize();
    if (!box || box.width < 40 || box.x < 0 || box.x + box.width > view.width + 1) fail("Info no visible: " + JSON.stringify(box));
    // Ni encima de las opciones ni del encabezado (procedencia del análisis).
    const list = await popup().locator("ul").boundingBox();
    const overlap = Math.min(box.x + box.width, list.x + list.width) > Math.max(box.x, list.x) &&
      Math.min(box.y + box.height, list.y + list.height) > Math.max(box.y, list.y);
    if (overlap) fail("El panel de información tapa la lista");
    if (!info.includes("Columna de la entrada de validos") || !info.includes("Esquema completo")) fail("Info: " + info);
    await shot(`w-${size}-${theme}-popup`);
    await page.keyboard.press("ArrowUp");
    if ((await selected()) !== "cliente") fail("Flecha arriba no recorre");
    await close();
    // FLOW: destinos del pipeline (no el SOURCE) con su clase de declaración.
    await caret("pedidos -> validos", "ranking -> ");
    await open();
    const flow = await labels();
    if (!flow.includes("reporte") || flow.includes("pedidos")) fail("Destinos FLOW: " + flow);
    if (!(await headers()).join().includes("Destinos de gasto_por_cliente")) fail("Encabezado FLOW");
    await close();
    await page.waitForTimeout(700);
    const after = await workspace();
    if ((await posts()) !== 0) fail("Pedir sugerencias envió mensajes al worker: " + (await posts()));
    if (after.active.revision !== before.active.revision || after.active.source !== before.active.source)
      fail("Pedir sugerencias cambió el documento");
    if (!(await page.evaluate(() => window.__editorW === document.querySelector(".cm-editor"))))
      fail("CodeMirror se recreó");

    // 3. JOIN, USE, conectores y esquema parcial (riesgo crediticio: SOURCE sin contrato).
    await openExample("credit_risk.etl");
    await resetPosts();
    await caret("ON left.customer_id", "ON left.");
    await open();
    same(await labels(), ["id", "customer_id", "amount", "status"], "Columnas left del JOIN");
    if (!(await headers()).join().includes("Columnas de left · clean.cleaned")) fail("Encabezado left");
    await close();
    await caret("ON left.customer_id", "== right.");
    await open();
    same(await labels(), ["customer_key"], "Columnas right del JOIN");
    if (!(await headers()).join().includes("esquema parcial")) fail("Esquema parcial sin aviso");
    if (full) await shot(`w-${size}-${theme}-partial`);
    await close();
    await caret("USE clean_orders AS clean;", "USE ");
    await open();
    const pipes = await labels();
    if (!pipes.includes("clean_orders") || !pipes.includes("credit_risk") || pipes.includes("order_report"))
      fail("Pipelines en USE: " + pipes);
    await close();
    await caret("SOURCE raw_orders = CSV(", "CSV(");
    await open();
    same(await labels(), ["file", "header", "delimiter", "nullstr"], "Opciones de CSV en SOURCE");
    await close();
    await page.waitForTimeout(500);
    if ((await posts()) !== 0) fail("Explorar sugerencias envió mensajes: " + (await posts()));
    // Aceptar left. vuelve a abrir la lista con las columnas de ese lado; todo con teclado.
    const joinLine = await lineText("ON left.customer_id");
    await caret("ON left.customer_id", "ON ");
    for (let i = 0; i < "left.customer_id".length; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Backspace");
    await open();
    same(await labels(), ["left.", "right."], "Calificadores en ON");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".cm-tooltip-autocomplete .cm-completionLabel")].some((e) => e.textContent === "customer_id"),
    );
    await page.waitForTimeout(120);
    await page.keyboard.press("ArrowDown");
    if ((await selected()) !== "customer_id") fail("No se recorrió hasta customer_id");
    await page.keyboard.press("Enter");
    if ((await lineText("ON left.customer_id")) !== joinLine) fail("La condición del JOIN no quedó igual");
    await live();
    if (await page.locator(".diagnostic-link").count()) fail("JOIN reconstruido con errores");

    // 4. «¿Quisiste decir?»: botón accesible bajo el diagnóstico, sobre el intervalo exacto, con teclado.
    await caret("ON left.customer_id", "left.customer_id");
    await page.keyboard.type("d");
    if (await popup().count()) await close();
    await live();
    await show("Inspector");
    const diagnostic = page.getByRole("button", { name: /E_COLUMN/ });
    await diagnostic.waitFor();
    if (!(await diagnostic.innerText()).includes("Columna inexistente: customer_idd.")) fail("Mensaje de E_COLUMN cambiado");
    const fix = page.getByRole("button", { name: /^Cambiar left\.customer_idd por left\.customer_id / });
    await fix.waitFor();
    if (!(await focusVisible(fix))) fail("Corrección sin foco visible");
    await fix.scrollIntoViewIfNeeded();
    await shot(`w-${size}-${theme}-fix`);
    if (await overflow()) fail(`Desbordamiento con la corrección (${size} ${theme})`);
    await resetPosts();
    await page.keyboard.press("Enter");
    if ((await lineText("ON left.customer_id")) !== joinLine) fail("La corrección no restauró la condición");
    await live();
    await show("Inspector");
    if (await page.locator(".diagnostic-link").count()) fail("El diagnóstico persiste tras la corrección");
    await show("Código");
    if ((await posts()) !== 1) fail("La corrección debía compilar una vez: " + (await posts()));
    // Deshacer devuelve el error: la corrección es una edición normal del historial.
    await page.locator(".cm-content").focus();
    await page.keyboard.press("ControlOrMeta+z");
    if (!(await lineText("ON left.customer_id")).includes("customer_idd")) fail("Deshacer no recupera el texto");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    if ((await lineText("ON left.customer_id")) !== joinLine) fail("Rehacer no aplica la corrección");
    await live();

    if (full) {
      // Acción del diagnóstico en CodeMirror (puntero): misma corrección sobre el intervalo marcado.
      await caret("ON left.customer_id", "left.customer_id");
      await page.keyboard.type("d");
      if (await popup().count()) await close();
      await live();
      await page.locator(".cm-lintRange-error").first().hover();
      const action = page.locator(".cm-diagnosticAction", { hasText: "¿Quisiste decir left.customer_id?" });
      await action.waitFor();
      await shot(`w-${size}-${theme}-action`);
      await action.click();
      if ((await lineText("ON left.customer_id")) !== joinLine) fail("La acción del diagnóstico no corrigió");
      await live();
    }

    // 5. El otro tema: la lista se lee con los tokens del tema, sin recrear el editor.
    const other = theme === "light" ? "dark" : "light";
    await setTheme(other);
    await caret("ON left.customer_id", "== right.");
    await open();
    await page.locator(".cm-completionInfo").waitFor();
    await page.waitForTimeout(100);
    await shot(`w-${size}-${other}-popup`);
    const contrast = await popup()
      .locator('li[aria-selected="true"]')
      .evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    if (contrast[0] === contrast[1]) fail("Opción activa sin contraste en " + other);
    await close();
    await setTheme(theme);
    if (await overflow()) fail(`Desbordamiento (${size})`);
  }

  await journey({ width: 1440, height: 1000, theme: "light", size: "desktop", full: true });
  await journey({ width: 390, height: 844, theme: "dark", size: "mobile", full: false });
  if (errors.length) fail(errors.join("\n"));
  return {
    suggestions: true,
    journeys: 2,
    zeroCompilesOnSuggest: true,
    staleBasis: true,
    join: true,
    flow: true,
    use: true,
    connectors: true,
    partialSchema: true,
    quickFix: true,
    pageErrors: errors,
  };
};
