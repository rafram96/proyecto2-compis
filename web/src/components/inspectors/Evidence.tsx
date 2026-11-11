import {
  objects,
  numericText,
  label,
  record,
  spanOf,
  strings,
  type RecordValue,
} from "./model";
import { SourceButton, type SourceProps } from "./SourceButton";

function EvidenceLinks({
  evidence,
  source,
}: {
  evidence: unknown;
  source: SourceProps;
}) {
  return (
    <ul className="evidence-links">
      {objects(evidence).map((e, i) => (
        <li key={i}>
          <SourceButton {...source} span={spanOf(e.span)}>
            {label(e.pipeline)}.{label(e.node)} · {label(e.condition)}
          </SourceButton>
        </li>
      ))}
    </ul>
  );
}
function Facts({ facts, source }: { facts: unknown; source: SourceProps }) {
  return (
    <ul className="facts-list">
      {objects(facts).map((fact, i) => {
        const lo = record(fact.lower) ? fact.lower : undefined,
          hi = record(fact.upper) ? fact.upper : undefined;
        return (
          <li key={i}>
            <strong>{label(fact.name)}</strong> ·{" "}
            <code>
              {lo
                ? `${lo.inclusive ? "[" : "("}${numericText(lo.value)}`
                : "(−∞"}
              ,{" "}
              {hi
                ? `${numericText(hi.value)}${hi.inclusive ? "]" : ")"}`
                : "+∞)"}
            </code>{" "}
            ·{" "}
            {fact.null_only
              ? "solo NULL"
              : fact.nullable
                ? "NULL posible"
                : "sin NULL"}
            <EvidenceLinks evidence={fact.evidence} source={source} />
            {lo && (
              <details>
                <summary>Procedencia del límite inferior</summary>
                <EvidenceLinks evidence={lo.evidence} source={source} />
              </details>
            )}
            {hi && (
              <details>
                <summary>Procedencia del límite superior</summary>
                <EvidenceLinks evidence={hi.evidence} source={source} />
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
const obligation: Record<string, string> = {
  equal_physical_key_types: "Tipos físicos de claves iguales",
  nonnull_keys: "Claves no nulas",
  unique_right_key: "Unicidad de la clave derecha",
  total_left_reference: "Referencia total izquierda",
  materialized_input_snapshots: "Instantáneas materializadas de ambas entradas",
};
const proof: Record<string, string> = {
  complete_input_columns: "Columnas completas en ambas entradas",
  all_consumers_select_only_left_columns:
    "Todos los consumidores inmediatos son SELECT de columnas izquierdas",
};
export default function Evidence({
  module,
  original,
  pipeline,
  ...source
}: SourceProps & {
  module?: RecordValue;
  original: RecordValue[];
  pipeline: string;
}) {
  const ranges = objects(module?.range_rewrites).filter(
    (r) => r.pipeline === pipeline,
  );
  const joins = objects(module?.join_rewrites).filter(
    (r) => r.pipeline === pipeline,
  );
  const facts = objects(module?.range_facts).filter(
    (r) => r.pipeline === pipeline,
  );
  const declared = original.filter(
    (n) =>
      record(n.payload) &&
      n.payload.node === "Join" &&
      record(n.payload.guarantee),
  );
  return (
    <section className="optimization-evidence">
      <h3>Evidencia del compilador</h3>
      <p>
        El núcleo emite pruebas de rangos y JOIN. Para constantes, filtros y
        muertos solo se muestran diferencias observadas entre las dos IR; no hay
        traza por pase ni medición de velocidad.
      </p>
      <h4>Rangos · {ranges.length} reescrituras</h4>
      {ranges.length === 0 && (
        <p>No se emitieron reescrituras de rangos en esta compilación.</p>
      )}
      {ranges.map((r, i) => (
        <details className="evidence-entry" key={i} open>
          <summary>
            {label(r.node)} · {label(r.action)}
          </summary>
          <p>
            <code>{label(r.before)}</code> →{" "}
            <code>
              {r.after === null
                ? "entrada directa (filtro retirado)"
                : label(r.after)}
            </code>
          </p>
          <p>{label(r.reason)}</p>
          <p>
            Origen: {strings(r.origin).join(", ")} · Consumidores reconectados:{" "}
            {strings(r.consumers).join(", ") || "ninguno"}
          </p>
          <SourceButton {...source} span={spanOf(r.span)} />
          <Facts facts={r.proof} source={source} />
        </details>
      ))}
      <details>
        <summary>
          Hechos de la etapa de rangos · {facts.length} nodos/puertos
        </summary>
        <p>
          Instantáneas intermedias del pase de rangos. Pases posteriores pueden
          fusionar o eliminar estos nodos; estos hechos no describen la IR final
          ni sustituyen los esquemas originales.
        </p>
        {facts.map((f, i) => (
          <section key={i}>
            <h4>
              {label(f.node)}
              {f.contradictory ? " · contradictorio" : ""}
            </h4>
            <Facts facts={f.columns} source={source} />
          </section>
        ))}
      </details>
      <h4>JOIN · declaración y obligación</h4>
      <p>
        VERIFY MANY_TO_ONE exige comprobaciones al ejecutar, incluso con O0.
        Compilar no comprueba integridad de datos. Ambas entradas conservan sus
        contratos y dependencias.
      </p>
      {declared.map((n, i) => {
        const payload = n.payload as RecordValue,
          guarantee = payload.guarantee as RecordValue;
        return (
          <div className="evidence-entry" key={i}>
            <strong>{label(n.name)} · VERIFY MANY_TO_ONE declarado</strong>
            <SourceButton {...source} span={spanOf(guarantee.span)}>
              Ver declaración
            </SourceButton>
            <p>
              Obligaciones dinámicas pendientes: tipos físicos iguales, claves
              no nulas, unicidad derecha y referencia total izquierda; se
              materializan ambas entradas al ejecutar.
            </p>
          </div>
        );
      })}
      {joins.map((r, i) => (
        <details className="evidence-entry" key={i} open>
          <summary>
            {label(r.node)} · {label(r.action)} → CHECK_JOIN
          </summary>
          <h4>Prueba estática emitida</h4>
          <ul>
            {strings(r.static_proof).map((p) => (
              <li key={p}>{proof[p] ?? p}</li>
            ))}
          </ul>
          <p>
            Consumidores SELECT: {strings(r.consumers).join(", ")}. Conserva
            columnas de {label(r.retained)}; {label(r.eliminated)} deja de
            aportar columnas y sigue siendo una dependencia leída y validada.
          </p>
          <h4>Obligaciones dinámicas conservadas, sin ejecutar</h4>
          <ul>
            {strings(r.obligations).map((p) => (
              <li key={p}>{obligation[p] ?? p}</li>
            ))}
          </ul>
          <p>
            Verificación: <code>{label(r.verification)}</code>
          </p>
          <p>Origen: {strings(r.origin).join(", ")}</p>
          <SourceButton {...source} span={spanOf(r.span)} />
          <SourceButton {...source} span={spanOf(r.declaration_span)}>
            Ver garantía
          </SourceButton>
        </details>
      ))}
      {joins.length === 0 && (
        <p>
          No se emitieron reescrituras de JOIN. Una declaración puede conservar
          el JOIN; eso no elimina sus obligaciones.
        </p>
      )}
    </section>
  );
}
