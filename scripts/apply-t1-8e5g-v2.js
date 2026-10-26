"use strict";
const fs = require("fs");
const path = require("path");
const root = process.cwd();
function read(p){const x=path.join(root,p);if(!fs.existsSync(x))throw new Error(`MISSING_FILE: ${p}`);return fs.readFileSync(x,"utf8");}
function write(p,s){fs.writeFileSync(path.join(root,p),s,"utf8");console.log("OK:",p);}
function replaceOnce(source, pattern, replacement, label) {
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);

  const matches = [...source.matchAll(globalPattern)];

  if (matches.length !== 1) {
    throw new Error(
      `${label}: expected 1 match, got ${matches.length}`,
    );
  }

  return source.replace(pattern, replacement);
}

const dispatchPath="server/lib/geoAlertDispatch.js";
let dispatch=read(dispatchPath);
if(!dispatch.includes('"geo_alert_eligible_users"')){
  const anchor=/  const \{ data: candidates, error: candidateError \} = await supaAdmin\.rpc\(\s*\n\s*"geo_alert_eligible_installations",/m;
  const block=`  const { data: eligibleUsers, error: eligibleUsersError } = await supaAdmin.rpc(\n    "geo_alert_eligible_users",\n    { p_campaign_id: id },\n  );\n  if (eligibleUsersError) throw eligibleUsersError;\n\n  for (const candidate of eligibleUsers || []) {\n    const notificationKey = \`AREA_ALERT:\${id}:\${candidate.recipient_user_id}\`;\n    const { error: notificationError } = await supaAdmin\n      .from("notifications")\n      .insert({\n        user_id: candidate.recipient_user_id,\n        type: "AREA_ALERT",\n        entity_type: "area_alert_campaign",\n        entity_id: id,\n        title: "AREA_ALERT",\n        body: candidate.report_title || "AREA_ALERT",\n        notification_key: notificationKey,\n        agg_count: 1,\n      });\n    if (notificationError && notificationError.code !== "23505") throw notificationError;\n  }\n\n  const { data: candidates, error: candidateError } = await supaAdmin.rpc(\n    "geo_alert_eligible_installations",`;
  dispatch=replaceOnce(dispatch,anchor,block,"eligible user insertion");
}
// Remove the old accepted-installation-bound in-app notification block by stable comments/anchors.
const oldStart=dispatch.indexOf("  // One persistent in-app inbox entry per recipient user");
if(oldStart>=0){
  const oldEnd=dispatch.indexOf("  const notificationKey = `AREA_ALERT:${id}`;",oldStart);
  if(oldEnd<0)throw new Error("OLD_NOTIFICATION_BLOCK_END_NOT_FOUND");
  dispatch=dispatch.slice(0,oldStart)+dispatch.slice(oldEnd);
}
dispatch=dispatch.replace(/eligible: \(candidates \|\| \[\]\)\.length,/g,'eligible: (eligibleUsers || []).length,\n      pushEligible: (candidates || []).length,');
// The final return has a different indentation; normalize repeated indentation safely.
dispatch=dispatch.replace(/\n\s{6}pushEligible: \(candidates \|\| \[\]\)\.length,\n\s{4}sent: accepted\.length,/,'\n    pushEligible: (candidates || []).length,\n    sent: accepted.length,');
// Fix pre-existing diagnostic references so dispatch cannot throw after successful sends.
dispatch=dispatch.replace(/candidates: candidates\.length,\s*\n\s*sent,\s*\n\s*skippedAsDuplicate,\s*\n\s*failed,/g,'candidates: (candidates || []).length,\n    sent: accepted.length,\n    skippedAsDuplicate: (candidates || []).length - accepted.length,\n    failed: tickets.filter((ticket) => ticket?.status !== "ok").length,');
dispatch=dispatch.replace(/result: \{ sent, skippedAsDuplicate, failed \},/g,'result: {\n      sent: accepted.length,\n      skippedAsDuplicate: (candidates || []).length - accepted.length,\n      failed: tickets.filter((ticket) => ticket?.status !== "ok").length,\n    },');
write(dispatchPath,dispatch);

const deliveryPath="server/routes/geoAlertDelivery.js";
let delivery=read(deliveryPath);
if(!delivery.includes("AREA_ALERT_NOTIFICATION_ACCESS")){
  delivery=replaceOnce(delivery,/    if \(recipientError\) throw recipientError;\s*\n    if \(!recipient\) return res\.status\(404\)\.json\(\{ error: "AREA_ALERT_NOT_AVAILABLE" \}\);/m,`    if (recipientError) throw recipientError;\n    let notificationAccess = false;\n    if (!recipient) {\n      const { data: notification, error: notificationError } = await supaAdmin\n        .from("notifications")\n        .select("id")\n        .eq("user_id", req.user.id)\n        .eq("type", "AREA_ALERT")\n        .eq("entity_type", "area_alert_campaign")\n        .eq("entity_id", campaignId)\n        .maybeSingle();\n      if (notificationError) throw notificationError;\n      notificationAccess = Boolean(notification);\n      console.info("[geo-alert][AREA_ALERT_NOTIFICATION_ACCESS]", { campaignId, userId: req.user.id, notificationAccess });\n      if (!notificationAccess) return res.status(404).json({ error: "AREA_ALERT_NOT_AVAILABLE" });\n    }`,"delivery notification access");
  delivery=delivery.replace("recipientStatus: recipient.status",'recipientStatus: recipient?.status || "IN_APP_ONLY"');
}
write(deliveryPath,delivery);

const notificationsPath="server/routes/notifications.js";
let notifications=read(notificationsPath);
if(!notifications.includes("AREA_ALERT_IN_APP_ACCESS")){
  const fnStart=notifications.indexOf("async function userCanAccessAreaAlert");
  const fnEnd=notifications.indexOf("async function userCanAccessObservation",fnStart);
  if(fnStart<0||fnEnd<0)throw new Error("AREA_ALERT_ACCESS_FUNCTION_NOT_FOUND");
  let fn=notifications.slice(fnStart,fnEnd);
  fn=replaceOnce(fn,/  if \(recipientError\) throw recipientError;\s*\n  if \(!recipient\) return null;/m,`  if (recipientError) throw recipientError;\n  if (!recipient) {\n    const { data: notification, error: notificationError } = await supaAdmin\n      .from("notifications")\n      .select("id")\n      .eq("user_id", userId)\n      .eq("type", "AREA_ALERT")\n      .eq("entity_type", "area_alert_campaign")\n      .eq("entity_id", campaignId)\n      .maybeSingle();\n    if (notificationError) throw notificationError;\n    if (!notification) return null;\n    console.info("[geo-alert][AREA_ALERT_IN_APP_ACCESS]", { campaignId, userId });\n  }`,"notification target access");
  notifications=notifications.slice(0,fnStart)+fn+notifications.slice(fnEnd);
}
write(notificationsPath,notifications);
console.log("OK: Applied T1.8E.5G v2 Nearby independence from push installation.");
