import { highlight } from "./highlight";

/**
 * Código que se ajusta al ancho con sangría colgante: la continuación de una línea larga queda
 * a la derecha de su comienzo, así un fragmento estrecho sigue leyéndose como código.
 */
export function Code({
  code,
  className = "",
  mark,
  verbatim = false,
  plain = false,
  label = "Código del programa, desplazable",
}: {
  /** Nombre accesible del bloque desplazable (solo con `verbatim`). */
  label?: string;
  verbatim?: boolean;
  /** Comandos, salidas y archivos: texto literal, sin resaltado del DSL (con `verbatim`). */
  plain?: boolean;
  code: string;
  className?: string;
  mark?: (line: string, i: number) => string | undefined;
}) {
  if (verbatim)
    return (
      <pre
        className={`code-wrap ${className}`}
        tabIndex={0}
        aria-label={label}
      >
        <code>{plain ? code : highlight(code)}</code>
      </pre>
    );
  return (
    <pre className={`code-wrap ${className}`}>
      {code.split("\n").map((line, i) => {
        const indent = line.length - line.trimStart().length;
        return (
          <span
            key={i}
            className={`ln ${mark?.(line, i) ?? ""}`}
            style={{ ["--in" as string]: indent }}
          >
            {line.trim() ? highlight(line.trimStart()) : " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
