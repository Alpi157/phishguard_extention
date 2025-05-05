const GOOGLE_RE   = /(^|\.)gmail\.com$/i;
const OUTLOOK_RE  = /(^|\.)outlook\.com$|(^|\.)office\.com$/i;

const LABELS = {
  ru: { low: "низкий",   medium: "средний", high: "высокий", prefix: "Риск:" },
  kz: { low: "төмен",    medium: "орташа",  high: "жоғары", prefix: "Қауіп:" },
  en: { low: "low",      medium: "medium",  high: "high",   prefix: "Risk:" }
};

let INDICATOR_ON = false;
let LANG = "ru";

chrome.storage.sync.get(["indicator_enabled","lang"], cfg => {
  INDICATOR_ON = !!cfg.indicator_enabled;
  LANG         = cfg.lang || "ru";
});


function findMessageContainer() {

  const gm = document.querySelector("div.a3s, .adn.ads, .ii.gt, div[role='main'] .ii");
  if (gm?.parentElement) return gm.parentElement;

  const olNew = document.querySelector("div[aria-label='Message body'], div[aria-label='Текст сообщения']");
  if (olNew) return olNew;


  const olOld = document.querySelector(".ReadMsgBody, .readingPaneContainer, .rps_lF");
  if (olOld) return olOld;


  return null;
}


function grabText() {
  const container = findMessageContainer();
  if (!container) return "";
  return container?.innerText.trim() || "";
}


chrome.runtime.onMessage.addListener((msg, _, send) => {
  if (msg.type === "REQUEST_EMAIL_TEXT") send({ text: grabText() });
});

let lastText = "";
function pump() {
  const text = grabText();
  if (text && text !== lastText) {
    lastText = text;
    chrome.runtime.sendMessage({ type: "EMAIL_UPDATED", text });
    if (INDICATOR_ON) autoAnalyze(text);
    scanQRCodes();
  }
}
new MutationObserver(pump).observe(document.body, { childList: true, subtree: true });
setInterval(pump, 1200);

document.addEventListener("click", handleClick, true);


function handleClick(e) {
  const a = e.target.closest("a[href]");
  if (!a) return;
  try {
    const url = new URL(a.href, location.href);
    if (GOOGLE_RE.test(url.hostname) || OUTLOOK_RE.test(url.hostname) || !/^https?:/.test(url.protocol))
      return;
    e.preventDefault(); e.stopImmediatePropagation();
    analyseURL(url.href);
  } catch {}
}


function removeIndicator() {
  document.getElementById("pg-risk-indicator")?.remove();
}


function showRiskIndicator(text) {
  removeIndicator();
  const div = document.createElement("div");
  div.id = "pg-risk-indicator";
  div.textContent = text;
  Object.assign(div.style, {
    fontSize:     "13px",
    fontWeight:   "500",
    margin:       "8px 0",
    padding:      "4px 10px",
    borderRadius: "6px",
    background:   "#f5f5f5",
    color:        "#333"
  });
  const ct = findMessageContainer();
  ct.prepend(div);
}


function autoAnalyze(text) {
  chrome.runtime.sendMessage({ type: "EMAIL_AUTO_CHECK", text }, res => {
    if (!res?.risk || !INDICATOR_ON) return;
    const lvl   = res.risk;
    const emoji = lvl === "high"   ? "🔴"
                : lvl === "medium" ? "🟠"
                :                     "🟢";
    const lbl   = LABELS[LANG][lvl];
    const pre   = LABELS[LANG].prefix;
    showRiskIndicator(`${emoji} ${pre} ${lbl}`);
  });
}

const CURTAIN_ID = "pg-curtain";
function removeCurtain() {
  document.getElementById(CURTAIN_ID)?.remove();
}
function curtain(mode, data = {}) {
  let c = document.getElementById(CURTAIN_ID);
  if (!c) {
    c = document.createElement("div"); c.id = CURTAIN_ID;
    Object.assign(c.style, {
      position:     "fixed", inset:0, zIndex:2147483646,
      display:      "flex", flexDirection:"column",
      alignItems:   "center", justifyContent:"center",
      background:   "rgba(0,0,0,.82)", color:"#fff",
      fontFamily:   "system-ui", textAlign:"center",
      padding:      "24px 20px", gap:"18px"
    });
    document.documentElement.appendChild(c);
  }
  if (mode === "check") {
    c.innerHTML = `<svg width="60" height="60" viewBox="0 0 24 24" fill="#2196f3">
      <path d="M12 2l9 4v6c0 5.55-3.75 10.2-9 12-5.25-1.8-9-6.45-9-12V6l9-4z"/></svg>
      <h2 style="margin:0">Проверка ссылки…</h2>`;
  } else {
    c.innerHTML = `<svg width="72" height="72" viewBox="0 0 24 24" fill="#f44336">
      <path d="M12 2l9 4v6c0 5.55-3.75 10.2-9 12-5.25-1.8-9-6.45-9-12V6l9-4z"/></svg>
      <h2 style="margin:0 0 6px">Опасная ссылка!</h2>
      <p style="font-size:14px;margin:4px 0 12px">${data.explanation||""}</p>
      <div style="display:flex;gap:12px">
        <button id="pg-back" style="padding:8px 20px;border:none;border-radius:7px;background:#607d8b;color:#fff;cursor:pointer">↩ Назад</button>
        <button id="pg-go"   style="padding:8px 20px;border:none;border-radius:7px;background:#f44336;color:#fff;cursor:pointer">⚠ Перейти</button>
      </div>`;
    c.querySelector("#pg-back").onclick = removeCurtain;
    c.querySelector("#pg-go").onclick   = () => { removeCurtain(); window.open(data.url, "_blank"); };
  }
  return c;
}


function analyseURL(url) {
  curtain("check");
  chrome.runtime.sendMessage({ type: "CHECK_URL", url }, res => {
    if (!res?.ok) { removeCurtain(); return window.open(url,"_blank"); }
    if (res.risk === "high") {
      curtain("block", { ...res, url });
      chrome.runtime.sendMessage({ type: "BLOCK_ALERT", url, risk: res.risk });
    } else {
      removeCurtain(); window.open(url, "_blank");
    }
  });
}


async function scanQRCodes() {
  const imgs = Array.from(document.querySelectorAll("img[src^='data:image']"));
  for (const img of imgs) {
    try {
      const data = await decodeQR(img);
      if (/^https?:\/\//i.test(data)) {
        analyseURL(data);
        return;
      }
    } catch {}
  }
}

function decodeQR(img) {
  return new Promise((resolve,reject)=>{
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    ctx.drawImage(img,0,0);
    const imageData = ctx.getImageData(0,0,canvas.width,canvas.height);
    import(chrome.runtime.getURL("libs/jsqr.min.js"))
      .then(jsqr => {
        const code = jsqr.default(imageData.data, canvas.width, canvas.height);
        code?.data ? resolve(code.data) : reject();
      })
      .catch(reject);
  });
}
