import type { CompilePresentation, Format } from "../compiler/types";
import { highlight } from "./highlight";

export function Output({
  fmt,
  result,
}: {
  fmt: Format;
  result: CompilePresentation;
}) {
  if (!result.ok) {
    return (
      <pre className="studio-pre">
        {result.err.split("\n").map((line, i) => {
          const m = /^([^:\n]+:\d+:\d+): ([A-Z_]+): (.*)$/.exec(line);
          return (
            <span key={i}>
              {m ? (
                <>
                  <span className="loc">{m[1]}</span>{" "}
                  <b className="err">{m[2]}</b> {m[3]}
                </>
              ) : (
                line
              )}
              {"\n"}
            </span>
          );
        })}
      </pre>
    );
  }
  if (fmt === "check") return <pre className="studio-pre ok">{result.out}</pre>;
  if (fmt === "tokens" || fmt === "tree")
    return <pre className="studio-pre">{result.out}</pre>;
  return <pre className="studio-pre">{highlight(result.out)}</pre>;
}
