"use strict";
// T1.9AZ: every report photo is checked before strangers see it. A photo whose main subject is a
// person, or that shows nudity, an ID card or document, or violence, is HELD: only the owner sees
// it (not the share page, the poster or the other side of a match). Other photos become OK.
// Photos not checked yet (status null) are shown in matches as before but not on public pages.
// Runs right after upload and every hour for photos that are still unchecked.
// Uses the same model and key as the photo analysis (IMAGE_ANALYSIS_ENABLED + ANTHROPIC_API_KEY).
const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-5-5";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 4.5 * 1024 * 1024;
const REASONS = new Set(["PERSON", "NUDITY", "DOCUMENT", "VIOLENCE", "OTHER"]);

function moderationEnabled(env = process.env) {
  return String(env.IMAGE_ANALYSIS_ENABLED || "").toLowerCase() === "true" && !!String(env.ANTHROPIC_API_KEY || "").trim();
}

function moderationPrompt() {
  return [
    "You check photos for a public lost-and-found notice. The photo should show a lost or found item or animal.",
    'Answer with ONE JSON object and nothing else: {"public_ok":true|false,"reason":"PERSON"|"NUDITY"|"DOCUMENT"|"VIOLENCE"|"OTHER"|null}',
    "- PERSON: a person is the main subject, or a face is clearly shown in a way that identifies someone. Hands, arms or a person far in the background behind the item or animal are fine.",
    "- NUDITY: nudity or sexual content.",
    "- DOCUMENT: an ID card, passport, bank card, letter, screen or other document with personal details is readable.",
    "- VIOLENCE: violence, blood or gore.",
    "- OTHER: anything else that should clearly not be on a public notice.",
    "Items, pets, bags, keys, bikes and places are ok. When the item or animal is the main subject, answer public_ok true.",
  ].join("\n");
}

function parseVerdict(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    if (v?.public_ok === true) return { status: "OK", reason: null };
    if (v?.public_ok === false) return { status: "HELD", reason: REASONS.has(v.reason) ? v.reason : "OTHER" };
    return null;
  } catch {
    return null;
  }
}

/** Asks the model about one JPEG (base64). Returns { status, reason } or null when it could not answer. */
async function judgeImage(base64, { env = process.env, fetchImpl = fetch, log = console } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": String(env.ANTHROPIC_API_KEY || ""), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: String(env.IMAGE_ANALYSIS_MODEL || DEFAULT_MODEL),
        max_tokens: 60,
        system: moderationPrompt(),
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: "Can this photo be shown on a public lost-and-found notice? JSON only." },
        ] }],
      }),
    });
    const json = await r.json().catch(() => null);
    // T1.9BO: say why there was no answer (status and error type only, never the photo).
    if (!r.ok) {
      log.warn?.(`[image-moderation] no verdict: HTTP ${r.status} ${json?.error?.type || ""}`.trim());
      return null;
    }
    const verdict = parseVerdict((json?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("\n"));
    if (!verdict) log.warn?.(`[image-moderation] no verdict: unreadable answer (stop_reason ${json?.stop_reason || "none"})`);
    return verdict;
  } catch (e) {
    log.warn?.(`[image-moderation] no verdict: request failed (${e?.name || "Error"})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * T1.9BN: where a stored photo lives. Paths are "<bucket>/reports/<id>/<file>"; an older path
 * without the bucket name ("reports/<id>/<file>") lives in the default photo bucket.
 */
function storedImageLocation(path, env = process.env) {
  const defaultBucket = env.BUCKET_REPORT_IMAGES || "report-images";
  const value = String(path || "").replace(/^\/+/, "");
  if (value.startsWith(`${defaultBucket}/`)) return { bucket: defaultBucket, objectPath: value.slice(defaultBucket.length + 1) };
  if (value.startsWith("reports/")) return { bucket: defaultBucket, objectPath: value };
  const [bucket, ...rest] = value.split("/");
  return { bucket, objectPath: rest.join("/") };
}

/** True only when the folder can be listed and the file is not in it. */
async function storedFileMissing(supa, bucket, objectPath) {
  try {
    const parts = String(objectPath || "").split("/");
    const name = parts.pop();
    if (!name) return false;
    const { data, error } = await supa.storage.from(bucket).list(parts.join("/"), { search: name, limit: 100 });
    if (error || !Array.isArray(data)) return false;
    return !data.some((f) => f?.name === name);
  } catch {
    return false;
  }
}

/** Checks one stored photo and saves the result. Returns the status, or null (try again later). */
async function moderateImageRow(row, { supa, env = process.env, fetchImpl = fetch, notifyHeld, log = console, now = Date.now() }) {
  if (!moderationEnabled(env) || !row?.path) return null;
  const { bucket, objectPath } = storedImageLocation(row.path, env);
  const { data: blob, error } = await supa.storage.from(bucket).download(objectPath);
  if (error || !blob) {
    const message = String(error?.message || "no data");
    // T1.9BO: a photo whose file is gone can never be checked or shown. Keep it off public
    // pages and stop retrying it every hour. «Gone» is confirmed by listing the folder, so an
    // access or bucket problem never holds photos by mistake.
    if (await storedFileMissing(supa, bucket, objectPath)) {
      log.warn?.(`[image-moderation] file missing, held (${message})`);
      const u = await supa.from("report_images")
        .update({ moderation_status: "HELD", moderation_reason: "OTHER", moderation_checked_at: new Date(now).toISOString() })
        .eq("id", row.id).is("moderation_status", null);
      if (u.error) throw u.error;
      return "HELD";
    }
    log.warn?.("[image-moderation] download failed", message);
    return null;
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_BYTES || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    // Not a JPEG we can send, or too large: keep it off public pages.
    const u = await supa.from("report_images").update({ moderation_status: "HELD", moderation_reason: "OTHER", moderation_checked_at: new Date(now).toISOString() }).eq("id", row.id);
    if (u.error) throw u.error;
    return "HELD";
  }
  const verdict = await judgeImage(buffer.toString("base64"), { env, fetchImpl, log });
  if (!verdict) return null;
  const u = await supa.from("report_images")
    .update({ moderation_status: verdict.status, moderation_reason: verdict.reason, moderation_checked_at: new Date(now).toISOString() })
    .eq("id", row.id).is("moderation_status", null);
  if (u.error) throw u.error;
  log.log?.(`[image-moderation] ${verdict.status}${verdict.reason ? ` ${verdict.reason}` : ""}`);
  if (verdict.status === "HELD" && notifyHeld) {
    try { await notifyHeld(row, verdict.reason); } catch (e) { log.warn?.("[image-moderation] notice failed", e?.message || e); }
  }
  return verdict.status;
}

/** Checks photos that are still unchecked (oldest first). */
async function moderatePending({ supa, limit = 20, ...deps }) {
  if (!moderationEnabled(deps.env)) return { checked: 0 };
  const { data, error } = await supa.from("report_images").select("id,report_id,path,created_by")
    .is("moderation_status", null).order("created_at", { ascending: true }).limit(limit);
  if (error) throw error;
  let checked = 0;
  for (const row of data || []) {
    try {
      if (await moderateImageRow(row, { supa, ...deps })) checked += 1;
    } catch (e) {
      (deps.log || console).warn?.("[image-moderation] failed", e?.message || e);
    }
  }
  return { checked };
}

function scheduleImageModeration({ supa, log = console, everyMs = 60 * 60 * 1000, notifyHeld } = {}) {
  const run = () => moderatePending({ supa, log, notifyHeld }).catch((e) => log.warn?.("[image-moderation] run failed", e?.message || e));
  const first = setTimeout(run, 60 * 1000);
  first.unref?.();
  const t = setInterval(run, everyMs);
  t.unref?.();
  return t;
}

/** Paths of HELD photos that this user does not own (they must not see them). */
async function heldPathsForOthers(supa, userId, paths) {
  const list = [...new Set((paths || []).filter(Boolean))];
  if (!list.length) return new Set();
  const { data, error } = await supa.from("report_images").select("path,reports(user_id)").in("path", list).eq("moderation_status", "HELD");
  if (error) throw error;
  return new Set((data || []).filter((r) => r.reports?.user_id !== userId).map((r) => r.path));
}

/** Removes HELD photos from the other side of a match (the viewer keeps their own). */
function dropHeldImages(match, userId) {
  if (!match) return match;
  for (const side of ["lost", "found"]) {
    const rep = match[side];
    if (!rep || rep.user_id === userId || !Array.isArray(rep.report_images)) continue;
    rep.report_images = rep.report_images.filter((img) => img.moderation_status !== "HELD");
  }
  for (const side of ["lost", "found"]) {
    for (const img of match[side]?.report_images || []) delete img.moderation_status;
  }
  return match;
}

module.exports = {
  storedImageLocation, storedFileMissing, moderationEnabled, moderationPrompt, parseVerdict, judgeImage, moderateImageRow, moderatePending, scheduleImageModeration, heldPathsForOthers, dropHeldImages };
