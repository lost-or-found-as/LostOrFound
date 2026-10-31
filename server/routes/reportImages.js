"use strict";
const { Router } = require("express");
const { supaAdmin } = require("../supabaseClient");
const { requireUserOrGuest } = require("../mw/auth");
const { stripJpegMetadata } = require("../lib/jpegMetadata");
const router = Router();

async function stripStoredImageMetadata(dbPath, reportId) {
  const [bucket, ...rest] = String(dbPath).split("/");
  const objectPath = rest.join("/");
  try {
    const { data: blob, error } = await supaAdmin.storage.from(bucket).download(objectPath);
    if (error || !blob) throw error || new Error("IMAGE_DOWNLOAD_FAILED");
    const original = Buffer.from(await blob.arrayBuffer());
    const { buffer, removed, isJpeg } = stripJpegMetadata(original);
    if (!isJpeg || removed === 0) return;
    const { error: upErr } = await supaAdmin.storage
      .from(bucket)
      .upload(objectPath, buffer, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;
    console.info("[report-images][metadata-removed]", { reportId, segments: removed });
  } catch (e) {
    // The app already re-encodes photos without metadata; log and keep the photo.
    console.warn("[report-images][metadata-strip-failed]", { reportId, errorMessage: e?.message || String(e) });
  }
}
router.post("/:id/images", requireUserOrGuest, async (req, res) => {
  try {
    const reportId=req.params.id; const {path,sort_order=0}=req.body||{}; const user=req.user;
    if (!path || typeof path!=="string") return res.status(400).json({error:"path required"});
    const prefix=`${process.env.BUCKET_REPORT_IMAGES || "report-images"}/reports/${reportId}/`;
    if (!path.startsWith(prefix)) return res.status(400).json({error:"Invalid image path"});
    const {data:report,error:rErr}=await supaAdmin.from("reports").select("id").eq("id",reportId).eq("user_id",user.id).maybeSingle();
    if (rErr || !report) return res.status(403).json({error:"Not allowed"});
    // T1.9L: remove GPS position and other hidden metadata before anyone can see the photo.
    await stripStoredImageMetadata(path, reportId);
    const {data,error}=await supaAdmin.from("report_images").insert({report_id:reportId,path,sort_order:Number(sort_order)||0,created_by:user.id}).select().single();
    if (error) return res.status(400).json({error:error.message});
    return res.json({image:data});
  } catch(e) { return res.status(500).json({error:e?.message ?? "Server error"}); }
});
module.exports=router;
