#!/usr/bin/env node
/**
 * Regenerates `LUCIDE_PATHS` in src/lib/check-icon-svg.ts from the installed
 * lucide-react's icon nodes, so the chart's canvas icons and tooltips draw
 * exactly what the React icons (grids, panels, prints) draw. Spec §8.5.
 *
 *   node scripts/gen-check-icons.mjs           rewrite the generated block
 *   node scripts/gen-check-icons.mjs --check   exit 1 if the block is stale
 *
 * No dependency: it reads `ICON_KEYS` from src/components/readiness/icon-registry.ts
 * and each key's `__iconNode` from
 * node_modules/lucide-react/dist/esm/icons/<lucide name>.js. Those files are ESM
 * `.js` in a package without `"type": "module"`, so this needs a Node with ESM
 * syntax detection (>= 20.19 / 22.12).
 *
 * Only owned, allow-listed geometry is written: every tag, attribute name and
 * attribute value is checked, and anything unexpected stops the script instead of
 * reaching the SVG the chart embeds.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = path.join(ROOT, "src/components/readiness/icon-registry.ts");
const TARGET = path.join(ROOT, "src/lib/check-icon-svg.ts");
const LUCIDE = path.join(ROOT, "node_modules/lucide-react");
const ICONS_DIR = path.join(LUCIDE, "dist/esm/icons");

/** Registry keys whose lucide file is only an alias re-export (no `__iconNode`). */
const ALIASES = { "file-signature": "file-pen-line" };
/** Hand-drawn keys (not lucide): the generator emits a reference to the named
 *  constant, which lives outside the generated block and stays as written. */
const HAND_DRAWN = { "rotary-table": "ROTARY_TABLE_PATHS" };

const BEGIN = "  // BEGIN GENERATED LUCIDE_PATHS (scripts/gen-check-icons.mjs) - do not edit by hand";
const END = "  // END GENERATED LUCIDE_PATHS";

const KEY_RE = /^[a-z][a-z0-9-]*$/;
const TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const ATTRS = new Set([
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points",
]);
// Path data and coordinates only: letters (path commands), digits, signs, dots,
// commas and spaces. Nothing that could close an attribute or a template literal.
const VALUE_RE = /^[0-9A-Za-z .,-]+$/;

function fail(message) {
  console.error(`gen-check-icons: ${message}`);
  process.exit(1);
}

/** The registry's ICON_KEYS, in order (the same parse the backend parity test uses). */
async function readIconKeys() {
  const source = await readFile(REGISTRY, "utf8");
  const block = /export const ICON_KEYS = \[(.*?)\] as const/s.exec(source);
  if (!block) fail(`no "export const ICON_KEYS = [...] as const" in ${REGISTRY}`);
  const body = block[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const keys = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const key of keys) {
    if (!KEY_RE.test(key)) fail(`icon key ${JSON.stringify(key)} is not a plain kebab-case name`);
  }
  if (new Set(keys).size !== keys.length) fail("ICON_KEYS has a duplicate key");
  return keys;
}

async function iconNode(key) {
  const name = ALIASES[key] ?? key;
  const file = path.join(ICONS_DIR, `${name}.js`);
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    fail(`can't load lucide icon "${name}" for key "${key}" (${file}): ${why}`);
  }
  if (!Array.isArray(mod.__iconNode)) {
    fail(`lucide icon "${name}" has no __iconNode (an alias? add it to ALIASES)`);
  }
  return mod.__iconNode;
}

function element(key, [tag, attrs]) {
  if (!TAGS.has(tag)) fail(`"${key}": unexpected element <${tag}>`);
  const parts = [];
  for (const [attr, value] of Object.entries(attrs)) {
    if (attr === "key") continue; // React's list key, not an SVG attribute
    if (!ATTRS.has(attr)) fail(`"${key}": unexpected attribute ${attr} on <${tag}>`);
    const text = String(value);
    if (!VALUE_RE.test(text)) fail(`"${key}": unexpected characters in ${attr}="${text}"`);
    parts.push(`${attr}="${text}"`);
  }
  return `<${tag} ${parts.join(" ")}/>`;
}

const propName = (key) => (/^[a-z][a-z0-9]*$/.test(key) ? key : `"${key}"`);

async function main() {
  const check = process.argv.includes("--check");
  const keys = await readIconKeys();
  const { version } = JSON.parse(await readFile(path.join(LUCIDE, "package.json"), "utf8"));
  const target = await readFile(TARGET, "utf8");

  for (const constant of Object.values(HAND_DRAWN)) {
    if (!target.includes(`const ${constant} = `)) fail(`${TARGET} lost its ${constant} constant`);
  }

  const lines = [BEGIN, `  // From lucide-react ${version}; hand-drawn keys reference their own constant.`];
  for (const key of keys) {
    if (HAND_DRAWN[key]) {
      lines.push(`  ${propName(key)}: ${HAND_DRAWN[key]},`);
      continue;
    }
    const nodes = await iconNode(key);
    lines.push(`  ${propName(key)}: \``);
    for (const node of nodes) lines.push(`    ${element(key, node)}`);
    lines.push("  `,");
  }
  lines.push(END);
  const block = lines.join("\n");

  const begin = target.indexOf(BEGIN);
  const end = target.indexOf(END);
  if (begin < 0 || end < begin) fail(`${TARGET} has no generated block markers`);
  const next = target.slice(0, begin) + block + target.slice(end + END.length);

  if (next === target) {
    console.log(`gen-check-icons: up to date (${keys.length} keys, lucide-react ${version})`);
    return;
  }
  if (check) fail("src/lib/check-icon-svg.ts is stale: run node scripts/gen-check-icons.mjs");
  await writeFile(TARGET, next);
  console.log(`gen-check-icons: wrote ${keys.length} keys from lucide-react ${version}`);
}

await main();
