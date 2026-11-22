const state = {
  channel: "ask",
  config: { askOpen: true, tuftOpen: true, turnstileSiteKey: "" },
  images: [],
  turnstile: { ask: null, tuft: null },
  turnstileToken: { ask: "", tuft: "" }
};

const channelButtons = [...document.querySelectorAll("[data-channel-target]")];
const channelPanels = [...document.querySelectorAll("[data-channel-panel]")];
const forms = [...document.querySelectorAll("[data-signal-form]")];
const toast = document.querySelector("[data-success-toast]");
const successText = document.querySelector("[data-success-text]");
const imageInput = document.querySelector("#ask-images");
const imagePreview = document.querySelector("[data-image-preview]");

function setChannel(channel) {
  state.channel = channel;
  channelButtons.forEach((button) => {
    const active = button.dataset.channelTarget === channel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  channelPanels.forEach((panel) => {
    const active = panel.dataset.channelPanel === channel;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

function showToast(text) {
  successText.textContent = text;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function setFormOpen(kind, open) {
  const form = document.querySelector('[data-signal-form="' + kind + '"]');
  const note = document.querySelector('[data-closed-note="' + kind + '"]');
  if (form) form.hidden = !open;
  if (note) note.hidden = open;
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "config failed");
    state.config = result;
    setFormOpen("ask", result.askOpen);
    setFormOpen("tuft", result.tuftOpen);
    if (result.turnstileSiteKey) await loadTurnstile(result.turnstileSiteKey);
  } catch {
    forms.forEach((form) => {
      const status = form.querySelector("[data-form-status]");
      status.textContent = "电台现在有一点杂音，请稍后再来。";
      form.querySelector("button[type=submit]").disabled = true;
    });
  }
}

function loadTurnstile(siteKey) {
  return new Promise((resolve) => {
    if (window.turnstile) {
      renderTurnstile(siteKey);
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      renderTurnstile(siteKey);
      resolve();
    };
    script.onerror = () => resolve();
    document.head.append(script);
  });
}

function renderTurnstile(siteKey) {
  ["ask", "tuft"].forEach((kind) => {
    const slot = document.querySelector('[data-turnstile-slot="' + kind + '"]');
    if (!slot || state.turnstile[kind] !== null) return;
    state.turnstile[kind] = window.turnstile.render(slot, {
      sitekey: siteKey,
      theme: "dark",
      size: "flexible",
      callback: (token) => {
        state.turnstileToken[kind] = token;
      },
      "expired-callback": () => {
        state.turnstileToken[kind] = "";
      }
    });
  });
}

async function normalizeImage(file) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maximum = 2200;
    const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], baseName + ".webp", {
      type: "image/webp",
      lastModified: Date.now()
    });
  } catch {
    return file;
  }
}

function renderImages() {
  imagePreview.replaceChildren();
  state.images.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "preview-item";
    const image = document.createElement("img");
    image.alt = "";
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "移除这张图");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.images.splice(index, 1);
      renderImages();
    });
    item.append(image, remove);
    imagePreview.append(item);
  });
}

async function selectImages(event) {
  const incoming = [...event.target.files].slice(0, 4);
  const normalized = [];
  for (const file of incoming) normalized.push(await normalizeImage(file));
  state.images = normalized.slice(0, 4);
  renderImages();
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.dataset.signalForm;
  const status = form.querySelector("[data-form-status]");
  const button = form.querySelector("button[type=submit]");
  status.textContent = "";
  button.disabled = true;

  const data = new FormData();
  data.set("kind", kind);
  data.set("message", form.elements.message.value);
  data.set("email", kind === "tuft" ? form.elements.email.value : "");
  data.set("turnstileToken", state.turnstileToken[kind] || "");
  if (kind === "ask") {
    state.images.forEach((file) => data.append("images", file, file.name));
  }

  try {
    const response = await fetch("/api/submissions", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "没有顺利塞进去。");
    form.reset();
    if (kind === "ask") {
      state.images = [];
      renderImages();
    }
    if (window.turnstile && state.turnstile[kind] !== null) {
      window.turnstile.reset(state.turnstile[kind]);
      state.turnstileToken[kind] = "";
    }
    showToast(kind === "tuft" ? "【塞好了！】" : "【收到了！】");
  } catch (error) {
    status.textContent = error.message || "电台刚才没有接稳。";
  } finally {
    button.disabled = false;
  }
}

channelButtons.forEach((button) => {
  button.addEventListener("click", () => setChannel(button.dataset.channelTarget));
});
forms.forEach((form) => form.addEventListener("submit", submitForm));
imageInput.addEventListener("change", selectImages);
setChannel("ask");
loadConfig();
