"use strict";

// Árbol de derivación y AST dibujados como grafos navegables.
//
// La navegación imita un mapa embebido: arrastrar (botón izquierdo o rueda) mueve el dibujo,
// Ctrl/⌘ + rueda o el pellizco del trackpad acercan y alejan hacia el cursor y el doble clic acerca.
// La rueda sola desplaza la página, como siempre. Maximizada (una ventana grande sobre el estudio),
// la rueda sola hace zoom. Teclado con el dibujo enfocado: flechas para moverse, + y - para el zoom,
// 0 para ajustar y M para maximizar (Esc o un clic fuera de la ventana la cierran).
//
// Expone window.Arboles.create(host, "parse" | "ast", { select(span), preview(span | null) }).
// Los span que recibe la aplicación tienen la forma { start: {line, column}, end: {line, column} }.

(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const ZOOM_KEY = MAC ? "⌘" : "Ctrl";
  const ZOOM = { min: 0.15, max: 3, step: 1.25 };
  const BIG_TREE = 120;  // a partir de estos nodos, la vista abre con las ramas profundas plegadas
  const PAN_STEP = 60;   // px por flecha

  function html(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function svg(tag, attributes = {}, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const truncate = (text, length) => (text && text.length > length ? `${text.slice(0, length - 1)}…` : text);
  const format = (value) => (Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : JSON.stringify(value));

  // ---------------------------------------------------------------------------------------------
  // Modelo común de los dos árboles:
  // { id, label, sub, extra, cat, span: [línea, columna, línea final, columna final] | null,
  //   edge, token, rule, attrs, children }
  // Los id son rutas desde la raíz ("p/0/2", "a/1/0"): siguen valiendo entre compilaciones mientras
  // la forma del programa no cambie, así se conservan las ramas plegadas y el nodo elegido.

  function ruleCategory(rule) {
    if (/^(pipeline|linear_pipeline)$/.test(rule)) return "root";
    if (/^source_decl$|^from_/.test(rule)) return "source";
    if (/^sink_decl$|^to_/.test(rule)) return "sink";
    if (/^step_decl$|_op$/.test(rule)) return "step";
    if (rule === "use_decl") return "use";
    if (/^(flow|connection|endpoint)$/.test(rule)) return "flow";
    if (/expr$|^(compare|is_null|is_not_null|qualified_column|number|string|scalar_function|bool|null)$/.test(rule)) return "expr";
    return "rule";
  }

  function fromParse(node, id = "p") {
    const span = node.start ? [node.start.line, node.start.column, node.end.line, node.end.column] : null;
    if (node.token) return { id, label: node.lexeme, sub: node.token, cat: "token", token: true, span, children: [] };
    return { id, label: node.rule, cat: ruleCategory(node.rule), rule: true, span,
      children: node.children.map((child, index) => fromParse(child, `${id}/${index}`)) };
  }

  const AST_CATEGORY = { Program: "root", Pipeline: "root", Source: "source", Input: "source", Step: "step",
    Sink: "sink", Output: "sink", Use: "use", Flow: "flow", Connection: "flow", Endpoint: "flow",
    BinaryExpr: "expr", UnaryExpr: "expr", Column: "expr", Literal: "expr", Call: "expr" };
  const isNode = (value) => value && typeof value === "object" && !Array.isArray(value) && "node" in value;

  function fromAst(value, edge = null, id = "a") {
    const type = value.node;
    const children = [], attrs = [];
    for (const [key, child] of Object.entries(value)) {
      if (key === "node" || key === "span") continue;
      if (isNode(child)) {
        children.push(fromAst(child, key, `${id}/${children.length}`));
      } else if (Array.isArray(child) && child.some(isNode)) {
        child.forEach((item, index) => {
          if (isNode(item)) children.push(fromAst(item, `${key}[${index}]`, `${id}/${children.length}`));
        });
      } else {
        attrs.push([key, child]);
      }
    }
    // La etiqueta principal es lo que identifica al nodo: su nombre, operador o valor.
    const get = (key) => attrs.find(([name]) => name === key)?.[1];
    let label = type, sub = null, used = [];
    if (type === "BinaryExpr" || type === "UnaryExpr") { label = get("operator"); sub = type; used = ["operator"]; }
    else if (type === "Literal") { label = JSON.stringify(get("value")); sub = type; used = ["value"]; }
    else if (type === "Column") {
      label = (get("qualifier") ? `${get("qualifier")}.` : "") + get("name"); sub = type; used = ["name", "qualifier"];
    } else if (type === "Use") { label = `${get("pipeline")} AS ${get("alias")}`; sub = type; used = ["pipeline", "alias"]; }
    else if (type === "Aggregation") { label = `${get("function")} AS ${get("alias")}`; sub = type; used = ["function", "alias"]; }
    else if (get("name") != null) { label = String(get("name")); sub = type; used = ["name"]; }
    const rest = attrs.filter(([key, v]) => !used.includes(key) && v !== null && v !== false && !(Array.isArray(v) && !v.length));
    const span = value.span ? [value.span.line, value.span.column, value.span.end_line, value.span.end_column] : null;
    return { id, label: String(label), sub, extra: rest.length ? rest.map(([k, v]) => `${k}: ${format(v)}`).join(" · ") : null,
      attrs, cat: AST_CATEGORY[type] ?? "misc", span, edge, children };
  }

  function walk(node, visit, parent = null, depth = 0) {
    visit(node, parent, depth);
    for (const child of node.children) walk(child, visit, node, depth + 1);
  }

  function count(node) {
    let total = 0;
    walk(node, () => total++);
    return total;
  }

  const toSpan = (span) => span && { start: { line: span[0], column: span[1] }, end: { line: span[2], column: span[3] } };

  // ---------------------------------------------------------------------------------------------
  // Layout de árbol ordenado, de arriba hacia abajo. Cada subárbol ocupa el ancho de sus hijos (o el
  // del propio nodo si es mayor) y el padre queda centrado. Con leavesBottom, los tokens bajan a la
  // última fila: leídos de izquierda a derecha forman la frontera del árbol, es decir, el programa.

  const CHAR = { main: 7.3, sub: 6.2, extra: 6.1, edge: 5.6 };

  function nodeSize(node, style) {
    const main = truncate(node.label, 26), extra = truncate(node.extra, 34);
    let width = Math.max(main.length * CHAR.main, (node.sub || "").length * CHAR.sub,
      extra ? extra.length * CHAR.extra : 0) + 22;
    if (style === "ast" && node.edge) width = Math.max(width, node.edge.length * CHAR.edge + 8);
    const height = node.token ? 36 : style === "ast" ? (extra ? 52 : node.sub ? 38 : 28) : 26;
    return { w: Math.max(width, node.rule ? 40 : 46), h: height };
  }

  function layout(root, options) {
    const visible = (node) => (options.collapsed.has(node.id) ? [] : node.children);
    const nodes = [];
    let maxDepth = 0;
    (function collect(node, depth, parent) {
      node._depth = depth; node._parent = parent; node._size = nodeSize(node, options.style);
      nodes.push(node);
      maxDepth = Math.max(maxDepth, depth);
      for (const child of visible(node)) collect(child, depth + 1, node);
    })(root, 0, null);

    const extent = (node) => {
      const children = visible(node);
      const sum = children.reduce((total, child) => total + extent(child), 0)
        + options.gapX * Math.max(0, children.length - 1);
      return (node._extent = Math.max(node._size.w, sum));
    };
    extent(root);
    const place = (node, start) => {
      node._x = start + node._extent / 2;
      const children = visible(node);
      const sum = children.reduce((total, child) => total + child._extent, 0)
        + options.gapX * Math.max(0, children.length - 1);
      let cursor = start + (node._extent - sum) / 2;
      for (const child of children) { place(child, cursor); cursor += child._extent + options.gapX; }
    };
    const pad = 24, top = options.edgeLabels ? 10 : 0;
    place(root, pad);
    const rowHeight = Math.max(...nodes.map((node) => node._size.h));
    for (const node of nodes) {
      const depth = options.leavesBottom && node.token ? maxDepth : node._depth;
      node._y = pad + top + depth * (rowHeight + options.gapY) + rowHeight / 2;
    }
    return {
      nodes, visible,
      width: root._extent + pad * 2,
      height: pad * 2 + top + (maxDepth + 1) * rowHeight + maxDepth * options.gapY + (options.leavesBottom ? 30 : 10),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Viewport con desplazamiento y zoom (transformación de un <g>; el SVG ocupa todo el recuadro).

  class Viewport {
    constructor(owner) {
      this.owner = owner;
      this.t = { k: 1, x: 0, y: 0 };
      this.content = { w: 0, h: 0, anchor: 0 };
      this.el = html("div", { class: "tv-viewport", tabindex: "0", role: "group",
        "aria-label": `Dibujo navegable. Arrastra para moverte, ${ZOOM_KEY} + rueda para el zoom, flechas para desplazarte.` });
      this.svg = svg("svg", { "aria-hidden": "false" });
      this.layer = svg("g");
      this.svg.append(this.layer);
      this.hint = html("div", { class: "tv-hint", "aria-hidden": "true" });
      this.el.append(this.svg, this.hint);
      this.listen();
    }

    apply() {
      const { k, x, y } = this.t;
      this.layer.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
      this.owner.zoomChanged(this);
    }

    zoomAt(factor, px, py) {
      const k = clamp(this.t.k * factor, ZOOM.min, ZOOM.max);
      const ratio = k / this.t.k;
      this.t = { k, x: px - (px - this.t.x) * ratio, y: py - (py - this.t.y) * ratio };
      this.apply();
    }

    zoomCenter(factor) {
      this.zoomAt(factor, this.el.clientWidth / 2, this.el.clientHeight / 2);
    }

    panBy(dx, dy) {
      this.t = { ...this.t, x: this.t.x + dx, y: this.t.y + dy };
      this.apply();
    }

    // Todo el dibujo a la vista si se puede leer; si no, zoom mínimo legible centrado en la raíz.
    fit() {
      const width = this.el.clientWidth, height = this.el.clientHeight;
      if (!width || !height || !this.content.w) return false;
      const k = clamp(Math.min(1, (width - 16) / this.content.w, (height - 16) / this.content.h), 0.6, 1);
      const x = this.content.w * k <= width ? (width - this.content.w * k) / 2 : width / 2 - this.content.anchor * k;
      this.t = { k, x, y: 8 };
      this.apply();
      return true;
    }

    point(event) {
      const rect = this.el.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    showHint(text) {
      this.hint.textContent = text;
      this.hint.classList.add("visible");
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => this.hint.classList.remove("visible"), 1300);
    }

    listen() {
      const el = this.el;
      el.addEventListener("wheel", (event) => {
        const zoomKey = event.ctrlKey || event.metaKey;  // el pellizco del trackpad llega con ctrlKey
        if (!zoomKey && !this.owner.maximized) {
          this.showHint(`Usa ${ZOOM_KEY} + rueda para acercar o alejar`);
          return;  // la rueda sola desplaza la página
        }
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
        if (this.owner.maximized && event.shiftKey && !zoomKey) {
          this.panBy(-event.deltaY * unit, 0);
          return;
        }
        const delta = event.deltaY * unit;
        // Los pasos pequeños (pellizco, trackpad) necesitan más sensibilidad que la rueda del mouse.
        const rate = Math.abs(delta) < 40 ? 0.01 : 0.002;
        this.zoomAt(Math.exp(-delta * rate), ...this.point(event));
      }, { passive: false });

      // Arrastre con el botón izquierdo o con la rueda. La captura del puntero empieza solo después
      // de moverse unos píxeles, para que un clic simple siga llegando al nodo.
      let drag = null, suppressClick = false;
      el.addEventListener("mousedown", (event) => { if (event.button === 1) event.preventDefault(); });  // sin autodesplazamiento
      el.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        if (event.target.closest(".tv-toggle")) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: event.button === 1 };
        if (event.button === 1) { el.setPointerCapture(event.pointerId); el.classList.add("dragging"); }
      });
      el.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved) {
          if (Math.hypot(dx, dy) < 4) return;
          drag.moved = true;
          el.setPointerCapture(event.pointerId);
          el.classList.add("dragging");
        }
        drag.x = event.clientX;
        drag.y = event.clientY;
        this.panBy(dx, dy);
      });
      const stop = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
        drag = null;
        el.classList.remove("dragging");
      };
      el.addEventListener("pointerup", stop);
      el.addEventListener("pointercancel", stop);
      el.addEventListener("click", (event) => {
        if (suppressClick) { event.stopPropagation(); event.preventDefault(); suppressClick = false; }
      }, true);
      el.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });

      el.addEventListener("dblclick", (event) => {
        if (event.target.closest(".tv-node, .tv-toggle")) return;
        event.preventDefault();
        this.zoomAt(event.shiftKey ? 1 / 1.6 : 1.6, ...this.point(event));
      });

      el.addEventListener("keydown", (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const actions = {
          ArrowLeft: () => this.panBy(PAN_STEP, 0), ArrowRight: () => this.panBy(-PAN_STEP, 0),
          ArrowUp: () => this.panBy(0, PAN_STEP), ArrowDown: () => this.panBy(0, -PAN_STEP),
          "+": () => this.owner.zoomAll(ZOOM.step), "=": () => this.owner.zoomAll(ZOOM.step),
          "-": () => this.owner.zoomAll(1 / ZOOM.step), "0": () => this.owner.fitAll(),
          m: () => this.owner.toggleMaximized(), M: () => this.owner.toggleMaximized(),
        };
        const action = actions[event.key];
        if (!action) return;
        event.preventDefault();
        action();
      });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Foco: el programa completo, un pipeline o una declaración. Las claves usan nombres y posiciones,
  // no los id internos, para sobrevivir a las recompilaciones mientras se escribe.

  function focusList(root, kind) {
    const list = [];
    const nameOf = (node) => (kind === "parse"
      ? node.children.find((child) => child.token && child.sub === "NAME")?.label ?? node.label
      : node.label);
    for (const pipeline of root.children.filter((child) => !child.token)) {
      const name = nameOf(pipeline);
      list.push({ key: `p:${name}`, label: `PIPELINE ${name}`, node: pipeline });
      pipeline.children.filter((child) => !child.token).forEach((decl, index) => {
        const own = nameOf(decl);
        const text = kind === "parse"
          ? (own === decl.label ? decl.label : `${own} · ${decl.label}`)
          : (decl.sub ? `${decl.label} · ${decl.sub}` : decl.label);
        list.push({ key: `d:${name}:${index}:${decl.label}`, label: `  ${name} › ${text}`, node: decl, decl: true });
      });
    }
    return list;
  }

  // Nodo del AST que mejor corresponde a un rango del programa (mayor solapamiento, el más alto en empate).
  function bestMatch(root, span) {
    if (!span) return root;
    const position = (line, column) => line * 100000 + column;
    const a1 = position(span[0], span[1]), a2 = position(span[2], span[3]);
    let best = root, score = -1;
    walk(root, (node, parent, depth) => {
      if (!node.span) return;
      const b1 = position(node.span[0], node.span[1]), b2 = position(node.span[2], node.span[3]);
      const shared = Math.min(a2, b2) - Math.max(a1, b1);
      if (shared <= 0) return;
      const value = shared / (Math.max(a2, b2) - Math.min(a1, b1)) - depth * 1e-4;
      if (value > score) { score = value; best = node; }
    });
    return best;
  }

  // Lo que el ASTBuilder (visitor.py) cambió en una declaración, según las reglas de su rama del árbol.
  function differences(parseNode, astNode) {
    const rules = new Set(), tokens = new Set();
    let flat = 0;
    walk(parseNode, (node) => {
      if (node.token) { tokens.add(node.sub); return; }
      rules.add(node.label);
      if (/^(and_expr|or_expr)$/.test(node.label) && node.children.length > 2) flat = Math.max(flat, node.children.length);
    });
    const notes = [];
    const note = (markup) => { const item = html("li"); item.innerHTML = markup; notes.push(item); };
    note(`El árbol tiene <b>${count(parseNode)}</b> nodos; el AST, <b>${count(astNode)}</b>.`);
    if (tokens.has("NAME")) note("Los tokens <code>NAME</code> dejan de ser nodos: pasan a ser atributos (<code>name</code>, <code>alias</code>…).");
    if (rules.has("string") || rules.has("number")) note("<code>string</code> y <code>number</code> se vuelven <code>Literal</code> con el valor ya convertido.");
    if (rules.has("qualified_column")) note("<code>qualified_column</code> se vuelve <code>Column</code>.");
    if (rules.has("compare")) note("<code>compare</code> se vuelve <code>BinaryExpr</code>: el operador pasa a ser un atributo.");
    if (flat) note(`<code>and_expr</code> / <code>or_expr</code> tiene ${flat} hijos en el árbol; el AST lo anida en <code>BinaryExpr</code> binarios (asociatividad izquierda).`);
    if (rules.has("is_null") || rules.has("is_not_null")) note("<code>is_null</code> / <code>is_not_null</code> se vuelven <code>UnaryExpr</code>.");
    if (rules.has("names")) note("<code>names</code> desaparece: queda como lista de texto en un atributo (<code>columns</code>, <code>group_by</code>).");
    if (rules.has("arguments")) note("<code>arguments</code> desaparece: la lista queda directamente en <code>Connector.arguments</code>.");
    if (rules.has("scalar_function")) note("<code>scalar_function</code> se vuelve <code>Call</code>.");
    const linear = [...rules].some((rule) => /^(linear_pipeline|from_clause|to_clause|from_input|to_output)$/.test(rule))
      || (/_op$/.test(parseNode.label) && astNode.sub === "Step");
    if (linear) note("Forma lineal: el AST convierte <code>FROM … TO</code> en <code>Source</code>, <code>Step</code> y <code>Sink</code> con nombres generados y un <code>Flow</code> que no está escrito en el programa.");
    note("Las palabras clave y los símbolos (<code>STEP</code>, <code>=</code>, <code>{</code>, <code>;</code>) no están en ninguno de los dos: Lark los descarta al construir el árbol.");
    return notes;
  }

  // ---------------------------------------------------------------------------------------------
  // Vista de una pestaña: barra, uno o dos recuadros navegables, notas (comparación) y detalle.

  const DESCRIPTIONS = {
    rule: "Regla de grammar.lark",
    token: "Token: hoja del árbol",
  };

  class TreeView {
    constructor(host, kind, callbacks) {
      this.kind = kind;               // "parse": pestaña Árbol; "ast": pestaña AST
      this.callbacks = callbacks;
      this.mode = kind;               // en la pestaña AST: "ast" o "compare"
      this.focusKey = null;
      this.collapsed = new Set();
      this.prepared = new Set();      // focos que ya recibieron el plegado inicial
      this.selected = null;
      this.maximized = false;
      this.dirty = true;
      this.drawnKey = null;
      this.build(host);
    }

    build(host) {
      this.root = html("div", { class: "tv" });
      const bar = html("div", { class: "tv-bar" });
      if (this.kind === "ast") {
        const group = html("div", { class: "segmented", role: "group", "aria-label": "Vista del AST" });
        for (const [mode, text] of [["ast", "AST"], ["compare", "Comparar con el árbol"], ["text", "Texto"]]) {
          const button = html("button", { type: "button", "aria-pressed": String(this.mode === mode) }, text);
          button.addEventListener("click", () => {
            if (mode === "text" && this.maximized) this.toggleMaximized();
            this.mode = mode;
            group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
            this.selected = null;
            this.render();
          });
          group.append(button);
        }
        bar.append(group);
      }
      this.focusSelect = html("select", { "aria-label": "Parte del programa que se dibuja" });
      this.focusSelect.addEventListener("change", () => {
        this.focusKey = this.focusSelect.value;
        this.selected = null;
        this.render();
      });
      const focusLabel = html("label", { class: "tv-field" }, "Ver ", this.focusSelect);
      bar.append(focusLabel);
      this.help = html("span", { class: "tv-help" });
      this.zoomText = html("span", { class: "tv-zoom" }, "100 %");
      const tool = (text, label, action) => {
        const button = html("button", { type: "button", "aria-label": label, title: label }, text);
        button.addEventListener("click", action);
        return button;
      };
      const zoom = html("div", { class: "segmented tv-tools", role: "group", "aria-label": "Zoom" },
        tool("−", "Alejar (-)", () => this.zoomAll(1 / ZOOM.step)),
        tool("Ajustar", "Ajustar a la vista (0)", () => this.fitAll()),
        tool("+", "Acercar (+)", () => this.zoomAll(ZOOM.step)));
      this.maxButton = html("button", { type: "button", class: "ghost tv-max-button" });
      this.maxButton.addEventListener("click", () => this.toggleMaximized());
      bar.append(this.help, this.zoomText, zoom, this.maxButton);
      this.graphControls = [focusLabel, this.help, this.zoomText, zoom, this.maxButton];

      this.body = html("div", { class: "tv-body" });
      this.panes = [this.pane(), this.pane()];
      this.body.append(...this.panes.map((pane) => pane.el));
      this.notes = html("ul", { class: "tv-notes" });
      this.detail = html("div", { class: "tv-detail", "aria-live": "polite" });
      this.empty = html("p", { class: "empty tv-empty" });
      // Modo «Texto» de la pestaña AST: la lista desplegable original del estudio (renderAst en app.js).
      this.textBox = html("div", { class: "ast tv-text" });
      this.textBox.hidden = true;
      this.root.append(bar, this.empty, this.body, this.notes, this.detail, this.textBox);
      host.replaceChildren(this.root);
      this.updateChrome();
    }

    pane() {
      const title = html("span"), countText = html("span");
      const viewport = new Viewport(this);
      const el = html("section", { class: "tv-pane" }, html("header", {}, title, countText), viewport.el);
      return { el, title, count: countText, viewport, nodes: new Map(), groups: new Map() };
    }

    update(tree, ast) {
      this.tree = tree;
      this.ast = ast;
      this.models = { parse: tree ? fromParse(tree) : null, ast: ast ? fromAst(ast) : null };
      this.render();
    }

    // Se llama al mostrar la pestaña: una pestaña oculta no tiene tamaño para ajustar el dibujo.
    refresh() {
      if (this.dirty) this.render();
    }

    render() {
      if (!this.models) return;
      const text = this.mode === "text";
      this.textBox.hidden = !text;
      for (const control of this.graphControls) control.hidden = text;
      if (text) {
        this.empty.hidden = this.body.hidden = this.notes.hidden = this.detail.hidden = true;
        this.callbacks.text?.(this.ast, this.textBox);  // renderAst(ast, contenedor)
        return;
      }
      if (!this.root.clientWidth) { this.dirty = true; return; }
      this.dirty = false;
      const compare = this.kind === "ast" && this.mode === "compare";
      const kind = this.kind === "parse" || compare ? "parse" : "ast";
      const main = this.models[kind];
      const missing = !main || (compare && !this.models.ast);
      this.empty.hidden = !missing;
      this.body.hidden = this.notes.hidden = this.detail.hidden = missing;
      if (missing) {
        this.empty.textContent = this.kind === "parse"
          ? "El árbol aparece cuando la sintaxis es válida."
          : "El AST aparece cuando la sintaxis es válida.";
        return;
      }

      let list = focusList(main, kind);
      if (compare) list = list.filter((item) => item.decl);
      if (!list.length) list = [{ key: "root", label: main.label, node: main }];
      if (!list.some((item) => item.key === this.focusKey)) {
        // En la comparación conviene empezar por una declaración con expresiones: es donde más cambia.
        const operators = /^(compare|and_expr|or_expr|is_null|is_not_null|scalar_function|sum|product)$/;
        const withExpression = list.find((item) => {
          let found = false;
          walk(item.node, (node) => { found ||= Boolean(node.rule && operators.test(node.label)); });
          return found;
        });
        this.focusKey = compare ? (withExpression ?? list[0]).key : list[0].key;
      }
      this.focusSelect.replaceChildren(...list.map((item) => html("option", { value: item.key }, item.label)));
      this.focusSelect.value = this.focusKey;
      const chosen = list.find((item) => item.key === this.focusKey).node;

      const views = compare
        ? [{ root: chosen, style: "parse", title: "Árbol de derivación" },
          { root: bestMatch(this.models.ast, chosen.span), style: "ast", title: "AST" }]
        : [{ root: chosen, style: kind, title: kind === "parse" ? "Árbol de derivación · parser LALR" : "AST · visitor.py → ast.py" }];
      for (const view of views) {
        const key = `${view.style}|${view.root.id}`;
        if (!this.prepared.has(key) && count(view.root) > BIG_TREE) {
          walk(view.root, (node, parent, depth) => { if (depth >= 2 && node.children.length) this.collapsed.add(node.id); });
        }
        this.prepared.add(key);
      }

      this.body.classList.toggle("tv-two", compare);
      this.panes[1].el.hidden = !compare;
      this.notes.hidden = !compare;
      if (compare) this.notes.replaceChildren(...differences(views[0].root, views[1].root));
      const drawKey = `${this.mode}|${this.focusKey}|${this.maximized}`;
      const refit = drawKey !== this.drawnKey;
      this.drawnKey = drawKey;
      views.forEach((view, index) => this.paint(this.panes[index], view, refit));
      this.describe(this.findSelected());
    }

    paint(pane, view, refit) {
      const { root, style } = view;
      const parse = style === "parse";
      const result = layout(root, { style, collapsed: this.collapsed, leavesBottom: parse, edgeLabels: !parse,
        gapX: parse ? 8 : 14, gapY: parse ? 22 : 34 });
      pane.title.textContent = view.title;
      pane.count.textContent = `${result.nodes.length} de ${count(root)} nodos`;
      pane.nodes = new Map(result.nodes.map((node) => [node.id, node]));
      pane.groups = new Map();
      const edges = svg("g"), labels = svg("g"), nodes = svg("g");

      for (const node of result.nodes) {
        const parent = node._parent;
        if (!parent) continue;
        const x1 = parent._x, y1 = parent._y + parent._size.h / 2, x2 = node._x, y2 = node._y - node._size.h / 2;
        const middle = y1 + Math.min(26, (y2 - y1) / 2);
        const d = parse ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${x1},${middle + 10} ${x2},${middle - 6} ${x2},${y2}`;
        edges.append(svg("path", { class: "tv-edge", d, "data-to": node.id }));
        if (!parse && node.edge) {
          labels.append(svg("text", { class: "tv-elabel", x: x2, y: y2 - 5, "text-anchor": "middle", "data-to": node.id }, node.edge));
        }
      }

      for (const node of result.nodes) {
        const { w, h } = node._size;
        const classes = ["tv-node", node.token ? "token" : "", node.rule ? "rule" : "", this.selected === node.id ? "sel" : ""];
        const name = node.token ? `token ${node.sub} ${node.label}` : node.sub ? `${node.sub} ${node.label}` : node.label;
        const group = svg("g", { class: classes.join(" ").trim(), transform: `translate(${node._x - w / 2},${node._y - h / 2})`,
          tabindex: "0", role: "button", "aria-label": name });
        group.append(svg("rect", { class: "tv-box", width: w, height: h, rx: node.token ? 4 : 6 }));
        if (!node.token) group.append(svg("rect", { class: `tv-stripe k-${node.cat}`, x: 0.6, y: 0.6, width: 4, height: h - 1.2, rx: 2 }));
        if (node.token) {
          group.append(svg("text", { class: "tv-sub", x: w / 2, y: 13, "text-anchor": "middle" }, node.sub),
            svg("text", { class: "tv-main", x: w / 2, y: 28, "text-anchor": "middle" }, truncate(node.label, 26)));
        } else if (node.rule) {
          group.append(svg("text", { class: "tv-main", x: w / 2 + 2, y: h / 2 + 4, "text-anchor": "middle" }, node.label));
        } else {
          if (node.sub) group.append(svg("text", { class: "tv-sub", x: 12, y: 14 }, node.sub));
          group.append(svg("text", { class: "tv-main", x: 12, y: node.sub ? 30 : h / 2 + 4 }, truncate(node.label, 26)));
          if (node.extra) group.append(svg("text", { class: "tv-extra", x: 12, y: 44 }, truncate(node.extra, 34)));
        }
        if (node.children.length) group.append(this.toggle(pane, node, w, h));

        const span = toSpan(node.span);
        const highlight = (on) => {
          for (let current = node; current; current = current._parent) {
            pane.groups.get(current.id)?.classList.toggle("on", on);
            pane.viewport.layer.querySelectorAll(`[data-to="${CSS.escape(current.id)}"]`)
              .forEach((element) => element.classList.toggle("on", on));
          }
          this.callbacks.preview?.(on ? span : null);
        };
        group.addEventListener("mouseenter", () => highlight(true));
        group.addEventListener("mouseleave", () => highlight(false));
        group.addEventListener("focus", () => highlight(true));
        group.addEventListener("blur", () => highlight(false));
        const choose = () => {
          this.selected = node.id;
          this.root.querySelectorAll(".tv-node.sel").forEach((element) => element.classList.remove("sel"));
          group.classList.add("sel");
          this.describe(node);
          if (span) this.callbacks.select?.(span);
        };
        group.addEventListener("click", choose);
        group.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); choose(); }
        });
        nodes.append(group);
        pane.groups.set(node.id, group);
      }

      const layer = pane.viewport.layer;
      layer.replaceChildren(edges, labels, nodes);
      if (parse) {
        const leaves = result.nodes.filter((node) => node.token);
        if (leaves.length > 1) {
          const y = Math.max(...leaves.map((node) => node._y + node._size.h / 2)) + 12;
          const x1 = Math.min(...leaves.map((node) => node._x - node._size.w / 2));
          const x2 = Math.max(...leaves.map((node) => node._x + node._size.w / 2));
          layer.append(svg("line", { class: "tv-frontier-line", x1, x2, y1: y - 4, y2: y - 4 }),
            svg("text", { class: "tv-frontier", x: x1, y: y + 10 },
              "frontera: leídas de izquierda a derecha, las hojas son los tokens del programa"));
        }
      }
      pane.viewport.content = { w: result.width, h: result.height, anchor: root._x };
      if (refit || !pane.fitted) pane.fitted = pane.viewport.fit();
      else pane.viewport.apply();
    }

    toggle(pane, node, width, height) {
      const closed = this.collapsed.has(node.id);
      const hidden = closed ? count(node) - 1 : 0;
      const toggle = svg("g", { class: "tv-toggle", transform: `translate(${width / 2},${height + 1})`, tabindex: "0",
        role: "button", "aria-expanded": String(!closed),
        "aria-label": `${closed ? "Expandir" : "Plegar"} ${node.label}${closed ? ` (${hidden} nodos)` : ""}` });
      toggle.append(svg("circle", { r: closed ? 10 : 6 }),
        svg("text", { "text-anchor": "middle", y: 3.5, class: closed ? "count" : "" },
          closed ? (hidden > 999 ? "+999" : `+${hidden}`) : "−"));
      const flip = (event) => {
        event.stopPropagation();
        // El nodo plegado o expandido se queda en el mismo lugar de la pantalla.
        const before = { x: node._x, y: node._y };
        if (closed) this.collapsed.delete(node.id); else this.collapsed.add(node.id);
        this.render();
        const after = pane.nodes.get(node.id);
        if (after) pane.viewport.panBy((before.x - after._x) * pane.viewport.t.k, (before.y - after._y) * pane.viewport.t.k);
        pane.groups.get(node.id)?.querySelector(".tv-toggle")?.focus();
      };
      toggle.addEventListener("click", flip);
      toggle.addEventListener("dblclick", (event) => event.stopPropagation());
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); flip(event); }
      });
      return toggle;
    }

    findSelected() {
      for (const pane of this.panes) {
        if (!pane.el.hidden && pane.nodes.has(this.selected)) return pane.nodes.get(this.selected);
      }
      return null;
    }

    describe(node) {
      if (!node) {
        this.detail.replaceChildren(html("span", {},
          "Pasa el cursor por un nodo para ubicarlo en el programa; clic para seleccionarlo. "
          + "El círculo bajo un nodo pliega o expande su rama."));
        return;
      }
      const parts = [html("b", {}, node.token ? `${node.sub} ${JSON.stringify(node.label)}` : node.sub ? `${node.sub} ${node.label}` : node.label)];
      if (node.rule) parts.push(html("span", {}, DESCRIPTIONS.rule));
      if (node.token) parts.push(html("span", {}, DESCRIPTIONS.token));
      if (node.edge) parts.push(html("span", {}, `campo ${node.edge}`));
      for (const [key, value] of node.attrs || []) parts.push(html("span", {}, `${key} = `, html("code", {}, format(value) ?? "null")));
      if (node.span) parts.push(html("span", {}, `línea ${node.span[0]}:${node.span[1]} – ${node.span[2]}:${node.span[3]}`));
      this.detail.replaceChildren(...parts);
    }

    // Zoom y ajuste afectan a todos los recuadros visibles (en la comparación, a los dos).
    visiblePanes() {
      return this.panes.filter((pane) => !pane.el.hidden);
    }

    zoomAll(factor) {
      for (const pane of this.visiblePanes()) pane.viewport.zoomCenter(factor);
    }

    fitAll() {
      for (const pane of this.visiblePanes()) pane.viewport.fit();
    }

    zoomChanged(viewport) {
      if (viewport === this.visiblePanes()[0]?.viewport) this.zoomText.textContent = `${Math.round(viewport.t.k * 100)} %`;
    }

    // Maximizar: la vista sale del panel y se muestra como una ventana grande sobre el estudio,
    // con el fondo oscurecido. Esc, el botón o un clic en el fondo la devuelven al panel.
    toggleMaximized() {
      this.maximized = !this.maximized;
      if (this.maximized) {
        this.returnFocus = document.activeElement;
        this.backdrop ??= html("div", { class: "tv-backdrop" });
        this.backdrop.onclick = () => this.toggleMaximized();
        this.root.before(this.backdrop);
        this.escape = (event) => {
          if (event.key === "Escape") { event.preventDefault(); this.toggleMaximized(); }
        };
        document.addEventListener("keydown", this.escape);
      } else {
        this.backdrop?.remove();
        document.removeEventListener("keydown", this.escape);
      }
      this.root.classList.toggle("tv-maximized", this.maximized);
      document.body.classList.toggle("tv-locked", this.maximized);
      this.updateChrome();
      requestAnimationFrame(() => {
        this.render();
        if (this.maximized) this.visiblePanes()[0]?.viewport.el.focus({ preventScroll: true });
        else this.returnFocus?.focus?.({ preventScroll: true });
      });
    }

    updateChrome() {
      this.help.textContent = this.maximized
        ? "Arrastra para moverte · rueda: zoom · Mayús + rueda: mover · Esc: cerrar"
        : `Arrastra para moverte · ${ZOOM_KEY} + rueda: zoom · M: maximizar`;
      this.maxButton.textContent = this.maximized ? "Cerrar" : "Maximizar";
      this.maxButton.title = this.maximized ? "Volver al panel (Esc)" : "Ver en una ventana grande (M)";
      this.maxButton.setAttribute("aria-pressed", String(this.maximized));
      this.root.setAttribute("aria-label", this.kind === "parse" ? "Árbol de derivación" : "AST");
      this.root.setAttribute("role", this.maximized ? "dialog" : "region");
      this.root.setAttribute("aria-modal", String(this.maximized));
    }
  }

  window.Arboles = {
    create: (host, kind, callbacks) => new TreeView(host, kind, callbacks),
  };
})();
