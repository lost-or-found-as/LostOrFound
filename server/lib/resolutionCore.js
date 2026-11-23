"use strict";
// T1.9BP: shared by resolutions (both confirm) and the handover code (the helper types the
// owner's code). Who the two parties are, and what happens when a case is solved.
const { supaAdmin } = require("../supabaseClient");
const { awardSafely } = require("./helperBonus");

/**
 * MATCH: a = owner of the lost case, b = the finder. OBSERVATION: a = observer, b = case owner.
 */
async function parties(kind,id){

 if(kind==="OBSERVATION"){const q=await supaAdmin.from("area_alert_observations").select("id,report_id,observer_user_id,report_owner_user_id,campaign_id,observation_type").eq("id",id).maybeSingle();if(q.error)throw q.error;return q.data?{a:q.data.observer_user_id,b:q.data.report_owner_user_id,reportIds:[q.data.report_id],observation:q.data}:null;}
 const q=await supaAdmin.from("matches").select("id,lost_id,found_id,lost:lost_id(user_id),found:found_id(user_id)").eq("id",id).maybeSingle();if(q.error)throw q.error;return q.data?{a:q.data.lost?.user_id,b:q.data.found?.user_id,reportIds:[q.data.lost_id,q.data.found_id]}:null;
}

/** The owner (the person who lost something) and the helper of a context. */
function ownerAndHelper(kind, p) {
  if (!p) return null;
  return kind === "OBSERVATION" ? { owner: p.b, helper: p.a } : { owner: p.a, helper: p.b };
}

/** Whether a handover makes sense: a match, or an observation where someone has the item. */
function canHandOver(kind, p) {
  if (kind === "MATCH") return true;
  return String(p?.observation?.observation_type || "").toUpperCase() === "FOUND";
}

/** Closes the cases, ends paid reach, marks the observation, and gives the helper the bonus. */
async function closeAndAward(kind, id, p, now = new Date().toISOString()) {
  for (const rid of p.reportIds.filter(Boolean)) {
    await supaAdmin.from("reports").update({ status: "CLOSED", closed_at: now }).eq("id", rid).is("deleted_at", null);
    await supaAdmin.from("geo_alert_campaigns").update({ status: "COMPLETED", completed_at: now, updated_at: now }).eq("report_id", rid).eq("status", "ACTIVE");
    await supaAdmin
      .from("report_entitlements")
      .update({ status: "CANCELLED", cancelled_at: now, updated_at: now })
      .eq("report_id", rid)
      .eq("status", "ACTIVE")
      .or("product_code.like.GEO_ALERT_TIER_*,product_code.like.AREA_VISIBILITY_TIER_*");
  }
  if (kind === "OBSERVATION") await supaAdmin.from("area_alert_observations").update({ status: "CONFIRMED", updated_at: now }).eq("id", id);
  // T1.9AS: a return gives the finder 15 bonus; a sighting that solved it gives the observer 5.
  if (kind === "MATCH")
    void awardSafely({ userId: p.b, event: "RETURN_CONFIRMED", sourceType: "match", sourceId: id, reportId: p.reportIds[1] || null, counterpartUserId: p.a, caseReportId: p.reportIds[0] }, { supa: supaAdmin });
  // T1.9BK: someone who found it from an area alert and gave it back has made a return (15), not a sighting (5).
  else
    void awardSafely(
      {
        userId: p.a,
        event: String(p.observation?.observation_type || "").toUpperCase() === "FOUND" ? "RETURN_CONFIRMED" : "SIGHTING_RESOLVED",
        sourceType: "observation",
        sourceId: id,
        reportId: p.reportIds[0] || null,
        counterpartUserId: p.b,
        caseReportId: p.reportIds[0],
      },
      { supa: supaAdmin },
    );
}

module.exports = { parties, ownerAndHelper, canHandOver, closeAndAward };
