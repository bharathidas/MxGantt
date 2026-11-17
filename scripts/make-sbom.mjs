// Software bill of materials (CycloneDX 1.5 JSON) for the release: the widget itself, every package
// bundled into it (measured on the real module graph, like check-licenses.mjs) and the externals the
// Mendix client provides. Written to dist/<version>/<widget>.sbom.cdx.json; no dependencies beyond
// esbuild, which the harness already uses.
//   node scripts/make-sbom.mjs
import { build } from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "mendix", "mendix/*", "big.js"];

function licenceOf(manifest) {
    const value = manifest.license ?? manifest.licenses;
    if (!value) {
        return "UNKNOWN";
    }
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(entry => entry.type ?? entry).join(" OR ");
    }
    return value.type ?? "UNKNOWN";
}

function packageRoot(file) {
    const parts = file.split(/[\\/]/);
    const index = parts.lastIndexOf("node_modules");
    if (index < 0) {
        return undefined;
    }
    const depth = parts[index + 1].startsWith("@") ? 3 : 2;
    return parts.slice(0, index + depth).join(sep);
}

const purl = (name, version) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
const licences = expression =>
    /\s(OR|AND)\s/.test(expression) ? [{ expression }] : [{ license: { id: expression } }];

const result = await build({
    entryPoints: [join(root, "src", `${pkg.widgetName}.tsx`)],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    jsx: "automatic",
    external: EXTERNAL,
    loader: { ".css": "empty", ".png": "empty" },
    logLevel: "silent"
});
const bundled = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
    const dir = packageRoot(join(root, input));
    if (!dir) {
        continue;
    }
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    bundled.set(`${manifest.name}@${manifest.version}`, manifest);
}

const outDir = join(root, "dist", pkg.version);
mkdirSync(outDir, { recursive: true });
const mpk = join(outDir, pkg.mxpackage.mpkName);
const widgetRef = purl(pkg.name, pkg.version);
const widget = {
    "bom-ref": widgetRef,
    type: "library",
    name: pkg.widgetName,
    version: pkg.version,
    description: pkg.description,
    licenses: licences(pkg.license),
    purl: widgetRef,
    supplier: { name: "MX Techies" }
};
if (existsSync(mpk)) {
    widget.hashes = [{ alg: "SHA-256", content: createHash("sha256").update(readFileSync(mpk)).digest("hex") }];
}

const components = [...bundled.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(manifest => ({
        "bom-ref": purl(manifest.name, manifest.version),
        type: "library",
        name: manifest.name,
        version: manifest.version,
        scope: "required",
        licenses: licences(licenceOf(manifest)),
        purl: purl(manifest.name, manifest.version)
    }));
// Supplied by the Mendix client at runtime; listed so the runtime surface is visible.
const runtime = ["react", "react-dom", "big.js"].map(name => {
    const path = join(root, "node_modules", name, "package.json");
    const manifest = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { name, version: "provided" };
    return {
        "bom-ref": purl(name, manifest.version),
        type: "library",
        name,
        version: manifest.version,
        scope: "excluded",
        description: "Provided by the Mendix client at runtime; not bundled",
        licenses: licences(licenceOf(manifest)),
        purl: purl(name, manifest.version)
    };
});

const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
        timestamp: new Date().toISOString(),
        tools: { components: [{ type: "application", name: "make-sbom.mjs", version: "1.0.0" }] },
        component: widget
    },
    components: [...components, ...runtime],
    dependencies: [{ ref: widgetRef, dependsOn: [...components, ...runtime].map(component => component["bom-ref"]) }]
};
const target = join(outDir, `${pkg.widgetName}.sbom.cdx.json`);
writeFileSync(target, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`SBOM written: ${target} (${components.length} bundled, ${runtime.length} runtime-provided)`);
