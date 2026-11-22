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

function createAttachments(attachments) {
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
    image.src = "/api/admin/media/" + encodeURIComponent(attachment.id);
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

function createSubmissionCard(submission) {
  const card = document.createElement("article");
  card.className = "submission-card";
  const head = document.createElement("div");
  head.className = "submission-head";
  const kind = document.createElement("span");
  kind.className = "signal-kind" + (submission.kind === "tuft" ? " is-tuft" : "");
  kind.textContent = submission.kind === "tuft" ? "毛团频道" : "收信频道";
  const time = document.createElement("time");
  time.className = "signal-time";
  time.dateTime = submission.createdAt;
  time.textContent = formatTime(submission.createdAt);
  head.append(kind, time);

  const message = document.createElement("p");
  message.className = "submission-message";
  message.textContent = submission.message || "（只放了图片）";
  card.append(head, message);
  if (submission.email) card.append(createEmailRow(submission.email));
  if (submission.attachments.length) card.append(createAttachments(submission.attachments));
  card.append(statusSelect(submission));
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
