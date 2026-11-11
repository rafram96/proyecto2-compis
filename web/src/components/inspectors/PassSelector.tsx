import { PASSES } from "../../workspace/model";
export default function PassSelector({
  passes,
  onChange,
}: {
  passes: string[] | null;
  onChange(passes: string[] | null): void;
}) {
  const mode = passes === null ? "default" : passes.length ? "custom" : "O0";
  return (
    <div className="passes-control">
      <label>
        Pases{" "}
        <select
          aria-label="Pases de optimización"
          value={mode}
          onChange={(e) =>
            onChange(
              e.target.value === "default"
                ? null
                : e.target.value === "O0"
                  ? []
                  : [...PASSES],
            )
          }
        >
          <option value="default">Predeterminados</option>
          <option value="custom">Personalizados</option>
          <option value="O0">Sin pases (O0)</option>
        </select>
      </label>
      <details
        className="passes-details"
        open={mode === "custom" ? true : undefined}
      >
        <summary>Elegir y ordenar pases</summary>
        <p>Se envían en el orden mostrado. Al activar uno se añade al final.</p>
        <fieldset>
          <legend>Pases individuales</legend>
          {PASSES.map((pass) => (
            <label key={pass}>
              <input
                type="checkbox"
                checked={(passes ?? PASSES).includes(pass)}
                onChange={(e) => {
                  const selected = passes ?? PASSES;
                  onChange(
                    e.target.checked
                      ? [...selected, pass]
                      : selected.filter((p) => p !== pass),
                  );
                }}
              />
              {pass}
            </label>
          ))}
        </fieldset>
        <ol>
          {(passes ?? PASSES).map((pass, i, order) => (
            <li key={pass}>
              <span>{pass}</span>
              <button
                className="tool-button"
                disabled={i === 0}
                aria-label={`Subir ${pass}`}
                onClick={() => {
                  const next = [...order];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              >
                Subir
              </button>
              <button
                className="tool-button"
                disabled={i === order.length - 1}
                aria-label={`Bajar ${pass}`}
                onClick={() => {
                  const next = [...order];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  onChange(next);
                }}
              >
                Bajar
              </button>
            </li>
          ))}
        </ol>
      </details>
      <p className="passes-order">
        Orden enviado:{" "}
        {passes === null
          ? "predeterminados · "
          : passes.length
            ? "lista explícita · "
            : "O0 · "}
        {(passes ?? PASSES).join(" → ") || "ningún pase"}
      </p>
    </div>
  );
}
