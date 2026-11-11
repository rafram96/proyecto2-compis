import { highlight } from "./highlight";

const CODE = `STEP valid = FILTER {
  WHERE income > 0;
}
FLOW {
  clients -> valid -> output;
}`;

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <h1 data-reveal style={{ ["--d" as string]: 0 }}>
          Pipelines que se leen.
        </h1>
        <p data-reveal style={{ ["--d" as string]: 1 }}>
          Cauce es un lenguaje para mover y limpiar datos que escribes como una receta. Compila a Polars y te enseña cada decisión del optimizador.
        </p>
        <div className="hero-actions" data-reveal style={{ ["--d" as string]: 2 }}>
          <a className="btn" href="#crear">
            Probar el editor
          </a>
          <a className="btn quiet" href="#optimizador">
            Ver el optimizador
          </a>
        </div>
      </div>
      <div className="arrow-stage" aria-hidden="true">
        <div className="flowcard" data-ui>
          <div className="ui-title">
            <span className="ui-dot on" />
            <span className="ui-dot" />
            credit_risk.etl
          </div>
          <pre>{highlight(CODE)}</pre>
        </div>
      </div>
    </header>
  );
}
