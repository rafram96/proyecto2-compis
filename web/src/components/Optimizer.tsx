import { useState } from "react";
import data from "../data/compiled.json";
import { highlight } from "./highlight";

type Variant = { ir: string; py: string };
const table = data as unknown as Record<string, Variant | string>;

const PASSES = [
  {
    id: "constantes",
    sentence: "Hace las cuentas antes de ejecutar.",
    why: "10 * 100 pasa a 1000; TRUE AND … y 1 < 2 desaparecen del plan.",
    bg: "var(--band-1)",
  },
  {
    id: "filtros",
    sentence: "Une filtros seguidos en uno solo.",
    why: "Tres FILTER consecutivos (grandes, pagadas, todo) quedan en un único paso.",
    bg: "var(--band-2)",
  },
  {
    id: "muertos",
    sentence: "Borra lo que nadie usa.",
    why: "sin_uso no llega a ningún SINK: Polars ni se entera de que existió.",
    bg: "var(--band-3)",
  },
] as const;

/** La IR impresa trae el bloque «antes» y el «después»; nos quedamos con el último. */
const finalIR = (ir: string) => ir.split(/\/\/ IR después de[^\n]*\n/).pop()!.trim();
const stepNames = (ir: string) => [...finalIR(ir).matchAll(/^\s+%(\w+)\s+=/gm)].map((m) => m[1]);

const base = table["000"] as Variant;
const baseSteps = stepNames(base.ir);

export function Optimizer() {
  const [on, setOn] = useState([true, true, false]);
  const [tab, setTab] = useState<"ir" | "py">("ir");
  const [tick, setTick] = useState(0);

  const key = on.map((v) => (v ? "1" : "0")).join("");
  const v = table[key] as Variant;
  const steps = stepNames(v.ir);
  const gone = baseSteps.filter((s) => !steps.includes(s));
  const code = tab === "ir" ? finalIR(v.ir) : v.py.trim();

  const toggle = (i: number) => {
    setOn((s) => s.map((x, j) => (j === i ? !x : x)));
    setTick((t) => t + 1);
  };

  return (
    <section className="opt" id="optimizador" aria-labelledby="opt-t">
      <div className="wrap">
        <h2 id="opt-t" className="sr">Optimizador</h2>
        <p className="statement" data-reveal>
          Activa un pase y mira cómo cambia el plan. Es la salida real del compilador sobre un mismo pipeline.
        </p>
      </div>

      <div className="bands" role="group" aria-label="Pases de optimización">
        {PASSES.map((p, i) => (
          <button
            key={p.id}
            className="band"
            role="switch"
            aria-checked={on[i]}
            style={{ ["--bg-on" as string]: p.bg }}
            onClick={() => toggle(i)}
            data-reveal
          >
            <span className="sentence">{p.sentence}</span>
            <span className="switch" data-ui aria-hidden="true" />
            <span className="why">
              <span>
                <b>{p.id}.</b> {p.why}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="lab">
        <div className="lab-head" data-reveal>
          <span className="lab-count" aria-live="polite">
            {baseSteps.length} → {steps.length} pasos
          </span>
          <span className="lab-note">
            {gone.length ? (
              <>
                Ya no aparecen en el plan: <b>{gone.join(", ")}</b>.
              </>
            ) : (
              "Sin pases activos el plan conserva cada paso tal como lo escribiste (-O0)."
            )}
          </span>
        </div>

        <div className="panes" data-reveal>
          <div className="pane" data-ui>
            <div className="pane-bar">
              <span className="fix">optimizaciones.etl</span>
            </div>
            <pre>{highlight((table.source as string).split("\n").slice(4).join("\n").replace(/^ {4}/gm, ""))}</pre>
          </div>
          <div className="pane" data-ui>
            <div className="pane-bar" role="tablist" aria-label="Salida del compilador">
              <button role="tab" aria-selected={tab === "ir"} onClick={() => setTab("ir")}>
                Plan (IR)
              </button>
              <button role="tab" aria-selected={tab === "py"} onClick={() => setTab("py")}>
                Python + Polars
              </button>
            </div>
            <pre key={`${tab}-${tick}`} className="swap" tabIndex={0}>
              {highlight(code)}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
