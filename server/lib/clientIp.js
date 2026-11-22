"use strict";
// T1.9BN: the address of the device that called us, in a form a caller cannot fake.
// Render only appends to X-Forwarded-For, so its first entry is whatever the caller sent.
// Render sits behind Cloudflare, which sets CF-Connecting-IP itself (a caller cannot set it),
// so that header is used first; otherwise the last X-Forwarded-For entry (added by Render),
// and last the socket address.

function firstHeader(req, name) {
  const v = req?.headers?.[name];
  return String(Array.isArray(v) ? v[0] : v || "").trim();
}

/** Returns { ip, source } where source is CF, XFF_LAST, SOCKET or NONE. */
function clientIpInfo(req) {
  const cf = firstHeader(req, "cf-connecting-ip");
  if (cf) return { ip: cf, source: "CF" };
  const xff = firstHeader(req, "x-forwarded-for")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (xff.length) return { ip: xff[xff.length - 1], source: "XFF_LAST" };
  const socket = String(req?.socket?.remoteAddress || "").trim();
  if (socket) return { ip: socket, source: "SOCKET" };
  return { ip: "", source: "NONE" };
}

function clientIp(req) {
  return clientIpInfo(req).ip;
}

module.exports = { clientIp, clientIpInfo };
