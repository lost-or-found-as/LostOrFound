"use strict";
// T1.9BS: public pages for QR tags (no sign-in).
//   tag page      what the finder sees after scanning: a message form, or why it is not possible.
//   thread page   the finder's own conversation with the owner (secret link).
//   print sheet   A4 sheet with stickers in two sizes for one code.
// Never shown: the owner, the tag's label (it may hold a name or address) or any contact details.
const { message } = require("./messages");
const { esc, shell } = require("./sharePage");
const { LIMITS, formatCode } = require("./itemTags");

const EXTRA_STYLE = `<style>.bubble{padding:10px 12px;border-radius:14px;white-space:pre-line;max-width:88%}
.from-finder{align-self:flex-end;background:#111827;color:#FFFFFF}.from-owner{align-self:flex-start;background:#EEF2FF;color:#1E1B4B}
.who{font-size:12px;font-weight:800;opacity:.75;margin-bottom:2px}.thread{display:flex;flex-direction:column;gap:8px}
.save{background:#ECFDF5;border:1px solid #6EE7B7;color:#065F46;border-radius:14px;padding:12px 14px;font-weight:700}
.err{background:#FEF2F2;border:1px solid #FCA5A5;color:#7F1D1D;border-radius:14px;padding:12px 14px;font-weight:700}
.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;letter-spacing:.08em}
button.btn{border:0;width:100%;font:inherit;font-weight:900;cursor:pointer}</style>`;

function page(lang, title, inner) {
  return shell(lang, title, `${EXTRA_STYLE}<main><span class="brand">Lost or Found</span>${inner}</main>`);
}

function kindText(lang, kind) {
  return message(lang, `tag.kind.${String(kind || "OTHER").toUpperCase()}`);
}

function messageForm({ lang, action, placeholderKey, buttonKey }) {
  return `<form method="post" action="${esc(action)}">
<textarea name="message" required minlength="${LIMITS.messageMin}" maxlength="${LIMITS.messageMax}" rows="5" placeholder="${esc(message(lang, placeholderKey))}"></textarea>
<button class="btn" type="submit">${esc(message(lang, buttonKey))}</button>
</form>`;
}

function errorBox(lang, errorKey) {
  return errorKey ? `<div class="err">${esc(message(lang, errorKey))}</div>` : "";
}

/** state: ACTIVE, UNCLAIMED, PAUSED or UNKNOWN. */
function renderTagPage({ lang, state, kind, code, action, errorKey }) {
  if (state === "ACTIVE") {
    const inner = `<section class="card">
<span class="kicker">${esc(message(lang, "tag.page.kicker"))}</span>
<h1>${esc(message(lang, "tag.page.title"))}</h1>
<p class="sub">${esc(message(lang, "tag.page.kind", { kind: kindText(lang, kind) }))}</p>
<p>${esc(message(lang, "tag.page.body"))}</p>
</section>
${errorBox(lang, errorKey)}
<section class="card">
<h2>${esc(message(lang, "tag.page.formTitle"))}</h2>
${messageForm({ lang, action, placeholderKey: "tag.page.placeholder", buttonKey: "tag.page.send" })}
<p class="meta">${esc(message(lang, "tag.page.privacy"))}</p>
</section>
<p class="meta report-link">${esc(message(lang, "tag.page.code"))} <span class="code">${esc(formatCode(code))}</span></p>`;
    return page(lang, message(lang, "tag.page.title"), inner);
  }
  const key = state === "UNCLAIMED" ? "unclaimed" : state === "PAUSED" ? "paused" : "unknown";
  const inner = `<section class="card">
<h1>${esc(message(lang, `tag.page.${key}Title`))}</h1>
<p>${esc(message(lang, `tag.page.${key}Body`))}</p>
<a class="btn2" href="https://lostorfound.app">${esc(message(lang, "share.getApp"))}</a>
</section>`;
  return page(lang, message(lang, `tag.page.${key}Title`), inner);
}

/** The finder's conversation. messages: [{ sender, body, created_at }]. */
function renderThreadPage({ lang, messages, status, action, justStarted, errorKey }) {
  const bubbles = (messages || [])
    .map((m) => {
      const finder = m.sender === "FINDER";
      return `<div class="bubble ${finder ? "from-finder" : "from-owner"}"><div class="who">${esc(message(lang, finder ? "tag.thread.you" : "tag.thread.owner"))}</div>${esc(m.body)}</div>`;
    })
    .join("\n");
  const hasOwnerReply = (messages || []).some((m) => m.sender === "OWNER");
  const open = status === "OPEN";
  const inner = `${justStarted ? `<div class="save">${esc(message(lang, "tag.thread.sent"))}</div>` : ""}
<section class="card">
<h1>${esc(message(lang, "tag.thread.title"))}</h1>
<p class="meta">${esc(message(lang, "tag.thread.saveLink"))}</p>
<div class="thread">${bubbles}</div>
${hasOwnerReply ? "" : `<p class="meta">${esc(message(lang, "tag.thread.waiting"))}</p>`}
</section>
${errorBox(lang, errorKey)}
${
  open
    ? `<section class="card"><h2>${esc(message(lang, "tag.thread.replyTitle"))}</h2>${messageForm({ lang, action, placeholderKey: "tag.thread.placeholder", buttonKey: "tag.thread.send" })}</section>`
    : `<section class="card"><p>${esc(message(lang, "tag.thread.closed"))}</p></section>`
}`;
  return page(lang, message(lang, "tag.thread.title"), inner);
}

const BIG_STICKERS = 6;
const SMALL_STICKERS = 15;

/** A4 with six 45 mm stickers and fifteen 25 mm stickers (key rings), all for one code. */
function renderPrintSheet({ lang, code, qrSvg }) {
  const shown = esc(formatCode(code));
  const big = Array.from(
    { length: BIG_STICKERS },
    () => `<div class="big"><div class="q">${qrSvg}</div><div class="t"><b>${esc(message(lang, "tag.print.found"))}</b><span>${esc(message(lang, "tag.print.scan"))}</span><span class="c">${shown}</span></div></div>`,
  ).join("");
  const small = Array.from({ length: SMALL_STICKERS }, () => `<div class="small"><div class="q">${qrSvg}</div><span class="c">${shown}</span></div>`).join("");
  const style = `@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font:14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0F172A;background:#FFFFFF}
.sheet{width:190mm;margin:0 auto;display:flex;flex-direction:column;gap:6mm}
.grid-big,.grid-small{display:flex;flex-wrap:wrap;gap:4mm}
.big{width:calc(50% - 2mm);border:1px dashed #94A3B8;border-radius:4mm;padding:3mm;display:flex;gap:3mm;align-items:center;height:45mm}
.big .q{width:38mm;height:38mm;flex-shrink:0}.q svg{width:100%;height:100%;display:block}
.big .t{display:flex;flex-direction:column;gap:1.5mm}.big b{font-size:18px;font-weight:900}.big span{font-size:12px;font-weight:700;color:#334155}
.small{width:calc(20% - 3.2mm);border:1px dashed #94A3B8;border-radius:3mm;padding:2mm;display:flex;flex-direction:column;align-items:center;gap:1mm;height:33mm}
.small .q{width:24mm;height:24mm}
.c{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:10px;letter-spacing:.06em;color:#0F172A}
.brand{font-size:11px;font-weight:900;color:#475569;text-align:center}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:190mm;margin:0 auto;padding:12px 0}
.bar p{margin:0;font-size:14px;color:#334155}
.print{flex-shrink:0;min-height:44px;padding:0 18px;border-radius:12px;border:0;background:#111827;color:#fff;font-weight:900;font-size:16px}
@media print{.bar{display:none}}
@media screen and (max-width:760px){.sheet{width:auto;padding:0 10px}.bar{padding:12px 10px}}`;
  const body = `<div class="bar"><p>${esc(message(lang, "tag.print.hint"))}</p><button class="print" onclick="window.print()">${esc(message(lang, "tag.print.button"))}</button></div>
<div class="sheet"><div class="grid-big">${big}</div><div class="grid-small">${small}</div><div class="brand">Lost or Found · ${shown}</div></div>`;
  return `<!doctype html><html lang="${lang === "no" ? "nb" : esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(message(lang, "tag.print.title"))}</title><style>${style}</style></head><body>${body}</body></html>`;
}

module.exports = { BIG_STICKERS, SMALL_STICKERS, renderTagPage, renderThreadPage, renderPrintSheet };
