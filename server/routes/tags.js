"use strict";
// T1.9BS: the owner's QR tags (signed-in accounts, not guests).
//   GET    /tags/mine                       tags with conversation and unread counts
//   POST   /tags                            new digital tag { label, kind }
//   POST   /tags/claim                      claim a printed code { code, label, kind }
//   PATCH  /tags/:id                        { label?, kind?, active? }
//   DELETE /tags/:id                        removes the tag and its conversations
//   GET    /tags/:id/threads                conversations for one tag
//   GET    /tags/threads/:threadId          messages (marks the conversation read)
//   POST   /tags/threads/:threadId/reply    { message }
//   POST   /tags/threads/:threadId/status   { status: OPEN | CLOSED | BLOCKED }
// The public side (the QR page and the finder's conversation) is in routes/tagPages.js.
const express = require("express");
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const tags = require("../lib/itemTags");

const router = express.Router();
const UUID_RE = /^[0-9a-f-]{36}$/i;
const TAG_COLUMNS = "id,code,label,kind,active,claimed_at,created_at";
const THREAD_COLUMNS = "id,tag_id,status,owner_read_at,finder_read_at,last_message_at,created_at";

function fail(res, status, code) {
  return res.status(status).json({ error: code });
}

function publicBase(req) {
  const configured = String(process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  return configured || `https://${req.get("host")}`;
}

function present(req, tag, extra = {}) {
  const base = publicBase(req);
  return {
    ...tag,
    displayCode: tags.formatCode(tag.code),
    pageUrl: `${base}/t/${tag.code}`,
    printUrl: `${base}/t/${tag.code}/print`,
    ...extra,
  };
}

async function ownTag(req) {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) return null;
  const q = await supaAdmin.from("item_tags").select(TAG_COLUMNS).eq("id", id).eq("owner_id", req.user.id).maybeSingle();
  if (q.error) throw q.error;
  return q.data || null;
}

async function ownThread(req) {
  const id = String(req.params.threadId || "");
  if (!UUID_RE.test(id)) return null;
  const q = await supaAdmin.from("tag_threads").select(THREAD_COLUMNS).eq("id", id).eq("owner_id", req.user.id).maybeSingle();
  if (q.error) throw q.error;
  return q.data || null;
}

/** Last message per thread: { threadId: { sender, body, created_at } }. */
async function lastMessages(threadIds) {
  if (!threadIds.length) return {};
  const q = await supaAdmin
    .from("tag_messages")
    .select("thread_id,sender,body,created_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(1000, threadIds.length * 30));
  if (q.error) throw q.error;
  const out = {};
  for (const m of q.data || []) if (!out[m.thread_id]) out[m.thread_id] = m;
  return out;
}

async function threadsWithPreview(filter) {
  let query = supaAdmin.from("tag_threads").select(THREAD_COLUMNS).order("last_message_at", { ascending: false }).limit(200);
  for (const [k, v] of Object.entries(filter)) query = query.eq(k, v);
  const q = await query;
  if (q.error) throw q.error;
  const threads = q.data || [];
  const last = await lastMessages(threads.map((t) => t.id));
  return threads.map((t) => {
    const m = last[t.id] || null;
    return {
      ...t,
      lastMessage: m ? { sender: m.sender, body: String(m.body).slice(0, 140), created_at: m.created_at } : null,
      unread: tags.ownerUnread(t, m?.sender),
    };
  });
}

async function insertTag(row) {
  // A clash on the code is very unlikely (31^8); try a few times.
  for (let i = 0; i < 4; i++) {
    const ins = await supaAdmin
      .from("item_tags")
      .insert({ ...row, code: tags.newCode() })
      .select(TAG_COLUMNS)
      .single();
    if (!ins.error) return ins.data;
    if (ins.error.code !== "23505") throw ins.error;
  }
  throw new Error("TAG_CODE_EXHAUSTED");
}

async function ownerTagCount(userId) {
  const q = await supaAdmin.from("item_tags").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if (q.error) throw q.error;
  return Number(q.count || 0);
}

router.get("/mine", requireUser, async (req, res) => {
  try {
    const q = await supaAdmin.from("item_tags").select(TAG_COLUMNS).eq("owner_id", req.user.id).order("created_at", { ascending: false });
    if (q.error) throw q.error;
    const threads = await threadsWithPreview({ owner_id: req.user.id });
    const byTag = {};
    for (const t of threads) {
      const s = (byTag[t.tag_id] ||= { threads: 0, unread: 0 });
      s.threads += 1;
      if (t.unread) s.unread += 1;
    }
    return res.json({
      tags: (q.data || []).map((t) => present(req, t, { threads: byTag[t.id]?.threads || 0, unread: byTag[t.id]?.unread || 0 })),
      maxTags: tags.LIMITS.tagsPerOwner,
    });
  } catch (e) {
    console.error("[tags] list failed", e?.message ?? e);
    return fail(res, 500, "TAGS_LOAD_FAILED");
  }
});

router.post("/", requireUser, async (req, res) => {
  try {
    if ((await ownerTagCount(req.user.id)) >= tags.LIMITS.tagsPerOwner) return fail(res, 429, "TAG_LIMIT");
    const tag = await insertTag({
      owner_id: req.user.id,
      label: tags.normalizeLabel(req.body?.label),
      kind: tags.normalizeKind(req.body?.kind),
      claimed_at: new Date().toISOString(),
    });
    return res.json({ tag: present(req, tag, { threads: 0, unread: 0 }) });
  } catch (e) {
    console.error("[tags] create failed", e?.message ?? e);
    return fail(res, 500, "TAG_CREATE_FAILED");
  }
});

router.post("/claim", requireUser, async (req, res) => {
  try {
    const code = tags.normalizeCode(req.body?.code);
    if (!code) return fail(res, 400, "TAG_CODE_INVALID");
    if ((await ownerTagCount(req.user.id)) >= tags.LIMITS.tagsPerOwner) return fail(res, 429, "TAG_LIMIT");
    // Only a code nobody owns can be claimed; the update is conditional so two people cannot both win.
    const upd = await supaAdmin
      .from("item_tags")
      .update({
        owner_id: req.user.id,
        label: tags.normalizeLabel(req.body?.label),
        kind: tags.normalizeKind(req.body?.kind),
        active: true,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("code", code)
      .is("owner_id", null)
      .select(TAG_COLUMNS)
      .maybeSingle();
    if (upd.error) throw upd.error;
    if (!upd.data) {
      const mine = await supaAdmin.from("item_tags").select("id").eq("code", code).eq("owner_id", req.user.id).maybeSingle();
      if (mine.data) return fail(res, 409, "TAG_ALREADY_YOURS");
      // Unknown and taken look the same, so codes cannot be probed.
      return fail(res, 404, "TAG_CODE_UNAVAILABLE");
    }
    return res.json({ tag: present(req, upd.data, { threads: 0, unread: 0 }) });
  } catch (e) {
    console.error("[tags] claim failed", e?.message ?? e);
    return fail(res, 500, "TAG_CLAIM_FAILED");
  }
});

router.patch("/:id", requireUser, async (req, res) => {
  try {
    const tag = await ownTag(req);
    if (!tag) return fail(res, 404, "TAG_NOT_FOUND");
    const patch = { updated_at: new Date().toISOString() };
    if (req.body && "label" in req.body) patch.label = tags.normalizeLabel(req.body.label);
    if (req.body && "kind" in req.body) patch.kind = tags.normalizeKind(req.body.kind);
    if (req.body && typeof req.body.active === "boolean") patch.active = req.body.active;
    const upd = await supaAdmin.from("item_tags").update(patch).eq("id", tag.id).eq("owner_id", req.user.id).select(TAG_COLUMNS).single();
    if (upd.error) throw upd.error;
    return res.json({ tag: present(req, upd.data) });
  } catch (e) {
    console.error("[tags] update failed", e?.message ?? e);
    return fail(res, 500, "TAG_UPDATE_FAILED");
  }
});

router.delete("/:id", requireUser, async (req, res) => {
  try {
    const tag = await ownTag(req);
    if (!tag) return fail(res, 404, "TAG_NOT_FOUND");
    const del = await supaAdmin.from("item_tags").delete().eq("id", tag.id).eq("owner_id", req.user.id);
    if (del.error) throw del.error;
    return res.json({ ok: true });
  } catch (e) {
    console.error("[tags] delete failed", e?.message ?? e);
    return fail(res, 500, "TAG_DELETE_FAILED");
  }
});

router.get("/:id/threads", requireUser, async (req, res) => {
  try {
    const tag = await ownTag(req);
    if (!tag) return fail(res, 404, "TAG_NOT_FOUND");
    return res.json({ tag: present(req, tag), threads: await threadsWithPreview({ tag_id: tag.id, owner_id: req.user.id }) });
  } catch (e) {
    console.error("[tags] threads failed", e?.message ?? e);
    return fail(res, 500, "TAG_THREADS_FAILED");
  }
});

router.get("/threads/:threadId", requireUser, async (req, res) => {
  try {
    const thread = await ownThread(req);
    if (!thread) return fail(res, 404, "TAG_THREAD_NOT_FOUND");
    const [msgs, tag] = await Promise.all([
      supaAdmin.from("tag_messages").select("id,sender,body,created_at").eq("thread_id", thread.id).order("created_at", { ascending: true }).limit(500),
      supaAdmin.from("item_tags").select(TAG_COLUMNS).eq("id", thread.tag_id).maybeSingle(),
    ]);
    if (msgs.error) throw msgs.error;
    if (tag.error) throw tag.error;
    const readAt = new Date().toISOString();
    await supaAdmin.from("tag_threads").update({ owner_read_at: readAt }).eq("id", thread.id);
    return res.json({ thread: { ...thread, owner_read_at: readAt }, tag: tag.data ? present(req, tag.data) : null, messages: msgs.data || [] });
  } catch (e) {
    console.error("[tags] thread failed", e?.message ?? e);
    return fail(res, 500, "TAG_THREAD_FAILED");
  }
});

router.post("/threads/:threadId/reply", requireUser, async (req, res) => {
  try {
    const thread = await ownThread(req);
    if (!thread) return fail(res, 404, "TAG_THREAD_NOT_FOUND");
    if (thread.status === "BLOCKED") return fail(res, 409, "TAG_THREAD_BLOCKED");
    const input = tags.normalizeMessage(req.body?.message);
    if (!input.ok) return fail(res, 400, input.code);
    const ownRecent = await supaAdmin
      .from("tag_messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", thread.id)
      .eq("sender", "OWNER")
      .gte("created_at", new Date(Date.now() - 60 * 1000).toISOString());
    if (ownRecent.error) throw ownRecent.error;
    if (Number(ownRecent.count || 0) >= tags.LIMITS.ownerRepliesPerMinute) return fail(res, 429, "MESSAGE_RATE_LIMIT");
    const now = new Date().toISOString();
    const ins = await supaAdmin.from("tag_messages").insert({ thread_id: thread.id, sender: "OWNER", body: input.body }).select("id,sender,body,created_at").single();
    if (ins.error) throw ins.error;
    await supaAdmin.from("tag_threads").update({ last_message_at: now, owner_read_at: now, status: "OPEN" }).eq("id", thread.id);
    return res.json({ message: ins.data });
  } catch (e) {
    console.error("[tags] reply failed", e?.message ?? e);
    return fail(res, 500, "TAG_REPLY_FAILED");
  }
});

router.post("/threads/:threadId/status", requireUser, async (req, res) => {
  try {
    const thread = await ownThread(req);
    if (!thread) return fail(res, 404, "TAG_THREAD_NOT_FOUND");
    const status = String(req.body?.status || "").toUpperCase();
    if (!["OPEN", "CLOSED", "BLOCKED"].includes(status)) return fail(res, 400, "TAG_STATUS_INVALID");
    const upd = await supaAdmin.from("tag_threads").update({ status }).eq("id", thread.id).eq("owner_id", req.user.id);
    if (upd.error) throw upd.error;
    return res.json({ ok: true, status });
  } catch (e) {
    console.error("[tags] status failed", e?.message ?? e);
    return fail(res, 500, "TAG_STATUS_FAILED");
  }
});

module.exports = router;
