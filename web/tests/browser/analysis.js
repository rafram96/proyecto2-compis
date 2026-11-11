async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await page.getByRole("button", { name: "Compilar", exact: true }).click();
  await page.locator(".studio-status[data-status=ready], .studio-status[data-status=error]").waitFor({ timeout: 65000 });
  if (await page.locator(".studio-status[data-status=error]").count()) throw new Error(await page.locator(".studio-status").innerText());
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
          if (Object.values(artifacts).some(a => a.status !== "available" && a.data !== null)) {
            throw new Error("El transporte perdió data:null en un artefacto sin datos");
          }
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
      if (live.ok || d.code !== code || d.phase !== "semantic" || live.analysis.contract_version !== "4") {
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

  const ranges = await page.evaluate(async () => {
    const { compile } = await import("/src/compiler/client.ts");
    const source = 'PIPELINE p { INPUT i: TABLE[x: DECIMAL?]; STEP a = FILTER { WHERE x >= 100; } STEP b = FILTER { WHERE x >= 0; } OUTPUT o: TABLE; FLOW { i -> a -> b -> o; } }';
    const optimized = await compile({ source, name: "rangos.etl", fmt: "ir", passes: ["rangos"] });
    const plain = await compile({ source, name: "rangos.etl", fmt: "ir", passes: [] });
    const module = optimized.analysis.artifacts.ir_after.data.module;
    if (!optimized.ok || !plain.ok || module.pipelines[0].nodes.some(n => n.name === "b")) {
      throw new Error("El pase rangos no eliminó el filtro implicado en Pyodide");
    }
    const proof = module.range_rewrites[0];
    if (proof.node !== "b" || proof.proof[0].lower.value !== 100 || proof.proof[0].nullable || !module.range_facts.length) {
      throw new Error("Faltan los hechos o la prueba del pase rangos");
    }
    if (!plain.analysis.artifacts.ir_after.data.module.pipelines[0].nodes.some(n => n.name === "b")) {
      throw new Error("-O0 eliminó un filtro");
    }
    return { removed: proof.node, evidence: proof.proof[0].lower.evidence[0].condition };
  });

  const joins = await page.evaluate(async () => {
    const { compile } = await import("/src/compiler/client.ts");
    const source = 'PIPELINE p { INPUT l: TABLE[x: INT?]; INPUT r: TABLE[y: INT?]; STEP j = JOIN { TYPE INNER; ON left.x == right.y; VERIFY MANY_TO_ONE; } STEP s = SELECT { COLUMNS x; } OUTPUT o: TABLE; FLOW { l -> j.left; r -> j.right; j -> s -> o; } }';
    for (const passes of [null, ["joins", "muertos"], ["muertos", "joins", "rangos"]]) {
      const live = await compile({ source, name: "joins.etl", fmt: "ir", passes });
      const python = await compile({ source, name: "joins.etl", fmt: "python", passes });
      const module = live.analysis.artifacts.ir_after.data.module;
      const proof = module.join_rewrites[0];
      if (!live.ok || !module.pipelines[0].nodes.some(n => n.kind === "CHECK_JOIN") ||
          proof.node !== "j" || proof.consumers.join() !== "s" ||
          !python.ok || !python.out.includes("verify_many_to_one") || python.out.includes(".join(")) {
        throw new Error(`Eliminación C4 sin obligación: ${JSON.stringify(live)}`);
      }
      if (source.slice(proof.declaration_span.start, proof.declaration_span.end) !== "VERIFY MANY_TO_ONE;") {
        throw new Error("Procedencia C4 incorrecta");
      }
    }
    const plain = await compile({ source, name: "joins.etl", fmt: "python", passes: [] });
    if (!plain.ok || !plain.out.includes("verify_many_to_one") || !plain.out.includes(".join(")) {
      throw new Error("-O0 perdió el contrato C4");
    }
    for (const fragment of ["COLUMNS y", "COLUMNS x, y"]) {
      const live = await compile({ source: source.replace("COLUMNS x", fragment), name: "joins.etl", fmt: "ir", passes: null });
      if (!live.ok || live.analysis.artifacts.ir_after.data.module.join_rewrites.length) throw new Error("C4 eliminó columnas observables");
    }
    const invalid = source.replace("TYPE INNER", "TYPE LEFT");
    const error = await compile({ source: invalid, name: "joins.etl", fmt: "ast", passes: null });
    const d = error.analysis.diagnostics[0];
    if (error.ok || d.code !== "E_JOIN_GUARANTEE" || invalid.slice(d.span.start, d.span.end) !== "VERIFY MANY_TO_ONE;") {
      throw new Error("Diagnóstico C4 incorrecto");
    }
    return { eliminated: true, obligations: true, O0: true, abstentions: 2, diagnostic: d.code };
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

  return { ...parity, semantic, ranges, joins, corrected: true, marked, unicodeMarked, pageErrors: errors };
}
