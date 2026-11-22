"use strict";
// T1.9BN: «I nærheten» only lists cases people can still help with. A nearby notice whose case
// is solved, closed or deleted is left out of the list and the unread count.

function isNearbyNotice(n) {
  const type = String(n?.type || "").toUpperCase();
  return type === "AREA_ALERT" || type === "GEO_ALERT" || String(n?.entity_type || "").toLowerCase() === "area_alert_campaign";
}

function reportGone(r) {
  return !r || !!r.deleted_at || String(r.status || "").toUpperCase() === "CLOSED" || !!r.closed_at;
}

/**
 * Returns the ids of nearby notices that point at a case that is gone.
 * campaigns: [{ id, report_id }], reports: [{ id, status, closed_at, deleted_at }].
 */
function closedNearbyIds(notifications, campaigns, reports) {
  const reportById = new Map((reports || []).map((r) => [r.id, r]));
  const reportByCampaign = new Map((campaigns || []).map((c) => [c.id, c.report_id]));
  const out = new Set();
  for (const n of notifications || []) {
    if (!isNearbyNotice(n)) continue;
    if (!reportByCampaign.has(n.entity_id)) continue; // unknown campaign: leave it to the normal checks
    const reportId = reportByCampaign.get(n.entity_id);
    if (!reportId || reportGone(reportById.get(reportId))) out.add(n.id);
  }
  return out;
}

/** Loads campaigns and cases for the nearby notices and returns the ids to hide. */
async function loadClosedNearbyIds(supa, notifications) {
  const campaignIds = [...new Set((notifications || []).filter(isNearbyNotice).map((n) => n.entity_id).filter(Boolean))];
  if (!campaignIds.length) return new Set();
  const c = await supa.from("geo_alert_campaigns").select("id,report_id").in("id", campaignIds);
  if (c.error) throw c.error;
  const reportIds = [...new Set((c.data || []).map((x) => x.report_id).filter(Boolean))];
  let reports = [];
  if (reportIds.length) {
    const r = await supa.from("reports").select("id,status,closed_at,deleted_at").in("id", reportIds);
    if (r.error) throw r.error;
    reports = r.data || [];
  }
  return closedNearbyIds(notifications, c.data || [], reports);
}

module.exports = { isNearbyNotice, reportGone, closedNearbyIds, loadClosedNearbyIds };
