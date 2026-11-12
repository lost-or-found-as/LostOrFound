// scripts/test-t1-9ag.js
// T1.9AG: EAS Update. Builds carry a channel (development / preview / production) and the
// runtime version follows the app version, so an update only reaches builds with the same native
// code. Rule: change "version" in app.json whenever native code changes (new native package,
// new permission, config plugin change); JavaScript-only fixes go out with npm run update:preview.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };

const app = json("app.json").expo;
const eas = json("eas.json");
const pkg = json("package.json");

ok(/^\d+\.\d+\.\d+$/.test(app.version || ""), "app.json has an explicit version");
ok(app.runtimeVersion && app.runtimeVersion.policy === "appVersion", "runtime version follows the app version");
ok(app.updates && app.updates.url === `https://u.expo.dev/${app.extra.eas.projectId}`, "update URL points at this EAS project");
ok(app.updates.fallbackToCacheTimeout === 0, "app start never waits for an update download");
for (const profile of ["development", "preview", "production"]) {
  ok(eas.build[profile].channel === profile, `build profile ${profile} has channel ${profile}`);
  ok(eas.build[profile].environment === profile, `build profile ${profile} uses environment ${profile}`);
}
ok(!!pkg.dependencies["expo-updates"], "expo-updates is installed");
ok(/--channel preview --environment preview/.test(pkg.scripts["update:preview"] || ""), "preview updates use the preview environment");
ok(/--channel production --environment production/.test(pkg.scripts["update:production"] || ""), "production updates use the production environment");

console.log(`OK: T1.9AG checks passed (${n} assertions).`);
