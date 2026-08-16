import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname);
const output = resolve(root, "build");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  entryPoints: {
    popup: resolve(root, "src/popup.ts"),
    options: resolve(root, "src/options.ts"),
    content: resolve(root, "src/content.ts"),
  },
  outdir: output,
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
});

for (const file of ["manifest.json", "popup.html", "options.html", "styles.css"]) {
  await cp(resolve(root, "static", file), resolve(output, file));
}
