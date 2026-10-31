// server/lib/jpegMetadata.js
// T1.9L: remove hidden metadata (EXIF with GPS position, XMP, IPTC, comments) from a JPEG before
// it is shown to anyone. The app already re-encodes photos without metadata; this is the second
// layer for older builds and other clients. Image data is not decoded or changed.
"use strict";

// APP1 (EXIF/XMP), APP2-APP15 (ICC is APP2 and is kept), COM.
const ICC_MARKER = 0xe2;
function isMetadataMarker(marker) {
  if (marker === 0xfe) return true; // COM
  if (marker === ICC_MARKER) return false; // colour profile, keeps colours right
  return marker >= 0xe1 && marker <= 0xef; // APP1..APP15
}

/** Returns { buffer, removed, isJpeg }. A file that is not a well-formed JPEG is returned unchanged. */
function stripJpegMetadata(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { buffer: buf, removed: 0, isJpeg: false };
  const parts = [buf.subarray(0, 2)];
  let pos = 2;
  let removed = 0;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return { buffer: buf, removed: 0, isJpeg: true }; // unexpected layout: leave it
    const marker = buf[pos + 1];
    if (marker === 0xda) {
      // Start of scan: the rest is image data.
      parts.push(buf.subarray(pos));
      return { buffer: removed ? Buffer.concat(parts) : buf, removed, isJpeg: true };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    const length = buf.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (length < 2 || end > buf.length) return { buffer: buf, removed: 0, isJpeg: true };
    if (isMetadataMarker(marker)) removed += 1;
    else parts.push(buf.subarray(pos, end));
    pos = end;
  }
  return { buffer: buf, removed: 0, isJpeg: true };
}

module.exports = { stripJpegMetadata };
