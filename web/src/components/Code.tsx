import { highlight } from "./highlight";

/**
 * Código que se ajusta al ancho con sangría colgante: la continuación de una línea larga queda
 * a la derecha de su comienzo, así un fragmento estrecho sigue leyéndose como código.
 */
export function Code({ code, className = "", mark }: { code: string; className?: string; mark?: (line: string, i: number) => string | undefined }) {
  return (
    <pre className={`code-wrap ${className}`}>
      {code.split("\n").map((line, i) => {
        const indent = line.length - line.trimStart().length;
        return (
          <span key={i} className={`ln ${mark?.(line, i) ?? ""}`} style={{ ["--in" as string]: indent }}>
            {line.trim() ? highlight(line.trimStart()) : " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
