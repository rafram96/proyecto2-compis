# Cauce, web del compilador ETL-DSL

Landing (y futuro estudio) del compilador de `etl_dsl/`. Se llama **Cauce**; el motivo de marca es la flecha `->` de `FLOW`.

```bash
cd web && npm install && npm run dev      # http://localhost:5173
npm run build                              # tsc + vite build
.venv/bin/python web/scripts/gen_compiled.py   # (raíz del repo) regenera src/data/compiled.json
```

## Decisiones fijas (no reabrir sin hablar con el equipo)

- **Stack:** Vite + React 19 + TypeScript + Tailwind v4. Tokens en `src/styles/brand.css`, componentes en `src/index.css`.
- **Editor de código: CodeMirror 6** (ya instalado: `@codemirror/state|view|language|commands|lint|search`, `@lezer/highlight`).
  No usar Monaco (pesado, workers, mal en móvil) ni Prism/Highlight.js (solo resaltan, no editan).
  Plan: lenguaje `etl-dsl` con `StreamLanguage` o Lezer (palabras clave de `etl_dsl/grammar.lark`), diagnósticos con `@codemirror/lint`
  alimentados por los errores `archivo:línea:col` del compilador, y los tokens de color `--syn-*` de `brand.css` como tema.
  El resaltador de `src/components/highlight.tsx` es solo para bloques estáticos del landing.
- **Marca B «Deep Ocean + ámbar Polars»:** azul = estructura, ámbar `#FFCC00` = acción (botones, interruptor activo). Tema **claro por defecto** con toggle
  (`data-theme` en `<html>`, clave `cauce-theme` en `localStorage`). En claro nunca uses `#00B4D8`/`#0096C7` como texto (contraste < 4.5:1).
- **Tipografía:** Montserrat (títulos) + Rubik (texto); Geist Mono solo dentro de bloques de código.
- **Dirección visual:** skill `design-taste-frontend` (direction «One motif»). Sin gradientes, sin sombras en reposo, sin bordes finos,
  sin eyebrows ni numeración, titulares ≤ 2 líneas. Verificar con
  `node .claude/skills/design-taste-frontend/scripts/lint.mjs web/src` e `inspect.mjs <url>`.
- **Datos de la demo = salida real del compilador** (`src/data/compiled.json`). No inventar IR ni código generado a mano: regenerar con el script.
- **Pendiente:** estudio con editor CodeMirror, vistas por fase (tokens, AST, IR como DAG, Python/Polars), backend puente que llame
  a `python -m etl_dsl --format ...` (referencia: `csharp-x86-compi/backend/server.js`).
