import { useState } from "react";
import { data, finalIR, pyBody } from "../data";
import { Code } from "./Code";

/** Cuatro paradas: sin pases y luego cada pase sumado al anterior (salida real de demo/optimizaciones.etl). */
const STOPS = [
  {
    key: "000",
    name: "Sin pases",
    clause: "Primero, el plan tal cual.",
    text: "Siete pasos, como están en el archivo. Es lo que imprime --format ir con -O0.",
  },
  {
    key: "100",
    name: "constantes",
    clause: "Luego, las cuentas hechas.",
    text: "10 * 100 ya es 1000 y TRUE AND desaparece. El paso todo filtraba con 1 < 2, que siempre se cumple: fuera.",
  },
  {
    key: "110",
    name: "filtros",
    clause: "Después, dos filtros en uno.",
    text: "grandes y pagadas pasan a ser un solo FILTER unido con AND. La IR anota qué se fusionó.",
  },
  {
    key: "111",
    name: "muertos",
    clause: "Al final, fuera lo que sobra.",
    text: "sin_uso no llega a ningún SINK, así que nadie lo necesita. Quedan cuatro pasos.",
  },
];

const plan = (key: string) => finalIR(data.optimizer[key].ir);
const stepOf = (line: string) => /^\s*%(\w+)\s+=/.exec(line)?.[1];
const count = (key: string) => plan(key).split("\n").filter(stepOf).length;

/** La IR de la parada actual con lo que cambió respecto de la anterior: tachado lo que se fue, marcado lo nuevo. */
function diffPlan(i: number) {
  const now = plan(STOPS[i].key).split("\n");
  if (i === 0) return { code: now.join("\n"), marks: now.map(() => "") };
  const before = new Map(plan(STOPS[i - 1].key).split("\n").map((l) => [stepOf(l), l] as const));
  const byStep = new Map(now.map((l) => [stepOf(l), l] as const));
  const lines: string[] = [];
  const marks: string[] = [];
  for (const old of plan(STOPS[i - 1].key).split("\n")) {
    const s = stepOf(old);
    if (!s) {
      lines.push(old);
      marks.push("");
    } else if (byStep.has(s)) {
      lines.push(byStep.get(s)!);
      marks.push(byStep.get(s) === before.get(s) ? "" : "changed");
    } else {
      lines.push(old);
      marks.push("gone");
    }
  }
  return { code: lines.join("\n"), marks };
}

export function Optimizer() {
  const [i, setI] = useState(0);
  const [tab, setTab] = useState<"ir" | "py">("ir");
  const stop = STOPS[i];
  const { code, marks } = diffPlan(i);
  const p = i / (STOPS.length - 1);

  return (
    <section className="opt" id="optimizador" aria-labelledby="opt-t">
      <div className="opt-field words">
        <h2 id="opt-t" className="sr">
          El optimizador, pase por pase
        </h2>
        <div key={stop.key} className="xfade">
          <p className="clause">{stop.clause}</p>
          <p className="clause-text">{stop.text}</p>
        </div>
      </div>

      <div className="opt-field stage">
        <div className="pane" data-ui>
          <div className="pane-bar">
            <span className="pane-file">optimizaciones.etl</span>
            <span className="pane-count" aria-live="polite">
              {count(stop.key)} pasos
            </span>
            <div className="pane-tabs" role="tablist" aria-label="Salida del compilador">
              <button role="tab" aria-selected={tab === "ir"} onClick={() => setTab("ir")}>
                Plan (IR)
              </button>
              <button role="tab" aria-selected={tab === "py"} onClick={() => setTab("py")}>
                Python
              </button>
            </div>
          </div>
          <div key={`${stop.key}-${tab}`} className="xfade pane-body" tabIndex={0}>
            {tab === "ir" ? <Code code={code} mark={(_, n) => marks[n]} /> : <Code code={pyBody(data.optimizer[stop.key].py)} />}
          </div>
        </div>
      </div>

      <div className="opt-slider">
        <div className="slider">
        <label className="sr" htmlFor="opt-range">
          Pases aplicados
        </label>
        <div className="track" aria-hidden="true">
          <span className="seg l">
            <i style={{ width: `${Math.min(p, 0.5) * 200}%` }} />
          </span>
          <span className="seg r">
            <i style={{ width: `${Math.max(p - 0.5, 0) * 200}%` }} />
          </span>
        </div>
        <input
          id="opt-range"
          type="range"
          min={0}
          max={STOPS.length - 1}
          step={1}
          value={i}
          onChange={(e) => setI(Number(e.target.value))}
          aria-valuetext={`${stop.name}: ${count(stop.key)} pasos`}
          style={{ ["--p" as string]: p }}
        />
        <div className="stops">
          {STOPS.map((s, n) => (
            <button
              key={s.key}
              type="button"
              aria-current={n === i}
              onClick={() => setI(n)}
              data-side={n / (STOPS.length - 1) < 0.5 ? "l" : "r"}
              style={{ ["--x" as string]: n / (STOPS.length - 1) }}
            >
              {s.name}
            </button>
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}
