const fs=require("fs"),path=require("path");
const files=["app/chat/[matchId].tsx", "app/(auth)/auth-callback.tsx", "app/(auth)/login.tsx", "app/(tabs)/profile.tsx", "app/observation-create.tsx", "app/observation/[id].tsx", "app/observation-chat/[id].tsx", "app/push-settings.tsx", "src/i18n/I18nProvider.tsx", "src/i18n/locales/en.ts", "src/i18n/locales/no.ts", "server/routes/observations.js", "server/routes/resolutions.js", "server/routes/observationChat.js"];
for(const f of files)if(!fs.existsSync(path.join(process.cwd(),f)))throw new Error(`Missing ${f}`);
const read=f=>fs.readFileSync(path.join(process.cwd(),f),"utf8");
const keys=x=>new Set([...x.matchAll(/^\s*["']([^"']+)["']\s*:/gm)].map(m=>m[1]));
const e=keys(read("src/i18n/locales/en.ts")),n=keys(read("src/i18n/locales/no.ts"));
const a=[...e].filter(k=>!n.has(k)),b=[...n].filter(k=>!e.has(k));if(a.length||b.length)throw new Error(`Locale mismatch EN:${b} NO:${a}`);
for(const f of ["server/routes/observations.js","server/routes/resolutions.js","server/routes/observationChat.js"]){const x=read(f);if(/f├|Ã¸|ðŸ/.test(x))throw new Error(`${f}: mojibake remains`);}
console.log(`OK: T1.7G checks passed. ${e.size} translation keys are present in both locales.`);
