"use strict";
// Runs real app TypeScript modules in Node for behavior tests, without React Native.
// Copies the given files to a temp folder, points package imports at small stubs, and runs a
// test script. Uses the project's TypeScript when installed (local PCs), otherwise Node's type
// stripping (Node 22+, the CI checks job).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..", "..");

function loadTypeScript() {
  try {
    return require(require.resolve("typescript", { paths: [root] }));
  } catch {
    return null;
  }
}

// files: repo-relative module paths. stubs: { "package-name": "ESM source" }.
// runner: ESM test source that imports modules by repo-relative path without extension,
// e.g. import { x } from "@/src/lib/caseDisplay".
function runTsModules({ files, stubs = {}, runner, prefix = "lof-ts-" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const ts = loadTypeScript();
  const ext = ts ? ".mjs" : ".ts";
  const known = new Set(files.map((f) => f.replace(/\.tsx?$/, "")));

  const rewrite = (source, fromRel) =>
    source.replace(/(from\s+|import\s*\(\s*)(["'])([^"']+)\2/g, (all, lead, q, spec) => {
      if (stubs[spec] != null) {
        const target = path.posix.relative(path.posix.dirname(fromRel), `__stubs__/${spec.replace(/[^\w]/g, "_")}`);
        return `${lead}${q}${target.startsWith(".") ? target : "./" + target}${ext}${q}`;
      }
      if (spec.startsWith("@/")) {
        spec = path.posix.relative(path.posix.dirname(fromRel), spec.slice(2));
        if (!spec.startsWith(".")) spec = "./" + spec;
      }
      if (!spec.startsWith(".")) return all;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
      if (!known.has(resolved)) throw new Error(`Test module ${fromRel} imports ${spec}, which is not in the file list`);
      return `${lead}${q}${spec.startsWith(".") ? spec : "./" + spec}${ext}${q}`;
    });

  const write = (rel, source) => {
    const out = path.join(dir, rel.replace(/\.tsx?$/, ext));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let code = rewrite(source, rel);
    if (ts) {
      code = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, verbatimModuleSyntax: false },
        fileName: rel,
      }).outputText;
    }
    fs.writeFileSync(out, code);
  };

  for (const f of files) write(f, fs.readFileSync(path.join(root, f), "utf8"));
  for (const [name, source] of Object.entries(stubs)) write(`__stubs__/${name.replace(/[^\w]/g, "_")}.ts`, source);
  const runnerRel = "run.ts";
  known.add("run");
  write(runnerRel, runner);

  const args = ts ? [path.join(dir, "run.mjs")] : ["--experimental-strip-types", "--no-warnings", path.join(dir, "run.ts")];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  return r.status === 0;
}

module.exports = { runTsModules };

// The language layer most helpers need.
const I18N_MODULES = [
  "src/i18n/translate.ts",
  "src/i18n/catalog.ts",
  "src/i18n/formatters.ts",
  "src/i18n/locales/en.ts",
  "src/i18n/locales/no.ts",
];

// expo-localization for tests: a metric device. Set globalThis.__measurementSystem to change it.
const EXPO_LOCALIZATION_STUB = `
export function getLocales() {
  return [{ languageCode: "nb", measurementSystem: globalThis.__measurementSystem ?? "metric" }];
}
`;

module.exports.I18N_MODULES = I18N_MODULES;
module.exports.EXPO_LOCALIZATION_STUB = EXPO_LOCALIZATION_STUB;

// Synchronous CommonJS loader for tests that call app helpers in-process.
// Relative .ts imports are loaded the same way; packages listed in `stubs` get the stub object.
function requireTs(file, stubs = {}) {
  const Module = require("module");
  const ts = loadTypeScript();
  const cache = new Map();
  const load = (abs) => {
    if (cache.has(abs)) return cache.get(abs).exports;
    const m = new Module(abs, module);
    m.filename = abs;
    m.paths = Module._nodeModulePaths(path.dirname(abs));
    cache.set(abs, m);
    m.require = (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      if (request.startsWith(".")) {
        const base = path.resolve(path.dirname(abs), request);
        for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
          if (fs.existsSync(candidate)) return load(candidate);
        }
      }
      return require(require.resolve(request, { paths: [path.dirname(abs)] }));
    };
    const source = fs.readFileSync(abs, "utf8");
    let code;
    if (ts) {
      code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: abs,
      }).outputText;
    } else {
      throw new Error("TYPESCRIPT_NOT_AVAILABLE: run npm install in the project root first");
    }
    const wrapper = Module.wrap(code);
    const fn = require("vm").runInThisContext(wrapper, { filename: abs });
    fn.call(m.exports, m.exports, m.require, m, abs, path.dirname(abs));
    return m.exports;
  };
  return load(path.resolve(file));
}

module.exports.requireTs = requireTs;
module.exports.EXPO_LOCALIZATION_STUB_OBJECT = {
  getLocales: () => [{ languageCode: "nb", measurementSystem: "metric" }],
};
