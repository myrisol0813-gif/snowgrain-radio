import test from "node:test";
import assert from "node:assert/strict";
import {publicWall,changePublication,removeSubmission,removeOwnSubmission} from "../src/community.js";
import {createReceipt} from "../src/replies.js";
import {validateMessage} from "../src/core.js";

test("tuft submissions accept their own private reference images",()=>{
  assert.equal(validateMessage("tuft","我的人物设定","artist@example.com",3),null);
  assert.match(validateMessage("tuft","我的人物设定","",3),/邮箱/);
});

function dbStub() {
  const queries=[];
  const deletions=[];
  let changes=1;
  let matchingHash="";
  const env={
    RATE_LIMIT_SECRET:"test-only-secret",
    DB:{
      prepare(sql){
        const entry={sql,args:[]};
        queries.push(entry);
        return {
          bind(...args){entry.args=args;return this;},
          async all(){
            if(sql.includes("FROM submissions s INNER JOIN replies r"))
              return {results:[{question:"问候",answer:"你好",replied_at:"2026-11-22"}]};
            return {results:[]};
          },
          async first(){
            if(sql.includes("INSERT INTO rate_limits"))return {count:1};
            if(sql.includes("FROM receipt_tokens WHERE token_hash=?"))
              return entry.args[0]===matchingHash?{submission_id:"letter-a"}:null;
            if(sql.includes("SELECT id FROM submissions"))return {id:"letter-a"};
            return null;
          },
          async run(){return {meta:{changes}};}
        };
      },
      async batch(items) {
        deletions.push(items.length);
        return items.map(()=>({meta:{changes:1}}));
      }
    },
    MEDIA:{async delete(){}}
  };
  return {env,queries,deletions,
    setChanges(n){changes=n;},
    allowHash(hash){matchingHash=hash;}
  };
}

test("gallery SQL restricts publication to consented, owner-approved answered letters",async()=>{
  const {env,queries}=dbStub();
  const response=await publicWall(new Request("https://radio.example/api/gallery"),env);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.items,[{question:"问候",answer:"你好",repliedAt:"2026-11-22"}]);
  assert.ok(!("email" in body.items[0]));
  const sql=queries[0].sql;
  for(const must of ["kind='ask'","allow_public=1","is_public=1","INNER JOIN replies","length(trim(r.message))>0"])
    assert.ok(sql.includes(must),must);
});

test("owner publication cannot be enabled without consent and existing text reply",async()=>{
  const {env,queries,setChanges}=dbStub();
  setChanges(0);
  const request=new Request("https://radio.example/api/admin/submissions/a/public",{
    method:"PATCH",headers:{"content-type":"application/json"},
    body:JSON.stringify({published:true})
  });
  const response=await changePublication(request,env,"a");
  assert.equal(response.status,409);
  const sql=queries.at(-1).sql;
  assert.match(sql,/allow_public=1/);
  assert.match(sql,/length\(trim\(message\)\)>0/);
});

test("deleting a letter removes private media and database children",async()=>{
  const {env,deletions}=dbStub();
  const response=await removeSubmission(env,"letter-a");
  assert.equal(response.status,200);
  assert.equal((await response.json()).deleted,true);
  assert.deepEqual(deletions,[5]);
});

test("wrong pickup code cannot delete anyone else's letter",async()=>{
  const {env}=dbStub();
  const {code}=await createReceipt(env);
  const response=await removeOwnSubmission(new Request(
    "https://radio.example/api/receipt/submission",{
      method:"DELETE",headers:{"content-type":"application/json"},
      body:JSON.stringify({code})
    }),env);
  assert.equal(response.status,404);
});

test("verified pickup code can delete its own entry",async()=>{
  const {env,allowHash}=dbStub();
  const {code,hash}=await createReceipt(env);
  allowHash(hash);
  const response=await removeOwnSubmission(new Request(
    "https://radio.example/api/receipt/submission",{
      method:"DELETE",headers:{"content-type":"application/json"},
      body:JSON.stringify({code})
    }),env);
  assert.equal(response.status,200);
});
