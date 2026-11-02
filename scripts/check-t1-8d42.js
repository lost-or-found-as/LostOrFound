const fs=require("fs"),path=require("path"),r=f=>fs.readFileSync(path.join(process.cwd(),f),"utf8");
const app=r("app/alert-areas.tsx"),server=r("server/routes/alertAreas.js"),sql=r("supabase/migrations/20261001_t1_8d42_watch_area_editing.sql");
for(const value of ["Ionicons","openEdit","editingId","fitToCoordinates","alertAreas.saveChanges","editingArea"])if(!app.includes(value))throw Error(`App feature missing: ${value}`);
for(const value of ["update_user_watch_area_v2","hasGeometry","boundaryPoints"])if(!server.includes(value))throw Error(`Server feature missing: ${value}`);
for(const value of ["create_user_watch_area_v2","update_user_watch_area_v2","point_data(value)"])if(!sql.includes(value))throw Error(`SQL feature missing: ${value}`);
if(app.includes("backText"))throw Error("Obsolete text-glyph style remains");
const keys=s=>new Set([...s.matchAll(/^\s*"([^"]+)"\s*:/gm)].map(m=>m[1])),en=keys(r("src/i18n/locales/en.ts")),no=keys(r("src/i18n/locales/no.ts"));if([...en].some(k=>!no.has(k))||[...no].some(k=>!en.has(k)))throw Error("Locale parity failed");
console.log(`OK: T1.8D.4.2 checks passed. ${en.size} keys in both locales.`);