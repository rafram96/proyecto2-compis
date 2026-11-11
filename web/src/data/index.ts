import raw from "./compiled.json";
import type { CompilePresentation, Format } from "../compiler/types";

/** Salida real de etl_dsl, generada por web/scripts/gen_compiled.py. No se edita a mano. */
type Program = { source: string; default: Record<Format, CompilePresentation>; O0: Partial<Record<Format, CompilePresentation>> };
type Data = {
  optimizer: Record<string, { ir: string; py: string }> & { source: string };
  programs: Record<string, Program>;
  stats: { tests: number; errorCodes: number; keywords: number; passes: string[] };
};

export const data = raw as unknown as Data;
export const programs = data.programs;
export const stats = data.stats;

/** La IR impresa con pases trae «antes» y «después»; para mostrar el plan basta el último bloque. */
export const finalIR = (ir: string) => ir.split(/\/\/ IR después de[^\n]*\n/).pop()!.trim();

/** El cuerpo de las funciones generadas, sin la cabecera de imports ni el main. */
export const pyBody = (py: string) => py.slice(py.indexOf("def pipeline_"), py.indexOf("PIPELINES =")).trim();
