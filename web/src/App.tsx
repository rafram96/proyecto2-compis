import { useEffect } from "react";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Errors } from "./components/Errors";
import { Optimizer } from "./components/Optimizer";
import { Language } from "./components/Language";
import { Letter } from "./components/Letter";
import { BuiltOn, Faq, Footer } from "./components/Faq";
import { Studio } from "./components/Studio";
import { startReveal } from "./lib/reveal";

export default function App() {
  useEffect(startReveal, []);
  return (
    <>
      <a className="skip" href="#estudio">
        Ir al estudio
      </a>
      <Nav />
      <main>
        <Hero />
        <Errors />
        <Optimizer />
        <Language />
        <Letter />
        <BuiltOn />
        <Faq />
        <Studio />
      </main>
      <Footer />
    </>
  );
}
