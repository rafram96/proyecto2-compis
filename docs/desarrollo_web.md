# Guía de desarrollo de Stream

Stream es la interfaz web del compilador ETL-DSL. Esta guía ayuda a levantar el proyecto y compartir cambios; para decisiones de implementación y contratos consulta el [README técnico de la web](../web/README.md).

## Requisitos

- Git y Docker Desktop con Docker Compose en ejecución. No necesitas instalar Node ni Python en tu equipo para usar Compose.
- Conexión a internet: el navegador descarga Pyodide la primera vez que se compila en Studio.

Clona el repositorio y cambia a la rama de trabajo que te hayan compartido:

```sh
git clone git@github.com:rafram96/proyecto2-compis.git
cd proyecto2-compis
git switch --track origin/feature/web
```

Si utilizas HTTPS, cambia la URL de clonación por la que muestra GitHub. Los comandos siguientes parten de la raíz del repositorio, salvo que se indique lo contrario.

## Iniciar el entorno de desarrollo

Desde la raíz del proyecto, con Docker Desktop abierto:

```sh
docker compose --profile dev up --build -d dev-web
```

Abre <http://localhost:5173>. Compose inicia Vite y el servicio Python, instala las dependencias de la web y prepara los datasets. La primera ejecución puede tardar mientras descarga las imágenes y dependencias. Para consultar el estado o los mensajes:

```sh
docker compose --profile dev ps
docker compose --profile dev logs -f dev-web dev-api
```

Los cambios en `web/` se reflejan mediante Vite y los cambios en `service/` o `etl_dsl/` reinician el servicio. La primera compilación en Studio descarga Pyodide en el navegador. **Compile** analiza el programa; **Run** lo ejecuta mediante el servicio. El servicio es privado y la web solo escucha en este equipo.

Para comprobar el recorrido completo, abre `/ejemplos/gasto-por-cliente`, crea una copia en Studio, compila y, en Resultados, elige el pipeline `gasto_por_cliente` y el dataset `join-orders@1`. Pulsa **Run**.

Para detener el entorno sin borrar los datos preparados:

```sh
docker compose --profile dev stop dev-web dev-api
```

Para volver a iniciarlo usa el comando `up` anterior. Si cambian `requirements.txt` o `requirements-service.txt`, conserva `--build` para reconstruir la imagen Python. Si el puerto 5173 está ocupado, detén el proceso que lo usa antes de iniciar Compose. Los datos del servicio y las dependencias de Node se guardan en volúmenes Docker locales.

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

Al cambiar contenido publicado, edita sus fuentes y regenera los archivos correspondientes; no edites a mano los JSON generados. Desde la raíz, con Compose iniciado:

```sh
docker compose --profile dev exec dev-api python web/scripts/gen_content.py
docker compose --profile dev exec dev-api python web/scripts/gen_compiled.py
docker compose --profile dev exec dev-api python web/scripts/gen_evaluation.py
docker compose --profile dev exec dev-api python web/scripts/gen_http.py
```

Ejecuta solo los generadores afectados; revisa sus opciones y dependencias en el [README técnico](../web/README.md). Los archivos generados versionados deben acompañar a sus fuentes cuando cambien.

## Comprobar antes de compartir

Desde la raíz, con Compose iniciado:

```sh
docker compose --profile dev exec dev-web npm run build
```

Las pruebas web también invocan el compilador Python mediante `.venv/bin/python`. Para ejecutarlas, instala Node 24 y Python 3.11 o superior en tu equipo, prepara el entorno e instala las dependencias desde la raíz:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-service.txt
cd web
npm ci
npm test
cd ..
```

En Windows usa `.venv\Scripts\python.exe` en lugar de `.venv/bin/python`. Desde la raíz, si cambiaste contenido o contratos, comprueba los generadores correspondientes:

```sh
docker compose --profile dev exec dev-api python web/scripts/gen_content.py --check
docker compose --profile dev exec dev-api python web/scripts/gen_evaluation.py --check
docker compose --profile dev exec dev-api python web/scripts/gen_http.py --check
```

Para cambios en el compilador o el servicio ejecuta además `docker compose --profile dev exec dev-api python -m unittest discover`. Prueba manualmente las páginas afectadas y, si cambiaste la ejecución, el recorrido Compile → Run. El build produce `web/dist/`, que es generado y no se sube a Git.

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
