"use strict";
// T1.9T: keeps area-alert push down for the people who receive them.
//   - at most 3 area-alert pushes per person per 24 hours (from any case)
//   - never the same case twice to one person within 7 days
// A person over the cap still sees the alert in "I nærheten"; only the push is skipped.

const DAILY_PUSH_CAP = 3;
const SAME_CASE_DAYS = 7;
const SENT_STATUSES = ["QUEUED", "TICKET_OK", "DELIVERED"];

/**
 * candidates: push installations (several per person possible).
 * recentCampaignsByUser: Map user -> Set of campaign ids pushed to them in the last 24 hours.
 * sameCaseUsers: Set of users who got a push about this case in the last 7 days.
 * Returns { send, skipped }; a person's installations are always decided together.
 */
function applyRecipientCaps(candidates, recentCampaignsByUser, sameCaseUsers, cap = DAILY_PUSH_CAP) {
  const send = [];
  const skipped = [];
  const decided = new Map();
  for (const c of candidates || []) {
    const user = c.recipient_user_id;
    if (!decided.has(user)) {
      const recent = recentCampaignsByUser.get(user)?.size || 0;
      decided.set(user, sameCaseUsers.has(user) ? "SAME_CASE" : recent >= cap ? "DAILY_CAP" : null);
    }
    const reason = decided.get(user);
    if (reason) skipped.push({ ...c, skipReason: reason });
    else send.push(c);
  }
  return { send, skipped };
}

module.exports = { DAILY_PUSH_CAP, SAME_CASE_DAYS, SENT_STATUSES, applyRecipientCaps };
