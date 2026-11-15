"use strict";

// Página de benchmarks: gráficos de Chart.js con los datos de benchmarks.json (bench/analisis.py).

const SISTEMAS = ["dsl", "polars", "duckdb", "pandas"];
const COLOR = { dsl: "--s-dsl", polars: "--s-polars", duckdb: "--s-duckdb", pandas: "--s-pandas" };
const PUNTO = { dsl: "circle", polars: "rect", duckdb: "triangle", pandas: "rectRot" };
const COLOR_TAREA = ["--task-1", "--task-2", "--task-3", "--task-4", "--task-5"];
const PUNTO_TAREA = ["circle", "rect", "triangle", "rectRot", "star"];
// Experimento aislado del reporte (sección Rendimiento): Limpieza de pedidos en SF 5.
const LIMPIEZA_SF5 = { con: 2.38, sin: 0.92 };
const NOTA_TAREA = {
  resumen_precios: "Consulta 1 de TPC-H: un filtro y una agregación con varias sumas. El DSL y Polars a mano son indistinguibles.",
  ingreso_descuento: "Consulta 6 de TPC-H: filtros y una suma. En SF 1 el DSL tarda unos 80 ms más porque el runtime resuelve el esquema en cada paso para ubicar los errores; es un costo fijo que no crece con los datos.",
  ingreso_por_pedido: "Consulta 3 de TPC-H, con dos JOIN. El DSL queda a la par de Polars; Pandas es el más lento porque carga las tres tablas completas.",
  limpieza_pedidos: "DROP_NULLS, FILL_NULL, DISTINCT y SORT sobre pedidos con nulos y duplicados. Es la única tarea en que el DSL se separa de Polars; la causa se explica más abajo.",
  devoluciones: "Dos salidas desde la misma cadena: el DSL vuelve a leer lineitem para la segunda. Pandas se queda sin memoria (más de 31 GB) desde SF 20, por eso su línea se corta.",
};
const MOMENTO = { "compilación": "al compilar", "ejecución": "al ejecutar", "silencioso": "silencioso", "no detectado": "no detectado" };
const PALABRAS_DSL = /\b(PIPELINE|FROM|TO|INPUT|OUTPUT|SOURCE|SINK|STEP|USE|AS|FLOW|FILTER|SELECT|DERIVE|AGGREGATE|JOIN|SORT|DISTINCT|RENAME|FILL_NULL|DROP_NULLS|WHERE|COLUMNS|GROUP_BY|ON|BY|AND|OR|NOT|IS|SUM|AVG|COUNT|MIN|MAX|PARQUET)\b/g;

const $ = (id) => document.getElementById(id);
let D;              // contenido de benchmarks.json
let fila;           // (sf, tarea, configuración) -> mediana, cuartiles y memoria
let sinMemoria;     // claves (sf, tarea, configuración) que no terminaron
const renders = []; // funciones que vuelven a crear cada gráfico (al cambiar el tema)
const graficos = new Map();

const clave = (sf, tarea, config) => `${sf}|${tarea}|${config}`;
const medida = (sf, tarea, config) => fila.get(clave(sf, tarea, config));
const nombreTarea = (id) => D.tareas.find((t) => t.id === id).nombre;
const nombreSistema = (id) => D.sistemas.find((s) => s.id === id).nombre;
const nombreVersion = (id) => (id === "duckdb" ? "SQL (DuckDB)" : nombreSistema(id));
const razon = (sf, tarea) => D.razones.find((q) => q.sf === sf && q.tarea === tarea);
const css = (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
const sfMax = () => D.escalas.at(-1);

// Formato

function segundos(s) {
  if (s < 0.1) return `${(s * 1000).toFixed(0)} ms`;
  return s < 10 ? `${s.toFixed(2)} s` : `${s.toFixed(1)} s`;
}
const veces = (r) => `${r < 10 ? r.toFixed(2) : r.toFixed(1)}×`;
const gb = (x) => `${x < 10 ? x.toFixed(1) : x.toFixed(0)} GB`;
const esc = (texto) => String(texto).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function cantidad(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} M`;
  return n >= 1e3 ? `${(n / 1e3).toFixed(0)} mil` : String(n);
}
const tamano = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`);
const datosSF = (sf) => D.datos?.find((d) => d.sf === sf);
function esMarcaLog(v) {
  const m = v / 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5].some((k) => Math.abs(m - k) < 1e-6);
}

// Plugins de Chart.js: valores sobre las barras y una línea horizontal de referencia.

const pluginValores = {
  id: "valores",
  afterDatasetsDraw(chart, _args, o) {
    if (!o || (!o.formato && !o.faltante)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = `600 ${o.tamano ?? 11.5}px "IBM Plex Sans", Arial, sans-serif`;
    ctx.textAlign = "center";
    chart.data.datasets.forEach((ds, i) => {
      if (!chart.isDatasetVisible(i)) return;
      chart.getDatasetMeta(i).data.forEach((barra, j) => {
        if (!barra || !Number.isFinite(barra.x)) return;
        const v = ds.data[j];
        if (v === null || v === undefined) {
          const texto = o.faltante?.(i, j);
          if (!texto) return;
          ctx.save();
          ctx.fillStyle = css("--muted");
          ctx.translate(barra.x, chart.scales.y.bottom - 6);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(texto, 0, 0);
          ctx.restore();
          return;
        }
        const texto = o.formato?.(v, i, j);
        if (!texto) return;
        if (o.dentro) {
          const { y, base } = barra.getProps(["y", "base"], true);
          if (Math.abs(base - y) < 16) return;
          ctx.fillStyle = o.colorDentro?.(i) ?? "#ffffff";
          ctx.textBaseline = "middle";
          ctx.fillText(texto, barra.x, (y + base) / 2);
        } else {
          ctx.fillStyle = css("--text");
          ctx.textBaseline = "bottom";
          ctx.fillText(texto, barra.x, barra.y - 4);
        }
      });
    });
    ctx.restore();
  },
};

const pluginReferencia = {
  id: "referencia",
  afterDatasetsDraw(chart, _args, o) {
    if (!o || o.y === undefined) return;
    const { ctx, chartArea: a, scales: { y } } = chart;
    const py = y.getPixelForValue(o.y);
    ctx.save();
    ctx.strokeStyle = o.color ?? css("--muted");
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.left, py);
    ctx.lineTo(a.right, py);
    ctx.stroke();
    if (o.etiqueta) {
      ctx.fillStyle = o.color ?? css("--muted");
      ctx.font = `600 12px "IBM Plex Sans", Arial, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(o.etiqueta, a.right - 4, py - 4);
    }
    ctx.restore();
  },
};

function aplicarTema() {
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--grid");
  Chart.defaults.font.family = '"IBM Plex Sans", Arial, sans-serif';
  Chart.defaults.font.size = 12.5;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "700" };
}

function grafico(id, config) {
  graficos.get(id)?.destroy();
  const g = new Chart($(id), config);
  graficos.set(id, g);
  return g;
}

/** Opciones comunes: ejes rotulados, leyenda arriba y tooltip con todas las series del punto. */
function opciones({ xTitulo, yTitulo, log = false, apilado = false, formatoY = String, tooltip, titulo, pie,
  detalle, valores, referencia, xEscalas = false, leyenda = true, yMin }) {
  const tick = (v) => (log && !esMarcaLog(v) ? "" : formatoY(v));
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    scales: {
      x: {
        type: xEscalas ? "linear" : "category",
        stacked: apilado,
        title: { display: Boolean(xTitulo), text: xTitulo, font: { weight: "600" } },
        grid: { display: xEscalas },
        ...(xEscalas ? {
          min: 0, max: sfMax() + 1,
          afterBuildTicks: (eje) => { eje.ticks = D.escalas.map((value) => ({ value })); },
          ticks: { callback: (v) => `SF ${v}`, font: { weight: "600" } },
        } : { ticks: { font: { weight: "600" } } }),
      },
      y: {
        type: log ? "logarithmic" : "linear",
        stacked: apilado,
        beginAtZero: !log && yMin === undefined,
        min: yMin,
        title: { display: Boolean(yTitulo), text: yTitulo, font: { weight: "600" } },
        ticks: { callback: tick },
      },
    },
    plugins: {
      legend: { display: leyenda, position: "top", align: "start", labels: { usePointStyle: true, boxWidth: 10, padding: 16 } },
      tooltip: {
        callbacks: {
          label: (c) => `${c.dataset.label}: ${c.parsed.y === null ? "—" : (tooltip ?? formatoY)(c.parsed.y, c)}`,
          ...(titulo ? { title: titulo } : {}),
          ...(detalle ? { afterLabel: detalle } : {}),
          ...(pie ? { footer: pie } : {}),
        },
      },
      valores,
      referencia,
    },
  };
}

// Controles

function segmentado(contenedor, opcionesBoton, actual, alCambiar) {
  contenedor.replaceChildren();
  for (const { valor, etiqueta } of opcionesBoton) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = etiqueta;
    b.setAttribute("aria-pressed", String(valor === actual));
    b.addEventListener("click", () => {
      for (const otro of contenedor.children) otro.setAttribute("aria-pressed", String(otro === b));
      alCambiar(valor);
    });
    contenedor.appendChild(b);
  }
}
const opcionesSF = () => D.escalas.map((sf) => ({ valor: sf, etiqueta: `SF ${sf}` }));
const opcionesEje = [{ valor: true, etiqueta: "Logarítmico" }, { valor: false, etiqueta: "Lineal" }];

// Secciones

function kpis() {
  const c = D.cifras;
  const tarjetas = [
    [`+${c.dslPolarsMin}–${c.dslPolarsMax} %`, `tiempo extra frente a Polars a mano, en 4 de 5 tareas (SF ${c.SFmax})`, "--s-dsl"],
    [`${c.pandasMin}–${c.pandasMax}×`, `más rápido que Pandas (SF ${c.SFmax})`, "--s-pandas"],
    [`${c.erroresCompilacion} de ${c.erroresTotal}`, "errores detectados al compilar, sin leer datos", "--s-dsl"],
    [`−${c.tokensVsPolars} %`, "tokens frente a Polars", "--s-polars"],
    [`${c.compilacionMs} ms`, "para compilar un programa", "--s-duckdb"],
  ];
  $("kpis").innerHTML = tarjetas.map(([v, l, k]) =>
    `<div class="kpi" style="--kpi:var(${k})"><span class="value">${esc(v)}</span><span class="label">${esc(l)}</span></div>`).join("");
  for (const nodo of document.querySelectorAll("[data-cifra]")) nodo.textContent = D.cifras[nodo.dataset.cifra] ?? "";
}

function seccionDatos() {
  if (!D.datos?.length) return;
  const tablas = ["lineitem", "orders", "orders_sucio", "customer"];
  const total = (j) => Object.values(D.datos[j].tablas).reduce((a, n) => a + n, 0);
  const aprox = (d) => (d.estimado ? "≈ " : "");
  function dibujar() {
    grafico("g-datos", {
      type: "bar",
      data: {
        labels: D.datos.map((d) => `SF ${d.sf}${d.estimado ? " (≈)" : ""}`),
        datasets: tablas.map((t, i) => ({
          label: t, data: D.datos.map((d) => (d.tablas[t] ?? 0) / 1e6),
          backgroundColor: css(`--t-${i + 1}`), borderRadius: 3, maxBarThickness: 90,
        })),
      },
      options: opciones({
        xTitulo: "Factor de escala", yTitulo: "Millones de filas", apilado: true, formatoY: (v) => `${v} M`,
        tooltip: (v) => `${v.toFixed(1)} M filas`,
        pie: (items) => {
          const d = D.datos[items[0].dataIndex];
          return `${aprox(d)}${cantidad(total(items[0].dataIndex))} filas en total · ${aprox(d)}${tamano(d.bytes)} en Parquet`;
        },
        valores: {
          formato: (_v, i, j) => (i === tablas.length - 1
            ? `${aprox(D.datos[j])}${cantidad(total(j))} filas · ${tamano(D.datos[j].bytes)}` : null),
        },
      }),
    });
  }
  const estimadas = D.datos.filter((d) => d.estimado).map((d) => `SF ${d.sf}`);
  const medidas = D.datos.filter((d) => !d.estimado).map((d) => `SF ${d.sf}`);
  $("datos-nota").textContent = (estimadas.length
    ? `${medidas.join(" y ")}: medidos al generar los datos. ${estimadas.join(" y ")} (≈): estimados en proporción, porque esa corrida no guardó el detalle; TPC-H crece linealmente con el factor de escala. `
    : "Medidos al generar los datos. ")
    + "orders_sucio es la copia de orders con nulos y duplicados que usa Limpieza de pedidos.";
  renders.push(dibujar);
  dibujar();
}

function seccionTiempo() {
  let sf = sfMax(), log = true;
  segmentado($("tiempo-sf"), opcionesSF(), sf, (v) => { sf = v; dibujar(); });
  segmentado($("tiempo-eje"), opcionesEje, log, (v) => { log = v; dibujar(); });
  function dibujar() {
    const d = datosSF(sf);
    $("tiempo-info").textContent = d ? `SF ${sf}: ${d.estimado ? "≈ " : ""}${cantidad(d.tablas.lineitem)} filas en lineitem` : "";
    grafico("g-tiempo", {
      type: "bar",
      data: {
        labels: D.tareas.map((t) => t.nombre),
        datasets: SISTEMAS.map((s) => ({
          label: nombreSistema(s), data: D.tareas.map((t) => medida(sf, t.id, s)?.mediana ?? null),
          backgroundColor: css(COLOR[s]), borderRadius: 4, pointStyle: PUNTO[s],
        })),
      },
      options: opciones({
        yTitulo: `Segundos (SF ${sf}${log ? ", escala logarítmica" : ""})`, log, formatoY: (v) => segundos(v),
        pie: (items) => {
          const r = razon(sf, D.tareas[items[0].dataIndex].id);
          return r ? `DSL / Polars: ${veces(r.razon)} (IC 95 %: ${r.lo.toFixed(2)}–${r.hi.toFixed(2)})` : "";
        },
        valores: { faltante: (i, j) => (sinMemoria.has(clave(sf, D.tareas[j].id, SISTEMAS[i])) ? "sin memoria" : null) },
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionEscala() {
  let tarea = D.tareas[0].id, log = true;
  segmentado($("escala-tarea"), D.tareas.map((t) => ({ valor: t.id, etiqueta: t.nombre })), tarea, (v) => { tarea = v; dibujar(); });
  segmentado($("escala-eje"), opcionesEje, log, (v) => { log = v; dibujar(); });
  function dibujar() {
    $("escala-nota").textContent = NOTA_TAREA[tarea] ?? "";
    grafico("g-escala", {
      type: "line",
      data: {
        datasets: SISTEMAS.map((s) => ({
          label: nombreSistema(s),
          data: D.escalas.map((sf) => ({ x: sf, y: medida(sf, tarea, s)?.mediana ?? null })),
          borderColor: css(COLOR[s]), backgroundColor: css(COLOR[s]),
          borderWidth: s === "dsl" ? 4 : 2.5, pointRadius: s === "dsl" ? 6 : 5, pointHoverRadius: 8,
          pointStyle: PUNTO[s], spanGaps: false, tension: 0,
        })),
      },
      options: opciones({
        xTitulo: "Factor de escala", xEscalas: true, log, formatoY: (v) => segundos(v),
        yTitulo: `Segundos${log ? " (escala logarítmica)" : ""}`,
        tooltip: (v, c) => {
          const f = medida(c.parsed.x, tarea, SISTEMAS[c.datasetIndex]);
          return `${segundos(v)} (RIC ${segundos(f.q1)}–${segundos(f.q3)})`;
        },
        pie: (items) => {
          const sf = items[0].parsed.x;
          const r = razon(sf, tarea);
          const d = datosSF(sf);
          return [r ? `DSL / Polars: ${veces(r.razon)}` : "", d ? `${d.estimado ? "≈ " : ""}${cantidad(d.tablas.lineitem)} filas en lineitem` : ""];
        },
        titulo: (items) => `${nombreTarea(tarea)} · SF ${items[0].parsed.x}`,
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionRazon() {
  function dibujar() {
    grafico("g-razon", {
      type: "line",
      data: {
        datasets: D.tareas.map((t, i) => ({
          label: t.nombre,
          data: D.escalas.map((sf) => ({ x: sf, y: razon(sf, t.id)?.razon ?? null })),
          borderColor: css(COLOR_TAREA[i]), backgroundColor: css(COLOR_TAREA[i]),
          borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointStyle: PUNTO_TAREA[i],
        })),
      },
      options: opciones({
        xTitulo: "Factor de escala", xEscalas: true, yTitulo: "Tiempo DSL / Polars a mano",
        formatoY: (v) => `${v}×`, yMin: 0.8,
        tooltip: (v, c) => {
          const r = razon(c.parsed.x, D.tareas[c.datasetIndex].id);
          return `${veces(v)} (IC 95 %: ${r.lo.toFixed(2)}–${r.hi.toFixed(2)})`;
        },
        referencia: { y: 1, etiqueta: "Polars a mano", color: css("--s-polars") },
        titulo: (items) => `SF ${items[0].parsed.x}`,
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionPandas() {
  function dibujar() {
    const sf = sfMax();
    grafico("g-pandas", {
      type: "bar",
      data: {
        labels: D.tareas.map((t) => t.nombre),
        datasets: [{
          label: "DSL frente a Pandas",
          data: D.tareas.map((t) => {
            const p = medida(sf, t.id, "pandas"), d = medida(sf, t.id, "dsl");
            return p && d ? p.mediana / d.mediana : null;
          }),
          backgroundColor: css("--s-dsl"), borderRadius: 5, maxBarThickness: 70,
        }],
      },
      options: opciones({
        leyenda: false, yTitulo: "Veces más rápido que Pandas", formatoY: (v) => `${v}×`,
        tooltip: (v) => `${v.toFixed(1)}× más rápido`,
        valores: {
          formato: (v) => `${v.toFixed(1)}×`,
          faltante: (_i, j) => (sinMemoria.has(clave(sf, D.tareas[j].id, "pandas")) ? "Pandas: sin memoria" : null),
        },
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionLimpieza() {
  function dibujar() {
    grafico("g-limpieza", {
      type: "bar",
      data: {
        labels: ["Con maintain_order", "Sin el indicador"],
        datasets: [{
          label: "Limpieza de pedidos, SF 5", data: [LIMPIEZA_SF5.con, LIMPIEZA_SF5.sin],
          backgroundColor: [css("--s-dsl"), css("--s-dsl-suave")], borderRadius: 5, maxBarThickness: 110,
        }],
      },
      options: opciones({
        leyenda: false, yTitulo: "Segundos (SF 5)", formatoY: (v) => `${v} s`, tooltip: segundos,
        valores: { formato: (v) => segundos(v), tamano: 13 },
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionOptimizaciones() {
  let sf = sfMax();
  const capas = [
    { etiqueta: "Sin los pases del DSL", variable: "--s-dsl", lento: "dsl-O0", rapido: "dsl" },
    { etiqueta: "Sin los pases, sin optimizador de Polars", variable: "--s-dsl-suave", lento: "dsl-O0-sin-opt-polars", rapido: "dsl-sin-opt-polars" },
    { etiqueta: "Sin el optimizador de Polars", variable: "--s-polars", lento: "dsl-sin-opt-polars", rapido: "dsl" },
  ];
  segmentado($("opt-sf"), opcionesSF(), sf, (v) => { sf = v; dibujar(); });
  function dibujar() {
    grafico("g-opt", {
      type: "bar",
      data: {
        labels: D.tareas.map((t) => t.nombre),
        datasets: capas.map((c) => ({
          label: c.etiqueta, backgroundColor: css(c.variable), borderRadius: 4,
          data: D.tareas.map((t) => {
            const a = medida(sf, t.id, c.lento), b = medida(sf, t.id, c.rapido);
            return a && b ? a.mediana / b.mediana : null;
          }),
        })),
      },
      options: opciones({
        yTitulo: `Veces más lento (SF ${sf})`, formatoY: (v) => `${v}×`, tooltip: (v) => veces(v),
        valores: { formato: (v, i) => (i === capas.length - 1 ? `${v.toFixed(1)}×` : null) },
        referencia: { y: 1, etiqueta: "sin cambio" },
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionMemoria() {
  let sf = sfMax();
  const cocientes = D.tareas.map((t) => [medida(sfMax(), t.id, "pandas"), medida(sfMax(), t.id, "dsl")])
    .filter(([p, d]) => p && d).map(([p, d]) => p.memoria_gb / d.memoria_gb);
  $("t-memoria").textContent = `Pandas usa hasta ${Math.round(Math.max(...cocientes))}× más memoria que el DSL`;
  segmentado($("memoria-sf"), opcionesSF(), sf, (v) => { sf = v; dibujar(); });
  function dibujar() {
    grafico("g-memoria", {
      type: "bar",
      data: {
        labels: D.tareas.map((t) => t.nombre),
        datasets: SISTEMAS.map((s) => ({
          label: nombreSistema(s), data: D.tareas.map((t) => medida(sf, t.id, s)?.memoria_gb ?? null),
          backgroundColor: css(COLOR[s]), borderRadius: 4, pointStyle: PUNTO[s],
        })),
      },
      options: opciones({
        yTitulo: `Memoria pico, GB (SF ${sf})`, formatoY: (v) => `${v} GB`, tooltip: gb,
        valores: { faltante: (i, j) => (sinMemoria.has(clave(sf, D.tareas[j].id, SISTEMAS[i])) ? "sin memoria (> 31 GB)" : null) },
      }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionExpresividad() {
  let metrica = "tokens";
  segmentado($("expr-medida"), [{ valor: "tokens", etiqueta: "Tokens" }, { valor: "lineas", etiqueta: "Líneas" }], metrica,
    (v) => { metrica = v; dibujar(); });
  function dibujar() {
    grafico("g-expr", {
      type: "bar",
      data: {
        labels: D.tareas.map((t) => t.nombre),
        datasets: SISTEMAS.map((v) => ({
          label: nombreVersion(v), backgroundColor: css(COLOR[v]), borderRadius: 4, pointStyle: PUNTO[v],
          data: D.tareas.map((t) => D.expresividad.find((e) => e.tarea === t.id && e.version === v)?.[metrica] ?? null),
        })),
      },
      options: opciones({ yTitulo: metrica === "tokens" ? "Tokens" : "Líneas de código", formatoY: String }),
    });
  }
  renders.push(dibujar);
  dibujar();
}

function seccionErrores() {
  const categorias = [
    { id: "compilación", etiqueta: "Al compilar", variable: "--s-dsl", texto: () => "#ffffff" },
    { id: "ejecución", etiqueta: "Al ejecutar", variable: "--s-dsl-suave", texto: () => css("--on-suave") },
    { id: "silencioso", etiqueta: "No se detecta", variable: "--miss", texto: () => css("--text") },
  ];
  const momento = [
    (e) => (e.dsl_momento === "no detectado" ? "silencioso" : e.dsl_momento),
    (e) => e.polars_momento,
  ];
  const casos = (sistema, categoria) => D.errores.filter((e) => momento[sistema](e) === categoria);
  function dibujar() {
    grafico("g-errores", {
      type: "bar",
      data: {
        labels: ["DSL", "Polars"],
        datasets: categorias.map((c) => ({
          label: c.etiqueta, backgroundColor: css(c.variable), borderRadius: 4, maxBarThickness: 120,
          borderColor: css("--surface"), borderWidth: { top: 2 },
          data: [0, 1].map((s) => casos(s, c.id).length),
        })),
      },
      options: opciones({
        apilado: true, yTitulo: `Errores (de ${D.errores.length})`, formatoY: String,
        tooltip: (v) => `${v} ${v === 1 ? "caso" : "casos"}`,
        valores: { dentro: true, tamano: 14, formato: (v) => (v ? String(v) : null), colorDentro: (i) => categorias[i].texto() },
        detalle: (c) => casos(c.dataIndex, categorias[c.datasetIndex].id).map((e) => `  ${e.caso.slice(0, 2)} · ${e.descripcion}`),
      }),
    });
  }
  renders.push(dibujar);
  dibujar();

  const insignia = (m) => `<span class="badge ${m.replace(" ", "-")}">${esc(MOMENTO[m] ?? m)}</span>`;
  $("errores-casos").innerHTML = `<div class="cases-head"><span>#</span><span>Error</span><span>DSL</span><span>Polars</span></div>`
    + D.errores.map((e) => `
    <details>
      <summary>
        <span class="num">${esc(e.caso.slice(0, 2))}</span>
        <span>${esc(e.descripcion)}</span>
        ${insignia(e.dsl_momento)}
        ${insignia(e.polars_momento)}
      </summary>
      <div class="body">
        <p><strong>DSL</strong>${e.dsl_codigo ? ` · <code>${esc(e.dsl_codigo)}</code>` : ""}</p>
        <pre>${esc(e.dsl_mensaje || "Sin diagnóstico: el programa compila y se ejecuta.")}</pre>
        <p><strong>Polars</strong></p>
        <pre>${esc(e.polars_momento === "silencioso" ? `Termina sin error y devuelve ${e.polars_detalle}.` : e.polars_detalle)}</pre>
      </div>
    </details>`).join("");
}

// Código lado a lado, sin comentarios de línea completa (como se midieron los tokens).
function resaltar(codigo, version) {
  const comentario = version === "dsl" ? "//" : version === "duckdb" ? "--" : "#";
  const lineas = codigo.split("\n").filter((linea) => !linea.trim().startsWith(comentario));
  while (lineas.length && !lineas[0].trim()) lineas.shift();
  return lineas.map((linea) => {
    const t = esc(linea);
    return version === "dsl" ? t.replace(PALABRAS_DSL, '<span class="kw">$1</span>') : t;
  }).join("\n");
}

function seccionCodigo() {
  let tarea = "ingreso_descuento", rival = "polars";
  const panel = (version) => {
    const e = D.expresividad.find((q) => q.tarea === tarea && q.version === version);
    return `<div class="code-panel" style="--c:var(${COLOR[version]})">
        <header><b>${esc(nombreVersion(version))}</b><span>${e.tokens} tokens · ${e.lineas} líneas</span></header>
        <pre>${resaltar(D.codigo[tarea][version], version)}</pre>
      </div>`;
  };
  const dibujar = () => { $("codigo").innerHTML = panel("dsl") + panel(rival); };
  segmentado($("codigo-tarea"), D.tareas.map((t) => ({ valor: t.id, etiqueta: t.nombre })), tarea, (v) => { tarea = v; dibujar(); });
  segmentado($("codigo-rival"), SISTEMAS.slice(1).map((v) => ({ valor: v, etiqueta: `vs ${nombreVersion(v)}` })), rival,
    (v) => { rival = v; dibujar(); });
  dibujar();
}

function pie() {
  const e = D.entorno;
  const versiones = Object.entries(e.versiones ?? {}).filter(([k]) => ["polars", "duckdb", "pandas", "pyarrow"].includes(k))
    .map(([k, v]) => `${k} ${v}`).join(", ");
  const porCorrida = {};
  for (const [sf, c] of Object.entries(D.corridas)) (porCorrida[c] ??= []).push(`SF ${sf}`);
  $("entorno").innerHTML = `
    <p>Medido en ${esc(e.cpu ?? "—")} (${esc(e.hilos ?? "?")} hilos) con Docker sobre WSL2 limitado a
      ${esc(Math.round(e.memoria_total_gb ?? 31))} GB; Python ${esc(e.python ?? "?")}, ${esc(versiones)}.</p>
    <p>${esc(D.cifras.mediciones)} mediciones correctas. Corridas: ${Object.entries(porCorrida)
      .map(([c, sfs]) => `${esc(sfs.join(", "))} de <code>${esc(c)}</code>`).join("; ")}.</p>
    <p>Datos generados por <code>bench/analisis.py</code> a partir de <code>bench/resultados/</code>.</p>`;
}

// Arranque

async function iniciar() {
  const estado = $("status");
  try {
    if (typeof Chart === "undefined") throw new Error("No se pudo cargar Chart.js desde el CDN");
    const respuesta = await fetch("benchmarks.json", { cache: "no-cache" });
    if (!respuesta.ok) throw new Error(`benchmarks.json: HTTP ${respuesta.status}`);
    D = await respuesta.json();
  } catch (err) {
    estado.textContent = err.message.includes("Chart") ? "Sin conexión al CDN de Chart.js" : "Sin datos: ejecuta bench/analisis.py";
    estado.className = "status error";
    console.error(err);
    return;
  }
  fila = new Map(D.tiempos.map((f) => [clave(f.sf, f.tarea, f.config), f]));
  sinMemoria = new Set(D.fallas.map((f) => clave(f.sf, f.tarea, f.config)));
  Chart.register(pluginValores, pluginReferencia);
  aplicarTema();
  kpis();
  seccionDatos();
  seccionTiempo();
  seccionEscala();
  seccionRazon();
  seccionPandas();
  seccionLimpieza();
  seccionOptimizaciones();
  seccionMemoria();
  seccionExpresividad();
  seccionErrores();
  seccionCodigo();
  pie();
  estado.textContent = `${D.cifras.mediciones} mediciones`;
  estado.className = "status ok";

  // El tema (del sistema o el elegido con el botón) cambia los colores: se vuelven a crear
  // los gráficos con los nuevos. theme.js emite "etl-themechange" en ambos casos.
  window.addEventListener("etl-themechange", () => {
    aplicarTema();
    renders.forEach((r) => r());
  });
}

iniciar();
