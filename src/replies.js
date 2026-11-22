import {
  ALLOWED_IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES,
  bytesToBase64, hmacHex
} from "./core.js";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}
function fail(message, status = 400) {return json({ok:false,error:message},status);}
function sameOrigin(request) {
  const origin=request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function newCode() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(24)))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function validCode(code) {return typeof code==="string" && /^[A-Za-z0-9_-]{32}$/.test(code);}
async function codeHash(env,code) {
  if(!env.RATE_LIMIT_SECRET) throw Error("RATE_LIMIT_SECRET required");
  return hmacHex(env.RATE_LIMIT_SECRET,"snowgrain:receipt:"+code);
}

async function rateLimit(request,env,kind) {
  const ip=request.headers.get("CF-Connecting-IP")||"local";
  const hour=new Date().toISOString().slice(0,13);
  const key=await hmacHex(env.RATE_LIMIT_SECRET,kind+":"+hour+":"+ip);
  const ends=new Date(Date.now()+7200000).toISOString();
  const record=await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,window_ends_at) VALUES (?,1,?) "+
    "ON CONFLICT(key) DO UPDATE SET count=count+1,window_ends_at=excluded.window_ends_at "+
    "RETURNING count").bind(key,ends).first();
  return Number(record?.count||1)<=24;
}

export async function createReceipt(env) {
  const code=newCode();
  return {code,hash:await codeHash(env,code)};
}
export function receiptInsert(env,id,hash,now) {
  return env.DB.prepare(
    "INSERT INTO receipt_tokens(submission_id,token_hash,created_at) VALUES (?,?,?)"
  ).bind(id,hash,now);
}

async function verifyCodeRequest(request,env) {
  if(!sameOrigin(request)) return {failure:fail("来源不匹配。",403)};
  if(!(await rateLimit(request,env,"receipt"))) return {failure:fail("取信次数有点多，请晚些再试。",429)};
  let data;
  try {data=await request.json();} catch {data=null;}
  if(!validCode(data?.code)) return {failure:fail("取信码格式不正确。")};
  return {hash:await codeHash(env,data.code)};
}

export async function lookupReceipt(request,env) {
  const checked=await verifyCodeRequest(request,env);
  if(checked.failure) return checked.failure;
  const row=await env.DB.prepare(
    "SELECT t.submission_id,r.message,r.updated_at FROM receipt_tokens t "+
    "LEFT JOIN replies r ON r.submission_id=t.submission_id WHERE t.token_hash=?"
  ).bind(checked.hash).first();
  if(!row) return fail("没有找到这封信，请检查取信码。",404);
  if(row.message==null) return json({ok:true,hasReply:false});
  const photos=await env.DB.prepare(
    "SELECT id,media_type FROM reply_attachments WHERE submission_id=? ORDER BY created_at ASC"
  ).bind(row.submission_id).all();
  return json({ok:true,hasReply:true,message:row.message,updatedAt:row.updated_at,
    attachments:(photos.results||[]).map(p=>({id:p.id,mediaType:p.media_type}))});
}

export async function receiptMedia(request,env,id) {
  const checked=await verifyCodeRequest(request,env);
  if(checked.failure) return checked.failure;
  const row=await env.DB.prepare(
    "SELECT a.object_key,a.media_type FROM reply_attachments a "+
    "JOIN receipt_tokens t ON t.submission_id=a.submission_id "+
    "WHERE a.id=? AND t.token_hash=?"
  ).bind(id,checked.hash).first();
  if(!row) return fail("没有找到这张图片。",404);
  const object=await env.MEDIA.get(row.object_key);
  if(!object) return fail("照片暂时不在架子上。",404);
  return new Response(object.body,{headers:{
    "content-type":row.media_type,
    "cache-control":"private, no-store",
    "x-content-type-options":"nosniff",
    "content-security-policy":"default-src 'none'; sandbox"
  }});
}

export async function addReplyData(env,submissions) {
  if(!submissions.length) return;
  const ids=submissions.map(s=>s.id);
  const markers=ids.map(()=>"?").join(",");
  const replyRows=await env.DB.prepare(
    "SELECT submission_id,message,updated_at FROM replies WHERE submission_id IN ("+markers+")"
  ).bind(...ids).all();
  const imageRows=await env.DB.prepare(
    "SELECT id,submission_id,media_type,original_name,size_bytes "+
    "FROM reply_attachments WHERE submission_id IN ("+markers+") ORDER BY created_at ASC"
  ).bind(...ids).all();
  const replies=new Map((replyRows.results||[]).map(r=>[r.submission_id,{
    message:r.message,updatedAt:r.updated_at,attachments:[]
  }]));
  for(const image of imageRows.results||[]){
    const reply=replies.get(image.submission_id);
    if(reply)reply.attachments.push({id:image.id,mediaType:image.media_type,
      originalName:image.original_name,sizeBytes:image.size_bytes});
  }
  for(const submission of submissions)submission.reply=replies.get(submission.id)||null;
}

export async function saveReply(request,env,id,ctx) {
  if(!sameOrigin(request))return fail("来源不匹配。",403);
  const record=await env.DB.prepare("SELECT kind FROM submissions WHERE id=?").bind(id).first();
  if(record?.kind!=="ask")return fail("只有收信频道可以写回声。",404);
  let form;
  try {form=await request.formData();}catch{return fail("没能读懂回复。");}
  const message=String(form.get("message")||"").trim();
  const images=form.getAll("images").filter(f=>f&&typeof f==="object"&&"arrayBuffer" in f);
  if(message.length>12000)return fail("回复不能超过12000字。");
  if(!message&&!images.length)return fail("请填写回复或放入图片。");
  if(images.length>MAX_IMAGES)return fail("回复最多四张图片。");
  let total=0;
  for(const img of images){
    total+=img.size;
    if(!ALLOWED_IMAGE_TYPES.has(img.type)||img.size>MAX_IMAGE_BYTES)
      return fail("回复图片只能用 JPG、PNG、WebP，单张不超过6MB。");
  }
  if(total>MAX_TOTAL_IMAGE_BYTES)return fail("回复图片合计不能超过20MB。");
  const replaceMedia=images.length>0||String(form.get("clearImages"))==="true";
  const old=replaceMedia ? await env.DB.prepare(
    "SELECT object_key FROM reply_attachments WHERE submission_id=?"
  ).bind(id).all() : {results:[]};
  const now=new Date().toISOString(),stored=[],inserts=[];
  try {
    for(const img of images){
      const imageId=crypto.randomUUID();
      const ext=img.type==="image/png"?"png":img.type==="image/webp"?"webp":"jpg";
      const objectKey="replies/"+id+"/"+imageId+"."+ext;
      await env.MEDIA.put(objectKey,await img.arrayBuffer(),{
        httpMetadata:{contentType:img.type},customMetadata:{submissionId:id,attachmentId:imageId}
      });
      stored.push(objectKey);
      inserts.push(env.DB.prepare(
        "INSERT INTO reply_attachments(id,submission_id,object_key,media_type,original_name,size_bytes,created_at) "+
        "VALUES (?,?,?,?,?,?,?)"
      ).bind(imageId,id,objectKey,img.type,String(img.name||"reply."+ext).slice(0,180),img.size,now));
    }
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO replies(submission_id,message,updated_at) VALUES (?,?,?) "+
        "ON CONFLICT(submission_id) DO UPDATE SET message=excluded.message,updated_at=excluded.updated_at"
      ).bind(id,message,now),
      ...(replaceMedia?[env.DB.prepare("DELETE FROM reply_attachments WHERE submission_id=?").bind(id),...inserts]:[]),
      env.DB.prepare("UPDATE submissions SET status='done',updated_at=? WHERE id=?").bind(now,id)
    ]);
  }catch(error){
    await Promise.allSettled(stored.map(key=>env.MEDIA.delete(key)));
    console.error("reply save failed",error);
    return fail("回复保存失败，请重试。",500);
  }
  const keys=(old.results||[]).map(row=>row.object_key);
  if(keys.length)ctx.waitUntil(Promise.allSettled(keys.map(key=>env.MEDIA.delete(key))));
  return json({ok:true,updatedAt:now});
}

export async function adminReplyMedia(env,id) {
  const row=await env.DB.prepare(
    "SELECT object_key,media_type FROM reply_attachments WHERE id=?"
  ).bind(id).first();
  if(!row)return fail("图片不存在。",404);
  const object=await env.MEDIA.get(row.object_key);
  if(!object)return fail("图片暂时不在。",404);
  return new Response(object.body,{headers:{
    "content-type":row.media_type,"cache-control":"private, no-store",
    "x-content-type-options":"nosniff"
  }});
}
