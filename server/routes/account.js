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
    if (error || !guest) return res.status(400).json({ error: "GUEST_TOKEN_INVALID" });
    if (!isAnonymousUser(guest)) return res.status(400).json({ error: "NOT_A_GUEST_SESSION" });
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

module.exports = router;
