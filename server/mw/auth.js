// C:\RN\RepairLostOrFound\server\mw\auth.js
"use strict";

const { supaAdmin } = require("../supabaseClient");

// T1.9A: a guest is an anonymous Supabase session. Guests may only submit a found report.
function isAnonymousUser(user) {
  if (!user) return false;
  return (
    user.is_anonymous === true ||
    user.isAnonymous === true ||
    user.app_metadata?.provider === "anonymous" ||
    user.user_metadata?.is_anonymous === true
  );
}

function authenticate({ allowGuest }) {
  return async function authMiddleware(req, res, next) {
    try {
      const auth = req.header("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      if (!token) return res.status(401).json({ error: "Missing bearer token" });

      const { data, error } = await supaAdmin.auth.getUser(token);
      if (error || !data?.user) return res.status(401).json({ error: "Invalid token" });

      const guest = isAnonymousUser(data.user);
      if (guest && !allowGuest) {
        return res.status(403).json({ error: "GUEST_NOT_ALLOWED" });
      }

      req.user = data.user;
      req.isGuest = guest;
      next();
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
}

// Default for every route: registered users only.
const requireUser = authenticate({ allowGuest: false });
// Only for the found-report submission flow (create report, upload its images, place lookup).
const requireUserOrGuest = authenticate({ allowGuest: true });

module.exports = { requireUser, requireUserOrGuest, isAnonymousUser };
