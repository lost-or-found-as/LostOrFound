"use strict";
// T1.9BI: once someone has been in touch about a lost case (a confirmed match, or a sighting or
// find reported from an area alert), the finder's reward can be raised but not lowered or removed.
// The reward is an agreement between the two people, but the app should not make it easy to
// promise money, get a tip and take the promise back. Every change is kept in report_edits.

const CONTACT_MATCH_STATUSES = ["CONFIRMED", "PAID"];

/** True when a change would lower a reward that is locked. */
function lowersLockedReward(existingOre, nextOre, locked) {
  if (!locked) return false;
  return Math.max(0, Number(nextOre) || 0) < Math.max(0, Number(existingOre) || 0);
}

/** Has anyone been in touch about this case? */
async function hasContact(supa, reportId) {
  const [lost, found, observations] = await Promise.all([
    supa.from("matches").select("id", { count: "exact", head: true }).eq("lost_id", reportId).in("status", CONTACT_MATCH_STATUSES),
    supa.from("matches").select("id", { count: "exact", head: true }).eq("found_id", reportId).in("status", CONTACT_MATCH_STATUSES),
    supa.from("area_alert_observations").select("id", { count: "exact", head: true }).eq("report_id", reportId),
  ]);
  for (const r of [lost, found, observations]) if (r.error) throw r.error;
  return (lost.count || 0) + (found.count || 0) + (observations.count || 0) > 0;
}

module.exports = { CONTACT_MATCH_STATUSES, lowersLockedReward, hasContact };
