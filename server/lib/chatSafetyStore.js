"use strict";
// T1.9M: database access for report and block in chat (backend only; service role).
const { supaAdmin } = require("../supabaseClient");
const { chatState, contextType } = require("./chatSafety");

const ITEM_FIELDS = "id,user_id,type,category,subcategory_key,subcategory_custom,title,color,secondary_color,brand";

/**
 * The two people in a chat and the case it is about.
 * kind "match": owner of the lost report and of the found report.
 * kind "observation": owner of the report and the person who sent the observation.
 */
async function chatParties(kind, id) {
  const type = contextType(kind);
  if (!type || !id) return null;
  if (type === "MATCH") {
    const q = await supaAdmin
      .from("matches")
      .select(`id,lost:lost_id(${ITEM_FIELDS}),found:found_id(user_id)`)
      .eq("id", id)
      .maybeSingle();
    if (q.error) throw q.error;
    const owner = q.data?.lost?.user_id;
    const finder = q.data?.found?.user_id;
    if (!owner || !finder) return null;
    return { type, id, roles: { [owner]: "OWNER", [finder]: "FINDER" }, users: [owner, finder], item: q.data.lost };
  }
  const q = await supaAdmin
    .from("area_alert_observations")
    .select("id,report_id,observer_user_id,report_owner_user_id")
    .eq("id", id)
    .maybeSingle();
  if (q.error) throw q.error;
  const owner = q.data?.report_owner_user_id;
  const observer = q.data?.observer_user_id;
  if (!owner || !observer) return null;
  const report = await supaAdmin.from("reports").select(ITEM_FIELDS).eq("id", q.data.report_id).maybeSingle();
  return { type, id, roles: { [owner]: "OWNER", [observer]: "OBSERVER" }, users: [owner, observer], item: report.data || null };
}

function otherParty(parties, userId) {
  if (!parties || !parties.users.includes(userId)) return null;
  return parties.users.find((u) => u !== userId) || null;
}

async function activeSuspensions(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const q = await supaAdmin.from("account_suspensions").select("user_id").in("user_id", ids).eq("status", "ACTIVE");
  if (q.error) throw q.error;
  return (q.data || []).map((r) => r.user_id);
}

async function isSuspended(userId) {
  return (await activeSuspensions([userId])).length > 0;
}

async function loadChatState(me, other) {
  const blocks = await supaAdmin
    .from("user_blocks")
    .select("blocker_id,blocked_id")
    .or(`and(blocker_id.eq.${me},blocked_id.eq.${other}),and(blocker_id.eq.${other},blocked_id.eq.${me})`);
  if (blocks.error) throw blocks.error;
  return chatState({ me, other, blocks: blocks.data || [], suspendedUserIds: await activeSuspensions([me, other]) });
}

async function isChatClosed(me, other) {
  return (await loadChatState(me, other)).closed;
}

/** All messages of a chat, oldest first (for the evidence copy in a report). */
async function chatMessages(parties) {
  if (parties.type === "MATCH") {
    const q = await supaAdmin
      .from("messages")
      .select("sender_id,body,created_at")
      .eq("conversation_id", parties.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (q.error) throw q.error;
    return q.data || [];
  }
  const conv = await supaAdmin.from("observation_conversations").select("id").eq("observation_id", parties.id).maybeSingle();
  if (conv.error) throw conv.error;
  if (!conv.data) return [];
  const q = await supaAdmin
    .from("observation_messages")
    .select("sender_id,body,created_at")
    .eq("conversation_id", conv.data.id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (q.error) throw q.error;
  return q.data || [];
}

module.exports = { chatParties, otherParty, isSuspended, activeSuspensions, loadChatState, isChatClosed, chatMessages, ITEM_FIELDS };
