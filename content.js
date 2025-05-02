const GOOGLE_RE = /(^|\.)(google|gmail)\.(com|[a-z]{2,3})$/i;
const BAD_RISK  = "high";

function grabText() {
  const node = document.querySelector("div.a3s") ||
               document.querySelector(".adn.ads") ||
               document.querySelector(".ii.gt")   ||
               document.querySelector("div[role='main'] .ii");
  if (node) return node.innerText.trim();

  const frame = document.querySelector("iframe[role='presentation']");
  return frame?.contentDocument?.body?.innerText.trim() || "";
}
chrome.runtime.onMessage.addListener((m,_,s)=>{
  if (m.type==="REQUEST_EMAIL_TEXT") s({text:grabText()});
});


let prev=""; const pump=()=>{const t=grabText();if(t&&t!==prev){prev=t;
  chrome.runtime.sendMessage({type:"EMAIL_UPDATED",text:t});}};
new MutationObserver(pump).observe(document.body,{childList:true,subtree:true});
setInterval(pump,1500);


document.addEventListener("click", handleClick, true);

function handleClick(ev) {
  const link = ev.target.closest("a[href]");
  if (!link) return;

  try {
    const u = new URL(link.href, location.href);

    if (GOOGLE_RE.test(u.hostname) || !/^https?:$/.test(u.protocol)) return;

    ev.preventDefault(); ev.stopImmediatePropagation();
    analyseURL(u.href);
  } catch {/* ignore malformed */}
}

const ID = "pg-curtain";
function removeCurtain(){document.getElementById(ID)?.remove();}

function curtain(mode, data={}){
  let d=document.getElementById(ID);
  if(!d){
    d=document.createElement("div"); d.id=ID;
    Object.assign(d.style,{
      position:"fixed",inset:0,zIndex:2_147_483_646,display:"flex",
      flexDirection:"column",alignItems:"center",justifyContent:"center",
      background:"rgba(0,0,0,.82)",color:"#fff",fontFamily:"system-ui",
      textAlign:"center",padding:"24px 20px",gap:"18px"
    });
    document.documentElement.appendChild(d);
  }
  if(mode==="check"){
    d.innerHTML=`<svg width="60" height="60" viewBox="0 0 24 24" fill="#2196f3">
      <path d="M12 2l9 4v6c0 5.55-3.75 10.2-9 12-5.25-1.8-9-6.45-9-12V6l9-4z"/></svg>
      <h2 style="margin:0">Проверка ссылки…</h2>`;
  }else{
    d.innerHTML=`<svg width="72" height="72" viewBox="0 0 24 24" fill="#f44336">
        <path d="M12 2l9 4v6c0 5.55-3.75 10.2-9 12-5.25-1.8-9-6.45-9-12V6l9-4z"/></svg>
      <h2 style="margin:0 0 6px">Опасная ссылка!</h2>
      <p style="font-size:14px;margin:4px 0 12px">${data.explanation||""}</p>
      <div style="display:flex;gap:12px">
        <button id="pg-back"   style="padding:8px 20px;border:none;border-radius:7px;background:#607d8b;color:#fff;cursor:pointer">↩ Назад</button>
        <button id="pg-go"     style="padding:8px 20px;border:none;border-radius:7px;background:#f44336;color:#fff;cursor:pointer">⚠ Перейти</button>
      </div>`;
    d.querySelector("#pg-back").onclick = removeCurtain;
    d.querySelector("#pg-go").onclick   = () => { removeCurtain(); location.href=data.url; };
  }
  return d;
}

function analyseURL(url){
  curtain("check");
  chrome.runtime.sendMessage({type:"CHECK_URL", url}, res=>{
    if(!res?.ok){ removeCurtain(); location.href=url; return; }

    if(res.risk===BAD_RISK){
      curtain("block", {...res, url});
      chrome.runtime.sendMessage({type:"BLOCK_ALERT", url, risk:res.risk});
    }else{
      removeCurtain(); location.href=url;
    }
  });
}
