const loginCard = document.querySelector("[data-login-card]");
const dashboard = document.querySelector("[data-admin-dashboard]");
const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");
const adminMessage = document.querySelector("[data-admin-message]");
const list = document.querySelector("[data-submission-list]");
const emptyInbox = document.querySelector("[data-empty-inbox]");
const signalCount = document.querySelector("[data-signal-count]");
const kindFilter = document.querySelector("[data-kind-filter]");
const statusFilter = document.querySelector("[data-status-filter]");

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = { error: "电台没有返回可以读懂的内容。" };
  }
  if (!response.ok) {
    const error = new Error(result.error || "请求失败。");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showLogin() {
  loginCard.hidden = false;
  dashboard.hidden = true;
}

function showDashboard() {
  loginCard.hidden = true;
  dashboard.hidden = false;
}

async function checkSession() {
  try {
    await api("/api/admin/session");
    showDashboard();
    await Promise.all([loadSettings(), loadSubmissions()]);
  } catch {
    showLogin();
  }
}

async function login(event) {
  event.preventDefault();
  loginStatus.textContent = "";
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: loginForm.elements.password.value })
    });
    loginForm.reset();
    showDashboard();
    await Promise.all([loadSettings(), loadSubmissions()]);
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadSettings() {
  const result = await api("/api/admin/settings");
  document.querySelector('[data-setting="askOpen"]').checked = result.askOpen;
  document.querySelector('[data-setting="tuftOpen"]').checked = result.tuftOpen;
}

async function updateSetting(event) {
  const checkbox = event.currentTarget;
  checkbox.disabled = true;
  adminMessage.textContent = "";
  try {
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ [checkbox.dataset.setting]: checkbox.checked })
    });
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    adminMessage.textContent = error.message;
  } finally {
    checkbox.disabled = false;
  }
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createEmailRow(email) {
  const row = document.createElement("div");
  row.className = "email-row";
  const code = document.createElement("code");
  code.textContent = email;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "复制";
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(email);
    button.textContent = "好了";
    window.setTimeout(() => {
      button.textContent = "复制";
    }, 1200);
  });
  row.append(code, button);
  return row;
}

function createAttachments(attachments, isReply = false) {
  const grid = document.createElement("div");
  grid.className = "attachment-grid";
  attachments.forEach((attachment) => {
    const button = document.createElement("button");
    button.className = "attachment-button";
    button.type = "button";
    button.setAttribute("aria-label", "显示 " + attachment.originalName);
    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = "";
    image.src = (isReply ? "/api/admin/reply-media/" : "/api/admin/media/") + encodeURIComponent(attachment.id);
    button.append(image);
    button.addEventListener("click", () => {
      button.classList.toggle("is-revealed");
    });
    grid.append(button);
  });
  return grid;
}

function statusSelect(submission) {
  const actions = document.createElement("div");
  actions.className = "submission-actions";
  const select = document.createElement("select");
  const options = [
    ["new", "刚收到"],
    ["held", "已经拎住"],
    ["done", "已经掉落"],
    ["archived", "收起来了"]
  ];
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = submission.status === value;
    select.append(option);
  });
  select.addEventListener("change", async () => {
    select.disabled = true;
    adminMessage.textContent = "";
    try {
      await api("/api/admin/submissions/" + encodeURIComponent(submission.id), {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
    } catch (error) {
      adminMessage.textContent = error.message;
      select.value = submission.status;
    } finally {
      select.disabled = false;
    }
  });
  actions.append(select);
  return actions;
}

function createReplyEditor(submission) {
  const form=document.createElement("form");
  form.className="reply-editor";
  const title=document.createElement("label");
  title.textContent=submission.reply?"编辑已经发出的回声":"给这封信写回声";
  const textarea=document.createElement("textarea");
  textarea.name="message";
  textarea.rows=3;
  textarea.maxLength=12000;
  textarea.placeholder="写一点回声给这封信……";
  textarea.value=submission.reply?.message||"";
  title.append(textarea);
  form.append(title);
  if(submission.reply?.attachments?.length){
    form.append(createAttachments(submission.reply.attachments,true));
  }
  const photos=document.createElement("input");
  photos.type="file";
  photos.name="images";
  photos.multiple=true;
  photos.accept="image/jpeg,image/png,image/webp";
  const photoLabel=document.createElement("label");
  const fileButton=document.createElement("span");
  fileButton.className="soft-button";
  fileButton.textContent="添加图片 +";
  photoLabel.className="reply-image-label";
  photoLabel.append(fileButton,photos);
  const selectionCount=document.createElement("small");
  selectionCount.setAttribute("aria-live","polite");
  photos.addEventListener("change",()=>{
    const count=photos.files.length;
    selectionCount.textContent=count?("已选 "+count+" 张，保存后替换旧图"):"";
  });
  photoLabel.append(selectionCount);
  form.append(photoLabel);
  if(submission.reply?.attachments?.length){
    const clearLabel=document.createElement("label");
    clearLabel.className="reply-clear";
    const clear=document.createElement("input");
    clear.type="checkbox";
    clear.name="clearImages";
    clearLabel.append(clear,document.createTextNode("清除已有回复图片"));
    form.append(clearLabel);
  }
  const status=document.createElement("p");
  status.className="form-status";
  status.setAttribute("role","status");
  const button=document.createElement("button");
  button.type="submit";
  button.className="submit-button";
  button.textContent="保存并发出回声";
  form.append(button,status);
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    status.textContent="";
    button.disabled=true;
    try {
      const data=new FormData();
      data.set("message",textarea.value);
      if(form.elements.clearImages?.checked)data.set("clearImages","true");
      const selected=[...photos.files];
      if(selected.length>4)throw Error("回复最多只能附四张图片。");
      for(const img of selected)data.append("images",img,img.name);
      const response=await fetch("/api/admin/submissions/"+encodeURIComponent(submission.id)+"/reply",{
        method:"POST",body:data,credentials:"same-origin"
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||"保存失败。");
      await loadSubmissions();
      adminMessage.textContent="回声已保存，访客现在可以凭取信码读到。";
    }catch(error) {
      status.textContent=error.message||"保存失败。";
    }finally{button.disabled=false;}
  });
  return form;
}

function createSubmissionCard(submission) {
  const card=document.createElement("article");
  card.className="submission-card";
  const details=document.createElement("details");
  details.className="letter-details";
  const summary=document.createElement("summary");
  summary.className="letter-summary";
  const top=document.createElement("div");
  top.className="submission-head";
  const kind=document.createElement("span");
  kind.className="signal-kind"+(submission.kind==="tuft"?" is-tuft":"");
  kind.textContent=submission.kind==="tuft"?"小毛团":"普通提问";
  const time=document.createElement("time");
  time.className="signal-time";time.dateTime=submission.createdAt;
  time.textContent=formatTime(submission.createdAt);
  const state=document.createElement("span");
  state.className="state-hint";
  const statusLabels={new:"刚收到",held:"已经拎住",done:"已经掉落",archived:"收起来了"};
  state.textContent=statusLabels[submission.status]||"";
  top.append(kind,time,state);
  const preview=document.createElement("p");
  preview.className="letter-preview";
  preview.textContent=submission.message||"（附图来信）";
  const arrow=document.createElement("span");
  arrow.className="letter-chevron";arrow.setAttribute("aria-hidden","true");
  arrow.textContent="⌄";
  summary.append(top,preview,arrow);
  details.append(summary);
  const content=document.createElement("div");
  content.className="letter-expanded";
  const full=document.createElement("p");
  full.className="submission-message";
  full.textContent=submission.message||"（只放了图片）";
  content.append(full);
  if(submission.email)content.append(createEmailRow(submission.email));
  if(submission.attachments.length)content.append(createAttachments(submission.attachments));
  const stateControl=statusSelect(submission);
  stateControl.querySelector("select").addEventListener("change",event=>{
    state.textContent=statusLabels[event.currentTarget.value]||"";
  });
  content.append(stateControl);
  if(submission.kind==="ask"){
    const replyFold=document.createElement("details");
    replyFold.className="reply-fold";
    const replySummary=document.createElement("summary");
    replySummary.textContent=submission.reply?"编辑已发出的回声":"给这封信写回声";
    replyFold.append(replySummary,createReplyEditor(submission));
    content.append(replyFold);

    const publicRow=document.createElement("div");
    publicRow.className="publication-control";
    if(!submission.allowPublic){
      publicRow.textContent="本封信未授权公开展示，仅能私下回复。";
    }else if(!submission.reply?.message?.trim()||!submission.message.trim()){
      publicRow.textContent="已同意公开文字问答。回复后可选择展示。";
    }else{
      const publicLabel=document.createElement("label");
      const toggle=document.createElement("input");
      toggle.type="checkbox";toggle.checked=!!submission.isPublic;
      const description=document.createElement("span");
      description.textContent="在公开展示区显示本次文字问答";
      publicLabel.append(toggle,description);
      publicRow.append(publicLabel);
      const note=document.createElement("small");
      note.textContent="不展示邮箱、取信码、来信图片或回复图片。";
      publicRow.append(note);
      toggle.addEventListener("change",async()=>{
        const selected=toggle.checked;
        toggle.disabled=true;
        try{
          await api("/api/admin/submissions/"+encodeURIComponent(submission.id)+"/public",{
            method:"PATCH",body:JSON.stringify({published:selected})
          });
        }catch(error){
          toggle.checked=!selected;
          adminMessage.textContent=error.message||"公开设置没有保存。";
        }finally{toggle.disabled=false;}
      });
    }
    content.append(publicRow);
  }
  const danger=document.createElement("button");
  danger.type="button";danger.className="danger-link";danger.textContent="永久删除这封来信";
  danger.addEventListener("click",async()=>{
    if(!window.confirm("确定永久删除这封来信、附图与回复吗？\n此操作不可恢复。"))return;
    danger.disabled=true;
    try{
      await api("/api/admin/submissions/"+encodeURIComponent(submission.id),{method:"DELETE"});
      await loadSubmissions();
      adminMessage.textContent="这封来信及附图已经删除。";
    }catch(error){
      danger.disabled=false;
      adminMessage.textContent=error.message||"删除失败，请重试。";
    }
  });
  content.append(danger);
  details.append(content);
  card.append(details);
  return card;
}

async function loadSubmissions() {
  adminMessage.textContent = "";
  const params = new URLSearchParams();
  if (kindFilter.value) params.set("kind", kindFilter.value);
  if (statusFilter.value) params.set("status", statusFilter.value);
  try {
    const result = await api("/api/admin/submissions?" + params.toString());
    list.replaceChildren();
    result.submissions.forEach((submission) => list.append(createSubmissionCard(submission)));
    signalCount.textContent = String(result.submissions.length);
    emptyInbox.hidden = result.submissions.length !== 0;
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    adminMessage.textContent = error.message;
  }
}

async function logout() {
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
  } finally {
    showLogin();
  }
}

loginForm.addEventListener("submit", login);
document.querySelectorAll("[data-setting]").forEach((checkbox) => {
  checkbox.addEventListener("change", updateSetting);
});
document.querySelector("[data-refresh]").addEventListener("click", loadSubmissions);
document.querySelector("[data-logout]").addEventListener("click", logout);
kindFilter.addEventListener("change", loadSubmissions);
statusFilter.addEventListener("change", loadSubmissions);
checkSession();
