const list=document.querySelector("[data-gallery-list]");
const message=document.querySelector("[data-gallery-message]");
const more=document.querySelector("[data-gallery-more]");
let page=0;
let fetching=false;
function makeLetter(item){
  const article=document.createElement("article");
  article.className="gallery-letter";
  const qLabel=document.createElement("p");qLabel.className="eyebrow";qLabel.textContent="来信";
  const question=document.createElement("p");question.className="gallery-question";question.textContent=item.question;
  const aLabel=document.createElement("p");aLabel.className="eyebrow";aLabel.textContent="回声";
  const answer=document.createElement("p");answer.className="gallery-answer";answer.textContent=item.answer||"（图片回声）";
  article.append(qLabel,question,aLabel,answer);
  return article;
}
async function nextPage(){
  if(fetching)return;
  fetching=true;more.disabled=true;message.textContent="";
  try{
    const response=await fetch("/api/gallery?page="+page,{cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"暂时无法读取展示区。");
    for(const letter of data.items)list.append(makeLetter(letter));
    if(page===0&&!data.items.length)message.textContent="还没有公开展示的来信。";
    page+=1;
    more.hidden=!data.hasMore;
  }catch(error){message.textContent=error.message||"电台有一点杂音。";}
  finally{fetching=false;more.disabled=false;}
}
more.addEventListener("click",nextPage);
nextPage();
