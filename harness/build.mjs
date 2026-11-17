// Bundles the widget with mocked Mendix props for the browser harness: node harness/build.mjs
// dist/entry.js uses React's development build (more checks); dist/prod/entry.js the production
// build that Mendix apps run, used by the performance checks (index.html?prod=1).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
for (const mode of ["development", "production"]) {
    await build({
        entryPoints: [here + "entry.tsx"],
        outdir: here + (mode === "production" ? "dist/prod" : "dist"),
        bundle: true,
        format: "iife",
        jsx: "automatic",
        target: "es2020",
        minify: mode === "production",
        alias: { mendix: here + "shim-mendix.ts" },
        define: { "process.env.NODE_ENV": JSON.stringify(mode) },
        logLevel: "warning"
    });
}
console.log("harness bundles written");
