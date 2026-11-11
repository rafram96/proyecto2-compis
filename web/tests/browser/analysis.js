async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await page.getByRole("button", { name: "Compilar", exact: true }).click();
  await page.locator(".studio-status[data-status=ready]").waitFor({ timeout: 45000 });
  await page.locator('.studio-out[data-origin="en vivo"]').waitFor();

  // Compara el mismo puente en CPython (snapshots) y Python/WASM, no un mock.
  const parity = await page.evaluate(async () => {
    const { compile } = await import("/src/compiler/client.ts");
    const { programs } = await import("/src/data/index.ts");
    let compared = 0;
    for (const [key, program] of Object.entries(programs)) {
      const name = key.replace("_ok", "");
      for (const [passes, snapshots] of [[null, program.default], [[], program.O0]]) {
        for (const [fmt, expected] of Object.entries(snapshots)) {
          const live = await compile({ source: program.source, name, fmt, passes });
          const { artifacts, ...summary } = live.analysis;
          const actual = { ...live, analysis: summary };
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`Diferencia CPython/Pyodide: ${key}, ${fmt}, ${JSON.stringify(passes)}`);
          }
          if (key === "pendientes.etl" && fmt === "ast" && artifacts.ast.status !== "available") {
            throw new Error("Se perdió el AST disponible tras un error semántico");
          }
          compared++;
        }
      }
    }
    return { compared };
  });

  const semantic = await page.evaluate(async () => {
    const { compile } = await import("/src/compiler/client.ts");
    const base = 'PIPELINE p { INPUT i: TABLE[x: INT]; STEP f = FILTER { WHERE EXPR; } OUTPUT o: TABLE; FLOW { i -> f -> o; } }';
    for (const [expr, code] of [["x + 1", "E_TYPE"], ["missing > 0", "E_COLUMN"]]) {
      const source = base.replace("EXPR", expr);
      const live = await compile({ source, name: "c2.etl", fmt: "ir", passes: null });
      const d = live.analysis.diagnostics[0];
      if (live.ok || d.code !== code || d.phase !== "semantic" || live.analysis.contract_version !== "2") {
        throw new Error(`Diagnóstico C2 incorrecto: ${JSON.stringify(live)}`);
      }
      const fragment = source.slice(d.span.start, d.span.end);
      if (fragment !== (code === "E_COLUMN" ? "missing" : expr)) throw new Error(`Rango C2: ${fragment}`);
      if (live.analysis.artifacts.ir_before.status !== "available" || live.analysis.artifacts.ir_after.status !== "blocked") {
        throw new Error("No se conservaron los artefactos parciales de C2");
      }
    }
    return { cases: 2 };
  });

  await page.getByRole("tab", { name: "pendientes.etl", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.studio-out[data-origin="en vivo"]')?.textContent.includes("E_NULL_COMPARISON"));
  await page.locator(".cm-lintRange-error").first().waitFor();
  const marked = await page.locator(".cm-lintRange-error").allTextContents();
  if (marked.join("") !== "status == NULL") throw new Error(`Rango incorrecto: ${JSON.stringify(marked)}`);

  const editor = page.locator(".cm-content");
  const source = await editor.innerText();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source.replace("== NULL", "IS NULL"));
  await page.waitForFunction(() => document.querySelector('.studio-out[data-origin="en vivo"]')?.textContent.includes("OK:"));
  if (await page.locator(".cm-lintRange-error").count()) throw new Error("El diagnóstico persiste tras corregir el programa");

  const unicode = 'PIPELINE p { INPUT data: TABLE[x: INT?]; STEP f = FILTER { WHERE "😀" == "é" AND x\n == NULL; } OUTPUT o: TABLE; FLOW { data -> f -> o; } }';
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(unicode);
  await page.waitForFunction(() => document.querySelector('.studio-out[data-origin="en vivo"]')?.textContent.includes("E_NULL_COMPARISON"));
  const unicodeMarked = await page.locator(".cm-lintRange-error").allTextContents();
  if (unicodeMarked.join("\n") !== "x\n == NULL") throw new Error(`Rango Unicode incorrecto: ${JSON.stringify(unicodeMarked)}`);
  if (errors.length) throw new Error(errors.join("\n"));

  return { ...parity, semantic, corrected: true, marked, unicodeMarked, pageErrors: errors };
}
