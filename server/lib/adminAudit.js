"use strict";
// T1.9AO: a line in admin_access_audit each time an admin looks at or acts on someone's data
// (Informasjonssikkerhet i Lost or Found, ch. 4). Never fails the admin's request.
const { supaAdmin } = require("../supabaseClient");

async function logAdminAccess({ adminUserId = null, action, entityType, entityId = null, reason, caseReference = null, metadata = {} }) {
  try {
    const { error } = await supaAdmin.from("admin_access_audit").insert({
      admin_user_id: adminUserId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      reason,
      case_reference: caseReference,
      metadata,
    });
    if (error) throw error;
  } catch (e) {
    console.error("[admin-audit][write-failed]", { action, errorMessage: e?.message || String(e) });
  }
}

module.exports = { logAdminAccess };
