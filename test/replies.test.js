import test from "node:test";
import assert from "node:assert/strict";
import {createReceipt,lookupReceipt,receiptMedia,saveReply} from "../src/replies.js";

function fakeEnv() {
  let knownHash="",storedId="sample-id";
  const env={
    RATE_LIMIT_SECRET:"a separate long signing secret for tests only",
    DB:{
      prepare(sql) {
        let args=[];
        return {
          bind(...values){args=values;return this;},
          async first(){
            if(sql.includes("INSERT INTO rate_limits"))return {count:1};
            if(sql.includes("FROM receipt_tokens t")) {
              return args[0]===knownHash ?
                {submission_id:storedId,message:"回信到了。",updated_at:"2026-11-22T12:00:00Z"} : null;
            }
            if(sql.includes("SELECT kind FROM submissions"))return {kind:"tuft"};
            return null;
          },
          async all(){
            if(sql.includes("FROM reply_attachments"))return {results:[]};
            return {results:[]};
          }
        };
      }
    }
  };
  return {env,record(hash,id="sample-id"){knownHash=hash;storedId=id;}};
}

test("each 192-bit pickup code is unique and only its digest is stored",async()=>{
  const {env}=fakeEnv();
  const first=await createReceipt(env);
  const second=await createReceipt(env);
  assert.match(first.code,/^[a-zA-Z0-9_-]{32}$/);
  assert.notEqual(first.code,second.code);
  assert.notEqual(first.hash,first.code);
  assert.equal(first.hash.length,64);
});

test("lookup validates codes and never reveals an unrelated letter",async()=>{
  const {env,record}=fakeEnv();
  const first=await createReceipt(env);
  const second=await createReceipt(env);
  record(first.hash);
  const request=code=>new Request("https://radio.example/api/receipt/lookup",{
    method:"POST",headers:{"content-type":"application/json",origin:"https://radio.example"},
    body:JSON.stringify({code})
  });
  const valid=await lookupReceipt(request(first.code),env);
  assert.equal(valid.status,200);
  const body=await valid.json();
  assert.equal(body.hasReply,true);
  assert.equal(body.message,"回信到了。");
  assert.equal("submission_id" in body,false);
  const wrong=await lookupReceipt(request(second.code),env);
  assert.equal(wrong.status,404);
  const invalid=await lookupReceipt(request("123"),env);
  assert.equal(invalid.status,400);
});

test("receipt media cannot be downloaded without its matching code",async()=>{
  const {env}=fakeEnv();
  const code=await createReceipt(env);
  const response=await receiptMedia(new Request("https://radio.example/api/receipt/media/123",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({code:code.code})
  }),env,"123");
  assert.equal(response.status,404);
});

test("a tuft entry cannot receive a public reply",async()=>{
  const {env}=fakeEnv();
  const response=await saveReply(new Request("https://radio.example/api/admin/submissions/123/reply",{
    method:"POST",body:new FormData()
  }),env,"123",{waitUntil(){}});
  assert.equal(response.status,404);
});
