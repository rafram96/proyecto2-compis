# Cauce, web del compilador ETL-DSL

Landing y estudio del compilador de `etl_dsl/`. Se llama **Cauce**: el lecho por donde corre el agua, como el `->` de `FLOW`
lleva los datos. La marca es `~>` (agua que se vuelve flecha) y la historia del nombre son los canales prehispánicos de
Cumbemayo y Nazca.

```bash
cd web && npm install && npm run dev            # http://localhost:5173
npm run build                                    # tsc + vite build
npm test                                         # rangos de diagnósticos; Node >= 22.18
.venv/bin/python web/scripts/gen_compiled.py     # (raíz del repo) regenera src/data/compiled.json
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5173/ # raíz, Vite iniciado y playwright-cli en PATH
bash web/scripts/gen_icons.sh                    # regenera iconos PNG/ICO y og.png (Chrome + ffmpeg)
```

## Decisiones fijas (no reabrir sin hablar con el equipo)

- **Stack:** Vite + React 19 + TypeScript + Tailwind v4. Tokens en `src/styles/brand.css`, estilos en `src/index.css`.
- **Editor de código: CodeMirror 6** (`src/editor/`), no Monaco. Lenguaje `etl-dsl` con `StreamLanguage` (vocabulario en
  `src/editor/words.ts`, sacado de `etl_dsl/grammar.lark`), autocompletado, diagnósticos con `@codemirror/lint` alimentados por los
  diagnósticos estructurados del compilador y colores `--syn-*` de `brand.css` (el tema cambia sin recrear el editor).
  Los rangos completos se convierten de caracteres Unicode de Python a UTF-16, conservando emoji y expresiones multilínea.
  Se carga en diferido: la página no lo espera para pintarse. `src/components/highlight.tsx` es solo para fragmentos estáticos.
- **Marca B «Deep Ocean + ámbar Polars»:** azul = estructura, ámbar `#FFCC00` = acción. Tema **claro por defecto** con toggle
  (`data-theme` en `<html>`, clave `cauce-theme` en `localStorage`). En claro nunca uses `#00B4D8`/`#0096C7` como texto.
- **Cambio de tema:** revelado circular desde el botón con la View Transitions API (`src/lib/theme.ts`); sin soporte o con
  «reducir movimiento», fundido corto o cambio directo. El icono luna/sol es una sola figura que se transforma.
- **Tipografía:** Montserrat (títulos) + Rubik (texto); Geist Mono solo dentro de código. Cinco tamaños: `--fs-xl|l|m|body|s`.
- **Dirección visual:** skill `design-taste-frontend`, dirección «The product performs» (semilla 1021409496, héroe redibujado a
  «Sentence split by a frame»): fragmentos reales del producto en vez de capturas. Sin gradientes, sin sombras en reposo, sin
  líneas finas fuera de fragmentos `data-ui`, titulares ≤ 2 líneas. Verificar con
  `node .claude/skills/design-taste-frontend/scripts/lint.mjs web/src` e `inspect.mjs <url> --allow mono`
  (`--allow mono` solo porque CodeMirror es código real editable fuera de `<pre>`).
- **Datos = salida real del compilador.** Nada de IR ni Python escritos a mano: todo sale de `src/data/compiled.json`.

## El compilador en el navegador

El estudio (sección final) corre **el mismo `etl_dsl`** que la terminal, sin backend:

1. `src/compiler/worker.ts` (Web Worker) descarga Pyodide 314.0.7 (Python 3.14) de jsDelivr la primera vez que alguien pulsa
   «Compilar», instala `public/py/lark-1.3.1-py3-none-any.whl` y copia `../etl_dsl/*.py|lark` (empaquetados por Vite con
   `import.meta.glob`, por eso `vite.config.ts` permite leer fuera de `web/`).
2. `src/compiler/studio.py` llama a la API pública `etl_dsl.analyze`, sin crear archivos ni depender de la CLI privada.
   Devuelve texto de presentación y el contrato estructurado: diagnósticos, versiones, hash del fuente, estado de artefactos,
   AST con posiciones e IR antes/después. Solicita solo los artefactos del formato elegido.
   Lo usa **también** `scripts/gen_compiled.py`. La prueba `verify_browser.py` compara 32 presentaciones reales entre CPython
   y Pyodide: los cuatro ejemplos, los seis formatos y las vistas IR/Python con `-O0`; también verifica corrección y rangos en CodeMirror.
3. Antes de cargar Python, la página muestra la salida precalculada; ya cargado, compila mientras escribes (pausa de 320 ms).

Los snapshots del landing guardan texto y resumen de análisis con diagnósticos, sin duplicar los AST/IR estructurados dentro
del paquete inicial. El resultado en vivo sí conserva los artefactos solicitados, incluso cuando una fase posterior falla.
La vista AST compacta oculta posiciones solo en el texto; el contrato en vivo las mantiene. Véase [la API de análisis](../docs/api_analisis.md).

Polars y DuckDB no hacen falta para compilar: el estudio no ejecuta pipelines ni lee datos.

## Contenido y recursos

- Programas de ejemplo propios de la web en `scripts/programs/` (`ventas.etl`, `pendientes.etl`); `credit_risk.etl` y
  `demo/optimizaciones.etl` se leen del repo.
- Fotos de Wikimedia Commons en `public/img/` (CC BY-SA, crédito en el pie de cada foto; detalle en
  `scripts/brand/photo-credits.json`). Muestran los canales de Cumbemayo y Nazca, no el producto.
- Iconos: `public/favicon.svg` es la fuente; `scripts/gen_icons.sh` genera `favicon.ico`, `apple-touch-icon.png`,
  `icon-192/512.png`, `icon-maskable-512.png` y `og.png` (plantilla en `scripts/brand/og.html`).

## Pendiente

Vistas por fase más ricas (AST e IR como grafo dibujado), ejecución con datos de ejemplo y un modo pantalla completa del estudio.
