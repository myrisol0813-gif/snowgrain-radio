import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedPushEndpoint,
  publicVapidKey,
  subscribeBrowser,
  notifyBrowsers
} from "../src/notify.js";

test("push service allowlist refuses arbitrary URLs and internal hosts",()=>{
  assert.equal(allowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"),true);
  assert.equal(allowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"),true);
  assert.equal(allowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"),false);
  assert.equal(allowedPushEndpoint("https://127.0.0.1/admin"),false);
  assert.equal(allowedPushEndpoint("https://fcm.googleapis.com.evil.com/push"),false);
  assert.equal(allowedPushEndpoint("https://evil.example/push"),false);
});

test("browser push keys are generated only on owner request, encrypted in the DB",async()=>{
  let saved=null;
  const env={
    ADMIN_SESSION_SECRET:"long-test-secret-never-used-in-production",
    DB:{prepare(sql){return {
      bind(...args){this.args=args;return this;},
      async first(){return saved;},
      async run(){
        saved={
          public_key:this.args[0],
          encrypted_private_jwk:this.args[1],
          nonce:this.args[2]
        };
        return {meta:{changes:1}};
      }
    };}}
  };
  const response=await publicVapidKey(env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.ok(result.publicKey.length>=80);
  assert.ok(saved.encrypted_private_jwk.length>100);
  assert.ok(!saved.encrypted_private_jwk.includes('"d"'));
  assert.equal(result.privateJwk,undefined);
});

test("browser push subscription rejects untrusted endpoint without DB writes",async()=>{
  const env={DB:{prepare(){throw Error("untrusted endpoint should be rejected before DB use");}}};
  const request=new Request("https://radio.elementeracoast.com/api/admin/notifications/subscribe",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({subscription:{endpoint:"http://localhost:8787/collect"}})
  });
  const response=await subscribeBrowser(request,env);
  assert.equal(response.status,400);
});

test("zero subscribed devices result in no browser notification fetch",async()=>{
  const env={DB:{prepare(sql){
    assert.match(sql,/FROM push_subscriptions/);
    return {all:async()=>({results:[]})};
  }}};
  await notifyBrowsers(env);
});
