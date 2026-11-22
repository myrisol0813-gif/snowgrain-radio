const form=document.querySelector("[data-pickup-form]");
const status=document.querySelector("[data-pickup-status]");
const letter=document.querySelector("[data-pickup-reply]");
const text=document.querySelector("[data-reply-text]");
const images=document.querySelector("[data-reply-images]");
let urls=[];
function clearPhotos(){
  for(const url of urls)URL.revokeObjectURL(url);
  urls=[];
  images.replaceChildren();
}
window.addEventListener("pagehide",clearPhotos);
async function submit(event){
  event.preventDefault();
  const code=form.elements.code.value.trim();
  const button=form.querySelector('button[type="submit"]');
  status.textContent="";
  letter.hidden=true;
  text.textContent="";
  clearPhotos();
  button.disabled=true;
  try{
    const res=await fetch("/api/receipt/lookup",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({code}),cache:"no-store"
    });
    const result=await res.json();
    if(!res.ok)throw Error(result.error||"取信失败。");
    if(!result.hasReply){
      status.textContent="信已经收到，不过回声还在路上。过些日子再来听听吧。";
      return;
    }
    text.textContent=result.message||"（这封回声只有图片）";
    for(const file of result.attachments||[]){
      const mediaRes=await fetch("/api/receipt/media/"+encodeURIComponent(file.id),{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({code}),cache:"no-store"
      });
      if(!mediaRes.ok)throw Error("有张回信图片暂时取不到。");
      const blob=await mediaRes.blob();
      const url=URL.createObjectURL(blob);
      urls.push(url);
      const img=document.createElement("img");
      img.src=url;
      img.alt="随信附上的图片";
      img.loading="lazy";
      images.append(img);
    }
    letter.hidden=false;
    status.textContent="回声到了。";
  }catch(error){
    status.textContent=error.message||"电台暂时有杂音。";
  }finally{
    button.disabled=false;
  }
}
form.addEventListener("submit",submit);
