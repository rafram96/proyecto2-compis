/** Logos originales autoalojados; procedencia y hashes en public/brand/stack/credits.json. */
export const TECHNOLOGIES = [
  { name: "Python", role: "Núcleo del compilador", logo: "python.png" },
  { name: "Lark", role: "Gramática y análisis", logo: "lark.png" },
  { name: "Polars", role: "Transformación de datos", logo: "polars.svg" },
  { name: "DuckDB", role: "Conexiones SQL", logo: "duckdb.svg" },
  {
    name: "Pyodide",
    role: "Python en el navegador",
    logo: "pyodide-light.svg",
    darkLogo: "pyodide-dark.svg",
    wordmark: true,
  },
  { name: "CodeMirror", role: "Edición de código", logo: "codemirror.svg" },
  { name: "React", role: "Interfaz de Studio", logo: "react.svg" },
  { name: "TypeScript", role: "Tipos en la web", logo: "typescript.png" },
  { name: "Vite", role: "Desarrollo y build", logo: "vite.svg" },
  {
    name: "Tailwind CSS",
    role: "Estilos de la interfaz",
    logo: "tailwind.png",
  },
  { name: "D3", role: "Árboles y grafos", logo: "d3.svg" },
  { name: "FastAPI", role: "Servicio de ejecución", logo: "fastapi.png" },
] as const;
