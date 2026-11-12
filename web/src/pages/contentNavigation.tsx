import { useEffect, useRef } from "react";
export function useContentFocus(key?: string) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let target: HTMLElement | null = null;
    try {
      target = location.hash
        ? document.getElementById(decodeURIComponent(location.hash.slice(1)))
        : null;
    } catch {
      /* Un hash malformado no bloquea la lectura. */
    }
    if (target) {
      target.scrollIntoView();
      target.focus({ preventScroll: true });
    } else heading.current?.focus({ preventScroll: true });
  }, [key]);
  return heading;
}
export function ContentMissing({ kind, href }: { kind: string; href: string }) {
  const heading = useContentFocus();
  return (
    <main className="content-page not-found" id="contenido">
      <h1 ref={heading} tabIndex={-1}>
        {kind} no encontrado
      </h1>
      <p>
        Este enlace no corresponde al contenido publicado. Tu documento sigue
        disponible en Studio.
      </p>
      <a className="btn" href={href}>
        Volver al catálogo
      </a>
      <a href="/studio">Volver a Studio</a>
    </main>
  );
}
