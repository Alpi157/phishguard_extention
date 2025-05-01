const GOOGLE_RE = /(^|\.)google\.(com|[a-z]{2,3})$/i;
const GMAIL_HOST = "mail.google.com";

function grabText () {
  const node = document.querySelector("div.a3s") ||
               document.querySelector(".adn.ads") ||
               document.querySelector(".ii.gt")   ||
               document.querySelector("div[role='main'] .ii");
  if (node) return node.innerText.trim();

  const iframe = document.querySelector("iframe[role='presentation']");
  return iframe?.contentDocument?.body?.innerText.trim() || "";
}

chrome.runtime.onMessage.addListener((m, _, s) => {
  if (m.type === "REQUEST_EMAIL_TEXT") s({ text: grabText() });
});

let prev = "";
const pump = () => {
  const t = grabText();
  if (t && t !== prev) {
    prev = t;
    chrome.runtime.sendMessage({ type:"EMAIL_UPDATED", text:t });
  }
};

new MutationObserver(pump).observe(document.body, { childList: true, subtree: true });
setInterval(pump, 1500);

document.addEventListener("click", intercept, true);

const API_TIMEOUT = 7_000;
const UI_ID       = "phg-curtain";
const BACKEND_URL = "http://127.0.0.1:8000/url";
const BAD_TH      = 0.60;

function intercept (ev) {
  const a = ev.target.closest("a[href]");
  if (!a) return;

  try {
    const u = new URL(a.href, location.href);

    if (u.hostname === GMAIL_HOST ||
        GOOGLE_RE.test(u.hostname) ||
        u.protocol !== "http:" && u.protocol !== "https:" )
      return;                                         // не трогаем

    ev.preventDefault();
    ev.stopImmediatePropagation();
    analyseAndPossiblyBlock(u.href);
  } catch { /* malformed url — игнор */ }
}

function analyseAndPossiblyBlock (url) {
  const curtain = showCurtain("check");

  chrome.runtime.sendMessage({ type:"CHECK_URL", url }, res => {
    if (!res?.ok) { curtain.remove(); window.location.href = url; return; }

    if (res.risk === "high" || res.mlScore >= BAD_TH) {
      showCurtain("block", url, res);
      chrome.runtime.sendMessage({ type:"BLOCK_ALERT", url, score:res.mlScore });
    } else {
      curtain.remove();
      window.location.href = url;
    }
  });
}

function removeCurtain () { document.getElementById(UI_ID)?.remove(); }

function showCurtain (mode, url = "", data = {}) {
  let div = document.getElementById(UI_ID);
  if (!div) {
    div = Object.assign(document.createElement("div"), { id: UI_ID });
    Object.assign(div.style, {
      position:"fixed", inset:0, zIndex: 2_147_483_646,
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      background:"rgba(0,0,0,.82)", color:"#fff",
      fontFamily:"system-ui,sans-serif", textAlign:"center",
      padding:"24px 20px", gap:"18px"
    });
    document.documentElement.appendChild(div);
  }

  if (mode === "check") {
    div.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 24 24" fill="#2196f3">
        <path d="M12 2l9 4v6c0 5.55-3.75 10.2-9 12-5.25-1.8-9-6.45-9-12V6l9-4z"/>
      </svg>
      <h2 style="margin:0">Проверка ссылки…</h2>
      <p style="font-size:14px;margin:0">Идёт глубокий анализ страницы</p>`;
  } else {
    const pct = (data.mlScore * 100).toFixed(1);
    div.innerHTML = `
      <svg width="72" height="72" viewBox="0 0 24 24" fill="#f44336">
        <path d="M12 2l9 4v6c0 5.55-3.75 10.2-9 12-5.25-1.8-9-6.45-9-12V6l9-4z"/>
      </svg>
      <h2 style="margin:0 0 6px">Опасная ссылка!</h2>
      <p style="margin:4px 0 12px;font-size:14px">
        Риск: ${pct}%<br>${data.explanation || ""}
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
        <button id="phg-back"   style="padding:8px 20px;border:none;border-radius:7px;background:#607d8b;color:#fff;cursor:pointer">↩ Назад</button>
        <button id="phg-proceed"style="padding:8px 20px;border:none;border-radius:7px;background:#f44336;color:#fff;cursor:pointer">⚠ Перейти</button>
      </div>`;

    div.querySelector("#phg-back")   .onclick = removeCurtain;
    div.querySelector("#phg-proceed").onclick = () => { removeCurtain(); window.location.href = url; };
  }
  return div;
}
