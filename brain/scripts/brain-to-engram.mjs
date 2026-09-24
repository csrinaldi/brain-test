#!/usr/bin/env node
// Reproyector brain → engram. Materializa el principio D6:
//   MD (brain/) = fuente de verdad   ·   engram = índice reconstruible.
// Indexa los documentos DURABLES del cerebro a engram de forma idempotente
// (--topic derivado del path → upsert, no duplica al re-correr).
// Si se pierde engram: `npm run brain:memory:index` lo reconstruye desde brain/.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadBrainConfig } from "./lib/brain-config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { project } = loadBrainConfig();
const PROJECT = project.name;

// Carpetas durables a indexar → tipo de observación en engram
const SOURCES = [
  { dir: "brain/project/decisions", type: "decision" },
  { dir: "brain/core/anti-patterns", type: "pattern" },
  { dir: "brain/project/anti-patterns", type: "pattern" },
  { dir: "brain/project/domain", type: "reference" },
  { dir: "brain/project/methodology", type: "reference" },
  { dir: "brain/core/methodology", type: "reference" },
];

function mdFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(mdFiles(p));
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

function titleOf(content, file) {
  const h = content.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : basename(file, ".md");
}

let indexed = 0;
for (const { dir, type } of SOURCES) {
  for (const file of mdFiles(join(repoRoot, dir))) {
    const content = readFileSync(file, "utf8");
    const rel = relative(repoRoot, file);
    const topic = rel.replace(/\.md$/, ""); // ej: brain/project/decisions/adr-0001-...
    try {
      execFileSync(
        "engram",
        ["save", titleOf(content, file), content, "--type", type, "--project", PROJECT, "--topic", topic],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      console.log(`  ✓ ${rel}  →  engram [${type}]  topic=${topic}`);
      indexed++;
    } catch (err) {
      console.error(`  ✗ ${rel}: ${String(err.stderr || err.message).trim()}`);
    }
  }
}

console.log(`\n${indexed} documentos del cerebro indexados a engram (proyección reconstruible desde brain/).`);
