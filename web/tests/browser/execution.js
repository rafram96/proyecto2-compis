async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const origin = new URL(page.url()).origin;
  const timeoutApi = '__CAUCE_TIMEOUT_API__';
  const apiRequests = [];
  page.on('request', r => { if (r.url().includes('/api/v1/runs') && r.method() === 'POST' && !r.url().endsWith('/cancel')) apiRequests.push(r.postDataJSON()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin + '/studio');
  await page.evaluate(() => localStorage.removeItem('cauce-workspace-v1'));
  await page.reload();
  await page.locator('.cm-content').waitFor();
  await page.getByRole('button', { name: 'Compile', exact: true }).click();
  const live = () => page.locator('.studio-out[data-origin="en vivo"]').waitFor({ timeout: 65000 });
  await live();
  await page.getByText('Servicio conectado · demo privada', { exact: true }).waitFor();
  const edit = async source => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(source);
    await live();
  };
  const bind = async (key, id) => page.getByLabel('Dataset para ' + key, { exact: true }).selectOption(id + '@1');
  const execute = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/runs' && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Ejecutar', exact: true }).click(),
    ]);
    if (response.status() !== 202) throw new Error('Ejecución HTTP no aceptada: ' + await response.text());
    return response.json();
  };
  const terminal = async (state = 'succeeded') => {
    await page.locator(`.execution-job[data-state="${state}"]`).waitFor({ timeout: 15000 });
    if (state === 'succeeded') await page.locator('.execution-results tbody').first().waitFor();
  };
  const rows = () => page.locator('.execution-results tbody').first().locator('tr').allTextContents();
  const active = () => page.evaluate(() => JSON.parse(localStorage.getItem('cauce-workspace-v1')).active);
  const postsBefore = apiRequests.length;
  await page.getByRole('button', { name: 'AST', exact: true }).click();
  await page.getByRole('button', { name: 'IR', exact: true }).click();
  if (apiRequests.length !== postsBefore) throw new Error('Explorar ejecutó un trabajo');
  const editor = await page.locator('.cm-editor').evaluate(el => { window.__editorD = el; return !!el; });
  await bind('ventas.pedidos', 'orders');
  const sales = await execute();
  await terminal();
  if (JSON.stringify(await rows()) !== JSON.stringify(['9301', '110.51'])) throw new Error('Filas ventas incorrectas: ' + JSON.stringify(await rows()));
  await page.getByText('Esquema observado (3 columnas)', { exact: true }).click();
  const schema = await page.getByLabel('Esquema de resultados').innerText();
  if (!schema.includes('gastado') || !schema.includes('Float64') || !schema.includes('Int64')) throw new Error('Esquema real incorrecto');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Descargar gasto_por_cliente.parquet/ }).click(),
  ]);
  await download.saveAs('.playwright-cli/d-ventas.parquet');
  const originalSource = (await active()).source;
  await page.evaluate(source => { window.__salesD = source; }, originalSource);
  // Resultado de columnas numéricas de esta página; no recarga datos completos.
  await page.getByText('Gráfico de esta página', { exact: true }).click();
  await page.getByRole('img', { name: /por fila de la página actual/ }).waitFor();
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const focus = await page.evaluate(() => ({ outline: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth }));
  if (focus.outline === 'none' || focus.width === '0px') throw new Error('Foco no visible');
  const capture = async (name, width, height, dark) => {
    await page.setViewportSize({ width, height });
    const theme = page.getByRole('button', { name: dark ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro' });
    if (await theme.count()) await theme.click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('theme-fade'));
    await page.locator('#resultados').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.playwright-cli/d-results-${name}.png`, fullPage: true, animations: 'disabled' });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Desbordamiento horizontal ' + name);
  };
  await capture('desktop-light', 1440, 1000, false);
  await capture('desktop-dark', 1440, 1000, true);
  await capture('mobile-light', 390, 844, false);
  await capture('mobile-dark', 390, 844, true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const multi = 'PIPELINE p { INPUT i: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?]; STEP f = FILTER { WHERE amount > 20; } OUTPUT raw: TABLE; OUTPUT filtered: TABLE; FLOW { i -> raw; i -> f -> filtered; } }';
  await edit(multi);
  if (await page.locator('.execution-job').getAttribute('data-current') !== 'false') throw new Error('La edición no marcó el resultado anterior');
  await bind('p.i', 'orders');
  const multiple = await execute();
  await terminal();
  const selectOutput = async name => {
    const options = await page.getByLabel('Salida materializada').locator('option').evaluateAll((els, name) => els.filter(el => el.textContent.includes(name)).map(el => el.value), name);
    if (options.length !== 1) throw new Error('Salida no unívoca: ' + name);
    await page.getByLabel('Salida materializada').selectOption(options[0]);
    await page.waitForFunction(expected => document.querySelector('.execution-results caption')?.textContent.includes(expected), name);
  };
  await selectOutput('p.raw');
  if ((await rows()).length !== 3 || !(await page.getByLabel('Tabla de resultados').innerText()).includes('NULL')) throw new Error('Salida raw/null incorrecta');
  await selectOutput('p.filtered');
  if (JSON.stringify(await rows()) !== JSON.stringify(['3930pending'])) throw new Error('Se mezclaron las salidas: ' + JSON.stringify(await rows()));
  // USE desde el ejemplo canónico, con INPUT interno conectado por FLOW.
  await page.getByLabel('Abrir ejemplo').selectOption('credit_risk.etl');
  await live();
  await page.getByLabel('Pipeline a ejecutar').selectOption('order_report');
  await bind('order_report.raw_orders', 'orders');
  await bind('order_report.customers', 'bank-customers');
  if (await page.getByLabel(/Dataset para clean_orders/).count()) throw new Error('INPUT de USE solicitado como binding externo');
  const composition = await execute();
  await terminal();
  if (JSON.stringify((await rows()).sort()) !== JSON.stringify(['110.5paid', '20UNKNOWN', '930pending'].sort())) throw new Error('USE no ejecutó contratos y composición: ' + JSON.stringify(await rows()));
  // O3/O0 conservan el fallo dinámico de unicidad derecha.
  await page.getByLabel('Abrir ejemplo').selectOption('joins.etl');
  await live();
  await bind('join_verificado.pedidos', 'join-orders');
  await bind('join_verificado.clientes', 'join-customers');
  const join = await execute();
  await terminal();
  if (JSON.stringify(await rows()) !== JSON.stringify(['230', '110', '240'])) throw new Error('JOIN válido incorrecto');
  const [joinDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Descargar joins_result.csv/ }).click()]);
  await joinDownload.saveAs('.playwright-cli/d-joins.csv');
  await bind('join_verificado.clientes', 'join-duplicates');
  await execute(); await terminal('failed');
  if (!(await page.locator('.execution-job').innerText()).includes('E_JOIN_UNIQUE')) throw new Error('No se conservó VERIFY optimizado');
  await page.getByLabel('Pases de optimización').selectOption('O0');
  await live();
  await execute(); await terminal('failed');
  if (!(await page.locator('.execution-job').innerText()).includes('E_JOIN_UNIQUE')) throw new Error('No se conservó VERIFY en O0');
  await bind('join_verificado.clientes', 'join-customers');
  await execute(); await terminal();
  if (JSON.stringify(await rows()) !== JSON.stringify(['230', '110', '240'])) throw new Error('JOIN O0 válido incorrecto');
  // Editar un trabajo realmente running: interceptar solo el polling para conservar esa vista.
  let delayed = false;
  const statusPattern = /\/api\/v1\/runs\/[a-f0-9]{32}$/;
  await page.route(statusPattern, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    if (!delayed && result.state === 'running') { delayed = true; await new Promise(resolve => setTimeout(resolve, 900)); }
    await route.fulfill({ response });
  });
  const changing = await execute();
  // Estado observado directamente en el servidor, antes de editar el documento.
  let actual;
  for (let i = 0; i < 40; i++) {
    actual = await (await page.request.get(origin + changing.status_url)).json();
    if (actual.state === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (actual.state !== 'running') throw new Error('No se observó running real para edición');
  await page.getByLabel('Nombre del documento').fill('join-editado.etl');
  await terminal();
  if (await page.locator('.execution-job').getAttribute('data-current') !== 'false' || !(await page.locator('.execution-job').innerText()).includes('joins.etl')) throw new Error('Resultado mal asociado durante edición');
  await page.unroute(statusPattern);
  await live();
  // Cancelar un hijo activo y ejecutar de nuevo para demostrar recuperación.
  const cancelling = await execute();
  for (let i = 0; i < 40; i++) {
    actual = await (await page.request.get(origin + cancelling.status_url)).json();
    if (actual.state === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (actual.state !== 'running') throw new Error('No se observó running real para cancelación');
  await page.getByRole('button', { name: 'Cancelar ejecución', exact: true }).click();
  await terminal('cancelled');
  const cancelled = await (await page.request.get(origin + cancelling.status_url)).json();
  if (cancelled.state !== 'cancelled') throw new Error('El runner no fue cancelado');
  await execute(); await terminal();
  // Salida vacía con OUTPUT: archivo materializado, esquema sin filas ficticias.
  await edit(multi.replace('amount > 20', 'amount > 1000'));
  await bind('p.i', 'orders');
  await execute(); await terminal();
  await selectOutput('p.filtered');
  await page.getByText(/Salida vacía válida · 0 filas/).waitFor();
  if ((await rows()).length !== 0) throw new Error('Salida vacía inventó filas');
  // Timeout de proceso real, con fixture de API que aplica un plazo de 20 ms.
  if (timeoutApi) {
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: timeoutApi + url.pathname + url.search, headers: { ...route.request().headers(), origin: timeoutApi, host: new URL(timeoutApi).host } });
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Reconectar', exact: true }).click();
    await execute(); await terminal('timed_out');
    if (!(await page.locator('.execution-job').innerText()).includes('E_TIMEOUT')) throw new Error('Timeout no comprensible');
    await page.unroute('**/api/v1/**');
  }
  // Desconexión real del transporte del navegador; el worker local sigue compilando.
  await page.route('**/api/v1/**', route => route.abort('connectionrefused'));
  await page.getByRole('button', { name: 'Reconectar', exact: true }).click();
  await page.getByText(/Servicio desconectado o sin respuesta/).first().waitFor();
  await edit(multi.replace('amount > 20', 'amount >= 20'));
  await live();
  await page.getByRole('button', { name: 'Python', exact: true }).click();
  if (!(await page.locator('.studio-out').innerText()).includes('pipeline_0')) throw new Error('Compilación local dejó de funcionar sin API');
  if (await page.getByRole('button', { name: 'Ejecutar', exact: true }).isEnabled()) throw new Error('Ejecución habilitada sin servicio');
  await page.unroute('**/api/v1/**');
  await page.getByRole('button', { name: 'Reconectar', exact: true }).click();
  await page.getByText('Servicio conectado · demo privada', { exact: true }).waitFor();
  // Pases personalizados y navegación sin pérdida; no hay herramientas de ejecución en lectura.
  await page.getByLabel('Pases de optimización').selectOption('custom');
  await live();
  const beforeNav = await active();
  const stateBeforeNav = await page.locator('.execution-job').getAttribute('data-run-id');
  await page.getByRole('link', { name: 'Docs', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Aprende Stream', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Ejemplos', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Elige un problema', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Abrir Studio', exact: true }).first().click();
  await page.locator('.cm-content').waitFor();
  if (JSON.stringify(await active()) !== JSON.stringify(beforeNav)) throw new Error('Navegación perdió documento/pases');
  if (await page.locator('.execution-job').getAttribute('data-run-id') !== stateBeforeNav) throw new Error('Se perdió trabajo al volver');
  if (!editor || errors.length) throw new Error('Errores de página: ' + errors.join('; '));
  // Recarga conserva borradores v1 y elimina referencias a resultados en memoria.
  await page.reload();
  await page.locator('.cm-content').waitFor();
  if (JSON.stringify(await active()) !== JSON.stringify(beforeNav)) throw new Error('Recarga alteró borrador v1');
  if (await page.locator('.execution-job').count()) throw new Error('Resultados grandes persistidos tras recarga');
  return { execution: true, download: true, multipleOutputs: true, useBindings: true, joinO0O3: true,
    revisionDuringRun: true, cancellation: true, timeout: !!timeoutApi, offlineCompilation: true, emptyOutput: true,
    themesAndMobile: true, navigation: true, salesRun: sales.id, compositionRun: composition.id, multipleRun: multiple.id, joinRun: join.id };
}
