"use strict";
// T1.9BP: trust between the owner (who lost something) and the helper (finder or observer).
//   GET  /trust/:kind/:id                 state for this chat (role, question, code, thanks)
//   POST /trust/:kind/:id/question        helper asks a control question
//   POST /trust/question/:qid/answer      owner answers (up to three tries per question)
//   POST /trust/question/:qid/judge       helper: the answer matches or not
//   POST /trust/:kind/:id/handover        helper types the owner's code: the case is returned
//   POST /trust/:kind/:id/thanks          owner sends one thank-you card after a solved case
//   GET  /trust/thanks/me                 thank-you cards the user has received
// kind: MATCH or OBSERVATION.
const express = require("express");
const { supaAdmin } = require("../supabaseClient");
const { requireUser } = require("../mw/auth");
const { notifyUser } = require("../lib/userNotify");
const { localizedPair } = require("../lib/messages");
const { modelProblems } = require("../lib/contentSafety");
const { parties, ownerAndHelper, canHandOver, closeAndAward } = require("../lib/resolutionCore");
const trust = require("../lib/trust");

const router = express.Router();
const KINDS = new Set(["MATCH", "OBSERVATION"]);
const ENTITY = { MATCH: "chat", OBSERVATION: "observation" };
const THANKS_BLOCKING = new Set(["HARASSMENT", "HATE", "SEXUAL"]);

function fail(res, status, code) {
  return res.status(status).json({ error: code });
}

async function context(req) {
  const kind = String(req.params.kind || "").toUpperCase();
  const id = String(req.params.id || "");
  if (!KINDS.has(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const p = await parties(kind, id);
  const roles = ownerAndHelper(kind, p);
  if (!roles || ![roles.owner, roles.helper].includes(req.user.id)) return null;
  return { kind, id, p, ...roles, role: req.user.id === roles.owner ? "OWNER" : "HELPER" };
}

async function resolved(kind, id) {
  const q = await supaAdmin
    .from("resolution_proposals")
    .select("id")
    .eq("context_type", kind)
    .eq("context_id", id)
    .eq("status", "ACCEPTED")
    .limit(1);
  if (q.error) throw q.error;
  return (q.data || []).length > 0;
}

async function questionsFor(kind, id) {
  const q = await supaAdmin
    .from("control_questions")
    .select("id,question,answer,status,attempts,created_at")
    .eq("context_type", kind)
    .eq("context_id", id)
    .order("created_at", { ascending: false })
    .limit(trust.MAX_QUESTIONS);
  if (q.error) throw q.error;
  return q.data || [];
}

async function codeRow(c, create) {
  const q = await supaAdmin.from("handover_codes").select("*").eq("context_type", c.kind).eq("context_id", c.id).maybeSingle();
  if (q.error) throw q.error;
  if (q.data || !create) return q.data || null;
  const ins = await supaAdmin
    .from("handover_codes")
    .insert({ context_type: c.kind, context_id: c.id, owner_id: c.owner, code: trust.newCode() })
    .select("*")
    .single();
  if (ins.error) {
    // Two requests at once: read the one that won.
    const again = await supaAdmin.from("handover_codes").select("*").eq("context_type", c.kind).eq("context_id", c.id).maybeSingle();
    if (again.error || !again.data) throw ins.error;
    return again.data;
  }
  return ins.data;
}

function notify(userId, c, type, key) {
  return notifyUser({
    userId,
    type,
    entityType: ENTITY[c.kind],
    entityId: c.id,
    titles: localizedPair(`push.${key}.title`),
    bodies: localizedPair(`push.${key}.body`),
  }).catch((e) => console.warn("[trust] notify failed", e?.message ?? e));
}

router.get("/thanks/me", requireUser, async (req, res) => {
  try {
    const q = await supaAdmin
      .from("thank_you_cards")
      .select("id,design,message,created_at")
      .eq("to_user", req.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (q.error) throw q.error;
    return res.json({ cards: q.data || [] });
  } catch (e) {
    console.error("[trust] thanks list failed", e?.message ?? e);
    return fail(res, 500, "THANKS_LOAD_FAILED");
  }
});

router.get("/:kind/:id", requireUser, async (req, res) => {
  try {
    const c = await context(req);
    if (!c) return fail(res, 404, "CONTEXT_NOT_FOUND");
    const handover = canHandOver(c.kind, c.p);
    const [questions, isResolved] = await Promise.all([handover ? questionsFor(c.kind, c.id) : [], resolved(c.kind, c.id)]);
    const code = handover && c.role === "OWNER" && !isResolved ? await codeRow(c, true) : handover ? await codeRow(c, false) : null;
    const thanks = await supaAdmin
      .from("thank_you_cards")
      .select("id,design,message,created_at")
      .eq("context_type", c.kind)
      .eq("context_id", c.id)
      .maybeSingle();
    if (thanks.error) throw thanks.error;
    const latest = questions[0] || null;
    return res.json({
      role: c.role,
      canHandOver: handover,
      resolved: isResolved,
      question: latest
        ? {
            id: latest.id,
            question: latest.question,
            // The answer is for the helper to judge; the owner sees their own answer too.
            answer: latest.answer,
            status: latest.status,
            attempts: latest.attempts,
            maxAttempts: trust.MAX_ANSWER_TRIES,
          }
        : null,
      questionsUsed: questions.length,
      maxQuestions: trust.MAX_QUESTIONS,
      canAsk: c.role === "HELPER" && handover && !isResolved && trust.canAsk(questions) === "ok",
      handover: handover
        ? {
            code: c.role === "OWNER" && !isResolved ? code?.code || null : null,
            used: !!code?.used_at,
            locked: !!(code?.locked_until && new Date(code.locked_until).getTime() > Date.now()),
          }
        : null,
      thanks: thanks.data || null,
    });
  } catch (e) {
    console.error("[trust] state failed", e?.message ?? e);
    return fail(res, 500, "TRUST_LOAD_FAILED");
  }
});

router.post("/:kind/:id/question", requireUser, async (req, res) => {
  try {
    const c = await context(req);
    if (!c) return fail(res, 404, "CONTEXT_NOT_FOUND");
    if (c.role !== "HELPER" || !canHandOver(c.kind, c.p)) return fail(res, 403, "NOT_ALLOWED");
    if (await resolved(c.kind, c.id)) return fail(res, 409, "CASE_RESOLVED");
    const text = trust.cleanText(req.body?.question);
    if (text.length < 3) return fail(res, 400, "QUESTION_TOO_SHORT");
    const allowed = trust.canAsk(await questionsFor(c.kind, c.id));
    if (allowed !== "ok") return fail(res, 409, allowed);
    const ins = await supaAdmin
      .from("control_questions")
      .insert({ context_type: c.kind, context_id: c.id, asked_by: c.helper, owner_id: c.owner, question: text })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    void notify(c.owner, c, "TRUST_QUESTION", "trustQuestion");
    return res.json({ ok: true, id: ins.data.id });
  } catch (e) {
    console.error("[trust] question failed", e?.message ?? e);
    return fail(res, 500, "QUESTION_FAILED");
  }
});

async function loadQuestion(req) {
  const qid = String(req.params.qid || "");
  if (!/^[0-9a-f-]{36}$/i.test(qid)) return null;
  const q = await supaAdmin.from("control_questions").select("*").eq("id", qid).maybeSingle();
  if (q.error) throw q.error;
  return q.data || null;
}

router.post("/question/:qid/answer", requireUser, async (req, res) => {
  try {
    const q = await loadQuestion(req);
    if (!q || q.owner_id !== req.user.id) return fail(res, 404, "QUESTION_NOT_FOUND");
    if (q.status !== "ASKED") return fail(res, 409, "QUESTION_NOT_OPEN");
    if (q.attempts >= trust.MAX_ANSWER_TRIES) return fail(res, 409, "NO_TRIES_LEFT");
    const answer = trust.cleanText(req.body?.answer);
    if (!answer) return fail(res, 400, "ANSWER_EMPTY");
    const up = await supaAdmin
      .from("control_questions")
      .update({ answer, status: "ANSWERED", attempts: q.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", q.id)
      .eq("status", "ASKED");
    if (up.error) throw up.error;
    void notify(q.asked_by, { kind: q.context_type, id: q.context_id }, "TRUST_ANSWER", "trustAnswer");
    return res.json({ ok: true });
  } catch (e) {
    console.error("[trust] answer failed", e?.message ?? e);
    return fail(res, 500, "ANSWER_FAILED");
  }
});

router.post("/question/:qid/judge", requireUser, async (req, res) => {
  try {
    const q = await loadQuestion(req);
    if (!q || q.asked_by !== req.user.id) return fail(res, 404, "QUESTION_NOT_FOUND");
    const verdict = trust.judge(q, req.body?.matches === true);
    if (verdict.error) return fail(res, 409, verdict.error);
    const up = await supaAdmin
      .from("control_questions")
      .update({ status: verdict.status, updated_at: new Date().toISOString() })
      .eq("id", q.id)
      .eq("status", "ANSWERED");
    if (up.error) throw up.error;
    const c = { kind: q.context_type, id: q.context_id };
    if (verdict.status === "CONFIRMED") void notify(q.owner_id, c, "TRUST_CONFIRMED", "trustConfirmed");
    else if (verdict.status === "ASKED") void notify(q.owner_id, c, "TRUST_RETRY", "trustRetry");
    else void notify(q.owner_id, c, "TRUST_NO_MATCH", "trustNoMatch");
    return res.json({ ok: true, status: verdict.status, triesLeft: Math.max(0, trust.MAX_ANSWER_TRIES - q.attempts) });
  } catch (e) {
    console.error("[trust] judge failed", e?.message ?? e);
    return fail(res, 500, "JUDGE_FAILED");
  }
});

router.post("/:kind/:id/handover", requireUser, async (req, res) => {
  try {
    const c = await context(req);
    if (!c) return fail(res, 404, "CONTEXT_NOT_FOUND");
    if (c.role !== "HELPER" || !canHandOver(c.kind, c.p)) return fail(res, 403, "NOT_ALLOWED");
    if (await resolved(c.kind, c.id)) return fail(res, 409, "CASE_RESOLVED");
    const row = await codeRow(c, false);
    if (!row) return fail(res, 409, "CODE_NOT_READY");
    const check = trust.checkCode(row, req.body?.code);
    if (check.result !== "ok") {
      if (check.result === "CODE_WRONG") {
        const up = await supaAdmin
          .from("handover_codes")
          .update({ failed_attempts: check.failed, locked_until: check.lockedUntil })
          .eq("context_type", c.kind)
          .eq("context_id", c.id);
        if (up.error) throw up.error;
        return fail(res, 400, check.lockedUntil ? "CODE_LOCKED" : "CODE_WRONG");
      }
      return fail(res, 409, check.result);
    }
    const now = new Date().toISOString();
    const used = await supaAdmin
      .from("handover_codes")
      .update({ used_at: now, failed_attempts: 0, locked_until: null })
      .eq("context_type", c.kind)
      .eq("context_id", c.id)
      .is("used_at", null)
      .select("context_id");
    if (used.error) throw used.error;
    if (!(used.data || []).length) return fail(res, 409, "CODE_USED");
    // The case counts as resolved by both: the owner showed the code, the helper typed it.
    const pending = await supaAdmin
      .from("resolution_proposals")
      .update({ status: "ACCEPTED", responded_at: now })
      .eq("context_type", c.kind)
      .eq("context_id", c.id)
      .eq("status", "PENDING")
      .select("id");
    if (pending.error) throw pending.error;
    if (!(pending.data || []).length) {
      const ins = await supaAdmin
        .from("resolution_proposals")
        .insert({ context_type: c.kind, context_id: c.id, proposed_by: c.helper, requested_from: c.owner, status: "ACCEPTED", responded_at: now });
      if (ins.error) throw ins.error;
    }
    await closeAndAward(c.kind, c.id, c.p, now);
    void notify(c.owner, c, "RESOLUTION_CONFIRMED", "trustHandedOver");
    return res.json({ ok: true });
  } catch (e) {
    console.error("[trust] handover failed", e?.message ?? e);
    return fail(res, 500, "HANDOVER_FAILED");
  }
});

router.post("/:kind/:id/thanks", requireUser, async (req, res) => {
  try {
    const c = await context(req);
    if (!c) return fail(res, 404, "CONTEXT_NOT_FOUND");
    if (c.role !== "OWNER") return fail(res, 403, "NOT_ALLOWED");
    if (!(await resolved(c.kind, c.id))) return fail(res, 409, "CASE_NOT_RESOLVED");
    const design = String(req.body?.design || "").toUpperCase();
    if (!trust.THANKS_DESIGNS.includes(design)) return fail(res, 400, "THANKS_DESIGN_INVALID");
    const message = trust.cleanText(req.body?.message);
    if (!message) return fail(res, 400, "THANKS_EMPTY");
    // Insults, hate or sexual content are refused. T1.9BT fix: a name is fine here – the card is
    // private, and «Tusen takk, Ola!» was stopped as a named person.
    const problems = await modelProblems([message]);
    if ((problems || []).some((p) => THANKS_BLOCKING.has(p))) return fail(res, 400, "THANKS_TEXT_NOT_ALLOWED");
    const ins = await supaAdmin
      .from("thank_you_cards")
      .insert({ context_type: c.kind, context_id: c.id, from_user: c.owner, to_user: c.helper, design, message });
    if (ins.error) {
      if (String(ins.error.code) === "23505") return fail(res, 409, "THANKS_ALREADY_SENT");
      throw ins.error;
    }
    void notifyUser({
      userId: c.helper,
      type: "THANKS_RECEIVED",
      entityType: "thanks",
      entityId: c.id,
      titles: localizedPair("push.thanksReceived.title"),
      bodies: localizedPair("push.thanksReceived.body"),
    }).catch((e) => console.warn("[trust] notify failed", e?.message ?? e));
    return res.json({ ok: true });
  } catch (e) {
    console.error("[trust] thanks failed", e?.message ?? e);
    return fail(res, 500, "THANKS_FAILED");
  }
});

module.exports = router;
