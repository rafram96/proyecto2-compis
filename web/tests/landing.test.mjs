import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TECHNOLOGIES } from "../src/components/technologies.ts";

test("los logos del stack están autoalojados y coinciden con su procedencia registrada", () => {
  const root = new URL("../public/brand/stack/", import.meta.url);
  const credits = JSON.parse(
    readFileSync(new URL("credits.json", root), "utf8"),
  );
  assert.equal(TECHNOLOGIES.length, 12);
  assert.equal(new Set(TECHNOLOGIES.map((t) => t.name)).size, 12);
  for (const technology of TECHNOLOGIES) {
    for (const file of [technology.logo, technology.darkLogo].filter(Boolean)) {
      const bytes = readFileSync(new URL(file, root));
      const entry = credits.assets.find(
        (asset) => asset.file === file && asset.project === technology.name,
      );
      assert.ok(entry, `Falta procedencia de ${file}`);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        entry.sha256,
      );
      assert.match(entry.source, /^https:\/\//);
      if (file.endsWith(".svg")) {
        const svg = bytes.toString("utf8");
        assert.match(svg, /<svg\b/);
        assert.doesNotMatch(
          svg,
          /<script\b|<foreignObject\b|(?:href|src)=["']https?:/i,
        );
      } else
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
  }
});
