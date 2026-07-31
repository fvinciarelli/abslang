import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// ── Node.js CLI bundle (for VSCode extension) ──
await esbuild.build({
  entryPoints: [path.join(root, "typescript/src/cli.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(root, "vscode/dist/cli.bundle.js"),
  external: ["aievaluator"],
});
console.log("✅ Node.js CLI bundle → vscode/dist/cli.bundle.js");

// ── Browser runner library (for web designer) ──
const stubsDir = path.join(root, "typescript/src/browser-stubs");

await esbuild.build({
  entryPoints: [path.join(root, "typescript/src/runner-browser.ts")],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "esm",
  outfile: path.join(root, "website/public/abs-runner.js"),
  external: ["aievaluator", "ajv"],
  plugins: [
    {
      name: "browser-stubs",
      setup(build) {
        build.onResolve({ filter: /^(fs|path)$/ }, (args) => {
          return {
            path: path.join(stubsDir, `${args.path}.ts`),
          };
        });
      },
    },
  ],
});
console.log("✅ Browser runner bundle → website/public/abs-runner.js");
