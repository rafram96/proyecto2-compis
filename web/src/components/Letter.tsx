import { stats } from "../data";
import { Mark } from "./Nav";

/** Fotos de Wikimedia Commons, descargadas al proyecto (créditos completos en scripts/brand/photo-credits.json). */
export const PHOTOS = {
  zigzag: {
    src: `${import.meta.env.BASE_URL}img/cumbemayo-zigzag.jpg`,
    w: 900,
    h: 1200,
    alt: "Canal de piedra tallado en zigzag en Cumbemayo, con agua corriendo entre las rocas.",
    caption: "Canal de Cumbemayo, Cajamarca. Los quiebres frenan el agua.",
    credit: "EnriqueGuia, CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Canal_Inca_Cumbemayo.jpg",
  },
  cantalloc: {
    src: `${import.meta.env.BASE_URL}img/cantalloc.jpg`,
    w: 1440,
    h: 973,
    alt: "Pozos en espiral de piedra de los acueductos de Cantalloc, en Nazca, bajo un cielo despejado.",
    caption: "Puquios de Cantalloc, Nazca. Espirales que bajan hasta el agua subterránea.",
    credit: "Diego Delso, CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Acueductos_subterr%C3%A1neos_de_Cantalloc,_Nazca,_Per%C3%BA,_2015-07-29,_DD_09.JPG",
  },
  puente: {
    src: `${import.meta.env.BASE_URL}img/puente-canal.jpg`,
    w: 1000,
    h: 750,
    alt: "Puente-canal de piedra que lleva el agua por encima de una quebrada en Cumbemayo.",
    caption: "Puente-canal en Cumbemayo: el cauce cruza por encima.",
    credit: "John PC, CC BY-SA 3.0",
    page: "https://commons.wikimedia.org/wiki/File:Puente-canal_de_Cumbemayo.JPG",
  },
  canal: {
    src: `${import.meta.env.BASE_URL}img/cumbemayo-canal.jpg`,
    w: 1000,
    h: 750,
    alt: "Tramo recto del canal de Cumbemayo entre grandes bloques de roca.",
    caption: "Otro tramo del canal de Cumbemayo.",
    credit: "EnriqueGuia, CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Canal_Cumbemayo.jpg",
  },
} as const;

type P = (typeof PHOTOS)[keyof typeof PHOTOS];

function Photo({ p, className }: { p: P; className: string }) {
  return (
    <figure className={`photo ${className}`} data-reveal>
      <div className="photo-crop">
        <img src={p.src} width={p.w} height={p.h} alt={p.alt} loading="lazy" decoding="async" />
      </div>
      <figcaption>
        {p.caption}{" "}
        <a href={p.page} target="_blank" rel="noreferrer">
          Foto: {p.credit}
        </a>
      </figcaption>
    </figure>
  );
}

export function Letter() {
  return (
    <section className="origin" id="origen" aria-labelledby="origen-t">
      <h2 id="origen-t" className="sr">
        Por qué se llama Stream
      </h2>
      <div className="letter" data-reveal>
        <Mark className="letter-mark" />
        <p>Hola. Somos el equipo detrás de Stream, el proyecto 2 del curso de Compiladores de UTEC, en Lima.</p>
        <p>
          Empezamos con una pregunta: ¿cómo escribe un pipeline de datos alguien que no programa? Nuestra respuesta es un archivo que
          se lee de arriba abajo: de dónde salen los datos, qué pasos siguen y a dónde llegan.
        </p>
        <p>
          Stream significa «corriente»: datos que recorren un camino. En Cumbemayo, mucho antes de los incas, se talló en la roca un canal en zigzag para llevar el agua
          lejos sin que se desbordara. Un cauce no inventa el agua; le da un camino. Eso queremos hacer con tus datos.
        </p>
        <p>
          Por dentro es un compilador completo: gramática LALR con Lark, un árbol sintáctico inmutable, un plan en forma de grafo, cinco
          pases de optimización y un generador de Python con Polars. Lo sostienen {stats.tests} pruebas, y {stats.errorCodes} códigos de
          error explican en español lo que falla.
        </p>
        <p>
          Todo lo que ves en esta página es <mark>salida real del compilador</mark>. Al final puedes compilar tú mismo, sin instalar
          nada.
        </p>
        <p className="sign">El equipo de Stream</p>
        <p className="role">Proyecto 2 · Compiladores · UTEC 2026-2</p>
      </div>

      <div className="photos">
        <Photo p={PHOTOS.zigzag} className="big" />
        <Photo p={PHOTOS.cantalloc} className="wide" />
        <Photo p={PHOTOS.puente} className="small a" />
        <Photo p={PHOTOS.canal} className="small b" />
      </div>
    </section>
  );
}
