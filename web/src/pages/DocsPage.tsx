import { useEffect } from "react";
import { articles, findArticle, findExample } from "../content";
import { markdown } from "../content/markdown";
import { ArticleBody } from "../components/ArticleBody";
import { Code } from "../components/Code";
import { OpenExample } from "../components/OpenExample";
import { ContentMissing, useContentFocus } from "./contentNavigation";
/** Artículos donde una vista de Studio continúa la lectura con el documento propio. */
const STUDIO_VIEWS: Record<string, { href: string; text: string }> = {
  "null-contratos": {
    href: "/studio?vista=resultado",
    text: "Revisar los diagnósticos de tu documento en Studio",
  },
  estructura: {
    href: "/studio?vista=flow",
    text: "Ver el FLOW de tu documento en Studio",
  },
};
export default function DocsPage({ slug }: { slug?: string }) {
  const article = slug ? findArticle(slug) : undefined;
  const heading = useContentFocus(slug);
  useEffect(() => {
    document.title = `${slug ? (article?.title ?? "Artículo no encontrado") : "Documentación"} · Stream`;
  }, [article, slug]);
  if (slug && !article) return <ContentMissing kind="Artículo" href="/docs" />;
  const blocks = article ? markdown(article.body) : [];
  const example = article ? findExample(article.program)! : null;
  const position = articles.findIndex((a) => a.slug === slug);
  return (
    <main className="content-page" id="contenido">
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Artículos">
          <a href="/docs" aria-current={!slug ? "page" : undefined}>
            Documentación
          </a>
          {articles.map((item) => (
            <a
              href={`/docs/${item.slug}`}
              key={item.slug}
              aria-current={slug === item.slug ? "page" : undefined}
            >
              {item.title}
            </a>
          ))}
          <a href="/studio">Volver a tu documento</a>
        </nav>
        <div className="docs-main">
          <header className="content-heading">
            <h1 ref={heading} tabIndex={-1}>
              {article?.title ?? "Aprende Stream"}
            </h1>
            <p>
              {article?.summary ??
                "Del primer programa a la referencia técnica. Lee, prueba una copia y vuelve a consultar sin perder tu trabajo."}
            </p>
          </header>
          {article && example ? (
            <>
              <p className="content-note">{article.intro}</p>
              <nav className="article-toc" aria-label="En este artículo">
                <strong>En este artículo</strong>
                {blocks
                  .filter((b) => b.kind === "heading")
                  .map(
                    (b) =>
                      b.kind === "heading" && (
                        <a key={b.id} href={`#${b.id}`}>
                          {b.text}
                        </a>
                      ),
                  )}
                <a href="#programa-completo">Programa completo</a>
              </nav>
              <article className="reading">
                <ArticleBody blocks={blocks} />
                <h2 id="programa-completo" tabIndex={-1}>
                  <a href="#programa-completo">Programa completo para probar</a>
                </h2>
                <p>
                  Este programa compila. Su fuente es {example.source}. Consulta{" "}
                  <a href={`/ejemplos/${example.slug}`}>
                    el problema y los datasets requeridos
                  </a>{" "}
                  antes de ejecutarlo localmente.
                </p>
                <Code verbatim code={example.code} />
                <OpenExample example={example} />
                {STUDIO_VIEWS[article.slug] && (
                  <p className="studio-view-link">
                    <a href={STUDIO_VIEWS[article.slug].href}>
                      {STUDIO_VIEWS[article.slug].text}
                    </a>{" "}
                    · abre tu documento actual en esa vista, no este programa.
                  </p>
                )}
                <h2>Ejemplos relacionados</h2>
                <ul>
                  {article.examples.map((slug) => (
                    <li key={slug}>
                      <a href={`/ejemplos/${slug}`}>
                        {findExample(slug)!.title}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="source-path">
                  Referencia vigente:{" "}
                  {article.sources.map((s) => s.path).join(" · ")}. Selección
                  generada de estas fuentes; los fragmentos de referencia están
                  identificados como incompletos.
                </p>
              </article>
              <nav
                className="article-pagination"
                aria-label="Continuar leyendo"
              >
                {position > 0 && (
                  <a rel="prev" href={`/docs/${articles[position - 1].slug}`}>
                    Anterior: {articles[position - 1].title}
                  </a>
                )}
                {position < articles.length - 1 && (
                  <a rel="next" href={`/docs/${articles[position + 1].slug}`}>
                    Siguiente: {articles[position + 1].title}
                  </a>
                )}
              </nav>
            </>
          ) : (
            <>
              <ol className="article-index">
                {articles.map((item) => (
                  <li key={item.slug}>
                    <h2>
                      <a href={`/docs/${item.slug}`}>{item.title}</a>
                    </h2>
                    <p>{item.summary}</p>
                  </li>
                ))}
              </ol>
              <p className="content-note">
                Compile analiza el programa sin leer datasets. En Studio,
                Ejecutar envía el programa al servicio privado Python y muestra
                sus resultados reales cuando los datasets están preparados.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
