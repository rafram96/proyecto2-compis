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

  return { ...parity, corrected: true, marked, unicodeMarked, pageErrors: errors };
}
