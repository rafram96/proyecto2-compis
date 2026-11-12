import { useMemo, useState } from "react";
import { createDocument } from "../workspace/model";
import { openDocument } from "../workspace/store";
import { downloadText } from "../workspace/files";
import { Code } from "../components/Code";
import { BLOCK_EXAMPLES } from "./examples";
import {
  buildPipeline,
  initialBuilder,
  newBlock,
  numeric,
  OPERATIONS,
  TYPES,
  type Block,
  type Column,
  type Operation,
} from "./model";

function ColumnChoice({
  columns,
  value,
  label,
  onChange,
  empty,
}: {
  columns: Column[];
  value: string;
  label: string;
  onChange(value: string): void;
  empty?: string;
}) {
  const missing = !!value && !columns.some((c) => c.name === value);
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {missing && <option value={value}>{value} · no disponible</option>}
        {!value && empty === undefined && (
          <option value="">Elige una columna…</option>
        )}
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} · {c.type}
            {c.nullable ? "?" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
function BlockFields({
  block,
  columns,
  update,
}: {
  block: Block;
  columns: Column[];
  update(change: Partial<Block>): void;
}) {
  const column = columns.find((c) => c.name === block.column);
  return (
    <div className="block-fields">
      {!["select", "distinct", "drop_nulls"].includes(block.op) &&
        !(block.op === "aggregate" && block.aggregate === "COUNT") && (
          <ColumnChoice
            columns={columns}
            value={block.column}
            label="Columna"
            onChange={(column) => update({ column })}
          />
        )}
      {block.op === "filter" && (
        <>
          <label>
            Condición
            <select
              value={block.operator}
              onChange={(e) => update({ operator: e.target.value })}
            >
              <option value="==">Igual a</option>
              <option value="!=">Distinto de</option>
              <option value=">">Mayor que</option>
              <option value=">=">Mayor o igual</option>
              <option value="<">Menor que</option>
              <option value="<=">Menor o igual</option>
              <option>IS NULL</option>
              <option>IS NOT NULL</option>
            </select>
          </label>
          {!block.operator.startsWith("IS ") && (
            <label>
              Valor
              {column?.type === "BOOL" ? (
                <select
                  value={block.value.toUpperCase()}
                  onChange={(e) => update({ value: e.target.value })}
                >
                  <option value="">Elige…</option>
                  <option>TRUE</option>
                  <option>FALSE</option>
                </select>
              ) : (
                <input
                  maxLength={200}
                  value={block.value}
                  inputMode={numeric(column) ? "decimal" : "text"}
                  placeholder={
                    numeric(column) ? "Ej. 10" : "Texto sin comillas"
                  }
                  onChange={(e) => update({ value: e.target.value })}
                />
              )}
            </label>
          )}
        </>
      )}
      {block.op === "derive" && (
        <>
          <label>
            Operación
            <select
              value={block.operator}
              onChange={(e) => update({ operator: e.target.value })}
            >
              <option value="+">Sumar</option>
              <option value="-">Restar</option>
              <option value="*">Multiplicar</option>
            </select>
          </label>
          <label>
            Constante
            <input
              maxLength={60}
              inputMode="decimal"
              value={block.value}
              onChange={(e) => update({ value: e.target.value })}
            />
          </label>
          <label>
            Nueva columna
            <input
              maxLength={60}
              value={block.alias}
              onChange={(e) => update({ alias: e.target.value })}
              spellCheck={false}
            />
          </label>
        </>
      )}
      {block.op === "aggregate" && (
        <>
          <ColumnChoice
            columns={columns}
            value={block.group}
            label="Agrupar por"
            empty="Sin grupos · un total"
            onChange={(group) => update({ group })}
          />
          <label>
            Resumen
            <select
              value={block.aggregate}
              onChange={(e) => update({ aggregate: e.target.value })}
            >
              <option value="SUM">SUM · suma</option>
              <option value="COUNT">COUNT · cantidad de filas</option>
              <option value="AVG">AVG · promedio</option>
              <option value="MIN">MIN · mínimo</option>
              <option value="MAX">MAX · máximo</option>
            </select>
          </label>
          <label>
            Nombre del resultado
            <input
              maxLength={60}
              value={block.alias}
              onChange={(e) => update({ alias: e.target.value })}
              spellCheck={false}
            />
          </label>
        </>
      )}
      {block.op === "sort" && (
        <label>
          Dirección
          <select
            value={block.direction}
            onChange={(e) => update({ direction: e.target.value })}
          >
            <option value="ASC">ASC · menor a mayor</option>
            <option value="DESC">DESC · mayor a menor</option>
          </select>
        </label>
      )}
      {["select", "distinct", "drop_nulls"].includes(block.op) && (
        <fieldset className="block-column-choices">
          <legend>Columnas</legend>
          {[...new Set([...columns.map((c) => c.name), ...block.columns])].map(
            (name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={block.columns.includes(name)}
                  onChange={(event) =>
                    update({
                      columns: event.target.checked
                        ? [...block.columns, name]
                        : block.columns.filter((c) => c !== name),
                    })
                  }
                />
                {name}
                {!columns.some((c) => c.name === name)
                  ? " · no disponible"
                  : ""}
              </label>
            ),
          )}
        </fieldset>
      )}
    </div>
  );
}

export default function BlockBuilder({ onOpen }: { onOpen(): void }) {
  const [builder, setBuilder] = useState(initialBuilder);
  const [selectedExample, setSelectedExample] = useState("");
  const [previousBuilder, setPreviousBuilder] = useState<typeof builder | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const example = BLOCK_EXAMPLES.find((item) => item.id === selectedExample);
  const result = useMemo(() => buildPipeline(builder), [builder]);
  function loadExample() {
    if (!example) return;
    setPreviousBuilder(builder);
    setBuilder(example.create());
    setMessage(
      `Ejemplo cargado: ${example.title}. Puedes editar sus bloques o restaurar el borrador anterior.`,
    );
  }
  function restoreBuilder() {
    if (!previousBuilder) return;
    setPreviousBuilder(builder);
    setBuilder(previousBuilder);
    setSelectedExample("");
    setMessage(
      "Bloques anteriores restaurados. El documento de Code sigue conservado.",
    );
  }
  const updateBlock = (id: string, change: Partial<Block>) =>
    setBuilder((b) => ({
      ...b,
      blocks: b.blocks.map((item) =>
        item.id === id ? { ...item, ...change } : item,
      ),
    }));
  function add(op: Operation) {
    const block = newBlock(op, result.stages.at(-1) ?? builder.columns);
    setBuilder((b) => ({ ...b, blocks: [...b.blocks, block] }));
    setMessage(`Añadido: ${OPERATIONS.find(([key]) => key === op)?.[1]}.`);
  }
  function move(index: number, delta: number) {
    setBuilder((b) => {
      const blocks = [...b.blocks];
      [blocks[index], blocks[index + delta]] = [
        blocks[index + delta],
        blocks[index],
      ];
      return { ...b, blocks };
    });
    setMessage(
      `Bloque movido a la posición ${index + delta + 1}. Revisa las columnas disponibles.`,
    );
  }
  function open() {
    if (result.errors.length) return;
    try {
      openDocument(createDocument(`${builder.name}.etl`, result.source));
      setMessage(
        "Copia creada. Pulsa Compile para validar el programa con el compilador real.",
      );
      onOpen();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <section className="block-builder" id="blocks" aria-labelledby="blocks-title">
      <div className="blocks-heading">
        <div>
          <h2 id="blocks-title">Construye un pipeline por bloques</h2>
          <p>
            Conecta una entrada, tus transformaciones y una salida. Los bloques
            se ejecutan de arriba abajo; el código se genera mientras los
            editas.
          </p>
        </div>
        <a href="/docs/tutorial">Ver tutorial CSV</a>
      </div>
      <p className="blocks-scope">
        Pipelines lineales CSV · 7 transformaciones · hasta 24 bloques. Para
        JOIN, USE y ramificaciones usa Code. Este borrador de bloques dura esta
        visita; guárdalo como copia o descárgalo antes de salir.
      </p>
      <section className="blocks-examples" aria-label="Ejemplos de Blocks">
        <div className="blocks-example-controls">
          <label>
            Ejemplos de Blocks
            <select
              aria-label="Ejemplos de Blocks"
              value={selectedExample}
              onChange={(event) => setSelectedExample(event.target.value)}
            >
              <option value="">Elegir un ejemplo…</option>
              {BLOCK_EXAMPLES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="tool-button"
            disabled={!example}
            onClick={loadExample}
          >
            Cargar ejemplo
          </button>
          {previousBuilder && (
            <button className="tool-button" onClick={restoreBuilder}>
              Restaurar bloques anteriores
            </button>
          )}
        </div>
        <p>
          {example?.description ??
            "Todos los ejemplos usan el CSV incluido de pedidos, con las columnas cliente e importe."}
        </p>
        <p>
          Al cargar se sustituyen los bloques actuales y se conserva una copia
          para restaurarlos. Tu documento en Code no cambia.
        </p>
      </section>
      <div className="blocks-layout">
        <div className="block-chain">
          <section
            className="pipeline-block block-source"
            aria-label="Bloque de entrada"
          >
            <div className="block-heading">
              <span>SOURCE · entrada CSV</span>
              <strong>De dónde vienen los datos</strong>
            </div>
            <div className="block-fields">
              <label>
                Nombre del pipeline
                <input
                  maxLength={60}
                  value={builder.name}
                  onChange={(e) =>
                    setBuilder({ ...builder, name: e.target.value })
                  }
                  spellCheck={false}
                />
              </label>
              <label>
                Archivo CSV
                <input
                  maxLength={300}
                  value={builder.file}
                  onChange={(e) =>
                    setBuilder({ ...builder, file: e.target.value })
                  }
                  spellCheck={false}
                />
              </label>
            </div>
            <details className="block-schema">
              <summary>Columnas de entrada · {builder.columns.length}</summary>
              <p>
                El contrato describe tus datos. El CSV incluido tiene cliente e
                importe. Cambiarlo no modifica el dataset.
              </p>
              {builder.columns.map((column, i) => (
                <div className="builder-column" key={i}>
                  <label>
                    Columna {i + 1}
                    <input
                      maxLength={60}
                      value={column.name}
                      onChange={(event) =>
                        setBuilder({
                          ...builder,
                          columns: builder.columns.map((c, j) =>
                            j === i ? { ...c, name: event.target.value } : c,
                          ),
                        })
                      }
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    Tipo {i + 1}
                    <select
                      value={column.type}
                      onChange={(event) =>
                        setBuilder({
                          ...builder,
                          columns: builder.columns.map((c, j) =>
                            j === i
                              ? {
                                  ...c,
                                  type: event.target.value as Column["type"],
                                }
                              : c,
                          ),
                        })
                      }
                    >
                      {TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <label className="builder-null">
                    <input
                      type="checkbox"
                      checked={column.nullable}
                      onChange={(event) =>
                        setBuilder({
                          ...builder,
                          columns: builder.columns.map((c, j) =>
                            j === i
                              ? { ...c, nullable: event.target.checked }
                              : c,
                          ),
                        })
                      }
                    />
                    Permite NULL
                  </label>
                  <button
                    className="tool-button"
                    aria-label={`Eliminar columna ${i + 1}`}
                    disabled={builder.columns.length === 1}
                    onClick={() =>
                      setBuilder({
                        ...builder,
                        columns: builder.columns.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Eliminar
                  </button>
                </div>
              ))}
              <button
                className="tool-button"
                disabled={builder.columns.length >= 32}
                onClick={() =>
                  setBuilder({
                    ...builder,
                    columns: [
                      ...builder.columns,
                      {
                        name: `columna_${builder.columns.length + 1}`,
                        type: "STRING",
                        nullable: false,
                      },
                    ],
                  })
                }
              >
                Añadir columna
              </button>
            </details>
          </section>
          {builder.blocks.map((block, index) => {
            const info = OPERATIONS.find(([op]) => op === block.op)!;
            return (
              <section
                className="pipeline-block block-transform"
                key={block.id}
                aria-label={`Bloque ${index + 1}: ${info[1]}`}
              >
                <div className="block-heading">
                  <span>
                    STEP {index + 1} · {block.op.toUpperCase()}
                  </span>
                  <strong>{info[1]}</strong>
                </div>
                <p>{info[2]}</p>
                <BlockFields
                  block={block}
                  columns={result.stages[index]}
                  update={(change) => updateBlock(block.id, change)}
                />
                <div className="block-actions">
                  <button
                    className="tool-button"
                    aria-label={`Subir bloque ${index + 1}`}
                    disabled={!index}
                    onClick={() => move(index, -1)}
                  >
                    Subir
                  </button>
                  <button
                    className="tool-button"
                    aria-label={`Bajar bloque ${index + 1}`}
                    disabled={index === builder.blocks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Bajar
                  </button>
                  <button
                    className="tool-button"
                    aria-label={`Eliminar bloque ${index + 1}`}
                    onClick={() => {
                      setBuilder({
                        ...builder,
                        blocks: builder.blocks.filter((b) => b.id !== block.id),
                      });
                      setMessage(`Bloque ${index + 1} eliminado.`);
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              </section>
            );
          })}
          <fieldset
            className="block-palette"
            disabled={builder.blocks.length >= 24}
          >
            <legend>Añadir transformación</legend>
            {OPERATIONS.map(([op, name, description]) => (
              <button
                key={op}
                className="tool-button"
                title={description}
                onClick={() => add(op)}
              >
                + {name}
              </button>
            ))}
          </fieldset>
          <section
            className="pipeline-block block-sink"
            aria-label="Bloque de salida"
          >
            <div className="block-heading">
              <span>SINK · salida CSV</span>
              <strong>A dónde llega el resultado</strong>
            </div>
            <label>
              Archivo de salida
              <input
                maxLength={300}
                value={builder.output}
                onChange={(e) =>
                  setBuilder({ ...builder, output: e.target.value })
                }
                spellCheck={false}
              />
            </label>
            <p>
              Columnas previstas:{" "}
              {result.stages
                .at(-1)
                ?.map((c) => c.name)
                .join(", ") || "ninguna"}
              .
            </p>
          </section>
        </div>
        <aside
          className="blocks-preview"
          aria-label="Código generado por bloques"
        >
          <h3>Tu programa ETL</h3>
          <p>
            Vista previa del código. Compile comprueba sintaxis, tipos y
            conexiones; Run permite ejecutar con un dataset autorizado.
          </p>
          <div
            className="blocks-code"
            tabIndex={0}
            role="region"
            aria-label="Código ETL generado, desplazable"
          >
            <Code code={result.source} />
          </div>
          {result.errors.length > 0 ? (
            <div className="blocks-errors" role="status">
              <strong>Revisa antes de crear la copia</strong>
              <ul>
                {result.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="blocks-ready">Listo para validar con Compile.</p>
          )}
          <div className="blocks-submit">
            <button
              className="btn sm"
              disabled={!!result.errors.length}
              onClick={open}
            >
              Abrir como copia en Code
            </button>
            <button
              className="tool-button"
              disabled={!!result.errors.length}
              onClick={() => downloadText(`${builder.name}.etl`, result.source)}
            >
              Descargar .etl
            </button>
          </div>
          <p>
            Tu documento actual queda en Borradores anteriores. El constructor
            no importa ni convierte automáticamente el código abierto.
          </p>
          <p role="status" className="blocks-message">
            {message}
          </p>
        </aside>
      </div>
    </section>
  );
}
