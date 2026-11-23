// scripts/test-t1-9bt.js
// T1.9BT: Live Activities for a lost case and the home screen widget (iOS). The server makes the
// texts and pushes updates through APNs; everything is off unless LIVE_ACTIVITIES_ENABLED=true.
//   node .\scripts\test-t1-9bt.js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

(async () => {
  const apns = require(path.join(root, "server/lib/apns.js"));
  const live = require(path.join(root, "server/lib/liveActivities.js"));

  // Switches.
  ok(!live.liveActivitiesEnabled({}), "off by default");
  ok(live.liveActivitiesEnabled({ LIVE_ACTIVITIES_ENABLED: "true" }), "on with the switch");
  ok(!apns.apnsConfigured({}), "APNs needs settings");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const env = { APNS_KEY_ID: "KEY1234567", APNS_TEAM_ID: "TEAM123456", APNS_PRIVATE_KEY: pem.replace(/\n/g, "\\n") };
  ok(apns.apnsConfigured(env), "APNs configured from env with escaped line breaks");
  eq(apns.apnsConfig(env).host, "https://api.push.apple.com", "production by default (TestFlight)");
  eq(apns.apnsConfig({ ...env, APNS_ENV: "sandbox" }).host, "https://api.sandbox.push.apple.com", "sandbox on request");

  // JWT: ES256, verifiable with the public key.
  const jwt = apns.signJwt({ keyId: "KEY1234567", teamId: "TEAM123456", privateKey: pem, now: 1_800_000_000_000 });
  const [h, c, sig] = jwt.split(".");
  eq(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KEY1234567" }, "jwt header");
  eq(JSON.parse(Buffer.from(c, "base64url")), { iss: "TEAM123456", iat: 1_800_000_000 }, "jwt claims");
  ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")), "jwt signature verifies");

  // Payload in expo-widgets' ContentState shape: { name, props: JSON string }.
  const p = apns.liveActivityPayload({ event: "end", name: "CaseActivity", props: { a: 1 }, dismissalDate: new Date(1_800_000_360_000), now: 1_800_000_000_000 });
  eq(p, { aps: { timestamp: 1_800_000_000, event: "end", "content-state": { name: "CaseActivity", props: '{"a":1}' }, "dismissal-date": 1_800_000_360 } }, "end payload");
  const headers = apns.liveActivityHeaders({ bundleId: "com.kjfok.lostorfound" }, "JWT", 5);
  eq(headers["apns-topic"], "com.kjfok.lostorfound.push-type.liveactivity", "topic");
  eq(headers["apns-push-type"], "liveactivity", "push type");
  eq(headers["apns-priority"], "5", "low priority for scheduled refresh");
  ok(apns.isDeadToken({ status: 410 }) && apns.isDeadToken({ status: 400, reason: "BadDeviceToken" }) && !apns.isDeadToken({ status: 429 }), "dead tokens");
  eq((await apns.sendLiveActivity("abcdef0123456789", {}, { env: {} })).reason, "APNS_NOT_CONFIGURED", "nothing sent without settings");

  // Props: every text ready, in the activity's language.
  const now = Date.parse("2026-11-24T12:00:00Z");
  const dog = { id: "11111111-1111-1111-1111-111111111111", type: "LOST", status: "ACTIVE", category: "PETS", subcategory_key: "DOG", pet_name: "Bamse", occurred_at: "2026-11-24T09:00:00Z" };
  const pr = live.caseProps(dog, { tips: 2, matches: 1 }, "no", now);
  eq(pr.kicker, "Savnet dyr", "pet kicker");
  eq(pr.title, "Bamse", "pet name");
  eq(pr.detail, "2 tips · 1 mulig treff", "counts");
  eq(pr.badge, "3", "badge");
  eq(pr.sinceMs, Date.parse("2026-11-24T09:00:00Z"), "since");
  eq(pr.url, "lostorfound://report-details/11111111-1111-1111-1111-111111111111", "deep link");
  ok(!pr.ended, "followable");
  eq(live.caseProps(dog, { tips: 0, matches: 0 }, "en", now).detail, "No tips yet", "nothing yet");
  eq(live.caseProps(dog, { tips: 1, matches: 2 }, "en", now).detail, "1 tip · 2 possible matches", "english plural");
  eq(live.caseProps(dog, { tips: 3 }, "de", now).detail, "3 Hinweise", "german");
  for (const [patch, why] of [[{ closed_at: "x" }, "closed"], [{ deleted_at: "x" }, "deleted"], [{ hidden_at: "x" }, "hidden"], [{ status: "EXPIRED" }, "expired"], [{ type: "FOUND" }, "found case"], [{ visible_until: "2026-11-24T11:00:00Z" }, "past visible_until"]]) {
    const ended = live.caseProps({ ...dog, ...patch }, {}, "no", now);
    ok(ended.ended && ended.detail === "Saken er avsluttet", `ends when ${why}`);
  }
  ok(live.caseProps({ ...dog, occurred_at: "2030-01-01T00:00:00Z" }, {}, "no", now).sinceMs === now, "a future date is not shown as the start");

  // refreshRow with a fake database and a fake sender.
  function fakeSupa(report, observations = []) {
    const updates = [];
    const api = {
      updates,
      from(table) {
        const q = { table, filters: {}, patch: null };
        const chain = {
          select() { return chain; },
          eq(k, v) { q.filters[k] = v; return chain; },
          not() { return chain; },
          limit() { return chain; },
          update(patch) { q.patch = patch; updates.push(q); return chain; },
          maybeSingle() { return Promise.resolve({ data: table === "reports" ? report : null, error: null }); },
          then(resolve) { return resolve({ data: table === "area_alert_observations" ? observations : [], error: null }); },
        };
        return chain;
      },
    };
    return api;
  }
  const sent = [];
  const deps = { loadReportMatches: async () => ({ matches: [] }), sendLiveActivity: async (token, payload, opts) => (sent.push({ token, payload, opts }), { ok: true, status: 200 }) };
  const row = { id: "row1", user_id: "u1", report_id: dog.id, push_token: "abcdef0123456789", language: "no", created_at: new Date(now - 60_000).toISOString(), last_props_hash: null, failures: 0 };
  const supa = fakeSupa(dog, [{ id: "o1", status: "NEW" }, { id: "o2", status: "REJECTED" }]);
  eq(await live.refreshRow(supa, row, { deps, now }), "SENT", "first push sent");
  const content = JSON.parse(sent[0].payload.aps["content-state"].props);
  eq(content.detail, "1 tips", "rejected tips are not counted");
  eq(sent[0].payload.aps.event, "update", "update event");
  const hash = supa.updates.find((u) => u.patch?.last_props_hash)?.patch.last_props_hash;
  eq(await live.refreshRow(supa, { ...row, last_props_hash: hash }, { deps, now }), "UNCHANGED", "same text is not pushed again");
  const closedSupa = fakeSupa({ ...dog, closed_at: "2026-11-24T11:00:00Z" });
  eq(await live.refreshRow(closedSupa, { ...row, last_props_hash: hash }, { deps, now }), "ENDED", "closed case ends the activity");
  eq(sent[sent.length - 1].payload.aps.event, "end", "end event");
  ok(closedSupa.updates.some((u) => u.patch?.status === "ENDED"), "row marked ended");
  eq(await live.refreshRow(supa, { ...row, created_at: new Date(now - live.MAX_AGE_MS - 1000).toISOString() }, { deps, now }), "TOO_OLD", "old activities are dropped");
  const deadDeps = { ...deps, sendLiveActivity: async () => ({ ok: false, status: 410, reason: "Unregistered" }) };
  const deadSupa = fakeSupa(dog);
  eq(await live.refreshRow(deadSupa, row, { deps: deadDeps, now }), "DEAD", "dead token ends the row");
  ok(deadSupa.updates.some((u) => u.patch?.status === "ENDED"), "dead row marked ended");
  eq(await live.refreshRow(supa, { ...row, push_token: null }, { deps, now }), "NO_TOKEN", "no token, no push");
  eq(await live.refreshUser(supa, "u1", { env: {} }), [], "refreshUser does nothing while off");

  // Wiring.
  const index = read("server/index.js");
  ok(/app\.use\("\/live-activities",liveRoutes\)/.test(index), "route mounted");
  ok(/scheduleLiveActivities\(\{ supa: supaAdmin/.test(index), "scheduler started");
  ok(/require\("\.\/liveActivities"\)\.nudgeUser\(userId\)/.test(read("server/lib/userNotify.js")), "notifications nudge the recount");
  const route = read("server/routes/liveActivities.js");
  ok(/LIVE_ACTIVITIES_OFF/.test(route) && /requireUser/.test(route), "route switched and signed in");
  ok(/LIVE_ACTIVITY_TAKEN/.test(route), "an activity id belongs to one user");
  ok(/"live_activity_tokens", "user_id", \["push_token"\]/.test(read("server/lib/privacyExport.js")), "privacy export without the device token");
  const sql = read("supabase/migrations/20261125100000_t1_9bt_live_activities.sql");
  ok(/enable row level security/.test(sql) && /revoke all on table public\.live_activity_tokens from anon, authenticated/.test(sql), "server only");
  ok(/references public\.reports\(id\) on delete cascade/.test(sql), "deleted case removes its rows");

  // Locales.
  const loc = (l) => JSON.parse(read(`server/locales/${l}.json`));
  const keys = (o) => Object.keys(o).filter((k) => k.startsWith("liveActivity.")).sort();
  eq(keys(loc("no")), keys(loc("en")), "server no/en keys");
  eq(keys(loc("de")), keys(loc("en")), "server de/en keys");
  const appKeys = (f) => [...new Set((read(f).match(/"(liveActivity|widget)\.[^"]+"/g) || []))].sort();
  eq(appKeys("src/i18n/locales/no.ts"), appKeys("src/i18n/locales/en.ts"), "app no/en keys");

  // App: guarded, and the widget runtime code has no own imports or app state.
  const la = read("src/lib/liveActivity.tsx");
  ok(/Platform\.OS !== "ios"/.test(la) && /try \{\s*factory = createLiveActivity/.test(la), "iOS only and guarded");
  ok(/liveActivitiesAvailable/.test(read("src/lib/casesWidget.tsx")), "widget follows the server switch");
  for (const f of ["src/lib/liveActivity.tsx", "src/lib/casesWidget.tsx"]) {
    const src = read(f);
    const start = src.indexOf('"widget";');
    ok(start > 0, `${f} has a widget function`);
    const body = src.slice(start, src.indexOf("\n};\n", start));
    ok(!/\bt\(|useI18n|useState|useEffect|await |API_BASE_URL|theme\./.test(body), `${f}: widget body uses only props and Expo UI`);
    ok(!/ as const|: string\b|<[A-Z][A-Za-z]*Props>/.test(body), `${f}: no TypeScript syntax inside the widget body`);
  }
  ok(/<LiveActivityCard reportId=\{String\(r\.id\)\} followable \/>/.test(read("app/report-details/[id].tsx")), "card on the case");
  ok(/updateCasesWidget\(value, t\)/.test(read("app/(tabs)/index.tsx")), "Home writes the widget");
  ok(/resumeCaseActivities\(language\)/.test(read("app/(tabs)/index.tsx")), "tokens resumed after restart");

  // app.json: plugin configured with push for Live Activities and one small widget.
  const plugins = JSON.parse(read("app.json")).expo.plugins;
  const wp = plugins.find((p) => Array.isArray(p) && p[0] === "expo-widgets");
  ok(wp, "expo-widgets plugin configured");
  eq(wp[1].enablePushNotifications, true, "Live Activity pushes");
  eq(wp[1].groupIdentifier, "group.com.kjfok.lostorfound", "app group");
  eq(wp[1].widgets.map((w) => w.name), ["LofCases"], "widget name matches createWidget");
  ok(/createWidget<CasesWidgetProps>\(WIDGET_NAME/.test(read("src/lib/casesWidget.tsx")) && /WIDGET_NAME = "LofCases"/.test(read("src/lib/casesWidget.tsx")), "same name in code");

  // Fixes from testing build 9.
  const map = read("app/(report)/map.tsx");
  ok(/circleEdges/.test(map) && /fitCircle\(selectedArea\.points\[0\], nextRadius\)/.test(map), "map fits the whole place when the radius changes");
  ok(/bottom: \(panelFolded \? 60 : panelHeight\) \+ 24/.test(map), "map keeps the place clear of the panel");
  ok(/setPanelFolded\(\(v\) => !v\)/.test(map) && /report\.map\.panel\.hide/.test(map), "panel can be folded");
  ok(/radiusDelta/.test(read("app/report-details/[id].tsx")), "case map shows the whole radius");
  const notif = read("server/routes/notifications.js");
  ok(/type\.startsWith\("RESOLUTION_"\)/.test(notif) && /matchTarget\.status === "CONFIRMED"/.test(notif), "close proposals and confirmed matches open the chat");
  ok(/type\.startsWith\("RESOLUTION_"\)/.test(read("src/lib/pushNotifications.ts")), "push for a close proposal opens the chat");
  ok(/THANKS_BLOCKING = new Set\(\["HARASSMENT", "HATE", "SEXUAL"\]\)/.test(read("server/routes/trust.js")), "a name in a thank-you card is allowed");

  // Notifications follow the app's language.
  const msgs = require(path.join(root, "server/lib/messages.js"));
  const pair = msgs.localizedPair("bonus.awarded.title", { points: 3 });
  eq(pair.__key, "bonus.awarded.title", "pair carries its key");
  eq(pair.__params, { points: 3 }, "pair carries its values");
  ok(!Object.keys(pair).includes("__key"), "the key does not show up as a language");
  eq(msgs.localizedStored("en", "push.resolutionProposed.title", null, "Forslag om å avslutte saken"), "Proposal to close the case", "stored Norwegian shown in English");
  eq(msgs.localizedStored("en", null, null, "Gammel tekst"), "Gammel tekst", "rows without a key keep their text");
  eq(msgs.localizedStored("en", "no.such.key", null, "Lagret"), "Lagret", "unknown key keeps the stored text");
  ok(/title_key: titleKey, body_key: bodyKey/.test(read("server/lib/userNotify.js")), "keys stored with the notification");
  ok(/insert\(row\)/.test(read("server/lib/userNotify.js")), "works before the migration");
  ok(/req\.query\.lang \? normalizeLanguage/.test(read("server/routes/notifications.js")), "list written in the asked language; older builds get stored text");
  ok(/notifications\?limit=80&lang=\$\{language\}/.test(read("app/notifications.tsx")), "app asks in its language");
  ok(/add column if not exists title_key text/.test(read("supabase/migrations/20261126100000_t1_9bt_notification_text_keys.sql")), "migration");

  console.log(`OK: T1.9BT ${n} checks`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
