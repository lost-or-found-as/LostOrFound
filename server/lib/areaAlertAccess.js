"use strict";
const { supaAdmin } = require("../supabaseClient");

const IN_APP_ONLY = "IN_APP_ONLY";

/**
 * Decides whether a user may open an area-alert campaign.
 *
 * Access is granted when the user either
 *   - has at least one push recipient row for the campaign (push path), or
 *   - has the internal AREA_ALERT notification for the campaign (Nearby path).
 *
 * Both lookups use limit(1) so that users with several installations, and therefore
 * several recipient rows, never trigger a multiple-rows error.
 *
 * @returns {Promise<{ allowed: boolean, recipientStatus: string | null }>}
 */
async function getAreaAlertAccess(campaignId, userId) {
  const id = String(campaignId || "").trim();
  const uid = String(userId || "").trim();
  if (!id || !uid) return { allowed: false, recipientStatus: null };

  const { data: recipients, error: recipientError } = await supaAdmin
    .from("geo_alert_recipients")
    .select("status")
    .eq("campaign_id", id)
    .eq("user_id", uid)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (recipientError) throw recipientError;
  if (recipients && recipients.length) {
    return { allowed: true, recipientStatus: recipients[0].status || null };
  }

  const { data: notifications, error: notificationError } = await supaAdmin
    .from("notifications")
    .select("id")
    .eq("user_id", uid)
    .eq("type", "AREA_ALERT")
    .eq("entity_type", "area_alert_campaign")
    .eq("entity_id", id)
    .limit(1);
  if (notificationError) throw notificationError;
  if (notifications && notifications.length) {
    return { allowed: true, recipientStatus: IN_APP_ONLY };
  }

  return { allowed: false, recipientStatus: null };
}

module.exports = { getAreaAlertAccess, IN_APP_ONLY };
