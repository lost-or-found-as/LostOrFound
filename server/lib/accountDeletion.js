"use strict";
// T1.9AQ: one way to delete an account, used by the app (DELETE /account) and by the admin
// script for requests by e-mail (server/scripts/delete-account.js).
// Each case goes through the same deletion as "Slett sak"; a case with purchases is kept
// archived without contact details (bookkeeping). Rows not removed by the sign-in cascade are
// deleted here; then the sign-in itself is deleted.
const LEFTOVER_ROWS = Object.freeze([
  { table: "notifications", column: "user_id" },
  { table: "report_creation_events", column: "user_id" },
]);

class AccountDeletionError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/** Cases the account still owns (not deleted). */
async function ownedReports(supa, userId) {
  const { data, error } = await supa.from("reports").select("id").eq("user_id", userId).is("deleted_at", null);
  if (error) throw error;
  return data || [];
}

/**
 * Deletes the account. deps = { supa, deleteOwnedReport, log }.
 * Returns { deletedReports }. Throws AccountDeletionError("ACCOUNT_DELETE_FAILED") on failure;
 * nothing after a failed case is attempted, so a retry is safe.
 */
async function deleteAccount(userId, { supa, deleteOwnedReport, log = console }) {
  if (!userId) throw new AccountDeletionError("ACCOUNT_DELETE_FAILED", "no user id");
  const reports = await ownedReports(supa, userId);
  for (const r of reports) {
    const result = await deleteOwnedReport(r.id, userId);
    if (result.status !== 200 && result.status !== 404) {
      log.error(`[account] delete: report ${r.id} failed`, result.body?.error);
      throw new AccountDeletionError("ACCOUNT_DELETE_FAILED", `report ${r.id}`);
    }
  }
  for (const { table, column } of LEFTOVER_ROWS) {
    const del = await supa.from(table).delete().eq(column, userId);
    if (del.error) log.warn(`[account] delete: ${table} cleanup failed`, del.error.message);
  }
  // T1.9BV: Apple requires revoking Sign in with Apple when the account is deleted. Best effort:
  // a failure is logged, the deletion goes on.
  await require("./appleSignIn").revokeForUser(supa, userId, { log });
  const { error: authError } = await supa.auth.admin.deleteUser(userId);
  if (authError) {
    log.error("[account] delete: auth user failed", authError.message);
    throw new AccountDeletionError("ACCOUNT_DELETE_FAILED", "auth user");
  }
  log.log(`[account] deleted account ${userId} (${reports.length} report(s))`);
  return { deletedReports: reports.length };
}

/** Finds a sign-in by id or e-mail (case-insensitive). Returns the auth user or null. */
async function findAccount(supa, { email, userId }) {
  if (userId) {
    const { data, error } = await supa.auth.admin.getUserById(userId);
    if (error) throw error;
    return data?.user || null;
  }
  const wanted = String(email || "").trim().toLowerCase();
  if (!wanted) return null;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => String(u.email || "").toLowerCase() === wanted);
    if (hit) return hit;
    if (users.length < 1000) return null;
  }
  return null;
}

module.exports = { deleteAccount, ownedReports, findAccount, AccountDeletionError, LEFTOVER_ROWS };
