"use strict";
// T1.9BS: public side of QR tags (no sign-in).
//   GET  /t/:code                the page behind the QR code (?lang=no|en; otherwise the browser's language)
//   POST /t/:code                the finder writes to the owner: starts a conversation and
//                                redirects to the finder's secret conversation link
//   GET  /t/:code/c/:token       the finder's conversation
//   POST /t/:code/c/:token       the finder writes again
//   GET  /t/:code/print          A4 sticker sheet for the code (shows only the code and QR)
// Limits: three new conversations per visitor and day, five per tag and day, twenty finder
// messages per conversation and day. Insults, hate and sexual content are stopped when the text
// check is switched on; a model failure never blocks.
const express = require("express");
const { supaAdmin } = require("../supabaseClient");
const { pickLanguage } = require("../lib/pageLanguage");
const { notifyUser } = require("../lib/userNotify");
const { localizedPair } = require("../lib/messages");
const { modelProblems } = require("../lib/contentSafety");
const { visitorKey } = require("../lib/contentReports");
const { clientIp } = require("../lib/clientIp");
const tags = require("../lib/itemTags");
const { renderTagPage, renderThreadPage, renderPrintSheet } = require("../lib/tagPage");

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCKING_REASONS = new Set(["HARASSMENT", "HATE", "SEXUAL"]);
const form = express.urlencoded({ extended: false, limit: "8kb" });

function publicBase(req) {
  const configured = String(process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  return configured || `https://${req.get("host")}`;
}

function send(res, status, html) {
  res.status(status);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex");
  res.set("Referrer-Policy", "no-referrer");
  return res.send(html);
}

async function tagByCode(raw) {
  const code = tags.normalizeCode(raw);
  if (!code) return null;
  const q = await supaAdmin.from("item_tags").select("id,code,owner_id,label,kind,active").eq("code", code).maybeSingle();
  if (q.error) throw q.error;
  return q.data || null;
}

async function threadByToken(tag, token) {
  if (!tag || !tags.validToken(token)) return null;
  const q = await supaAdmin
    .from("tag_threads")
    .select("id,tag_id,owner_id,status,owner_read_at,last_message_at")
    .eq("finder_token_hash", tags.hashToken(token))
    .eq("tag_id", tag.id)
    .maybeSingle();
  if (q.error) throw q.error;
  return q.data || null;
}

async function countSince(table, filters, sinceIso, column = "created_at") {
  let query = supaAdmin.from(table).select("id", { count: "exact", head: true }).gte(column, sinceIso);
  for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
  const q = await query;
  if (q.error) throw q.error;
  return Number(q.count || 0);
}

/** null when the text may be sent, otherwise the error key for the page. */
async function blockedText(body) {
  const problems = await modelProblems([body]);
  return (problems || []).some((p) => BLOCKING_REASONS.has(p)) ? "tag.error.content" : null;
}

function notifyOwner(tag, threadId, first) {
  const label = String(tag.label || "").trim();
  const titleKey = first ? "push.tagMessage.title" : "push.tagFinderReply.title";
  return notifyUser({
    userId: tag.owner_id,
    type: "TAG_MESSAGE",
    entityType: "tag_thread",
    entityId: threadId,
    titles: localizedPair(titleKey),
    bodies: label ? localizedPair("push.tagMessage.body", { label }) : localizedPair("push.tagMessage.bodyNoLabel"),
  }).catch((e) => console.warn("[tag] notify failed", e?.message ?? e));
}

function tagPage(req, res, tag, lang, status, errorKey) {
  const state = tags.tagState(tag);
  const action = tag ? `${publicBase(req)}/t/${tag.code}?lang=${lang}` : "";
  return send(res, status ?? (state === "UNKNOWN" ? 404 : 200), renderTagPage({ lang, state, kind: tag?.kind, code: tag?.code, action, errorKey }));
}

router.get("/:code", async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    return tagPage(req, res, await tagByCode(req.params.code), lang);
  } catch (e) {
    console.error("[tag] page failed", e?.message ?? e);
    return send(res, 500, renderTagPage({ lang, state: "UNKNOWN" }));
  }
});

router.post("/:code", form, async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    const tag = await tagByCode(req.params.code);
    if (tags.tagState(tag) !== "ACTIVE") return tagPage(req, res, tag, lang);
    const input = tags.normalizeMessage(req.body?.message);
    if (!input.ok) return tagPage(req, res, tag, lang, 400, input.code === "TAG_MESSAGE_TOO_LONG" ? "tag.error.tooLong" : "tag.error.tooShort");
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const visitor = visitorKey(clientIp(req));
    if ((await countSince("tag_threads", { visitor_key: visitor }, since)) >= tags.LIMITS.threadsPerVisitorPerDay) {
      return tagPage(req, res, tag, lang, 429, "tag.error.limit");
    }
    if ((await countSince("tag_threads", { tag_id: tag.id }, since)) >= tags.LIMITS.threadsPerTagPerDay) {
      return tagPage(req, res, tag, lang, 429, "tag.error.limit");
    }
    const blocked = await blockedText(input.body);
    if (blocked) return tagPage(req, res, tag, lang, 400, blocked);

    const token = tags.newFinderToken();
    const now = new Date().toISOString();
    const thread = await supaAdmin
      .from("tag_threads")
      .insert({ tag_id: tag.id, owner_id: tag.owner_id, finder_token_hash: tags.hashToken(token), visitor_key: visitor, finder_read_at: now, last_message_at: now })
      .select("id")
      .single();
    if (thread.error) throw thread.error;
    const msg = await supaAdmin.from("tag_messages").insert({ thread_id: thread.data.id, sender: "FINDER", body: input.body });
    if (msg.error) throw msg.error;
    void notifyOwner(tag, thread.data.id, true);
    // Post/redirect/get: a reload does not send the message twice, and the address bar holds the secret link.
    return res.redirect(303, `${publicBase(req)}/t/${tag.code}/c/${token}?lang=${lang}&new=1`);
  } catch (e) {
    console.error("[tag] message failed", e?.message ?? e);
    return send(res, 500, renderTagPage({ lang, state: "UNKNOWN" }));
  }
});

async function threadView(req, res, lang, { status = 200, errorKey = null } = {}) {
  const tag = await tagByCode(req.params.code);
  const thread = await threadByToken(tag, req.params.token);
  if (!thread) return send(res, 404, renderTagPage({ lang, state: "UNKNOWN" }));
  const msgs = await supaAdmin.from("tag_messages").select("sender,body,created_at").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(500);
  if (msgs.error) throw msgs.error;
  await supaAdmin.from("tag_threads").update({ finder_read_at: new Date().toISOString() }).eq("id", thread.id);
  // A blocked finder sees the conversation as closed; they are not told that they were blocked.
  const shownStatus = thread.status === "OPEN" && tag.active ? "OPEN" : "CLOSED";
  return send(
    res,
    status,
    renderThreadPage({
      lang,
      messages: msgs.data || [],
      status: shownStatus,
      action: `${publicBase(req)}/t/${tag.code}/c/${req.params.token}?lang=${lang}`,
      justStarted: req.query.new === "1",
      errorKey,
    }),
  );
}

router.get("/:code/print", async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    const tag = await tagByCode(req.params.code);
    if (!tag) return send(res, 404, renderTagPage({ lang, state: "UNKNOWN" }));
    const QRCode = require("qrcode");
    const qrSvg = await QRCode.toString(`${publicBase(req)}/t/${tag.code}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
    return send(res, 200, renderPrintSheet({ lang, code: tag.code, qrSvg }));
  } catch (e) {
    console.error("[tag] print failed", e?.message ?? e);
    return send(res, 500, renderTagPage({ lang, state: "UNKNOWN" }));
  }
});

router.get("/:code/c/:token", async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    return await threadView(req, res, lang);
  } catch (e) {
    console.error("[tag] thread failed", e?.message ?? e);
    return send(res, 500, renderTagPage({ lang, state: "UNKNOWN" }));
  }
});

router.post("/:code/c/:token", form, async (req, res) => {
  const lang = pickLanguage(req.query.lang, req.header("Accept-Language"));
  try {
    const tag = await tagByCode(req.params.code);
    const thread = await threadByToken(tag, req.params.token);
    if (!thread) return send(res, 404, renderTagPage({ lang, state: "UNKNOWN" }));
    if (thread.status !== "OPEN" || !tag.active) return threadView(req, res, lang);
    const input = tags.normalizeMessage(req.body?.message);
    if (!input.ok) return threadView(req, res, lang, { status: 400, errorKey: input.code === "TAG_MESSAGE_TOO_LONG" ? "tag.error.tooLong" : "tag.error.tooShort" });
    const since = new Date(Date.now() - DAY_MS).toISOString();
    if ((await countSince("tag_messages", { thread_id: thread.id, sender: "FINDER" }, since)) >= tags.LIMITS.finderMessagesPerThreadPerDay) {
      return threadView(req, res, lang, { status: 429, errorKey: "tag.error.limit" });
    }
    const blocked = await blockedText(input.body);
    if (blocked) return threadView(req, res, lang, { status: 400, errorKey: blocked });
    // Notify only when the owner has nothing unread from this finder already.
    const last = await supaAdmin.from("tag_messages").select("sender").eq("thread_id", thread.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const alreadyUnread = tags.ownerUnread(thread, last.data?.sender);
    const ins = await supaAdmin.from("tag_messages").insert({ thread_id: thread.id, sender: "FINDER", body: input.body });
    if (ins.error) throw ins.error;
    const now = new Date().toISOString();
    await supaAdmin.from("tag_threads").update({ last_message_at: now, finder_read_at: now }).eq("id", thread.id);
    if (!alreadyUnread) void notifyOwner(tag, thread.id, false);
    return res.redirect(303, `${publicBase(req)}/t/${tag.code}/c/${req.params.token}?lang=${lang}`);
  } catch (e) {
    console.error("[tag] finder reply failed", e?.message ?? e);
    return send(res, 500, renderTagPage({ lang, state: "UNKNOWN" }));
  }
});

module.exports = router;
