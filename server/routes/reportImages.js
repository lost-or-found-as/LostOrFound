"use strict";
const { Router } = require("express");
const { supaAdmin } = require("../supabaseClient");
const { requireUserOrGuest } = require("../mw/auth");
const router = Router();
router.post("/:id/images", requireUserOrGuest, async (req, res) => {
  try {
    const reportId=req.params.id; const {path,sort_order=0}=req.body||{}; const user=req.user;
    if (!path || typeof path!=="string") return res.status(400).json({error:"path required"});
    const prefix=`${process.env.BUCKET_REPORT_IMAGES || "report-images"}/reports/${reportId}/`;
    if (!path.startsWith(prefix)) return res.status(400).json({error:"Invalid image path"});
    const {data:report,error:rErr}=await supaAdmin.from("reports").select("id").eq("id",reportId).eq("user_id",user.id).maybeSingle();
    if (rErr || !report) return res.status(403).json({error:"Not allowed"});
    const {data,error}=await supaAdmin.from("report_images").insert({report_id:reportId,path,sort_order:Number(sort_order)||0,created_by:user.id}).select().single();
    if (error) return res.status(400).json({error:error.message});
    return res.json({image:data});
  } catch(e) { return res.status(500).json({error:e?.message ?? "Server error"}); }
});
module.exports=router;
