# Guía de desarrollo de Stream

Stream es la interfaz web del compilador ETL-DSL. Esta guía ayuda a levantar el proyecto y compartir cambios; para decisiones de implementación y contratos consulta el [README técnico de la web](../web/README.md).

## Requisitos

- Git y Node.js 24 con npm (se recomienda usar la misma versión para todo el equipo).
- Python 3.11 o superior para el servicio y los scripts del proyecto.
- Conexión a internet: el navegador descarga Pyodide la primera vez que se compila en Studio.

Clona el repositorio y cambia a la rama de trabajo que te hayan compartido:

```sh
git clone git@github.com:rafram96/proyecto2-compis.git
cd proyecto2-compis
git switch --track origin/feature/web
```

Si utilizas HTTPS, cambia la URL de clonación por la que muestra GitHub. Los comandos siguientes parten de la raíz del repositorio, salvo que se indique lo contrario.

## Iniciar la interfaz

```sh
cd web
npm ci
npm run dev
```

Abre la dirección que muestra Vite (normalmente <http://localhost:5173>). La página principal, el catálogo, la documentación y Studio funcionan sin iniciar la API. En Studio, **Compile** analiza el programa en el navegador; no lee datasets ni ejecuta el pipeline.

## Activar la ejecución de pipelines

Para usar **Run** en Studio necesitas también el servicio Python. En otra terminal, desde la raíz:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-service.txt
.venv/bin/python -m service.prepare
.venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

En Windows usa `.venv\Scripts\python.exe` en lugar de `.venv/bin/python`. Mantén Vite y el servicio en terminales separadas. Vite redirige `/api` al puerto 8000; si usas otro, inicia Vite con `CAUCE_API_TARGET=http://127.0.0.1:PUERTO`. El servicio es para uso privado local; consulta sus condiciones en [servicio de ejecución](servicio_ejecucion.md) antes de exponerlo.

Para probar el recorrido completo, abre `/ejemplos/gasto-por-cliente`, crea una copia en Studio, compila y, en Resultados, elige el pipeline `gasto_por_cliente` y el dataset `join-orders@1`. Pulsa **Run**. Ese CSV está incluido; `service.prepare` prepara los datasets adicionales de otros ejemplos.

## Dónde hacer cambios

| Ruta | Contenido |
| --- | --- |
| `web/src/pages/` y `web/src/components/` | Páginas y componentes de la interfaz. |
| `web/src/index.css` y `web/src/styles/` | Estilos y tokens visuales. |
| `web/src/editor/`, `compiler/`, `workspace/`, `execution/` | Editor, puente al compilador, documentos locales y cliente del servicio. |
| `web/content/` y `docs/` | Manifiestos de ejemplos y artículos, y documentación fuente. |
| `etl_dsl/` | Núcleo Python compartido por la CLI y el compilador del navegador. |
| `service/` | API y ejecución privada de pipelines. |
| `web/public/` | Recursos públicos, incluida la evidencia publicada y la rueda de Lark. |

Al cambiar contenido publicado, edita sus fuentes y regenera los archivos correspondientes; no edites a mano los JSON generados. Desde la raíz, con el entorno Python preparado:

```sh
.venv/bin/python web/scripts/gen_content.py
.venv/bin/python web/scripts/gen_compiled.py
.venv/bin/python web/scripts/gen_evaluation.py
.venv/bin/python web/scripts/gen_http.py
```

Ejecuta solo los generadores afectados; revisa sus opciones y dependencias en el [README técnico](../web/README.md). Los archivos generados versionados deben acompañar a sus fuentes cuando cambien.

## Comprobar antes de compartir

Desde `web/`:

```sh
npm test
npm run build
```

Desde la raíz, si cambiaste contenido o contratos, comprueba los generadores correspondientes:

```sh
.venv/bin/python web/scripts/gen_content.py --check
.venv/bin/python web/scripts/gen_evaluation.py --check
.venv/bin/python web/scripts/gen_http.py --check
```

Para cambios en el compilador o el servicio ejecuta además `.venv/bin/python -m unittest discover`. Prueba manualmente las páginas afectadas y, si cambiaste la ejecución, el recorrido Compile → Run. El build produce `web/dist/`, que es generado y no se sube a Git.

## Flujo de colaboración

Crea tu propia rama a partir de la rama compartida y evita trabajar directamente en `main`:

```sh
git switch feature/web
git pull --ff-only
git switch -c feat/descripcion-del-cambio
# Edita, revisa con git status y ejecuta las comprobaciones pertinentes.
git add <archivos>
git commit -m "web: describe el cambio"
git push -u origin feat/descripcion-del-cambio
```

Abre un pull request hacia la rama que acuerde el equipo y describe el cambio y las pruebas realizadas. No subas `.venv/`, `web/node_modules/`, `web/dist/`, datos locales ni secretos. `web/package-lock.json`, las fuentes y los recursos públicos necesarios sí se comparten. Para publicar el sitio se necesita configurar un alojamiento; subir una rama a GitHub por sí solo no publica la web.
