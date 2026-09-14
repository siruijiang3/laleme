import { copyFile, mkdir, readFile, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = new URL("node_modules/maplibre-gl/", root);
const { version } = JSON.parse(await readFile(new URL("package.json", source), "utf8"));
const output = new URL("public/maplibre/", root);
await rm(output, { recursive: true, force: true });
const target = new URL(`${version}/`, output);
await mkdir(target, { recursive: true });
// The ESM worker imports its shared module by relative URL.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(new URL(`dist/${file}`, source), new URL(file, target));
}
await copyFile(new URL("LICENSE.txt", source), new URL("LICENSE.txt", target));
console.log(`Prepared same-origin MapLibre ${version} worker modules.`);
