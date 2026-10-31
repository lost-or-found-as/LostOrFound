"use strict";
// T1.9M: report and block in chat.
//   GET    /safety/state/:kind/:id    chat state for the signed-in user (kind: match | observation)
//   POST   /safety/block/:kind/:id    block the other person in this chat
//   DELETE /safety/block/:kind/:id    lift your block
//   POST   /safety/report/:kind/:id   report the chat { reason, details?, block? }
// Admin (user ids in ADMIN_USER_IDS):
//   GET    /safety/admin/me                    { isAdmin }
//   GET    /safety/admin/reports?status=open|handled
//   POST   /safety/admin/reports/:id/resolve   { action: "NO_ACTION" | "SUSPEND" }
//   POST   /safety/admin/users/:userId/restore lift a suspension; open reports become NO_ACTION
const express = require("express");
const router = express.Router();
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { isAdmin, normalizeReport, snapshotMessages, shouldAutoSuspend, AUTO_SUSPEND_WINDOW_DAYS } = require("../lib/chatSafety");
const { chatParties, otherParty, loadChatState, chatMessages, activeSuspensions } = require("../lib/chatSafetyStore");
const { notifyAdmins } = require("../lib/adminAlert");

const DAY_MS = 24 * 60 * 60 * 1000;
const fail = (res, e, code) => res.status(500).json({ error: e?.message || code });

async function partiesForUser(req, res) {
  const parties = await chatParties(req.params.kind, req.params.id);
  const other = otherParty(parties, req.user.id);
  if (!other) {
    res.status(404).json({ error: "CHAT_NOT_FOUND" });
    return null;
  }
  return { parties, other };
}

router.get("/state/:kind/:id", requireUser, async (req, res) => {
  try {
    const found = await partiesForUser(req, res);
    if (!found) return;
    return res.json({ ok: true, state: await loadChatState(req.user.id, found.other) });
  } catch (e) {
    return fail(res, e, "CHAT_STATE_FAILED");
  }
});

async function block(blocker, blocked) {
  const q = await supaAdmin
    .from("user_blocks")
    .upsert({ blocker_id: blocker, blocked_id: blocked }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
  if (q.error) throw q.error;
}

router.post("/block/:kind/:id", requireUser, async (req, res) => {
  try {
    const found = await partiesForUser(req, res);
    if (!found) return;
    await block(req.user.id, found.other);
    return res.json({ ok: true, state: await loadChatState(req.user.id, found.other) });
  } catch (e) {
    return fail(res, e, "BLOCK_FAILED");
  }
});

router.delete("/block/:kind/:id", requireUser, async (req, res) => {
  try {
    const found = await partiesForUser(req, res);
    if (!found) return;
    const q = await supaAdmin.from("user_blocks").delete().eq("blocker_id", req.user.id).eq("blocked_id", found.other);
    if (q.error) throw q.error;
    return res.json({ ok: true, state: await loadChatState(req.user.id, found.other) });
  } catch (e) {
    return fail(res, e, "UNBLOCK_FAILED");
  }
});

async function suspendIfReportedByMany(userId) {
  const since = new Date(Date.now() - AUTO_SUSPEND_WINDOW_DAYS * DAY_MS).toISOString();
  const open = await supaAdmin
    .from("chat_reports")
    .select("reporter_id,status,created_at")
    .eq("reported_user_id", userId)
    .eq("status", "OPEN")
    .gte("created_at", since);
  if (open.error) throw open.error;
  if (!shouldAutoSuspend(open.data || [])) return false;
  if ((await activeSuspensions([userId])).length) return false;
  const now = new Date().toISOString();
  const up = await supaAdmin.from("account_suspensions").upsert(
    { user_id: userId, status: "ACTIVE", reason: "AUTO_REPORTS", created_at: now, updated_at: now, lifted_at: null, lifted_by: null },
    { onConflict: "user_id" },
  );
  if (up.error) throw up.error;
  return true;
}

router.post("/report/:kind/:id", requireUser, async (req, res) => {
  try {
    const input = normalizeReport(req.body);
    if (!input.ok) return res.status(400).json({ error: input.error });
    const found = await partiesForUser(req, res);
    if (!found) return;
    const { parties, other } = found;
    const ins = await supaAdmin
      .from("chat_reports")
      .insert({
        context_type: parties.type,
        context_id: parties.id,
        reporter_id: req.user.id,
        reported_user_id: other,
        reason: input.value.reason,
        details: input.value.details,
        message_snapshot: snapshotMessages(await chatMessages(parties), req.user.id),
      })
      .select("id")
      .single();
    if (ins.error) {
      if (ins.error.code === "23505") return res.status(409).json({ error: "REPORT_ALREADY_OPEN" });
      throw ins.error;
    }
    if (input.value.block) await block(req.user.id, other);
    const autoSuspended = await suspendIfReportedByMany(other);
    await notifyAdmins({ reportId: ins.data.id, reason: input.value.reason, details: input.value.details, autoSuspended });
    return res.json({ ok: true, reportId: ins.data.id, state: await loadChatState(req.user.id, other) });
  } catch (e) {
    return fail(res, e, "REPORT_FAILED");
  }
});

// ---- Admin -----------------------------------------------------------------

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user?.id)) return res.status(403).json({ error: "NOT_ADMIN" });
  next();
}

router.get("/admin/me", requireUser, (req, res) => res.json({ isAdmin: isAdmin(req.user.id) }));

router.get("/admin/reports", requireUser, requireAdmin, async (req, res) => {
  try {
    const handled = String(req.query.status || "open").toLowerCase() === "handled";
    let q = supaAdmin
      .from("chat_reports")
      .select("id,context_type,context_id,reporter_id,reported_user_id,reason,details,message_snapshot,status,created_at,handled_at")
      .order("created_at", { ascending: false })
      .limit(100);
    q = handled ? q.neq("status", "OPEN") : q.eq("status", "OPEN");
    const { data, error } = await q;
    if (error) throw error;
    const reports = data || [];
    const reported = [...new Set(reports.map((r) => r.reported_user_id))];
    const [all, blocks, suspended] = reported.length
      ? await Promise.all([
          supaAdmin.from("chat_reports").select("reported_user_id").in("reported_user_id", reported),
          supaAdmin.from("user_blocks").select("blocked_id").in("blocked_id", reported),
          activeSuspensions(reported),
        ])
      : [{ data: [] }, { data: [] }, []];
    const count = (rows, key, id) => (rows?.data || []).filter((r) => r[key] === id).length;
    const out = [];
    for (const r of reports) {
      const parties = await chatParties(r.context_type.toLowerCase(), r.context_id).catch(() => null);
      out.push({
        ...r,
        reporterRole: parties?.roles?.[r.reporter_id] ?? null,
        item: parties?.item ? { ...parties.item, user_id: undefined } : null,
        reportedTotals: {
          reports: count(all, "reported_user_id", r.reported_user_id),
          blockedBy: count(blocks, "blocked_id", r.reported_user_id),
          suspended: suspended.includes(r.reported_user_id),
        },
      });
    }
    return res.json({ ok: true, reports: out });
  } catch (e) {
    return fail(res, e, "ADMIN_REPORTS_FAILED");
  }
});

router.post("/admin/reports/:id/resolve", requireUser, requireAdmin, async (req, res) => {
  try {
    const action = String(req.body?.action || "").toUpperCase();
    if (action !== "NO_ACTION" && action !== "SUSPEND") return res.status(400).json({ error: "INVALID_ACTION" });
    const q = await supaAdmin.from("chat_reports").select("id,reported_user_id").eq("id", req.params.id).maybeSingle();
    if (q.error) throw q.error;
    if (!q.data) return res.status(404).json({ error: "REPORT_NOT_FOUND" });
    const now = new Date().toISOString();
    if (action === "SUSPEND") {
      const up = await supaAdmin.from("account_suspensions").upsert(
        { user_id: q.data.reported_user_id, status: "ACTIVE", reason: "ADMIN", updated_at: now, lifted_at: null, lifted_by: null },
        { onConflict: "user_id" },
      );
      if (up.error) throw up.error;
    }
    const upd = await supaAdmin
      .from("chat_reports")
      .update({ status: action === "SUSPEND" ? "ACTION_TAKEN" : "NO_ACTION", handled_at: now, handled_by: req.user.id })
      .eq("id", q.data.id);
    if (upd.error) throw upd.error;
    return res.json({ ok: true });
  } catch (e) {
    return fail(res, e, "ADMIN_RESOLVE_FAILED");
  }
});

router.post("/admin/users/:userId/restore", requireUser, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const now = new Date().toISOString();
    const up = await supaAdmin
      .from("account_suspensions")
      .update({ status: "LIFTED", updated_at: now, lifted_at: now, lifted_by: req.user.id })
      .eq("user_id", userId)
      .eq("status", "ACTIVE");
    if (up.error) throw up.error;
    // The open reports were judged together with the restore, so they do not suspend the account again.
    const upd = await supaAdmin
      .from("chat_reports")
      .update({ status: "NO_ACTION", handled_at: now, handled_by: req.user.id })
      .eq("reported_user_id", userId)
      .eq("status", "OPEN");
    if (upd.error) throw upd.error;
    return res.json({ ok: true });
  } catch (e) {
    return fail(res, e, "ADMIN_RESTORE_FAILED");
  }
});

module.exports = router;
