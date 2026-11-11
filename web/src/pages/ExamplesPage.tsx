import { useEffect } from "react";
import { examples, findExample, findArticle } from "../content";
import { Code } from "../components/Code";
import { OpenExample } from "../components/OpenExample";
import { ContentMissing, useContentFocus } from "./contentNavigation";
export default function ExamplesPage({ slug }: { slug?: string }) {
  const example = slug ? findExample(slug) : undefined;
  const heading = useContentFocus(slug);
  useEffect(() => {
    document.title = `${slug ? (example?.title ?? "Ejemplo no encontrado") : "Ejemplos"} · Cauce`;
  }, [example, slug]);
  if (slug && !example)
    return <ContentMissing kind="Ejemplo" href="/ejemplos" />;
  return (
    <main className="content-page" id="contenido">
      {example ? (
        <>
          <a className="back-link" href="/ejemplos">
            Todos los ejemplos
          </a>
          <header className="content-heading">
            <h1 ref={heading} tabIndex={-1}>
              {example.title}
            </h1>
            <p>{example.goal}</p>
          </header>
          <div className="example-layout">
            <article className="reading">
              <h2>El problema y sus operaciones</h2>
              <p>{example.explanation}</p>
              <ul className="operation-list" aria-label="Operaciones">
                {example.operations.map((op) => (
                  <li key={op}>
                    <code>{op}</code>
                  </li>
                ))}
              </ul>
              <h2>Qué comprobar al compilar</h2>
              <p>
                {!example.expectation.ok && (
                  <strong>Ejercicio inválido intencionalmente. </strong>
                )}
                {example.expectedText}
              </p>
              <h2>
                Programa completo
                {!example.expectation.ok ? " · contiene un error" : ""}
              </h2>
              <p className="source-path">Fuente: {example.source}</p>
              <Code verbatim code={example.code} className="example-source" />
            </article>
            <aside
              className="example-context"
              aria-label="Requisitos del ejemplo"
            >
              <h2>Datos y entorno</h2>
              <ul>
                {example.requirements.map((req) => (
                  <li key={req}>{req}</li>
                ))}
              </ul>
              <h2>Al ejecutar localmente</h2>
              <p>{example.runtime}</p>
              <p className="content-note">
                Compilar no lee datasets ni certifica sus valores. No hay
                ejecución de pipelines en la web.
              </p>
              <OpenExample example={example} />
              <h2>Para entenderlo</h2>
              <ul className="reading-links">
                {example.docs.map((doc) => (
                  <li key={doc}>
                    <a href={`/docs/${doc}`}>{findArticle(doc)!.title}</a>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      ) : (
        <>
          <header className="content-heading">
            <h1 ref={heading} tabIndex={-1}>
              Elige un problema
            </h1>
            <p>
              Cinco programas reales para aprender a transformar datos y
              entender lo que demuestra el compilador.
            </p>
          </header>
          <p className="content-note">
            Puedes compilar todos sin datasets. El ejercicio de NULL contiene un
            error para corregir. Para ejecutar, abre una copia y conecta el servicio privado; su catálogo informa qué datasets están preparados.
          </p>
          <div className="example-list">
            {examples.map((item) => (
              <article key={item.slug}>
                <div>
                  <h2>
                    <a href={`/ejemplos/${item.slug}`}>{item.title}</a>
                  </h2>
                  <p>{item.goal}</p>
                </div>
                <div>
                  <span
                    className="example-status"
                    data-invalid={!item.expectation.ok}
                  >
                    {item.expectation.ok
                      ? "Programa válido"
                      : "Ejercicio inválido"}
                  </span>
                  <p>{item.operations.join(" · ")}</p>
                  <a
                    href={`/ejemplos/${item.slug}`}
                    aria-label={`Ver ${item.title}`}
                  >
                    Ver programa y requisitos
                  </a>
                </div>
              </article>
            ))}
          </div>
          <p className="content-next">
            ¿Primera visita?{" "}
            <a href="/docs/primer-programa">Recorre el estudio paso a paso</a> o{" "}
            <a href="/estudio">vuelve a tu documento</a>.
          </p>
        </>
      )}
    </main>
  );
}
