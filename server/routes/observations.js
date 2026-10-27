
"use strict";
const express=require("express");
const router=express.Router();
const {supaAdmin}=require("../supabaseClient");
const {requireUser}=require("../mw/auth");
const {notifyUser}=require("../lib/userNotify");
const {localizedPair}=require("../lib/messages");
function cleanText(v,n){const s=String(v||"").trim();return s?s.slice(0,n):null;}
function validPoint(lat,lng){return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;}
async function getCampaign(id){const q=await supaAdmin.from("geo_alert_campaigns").select("id,user_id,report_id,status,ends_at,reports(id,user_id,type,status,deleted_at,title)").eq("id",id).maybeSingle();if(q.error)throw q.error;return q.data||null;}
async function received(c,u){const q=await supaAdmin.from("geo_alert_recipients").select("campaign_id").eq("campaign_id",c).eq("user_id",u).maybeSingle();if(q.error)throw q.error;return !!q.data;}
router.post("/",requireUser,async(req,res)=>{try{
 const userId=req.user?.id,campaignId=String(req.body?.campaignId||"").trim(),type=String(req.body?.observationType||"").trim().toUpperCase();
 const lat=Number(req.body?.latitude),lng=Number(req.body?.longitude),observedAt=new Date(req.body?.observedAt||Date.now()),clientRequestId=String(req.body?.clientRequestId||"").trim();
 if(!userId)return res.status(401).json({error:"UNAUTHORIZED"});
 if(!campaignId||!clientRequestId)return res.status(400).json({error:"MISSING_REQUIRED_FIELDS"});
 if(!["SEEN","FOUND"].includes(type))return res.status(400).json({error:"INVALID_OBSERVATION_TYPE"});
 if(!validPoint(lat,lng))return res.status(400).json({error:"INVALID_LOCATION"});
 if(!Number.isFinite(observedAt.getTime()))return res.status(400).json({error:"INVALID_OBSERVED_AT"});
 if(type==="FOUND" && typeof req.body?.hasItem!=="boolean")return res.status(400).json({error:"HAS_ITEM_CHOICE_REQUIRED"});
 const campaign=await getCampaign(campaignId);if(!campaign)return res.status(404).json({error:"AREA_ALERT_NOT_FOUND"});
 const report=campaign.reports;if(!report||report.deleted_at||String(report.type).toUpperCase()!=="LOST")return res.status(409).json({error:"REPORT_NOT_AVAILABLE"});
 if(String(campaign.status).toUpperCase()!=="ACTIVE"||(campaign.ends_at&&new Date(campaign.ends_at)<=new Date()))return res.status(409).json({error:"AREA_ALERT_NOT_ACTIVE"});
 if(report.user_id===userId)return res.status(409).json({error:"OWNER_CANNOT_OBSERVE_OWN_REPORT"});
 if(!(await received(campaignId,userId)))return res.status(403).json({error:"AREA_ALERT_ACCESS_DENIED"});
 const row={campaign_id:campaignId,report_id:campaign.report_id,observer_user_id:userId,report_owner_user_id:report.user_id,observation_type:type,location:`SRID=4326;POINT(${lng} ${lat})`,observed_at:observedAt.toISOString(),comment:cleanText(req.body?.comment,1000),movement_direction:type==="SEEN"?cleanText(req.body?.movementDirection,120):null,has_item:type==="FOUND"?req.body.hasItem:false,client_request_id:clientRequestId,updated_at:new Date().toISOString()};
 const q=await supaAdmin.from("area_alert_observations").upsert(row,{onConflict:"observer_user_id,client_request_id"}).select("id,campaign_id,report_id,observation_type,observed_at,comment,movement_direction,has_item,status,created_at").single();if(q.error)throw q.error;
 const found=type==="FOUND";
 await notifyUser({
  userId:report.user_id,type:"AREA_ALERT_OBSERVATION",entityType:"observation",entityId:q.data.id,
  titles:localizedPair(found?"push.observationFound.title":"push.observationSeen.title"),
  bodies:localizedPair(found?"push.observationFound.body":"push.observationSeen.body"),
  data:{observationId:q.data.id,reportId:campaign.report_id}
 });
 return res.json({ok:true,observation:q.data});
}catch(e){return res.status(500).json({error:e?.message||"OBSERVATION_CREATE_FAILED"});}});
router.get("/:id",requireUser,async(req,res)=>{try{
 const userId=req.user?.id,id=String(req.params.id||"").trim();const q=await supaAdmin.from("area_alert_observations").select("id,campaign_id,report_id,observer_user_id,report_owner_user_id,observation_type,observed_at,comment,movement_direction,has_item,status,created_at,location,reports(id,title,location_label,category,subcategory_key,color,brand)").eq("id",id).maybeSingle();if(q.error)throw q.error;
 if(!q.data||(q.data.observer_user_id!==userId&&q.data.report_owner_user_id!==userId))return res.status(404).json({error:"OBSERVATION_NOT_FOUND"});
 const p=await supaAdmin.rpc("observation_point",{p_observation_id:id});if(p.error)throw p.error;const pt=Array.isArray(p.data)?p.data[0]:p.data;
 const c=await supaAdmin.from("observation_conversations").select("id").eq("observation_id",id).maybeSingle();if(c.error&&c.error.code!=="42P01")throw c.error;
 return res.json({ok:true,role:q.data.report_owner_user_id===userId?"OWNER":"OBSERVER",conversationId:c.data?.id||null,observation:{...q.data,latitude:pt?.latitude,longitude:pt?.longitude}});
}catch(e){return res.status(500).json({error:e?.message||"OBSERVATION_LOAD_FAILED"});}});
router.post("/:id/status",requireUser,async(req,res)=>{try{
 const userId=req.user?.id,id=String(req.params.id||"").trim(),status=String(req.body?.status||"").toUpperCase();if(!["RELEVANT","DISMISSED"].includes(status))return res.status(400).json({error:"INVALID_STATUS"});
 const o=await supaAdmin.from("area_alert_observations").select("id,report_owner_user_id,observer_user_id").eq("id",id).maybeSingle();if(o.error)throw o.error;if(!o.data||o.data.report_owner_user_id!==userId)return res.status(404).json({error:"OBSERVATION_NOT_FOUND"});
 const u=await supaAdmin.from("area_alert_observations").update({status,updated_at:new Date().toISOString()}).eq("id",id).select("id,status").single();if(u.error)throw u.error;
 await notifyUser({
  userId:o.data.observer_user_id,type:"OBSERVATION_STATUS",entityType:"observation",entityId:id,
  titles:localizedPair(status==="RELEVANT"?"push.observationRelevant.title":"push.observationDismissed.title"),
  bodies:localizedPair(status==="RELEVANT"?"push.observationRelevant.body":"push.observationDismissed.body")
 });
 return res.json({ok:true,observation:u.data});
}catch(e){return res.status(500).json({error:e?.message||"OBSERVATION_STATUS_FAILED"});}});
module.exports=router;
