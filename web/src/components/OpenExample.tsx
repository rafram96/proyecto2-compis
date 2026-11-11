import { useState } from "react";
import type { Example } from "../content";
import { createDocument } from "../workspace/model";
import { openDocument } from "../workspace/store";
import { navigate } from "../lib/router";
export function OpenExample({ example }: { example: Example }) {
  const [error, setError] = useState("");
  return (
    <div className="open-example">
      <button
        className="btn"
        onClick={() => {
          try {
            openDocument(createDocument(example.name, example.code));
            navigate("/estudio");
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        Abrir una copia en el estudio
      </button>
      <p>Tu documento anterior queda en Borradores anteriores.</p>
      {error && (
        <p className="workspace-message" role="alert">
          {error} <a href="/estudio">Gestionar borradores en el estudio</a>
        </p>
      )}
    </div>
  );
}
