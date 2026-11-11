# Cauce, web del compilador ETL-DSL

Landing (`/`) y estudio ampliado (`/estudio`) del compilador de `etl_dsl/`. Se llama **Cauce**: el lecho por donde corre el agua, como el `->` de `FLOW`
lleva los datos. La marca es `~>` (agua que se vuelve flecha) y la historia del nombre son los canales prehispánicos de
Cumbemayo y Nazca.

```bash
cd web && npm install && npm run dev            # http://localhost:5173
npm run build                                    # tsc + vite build
npm test                                         # 21 pruebas de rangos, documentos y worker; Node >= 22.18
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
- **Datos = salida real del compilador.** Nada de IR ni Python escritos a mano: las demos salen de `src/data/compiled.json` y las ediciones se compilan con el mismo núcleo en Pyodide.

## El compilador en el navegador

La demostración del landing y el estudio `/estudio` corren **el mismo `etl_dsl`** que la terminal, sin backend:

1. `src/compiler/worker.ts` (Web Worker) descarga Pyodide 314.0.7 (Python 3.14) de jsDelivr la primera vez que alguien pulsa
   «Compilar», instala `public/py/lark-1.3.1-py3-none-any.whl` y copia `../etl_dsl/*.py|lark` (empaquetados por Vite con
   `import.meta.glob`, por eso `vite.config.ts` permite leer fuera de `web/`).
2. `src/compiler/studio.py` llama a la API pública `etl_dsl.analyze`, sin crear archivos ni depender de la CLI privada.
   Devuelve texto de presentación y el contrato estructurado: diagnósticos, versiones, hash del fuente, estado de artefactos,
   AST con posiciones e IR antes/después. La demo solicita los artefactos del formato elegido.
   Lo usa **también** `scripts/gen_compiled.py`. El estudio solicita todos los artefactos y recibe seis presentaciones textuales
   en una sola compilación; cambiar de inspector reutiliza ese resultado, incluso si solo hay artefactos parciales.
   El worker serializa con JSON de Python para conservar `None` como `null` (la conversión directa de Pyodide usa `undefined`).
   `verify_browser.py` compara 32 presentaciones entre CPython/Pyodide y comprueba diagnósticos, O1, O3 y el recorrido de `/estudio`.
3. La demo muestra salidas precalculadas identificadas como tales solo para sus fuentes originales. El estudio comienza sin resultados;
   restaura únicamente el documento. Python se carga al pulsar Compilar; después recompila al editar con una pausa de 320 ms.

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

## Rutas y navegación

- `/`: landing y demo breve. **Continuar en el estudio** copia el texto editado y los pases al documento activo, conservando el anterior.
- `/estudio`: editor estable, inspectores Resultado/Tokens/Árbol/AST/IR/Python y diagnósticos accesibles desde cualquier fase.
- Las demás rutas muestran recuperación hacia Inicio y Estudio. `/ejemplos`, `/docs` y `/evaluacion` todavía no existen.
- La navegación interna usa History API; atrás/adelante conserva el documento. La URL no contiene programas ni datos.
- Editor e inspector quedan en paralelo en escritorio. En móvil, Código/Inspector alterna su visibilidad sin desmontar CodeMirror.
  Un diagnóstico selecciona su intervalo y devuelve al código. Ctrl/⌘ + Enter compila; Esc y después Tab permite salir del editor.

Vite dev y preview ya aplican fallback SPA. En hosting, servir `dist/index.html` para rutas de la aplicación que no sean archivos.
`public/_redirects` se copia al build para hosts compatibles; en Nginx puede usarse [nginx.conf](nginx.conf), montando `dist` en
`/usr/share/nginx/html`. Los assets y la rueda Python deben servirse como archivos reales, con sus errores 404. El ejemplo Nginx
no constituye un despliegue realizado. Verificar siempre el acceso directo a `/estudio` en el alojamiento elegido.

## Documento, archivos y persistencia

`src/workspace/` mantiene un documento activo: id local, nombre lógico, fuente, revisión, pases e inspector. Texto, nombre o pases
incrementan la revisión; cambiar de inspector no la incrementa. `null` conserva los pases predeterminados del núcleo; `[]` es O0.
La selección y el scroll de CodeMirror permanecen al cambiar inspector o tema. No se persisten cursor, historial de deshacer ni resultados.

- Importar acepta `.etl` UTF-8 hasta **128 KiB**, valida la decodificación y conserva el texto (retira BOM inicial). CodeMirror usa LF
  al editar; un archivo CRLF sin editar se conserva al guardar/exportar. Los nombres de descarga son nombres locales saneados.
- Descargar `.etl` exporta el documento actual. Python solo se habilita si su artefacto está disponible para esa revisión y pases.
  Al editar se marca la salida anterior como desactualizada y se deshabilita su descarga.
- `localStorage`, clave **`cauce-workspace-v1`**, guarda un sobre `{version:1, active, drafts}` validado, con hasta **8** documentos anteriores
  y **512 KiB** de JSON UTF-8 total. No contiene datasets ni artefactos compilados. El guardado es inmediato al cambiar el documento o inspector.
- Abrir ejemplo, importar o recuperar conserva el activo anterior. Borradores anteriores permite recuperar, descargar y eliminar explícitamente;
  alcanzar 8 bloquea la apertura de otro documento hasta eliminar uno, sin expulsión automática.
- Corrupción, versión incompatible, acceso denegado, cuota o límites de tamaño producen un aviso; el editor continúa en memoria y permite descargar.
  No se sustituye un almacenamiento inválido al abrir la página; la siguiente edición/apertura intenta guardar el estado validado.
  Si hay cambios sin guardar, el navegador avisa antes de salir. Un fallo de almacenamiento **no** garantiza recuperación tras cerrar/recargar.
- Los borradores pertenecen a este navegador y origen. No hay sincronización entre dispositivos ni resolución de ediciones simultáneas entre pestañas.

## Revisiones y recuperación del compilador

Cada resultado queda asociado al id, revisión y pases de su solicitud. Las respuestas antiguas no sustituyen el resultado actual; los
resultados anteriores del mismo documento se etiquetan, y los de otro documento se ocultan. Se conservan artefactos parciales y sus estados
`available`, `not_requested`, `blocked`, sin inventar salida para fases fallidas. El estudio solicita todas las fases en cada compilación;
por eso un diagnóstico de backend también puede aparecer mientras se inspecciona AST. Esto no certifica ejecución de datasets.

El cliente permite **una solicitud en curso y una pendiente**, reemplazando la pendiente con la más reciente y rechazando su promesa.
Valida mensajes/contrato 4, ignora callbacks de workers reemplazados y atiende `onerror`, `messageerror`, inicialización y envío fallidos.
Carga: **60 s** máximos desde el inicio, sin extender el plazo por mensajes de progreso. Compilación: **12 s** desde que Python está listo.
Un fallo o reinicio termina el worker y rechaza todas las promesas; la interfaz sale del estado ocupado. **Reiniciar compilador** conserva
el documento y requiere pulsar Compilar para descargar/cargar Python otra vez. No hay fallback a un servicio remoto.

## Verificación reproducible

Desde la raíz: `.venv/bin/python -m unittest discover` (**132 pruebas**) y `.venv/bin/python web/scripts/gen_compiled.py`.
Desde `web`: `npm test` (**21 pruebas**) y `npm run build`. El worker se prueba con canales/temporizadores simulados para fallos y plazos.

Con Vite iniciado en un puerto libre (no detener procesos ajenos):

```sh
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5174/
```

Requiere `playwright-cli` y Chromium/Chrome. Usa un perfil aislado; las capturas y descargas quedan en `web/.playwright-cli/` (ignorado).
Comprueba 32 comparaciones CPython/Pyodide, C2, O1/O0, O3 y obligaciones, Unicode/multilínea/EOF, transferencia desde la demo,
corrección, fases sin recompilar, archivos descargados byte a byte, importación UTF-8/CRLF, recarga, atrás/adelante, ruta desconocida,
fallo real de descarga de Pyodide con recuperación, cambios durante la carga, ediciones rápidas, ambos temas y alternancia móvil/teclado.
Las capturas se revisan visualmente; las pruebas no sustituyen una evaluación de usabilidad. También se comprobó el acceso directo a
`/estudio` con `vite preview` (puerto 5184), compilación real y Python descargable; consola sin errores ni advertencias.

## Pendiente

W1 queda **parcial**: se entregó el paso A, no las páginas auxiliares. W4 esencial implementado; las sugerencias semánticas siguen pendientes.
W2 conserva pendientes AST/FLOW gráficos y comparación avanzada de IR. W3 (servicio HTTP, bindings y ejecución Polars con datos) no se implementó.
No hay cuentas, colaboración, persistencia remota ni editor por bloques.
