/**
 * Contrôles statiques du module avant publication.
 * Inspiré de l'exemple fourni, adapté aux fichiers JavaScript .js et .mjs.
 * Exécution : node Tools/check.mjs
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Recense les scripts, y compris dans leurs sous-dossiers. */
async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:m?js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Contrôle l'existence ET la casse de chaque composant du chemin. */
async function checkPath(path) {
  const parts = relative(root, path).split(sep);
  assert.ok(parts[0] !== "..", `Chemin extérieur au module : ${path}`);
  let directory = root;
  for (const part of parts) {
    const names = await readdir(directory);
    assert.ok(names.includes(part), `Fichier absent ou mauvaise casse : ${relative(root, path)}`);
    directory = resolve(directory, part);
  }
}

const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
assert.equal(manifest.id, "automated-weapon-mastery", "Identifiant du module incorrect");
const assets = [...(manifest.esmodules ?? []), ...(manifest.scripts ?? []), ...(manifest.styles ?? [])];
assert.ok(assets.length > 0, "Le manifeste ne référence aucun fichier distribué");
for (const asset of assets) await checkPath(resolve(root, asset));

// On vérifie aussi les tests et les outils, sans les inclure dans le ZIP de release.
const files = (await Promise.all(["scripts", "tests", "Tools"].map(folder => sourceFiles(resolve(root, folder))))).flat();
const imports = new Map();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || `Syntaxe invalide : ${file}`);

  const source = await readFile(file, "utf8");
  const dependencies = [];
  const pattern = /^\s*(?:import\s+(?:[^"';]*?\sfrom\s*)?|export\s+[^"';]*?\sfrom\s*)["']([^"']+)["']/gm;
  for (const [, specifier] of source.matchAll(pattern)) {
    if (!specifier.startsWith(".")) continue;
    const dependency = resolve(dirname(file), specifier);
    await checkPath(dependency);
    dependencies.push(dependency);
  }
  imports.set(file, dependencies);
}

/** Refuse les cycles de modules, susceptibles de casser l'initialisation. */
function checkImportCycles(file, stack = [], checked = new Set()) {
  assert.ok(!stack.includes(file), `Import circulaire : ${[...stack, file].map(path => relative(root, path)).join(" -> ")}`);
  if (checked.has(file)) return;
  for (const dependency of imports.get(file) ?? []) checkImportCycles(dependency, [...stack, file], checked);
  checked.add(file);
}
for (const entry of manifest.esmodules ?? []) checkImportCycles(resolve(root, entry));
console.log(`${files.length} fichiers vérifiés : syntaxe, chemins, casse et absence de cycles depuis le manifeste.`);
