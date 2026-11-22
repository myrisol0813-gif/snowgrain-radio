// Web adaptation of Native SnowLetterVisuals.kt / tornRectPath and drawPaperclip.
// The SVG is decorative; the HTML remains semantic and accessible.
const ns="http://www.w3.org/2000/svg";
function node(tag,attrs={}) {
  const el=document.createElementNS(ns,tag);
  Object.entries(attrs).forEach(([key,value])=>el.setAttribute(key,String(value)));
  return el;
}
function sheetPath(w,h,shift=0,scale=1) {
  const left=10+shift,top=6+shift,right=w-10+shift,bottom=h-6+shift;
  const wobble=2.6*scale,step=22;
  const coords=[["M",left+10,top]];
  let x=left+10,i=0;
  while(x<right-10) {
    x=Math.min(x+step,right-10);
    coords.push(["L",x,top+((i%3)-1)*wobble]);i++;
  }
  let y=top+10;
  while(y<bottom-10) {
    y=Math.min(y+step,bottom-10);
    coords.push(["L",right+((i%3)-1)*wobble,y]);i++;
  }
  x=right-10;
  while(x>left+10) {
    x=Math.max(x-step,left+10);
    coords.push(["L",x,bottom+((i%3)-1)*wobble]);i++;
  }
  y=bottom-10;
  while(y>top+10) {
    y=Math.max(y-step,top+10);
    coords.push(["L",left+((i%3)-1)*wobble,y]);i++;
  }
  return coords.map(v=>v.join(" ")).join(" ")+" Z";
}
function drawPaper(shell,svg) {
  const {width,height}=shell.getBoundingClientRect();
  const small=shell.classList.contains("gallery-letter");
  const w=Math.max(small?180:280,Math.round(width)),h=Math.max(small?100:240,Math.round(height));
  svg.setAttribute("viewBox","0 0 "+w+" "+h);
  svg.setAttribute("width",w);
  svg.setAttribute("height",h);
  const shadow=node("path",{d:sheetPath(w,h,small?3:4,small?.38:.5),fill:"#B7C8D8","fill-opacity":small?".17":".20"});
  const paper=node("path",{d:sheetPath(w,h,0,small?.55:1),fill:"#FFFEFA",stroke:"#AFC4D8","stroke-opacity":small?".39":".30","stroke-width":"1"});
  if(small){svg.replaceChildren(shadow,paper);return;}
  const clip=node("g",{transform:"rotate(-20 40 34)",fill:"none",stroke:"#D7A84D"});
  clip.append(node("rect",{x:33,y:12,width:14,height:44,rx:8,"stroke-opacity":".43","stroke-width":2}));
  clip.append(node("rect",{x:37,y:19,width:7,height:30,rx:5,"stroke-opacity":".31","stroke-width":1.3}));
  svg.replaceChildren(shadow,paper,clip);
}
function mountPaper(shell) {
  if(shell.querySelector(":scope > .paper-backdrop"))return;
  const svg=node("svg",{class:"paper-backdrop","aria-hidden":"true",focusable:"false",preserveAspectRatio:"none"});
  shell.prepend(svg);
  let lastWidth=0,lastHeight=0;
  const redraw=()=>{
    const rect=shell.getBoundingClientRect();
    if(Math.abs(rect.width-lastWidth)<.5&&Math.abs(rect.height-lastHeight)<.5)return;
    lastWidth=rect.width;lastHeight=rect.height;
    drawPaper(shell,svg);
  };
  new ResizeObserver(redraw).observe(shell);
  redraw();
}
document.querySelectorAll(".snow-letter-page").forEach(mountPaper);

// Public gallery cards arrive asynchronously; give each one the same torn-paper
// silhouette as the surrounding sheet, without another paperclip on every card.
const galleryList=document.querySelector("[data-gallery-list]");
if(galleryList){
  const mountGalleryPapers=()=>{
    for(const letter of galleryList.children){
      if(letter.classList.contains("gallery-letter"))mountPaper(letter);
    }
  };
  new MutationObserver(mountGalleryPapers).observe(galleryList,{childList:true});
  mountGalleryPapers();
}
