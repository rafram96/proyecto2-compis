import { lazy, Suspense } from "react";
import type { AnalysisResult, Format } from "../../compiler/types";
import type { Inspector as InspectorName } from "../../workspace/model";
import { Output } from "../CompilerOutput";
import { available, unavailable, hasUnsafeInteger } from "./model";
import type { SourceProps } from "./SourceButton";
const Ast = lazy(() => import("./AstInspector"));
const Flow = lazy(() => import("./FlowInspector"));
const IR = lazy(() => import("./IRInspector"));
const Schemas = lazy(() => import("./SchemaInspector"));
const ParseTree = lazy(() => import("./ParseTreeInspector"));
const Tokens = lazy(() => import("./TokensInspector"));
export default function Inspector({
  inspector,
  analysis,
  views,
  ...source
}: SourceProps & {
  inspector: InspectorName;
  analysis?: AnalysisResult | null;
  views?: Record<Format, string>;
}) {
  const text =
    inspector === "flow" || inspector === "schemas"
      ? ""
      : (views?.[inspector] ?? "");
  let content;
  if (inspector === "ast")
    content = (
      <Ast artifact={analysis?.artifacts.ast} text={text} {...source} />
    );
  else if (inspector === "flow")
    content = <Flow artifact={analysis?.artifacts.ast} {...source} />;
  else if (inspector === "ir")
    content = <IR analysis={analysis} text={text} {...source} />;
  else if (inspector === "schemas")
    content = (
      <Schemas
        artifact={analysis?.artifacts.schemas}
        before={available(analysis?.artifacts.ir_before)?.module}
        {...source}
      />
    );
  else if (inspector === "tree")
    content = <ParseTree artifact={analysis?.artifacts.tree} {...source} />;
  else if (inspector === "tokens")
    content = <Tokens artifact={analysis?.artifacts.tokens} {...source} />;
  else
    content = text ? (
      <Output
        fmt={inspector}
        result={{ ok: true, out: text, err: "", analysis: null }}
      />
    ) : (
      <p className="empty-output">
        {inspector === "check"
          ? "Compila esta revisión y consulta los diagnósticos para recuperar el análisis."
          : unavailable(analysis?.artifacts[inspector])}
      </p>
    );
  return (
    <>
      <p hidden={!hasUnsafeInteger(analysis?.artifacts)} className="stale-note">
        El JSON del navegador puede redondear enteros fuera del rango seguro.
        Consulta las vistas textuales AST/IR producidas en Python para sus
        valores exactos; la comparación estructurada no certifica igualdad de
        esos nodos.
      </p>
      <Suspense fallback={<p className="empty-output">Cargando inspector…</p>}>
        {content}
      </Suspense>
    </>
  );
}
