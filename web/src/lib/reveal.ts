/**
 * Entradas por sección: cada hijo con [data-reveal] sube y aparece en orden (--d) cuando su sección entra.
 * Sin JavaScript el contenido está visible: la clase .js la pone index.html.
 */
export function startReveal(): () => void {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }),
    { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
  );
  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
  return () => io.disconnect();
}
