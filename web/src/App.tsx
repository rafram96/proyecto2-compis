import { lazy, Suspense, useEffect } from "react";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Errors } from "./components/Errors";
import { Optimizer } from "./components/Optimizer";
import { Language } from "./components/Language";
import { Letter } from "./components/Letter";
import { BuiltOn, Faq, Footer } from "./components/Faq";
import { Studio } from "./components/Studio";
import { startReveal } from "./lib/reveal";
import { navigate, usePath } from "./lib/router";
const ExamplesPage = lazy(() => import("./pages/ExamplesPage"));
const DocsPage = lazy(() => import("./pages/DocsPage"));
const StudioPage = lazy(() => import("./pages/StudioPage"));
// Si el chunk de evaluación no llega (red/caché), se informa sin inventar datos ni afectar a Studio.
const EvaluationPage = lazy(() =>
  import("./pages/EvaluationPage").catch(() => ({
    default: () => (
      <main className="content-page not-found" id="contenido">
        <h1>No se pudo cargar la evaluación</h1>
        <p role="alert">
          Falló la descarga de la página. Tu documento dStudio no se ha modificado.
        </p>
        <button type="button" className="btn" onClick={() => location.reload()}>
          Reintentar
        </button>
      </main>
    ),
  })),
);

export default function App() {
  const rawPath = usePath();
  const path = rawPath === "/estudio" || rawPath === "/studio/" ? "/studio" : rawPath;
  useEffect(() => {
    if (rawPath === "/estudio" || rawPath === "/studio/")
      history.replaceState(history.state, "", "/studio" + location.search + location.hash);
  }, [rawPath]);
  useEffect(() => {
    if (path === "/") {
      document.title = "Stream · Pipelines que se leen";
      return startReveal();
    }
  }, [path]);
  return (
    <div
      className={path === "/" ? "landing" : "app-page"}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const anchor = (event.target as Element).closest<HTMLAnchorElement>(
          "a[href]",
        );
        if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
        const url = new URL(anchor.href);
        // Misma ruta y misma consulta: solo cambia el ancla y la resuelve el navegador.
        // Misma ruta con otra consulta (p. ej. /studio?vista=ir) no debe recargar la página.
        if (
          url.origin !== location.origin ||
          (url.pathname === location.pathname && url.search === location.search)
        )
          return;
        event.preventDefault();
        navigate(url.pathname + url.search + url.hash);
      }}
    >
      <a
        className="skip"
        href={path === "/" || path === "/studio" ? "#estudio" : "#contenido"}
      >
        Ir al contenido
      </a>
      <Nav inStudio={path === "/studio"} />
      {path === "/" ? (
        <>
          <main>
            <Hero />
            <Errors />
            <Optimizer />
            <Language />
            <Letter />
            <BuiltOn />
            <Faq />
            <Studio />
          </main>
          <Footer />
        </>
      ) : path === "/studio" ? (
        <Suspense
          fallback={
            <main className="workspace">
              <p role="status">Abriendo Studio…</p>
            </main>
          }
        >
          <StudioPage />
        </Suspense>
      ) : /^\/evaluacion\/?$/.test(path) ? (
        <Suspense
          fallback={
            <main className="content-page" id="contenido">
              <p role="status">Abriendo la evaluación…</p>
            </main>
          }
        >
          <EvaluationPage />
        </Suspense>
      ) : /^\/(ejemplos|docs)(\/[^/]+)?\/?$/.test(path) ? (
        <Suspense
          fallback={
            <main className="content-page" id="contenido">
              <p role="status">Abriendo contenido…</p>
            </main>
          }
        >
          {path.split("/")[1] === "ejemplos" ? (
            <ExamplesPage key={path} slug={path.split("/")[2] || undefined} />
          ) : (
            <DocsPage key={path} slug={path.split("/")[2] || undefined} />
          )}
        </Suspense>
      ) : (
        <main className="workspace not-found" id="contenido">
          <h1>Página no encontrada</h1>
          <p>
            Esta ruta no existe. Puedes volver al inicio o recuperar tu
            documento en Studio.
          </p>
          <a className="btn" href="/studio">
            Abrir Studio
          </a>
          <a href="/">Volver al inicio</a>
        </main>
      )}
    </div>
  );
}
