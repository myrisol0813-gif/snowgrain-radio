// Owner opt-in Web Push. No letter contents, recipient email or images leave the radio.
// Private VAPID signing key is AES-GCM encrypted at rest using the existing admin secret.
const encoder=new TextEncoder();
const decoder=new TextDecoder();

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}
function fail(error,status=400){return json({ok:false,error},status);}
function base64url(value){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function fromBase64url(value){
  const padded=String(value).replace(/-/g,"+").replace(/_/g,"/");
  const binary=atob(padded+"=".repeat((4-padded.length%4)%4));
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function adminSecret(env){
  return env.ADMIN_SESSION_SECRET||env.ADMIN_TOKEN||"";
}
async function encryptionKey(env){
  const secret=adminSecret(env);
  if(!secret)throw Error("Missing admin encryption secret");
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode("snowgrain push key v1:"+secret));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}

async function encryptPrivate(env,privateJwk){
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const key=await encryptionKey(env);
  const data=encoder.encode(JSON.stringify(privateJwk));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce},key,data);
  return {encrypted:base64url(ciphertext),nonce:base64url(nonce)};
}
async function decryptPrivate(env,row){
  const key=await encryptionKey(env);
  const plaintext=await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:fromBase64url(row.nonce)},key,fromBase64url(row.encrypted_private_jwk)
  );
  return JSON.parse(decoder.decode(plaintext));
}

async function getConfig(env){
  return env.DB.prepare("SELECT public_key,encrypted_private_jwk,nonce FROM push_config WHERE id=1").first();
}

async function makeConfig(env){
  const current=await getConfig(env);
  if(current)return current;
  const keys=await crypto.subtle.generateKey(
    {name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]
  );
  const publicKey=base64url(await crypto.subtle.exportKey("raw",keys.publicKey));
  const privateJwk=await crypto.subtle.exportKey("jwk",keys.privateKey);
  const sealed=await encryptPrivate(env,privateJwk);
  const now=new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO push_config(id,public_key,encrypted_private_jwk,nonce,created_at) VALUES (1,?,?,?,?)"
  ).bind(publicKey,sealed.encrypted,sealed.nonce,now).run();
  return getConfig(env);
}

export function allowedPushEndpoint(endpoint){
  if(typeof endpoint!=="string"||endpoint.length>2048)return false;
  try {
    const uri=new URL(endpoint);
    if(uri.protocol!=="https:"||uri.username||uri.password||uri.port||uri.hash)return false;
    const host=uri.hostname.toLowerCase();
    return host==="fcm.googleapis.com"
      ||host==="updates.push.services.mozilla.com"
      ||host==="web.push.apple.com"
      ||host.endsWith(".push.apple.com")
      ||host==="wns.notify.windows.com"
      ||host.endsWith(".notify.windows.com");
  }catch{return false;}
}

export async function publicVapidKey(env){
  try {
    const config=await makeConfig(env);
    if(!config)return fail("提醒密钥没有准备好。",503);
    return json({ok:true,publicKey:config.public_key});
  }catch(error){
    console.error("push key initialization failed",error);
    return fail("提醒服务暂时没有准备好。",503);
  }
}

export async function subscriptionStatus(env){
  const row=await env.DB.prepare("SELECT COUNT(*) AS total FROM push_subscriptions").first();
  return json({ok:true,subscribedDevices:Number(row?.total||0)});
}

export async function subscribeBrowser(request,env){
  let data;
  try{data=await request.json();}catch{return fail("无法读取浏览器订阅。");}
  const endpoint=data?.subscription?.endpoint;
  if(!allowedPushEndpoint(endpoint))return fail("这不是受支持的浏览器推送地址。");
  const existing=await env.DB.prepare(
    "SELECT endpoint FROM push_subscriptions WHERE endpoint=?"
  ).bind(endpoint).first();
  if(!existing){
    const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM push_subscriptions").first();
    if(Number(count?.total||0)>=8)return fail("已经绑定八台设备，请先取消旧设备提醒。",409);
  }
  const now=new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO push_subscriptions(endpoint,created_at,updated_at) VALUES (?,?,?) "+
    "ON CONFLICT(endpoint) DO UPDATE SET updated_at=excluded.updated_at"
  ).bind(endpoint,now,now).run();
  return json({ok:true});
}

export async function unsubscribeBrowser(request,env){
  let data;
  try{data=await request.json();}catch{return fail("无法读取取消订阅请求。");}
  const endpoint=data?.endpoint;
  if(!allowedPushEndpoint(endpoint))return fail("无效的订阅信息。");
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(endpoint).run();
  return json({ok:true});
}

export async function clearSubscriptions(env){
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
  return json({ok:true});
}

async function authorization(env,config,endpoint){
  const key=await crypto.subtle.importKey("jwk",await decryptPrivate(env,config),
    {name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const url=new URL(endpoint);
  const header=base64url(encoder.encode(JSON.stringify({typ:"JWT",alg:"ES256"})));
  const payload=base64url(encoder.encode(JSON.stringify({
    aud:url.origin,
    exp:Math.floor(Date.now()/1000)+3600,
    sub:"https://radio.elementeracoast.com/"
  })));
  const token=header+"."+payload;
  const sig=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,encoder.encode(token));
  return "vapid t="+token+"."+base64url(sig)+", k="+config.public_key;
}

export async function notifyBrowsers(env){
  const rows=await env.DB.prepare(
    "SELECT endpoint FROM push_subscriptions ORDER BY updated_at DESC LIMIT 8"
  ).all();
  const subscriptions=(rows.results||[]).filter(row=>allowedPushEndpoint(row.endpoint));
  if(!subscriptions.length)return;
  const config=await getConfig(env);
  if(!config)return;
  await Promise.allSettled(subscriptions.map(async(row)=>{
    try {
      // Empty Web Push: the service worker supplies the fixed generic text.
      // Never send questions, addresses, tokens, nicknames or image metadata.
      const auth=await authorization(env,config,row.endpoint);
      const response=await fetch(row.endpoint,{
        method:"POST",
        headers:{"Authorization":auth,"TTL":"3600","Urgency":"normal"}
      });
      if(response.status===404||response.status===410){
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=?")
          .bind(row.endpoint).run();
      }else if(!response.ok){
        console.error("push delivery HTTP status",response.status);
      }
    }catch(error){
      console.error("push delivery failed",error instanceof Error?error.name:"unknown");
    }
  }));
}
