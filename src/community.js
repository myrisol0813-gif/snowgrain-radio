import {getReceiptOwnerFromRequest} from "./replies.js";

function json(payload,status=200) {
  return new Response(JSON.stringify(payload),{
    status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}
function fail(message,status=400) {return json({ok:false,error:message},status);}

export async function publicWall(request,env) {
  const url=new URL(request.url);
  const parsed=Number(url.searchParams.get("page")||"0");
  const page=Number.isInteger(parsed)&&parsed>=0&&parsed<=100 ? parsed : 0;
  const limit=12;
  const result=await env.DB.prepare(
    "SELECT s.message AS question,r.message AS answer,r.updated_at AS replied_at "+
    "FROM submissions s INNER JOIN replies r ON r.submission_id=s.id "+
    "WHERE s.kind='ask' AND s.allow_public=1 AND s.is_public=1 "+
    "AND length(trim(s.message))>0 AND length(trim(r.message))>0 "+
    "ORDER BY r.updated_at DESC,s.created_at DESC LIMIT ? OFFSET ?"
  ).bind(limit+1,limit*page).all();
  const rows=result.results||[];
  // Gallery deliberately excludes email, attachments, raw IDs and internal status.
  return json({ok:true,items:rows.slice(0,limit).map(row=>({
    question:row.question,answer:row.answer,repliedAt:row.replied_at
  })),hasMore:rows.length>limit,page});
}

export async function changePublication(request,env,id) {
  let body;
  try{body=await request.json();}catch{body=null;}
  if(typeof body?.published!=="boolean")return fail("请选择是否展示。");
  const now=new Date().toISOString();
  const sql=body.published
    ? "UPDATE submissions SET is_public=1,updated_at=? WHERE id=? AND kind='ask' "+
      "AND allow_public=1 AND length(trim(message))>0 "+
      "AND EXISTS(SELECT 1 FROM replies WHERE submission_id=submissions.id AND length(trim(message))>0)"
    : "UPDATE submissions SET is_public=0,updated_at=? WHERE id=?";
  const result=await env.DB.prepare(sql).bind(now,id).run();
  if(!result.meta?.changes) return fail(
    body.published?"只有投稿者同意公开、且已回复的文字提问才能展示。":"没有找到这封信。",409
  );
  return json({ok:true,published:body.published});
}

export async function removeSubmission(env,id) {
  const row=await env.DB.prepare("SELECT id FROM submissions WHERE id=?").bind(id).first();
  if(!row)return fail("这封信已经不存在了。",404);
  const [received,sent]=await Promise.all([
    env.DB.prepare("SELECT object_key FROM attachments WHERE submission_id=?").bind(id).all(),
    env.DB.prepare("SELECT object_key FROM reply_attachments WHERE submission_id=?").bind(id).all()
  ]);
  const keys=[...(received.results||[]),...(sent.results||[])].map(x=>x.object_key);
  // Purge private storage before removing its D1 references; errors abort deletion
  // so the owner can retry rather than silently leaving private R2 objects behind.
  try {
    for (const key of keys) await env.MEDIA.delete(key);
    const result=await env.DB.batch([
      env.DB.prepare("DELETE FROM attachments WHERE submission_id=?").bind(id),
      env.DB.prepare("DELETE FROM reply_attachments WHERE submission_id=?").bind(id),
      env.DB.prepare("DELETE FROM receipt_tokens WHERE submission_id=?").bind(id),
      env.DB.prepare("DELETE FROM replies WHERE submission_id=?").bind(id),
      env.DB.prepare("DELETE FROM submissions WHERE id=?").bind(id)
    ]);
    if(!result[result.length-1]?.meta?.changes) return fail("这封信已被删除。",404);
  } catch(error) {
    console.error("delete submission failed",error);
    return fail("删除暂时没有完成，请稍后重试。",500);
  }
  return json({ok:true,deleted:true});
}

export async function removeOwnSubmission(request,env) {
  const owner=await getReceiptOwnerFromRequest(request,env);
  if(owner.failure)return owner.failure;
  return removeSubmission(env,owner.id);
}
