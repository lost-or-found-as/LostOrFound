// server/routes/account.js
"use strict";

// T1.9A: a guest may only submit found reports. When the same phone later signs in
// (new or existing account), the app sends the guest session's access token here and
// the guest's reports are moved to the registered account.

const { Router } = require("express");
const { supaAdmin } = require("../supabaseClient");
const { requireUser, isAnonymousUser } = require("../mw/auth");

const router = Router();

// Tables where a guest's own rows are keyed by user id (guests cannot create anything else).
const OWNED_ROWS = [
  { table: "reports", column: "user_id" },
  { table: "report_images", column: "created_by" },
  { table: "report_creation_events", column: "user_id" },
  { table: "report_edits", column: "user_id" },
];

// POST /account/claim-guest-reports  body: { guestAccessToken }
router.post("/claim-guest-reports", requireUser, async (req, res) => {
  try {
    const guestAccessToken = String(req.body?.guestAccessToken || "").trim();
    if (!guestAccessToken) return res.status(400).json({ error: "GUEST_TOKEN_REQUIRED" });

    const { data, error } = await supaAdmin.auth.getUser(guestAccessToken);
    const guest = data?.user;
    if (error || !guest) {
      console.warn(`[account] claim refused for ${req.user.id}: GUEST_TOKEN_INVALID (${error?.message ?? "no user"})`);
      return res.status(400).json({ error: "GUEST_TOKEN_INVALID" });
    }
    if (!isAnonymousUser(guest)) {
      console.warn(`[account] claim refused for ${req.user.id}: NOT_A_GUEST_SESSION`);
      return res.status(400).json({ error: "NOT_A_GUEST_SESSION" });
    }
    if (guest.id === req.user.id) return res.json({ moved: 0 });

    let moved = 0;
    for (const { table, column } of OWNED_ROWS) {
      const { data: rows, error: updErr } = await supaAdmin
        .from(table)
        .update({ [column]: req.user.id })
        .eq(column, guest.id)
        .select("id");
      if (updErr) {
        console.error(`[account] claim ${table} failed`, updErr.message);
        return res.status(500).json({ error: "GUEST_CLAIM_FAILED" });
      }
      if (table === "reports") moved = (rows || []).length;
    }

    console.log(`[account] claimed ${moved} guest report(s) for ${req.user.id}`);
    return res.json({ moved });
  } catch (e) {
    console.error("[account] claim error", e?.message ?? e);
    return res.status(500).json({ error: "GUEST_CLAIM_FAILED" });
  }
});

// T1.9P: delete the account and everything tied to it (Apple and Google require this in the app).
// Each report goes through the same deletion as "Slett sak"; a report with purchases is kept
// archived without contact details (bookkeeping). Rows not removed by the auth cascade are
// deleted here; then the sign-in itself is deleted.
const LEFTOVER_ROWS = [
  { table: "notifications", column: "user_id" },
  { table: "report_creation_events", column: "user_id" },
];

// DELETE /account   (registered accounts; a guest has no sign-in to delete beyond its found reports)
router.delete("/", requireUser, async (req, res) => {
  const userId = req.user.id;
  try {
    const { deleteOwnedReport } = require("./reports");
    const { data: reports, error } = await supaAdmin.from("reports").select("id").eq("user_id", userId).is("deleted_at", null);
    if (error) throw error;
    for (const r of reports || []) {
      const result = await deleteOwnedReport(r.id, userId);
      if (result.status !== 200 && result.status !== 404) {
        console.error(`[account] delete: report ${r.id} failed`, result.body?.error);
        return res.status(500).json({ error: "ACCOUNT_DELETE_FAILED" });
      }
    }
    for (const { table, column } of LEFTOVER_ROWS) {
      const del = await supaAdmin.from(table).delete().eq(column, userId);
      if (del.error) console.warn(`[account] delete: ${table} cleanup failed`, del.error.message);
    }
    const { error: authError } = await supaAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[account] delete: auth user failed", authError.message);
      return res.status(500).json({ error: "ACCOUNT_DELETE_FAILED" });
    }
    console.log(`[account] deleted account ${userId} (${(reports || []).length} report(s))`);
    return res.json({ ok: true, deletedReports: (reports || []).length });
  } catch (e) {
    console.error("[account] delete error", e?.message ?? e);
    return res.status(500).json({ error: "ACCOUNT_DELETE_FAILED" });
  }
});

module.exports = router;
