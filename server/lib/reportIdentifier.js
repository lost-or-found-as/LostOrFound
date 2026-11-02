"use strict";
// T1.9V: an optional private identifier on a report (frame number, serial number, IMEI, chip
// number). It is never sent to the other party; the database only uses it to find matches.
const IDENTIFIER_KINDS = Object.freeze(["FRAME_NUMBER", "SERIAL_NUMBER", "IMEI", "CHIP_NUMBER", "OTHER"]);
const MIN_LENGTH = 4;
const MAX_LENGTH = 40;

function invalid() {
  const error = new Error("INVALID_IDENTIFIER");
  error.code = "INVALID_IDENTIFIER";
  return error;
}

/** Letters and digits only, upper case: "wtu 123-c" -> "WTU123C". */
function normalizeIdentifierValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^0-9A-ZÆØÅÄÖÜ]/g, "");
}

/**
 * { kind, value } as stored, null when nothing was given (clears the identifier on edit).
 * Throws INVALID_IDENTIFIER for an unknown kind or a value that is too short or too long.
 */
function normalizeIdentifier(input) {
  if (input == null || input === "") return null;
  if (typeof input !== "object") throw invalid();
  const raw = String(input.value ?? "").trim();
  if (!raw) return null;
  const kind = String(input.kind ?? "OTHER").trim().toUpperCase();
  if (!IDENTIFIER_KINDS.includes(kind)) throw invalid();
  const value = normalizeIdentifierValue(raw);
  if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) throw invalid();
  return { kind, value };
}

/** Stores or clears the identifier of a report (service role). */
async function saveIdentifier(supa, reportId, identifier) {
  if (!identifier) {
    const { error } = await supa.from("report_identifiers").delete().eq("report_id", reportId);
    if (error) throw error;
    return;
  }
  const { error } = await supa
    .from("report_identifiers")
    .upsert(
      { report_id: reportId, kind: identifier.kind, value_normalized: identifier.value, updated_at: new Date().toISOString() },
      { onConflict: "report_id" },
    );
  if (error) throw error;
}

/** The owner's own identifier for the edit screen, or null. */
async function loadIdentifier(supa, reportId) {
  const { data, error } = await supa
    .from("report_identifiers")
    .select("kind, value_normalized")
    .eq("report_id", reportId)
    .maybeSingle();
  if (error || !data) return null;
  return { kind: data.kind, value: data.value_normalized };
}

module.exports = { IDENTIFIER_KINDS, MIN_LENGTH, MAX_LENGTH, normalizeIdentifier, normalizeIdentifierValue, saveIdentifier, loadIdentifier };
