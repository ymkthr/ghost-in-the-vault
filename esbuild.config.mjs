import { builtinModules } from "node:module";
import esbuild from "esbuild";

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  outfile: "main.js",
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  loader: { ".wasm": "binary" },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
