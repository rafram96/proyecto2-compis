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
const StudioPage = lazy(() => import("./pages/StudioPage"));

export default function App() {
  const path = usePath();
  useEffect(() => {
    if (path === "/") {
      document.title = "Cauce · Pipelines que se leen";
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
        if (
          url.origin !== location.origin ||
          url.pathname === location.pathname
        )
          return;
        event.preventDefault();
        navigate(url.pathname + url.search + url.hash);
      }}
    >
      <a className="skip" href="#estudio">
        Ir al estudio
      </a>
      <Nav inStudio={path === "/estudio"} />
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
      ) : path === "/estudio" ? (
        <Suspense
          fallback={
            <main className="workspace">
              <p role="status">Abriendo el estudio…</p>
            </main>
          }
        >
          <StudioPage />
        </Suspense>
      ) : (
        <main className="workspace not-found">
          <h1>Página no encontrada</h1>
          <p>
            Esta ruta no existe. Puedes volver al inicio o recuperar tu
            documento en el estudio.
          </p>
          <a className="btn" href="/estudio">
            Abrir el estudio
          </a>
          <a href="/">Volver al inicio</a>
        </main>
      )}
    </div>
  );
}
