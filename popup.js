const $  = id => document.getElementById(id);
const show = id => ["main", "settings"].forEach(v => $(v).style.display = v === id ? "block" : "none");
$("openSettings").onclick = () => show("settings");
$("backBtn").onclick      = () => show("main");

const T = {
  check:{ru:"Проверить письмо", kz:"Хатты тексеру", en:"Check email"},
  wait :{ru:"Анализ",           kz:"Талдау",        en:"Analyzing"},
  noText:{ru:"Нет текста письма", kz:"Хат табылмады", en:"No email text"},
  placeholder:{
    ru:"Откройте письмо в Gmail — текст подставится…",
    kz:"Gmail хатты ашыңыз — мәтін автоматты түрде пайда болады…",
    en:"Open an email in Gmail — it will auto-fill here…"
  },
  settings:{
    title :{ru:"Настройки", kz:"Баптаулар", en:"Settings"},
    back  :{ru:"← Назад",   kz:"← Артқа",   en:"← Back"},
    label1:{ru:"OpenAI API-ключ:", kz:"OpenAI API кілті:", en:"OpenAI API key:"},
    label2:{ru:"Язык интерфейса:", kz:"Тіл таңдауы:", en:"Interface language:"},
    save  :{ru:"💾 Сохранить", kz:"💾 Сақтау", en:"💾 Save"},
    saved :{ru:"✓ Сохранено", kz:"✓ Сақталды", en:"✓ Saved"},
    gear  :{ru:"⚙ Настройки", kz:"⚙ Баптаулар", en:"⚙ Settings"}
  }
};

let LANG = "ru";
const applyLang = () => {
  $("analyzeBtn").textContent   = T.check[LANG];
  $("messageInput").placeholder = T.placeholder[LANG];
  $("backBtn").textContent      = T.settings.back[LANG];
  $("settingsHeader").textContent = T.settings.title[LANG];
  $("labelApi").textContent     = T.settings.label1[LANG];
  $("labelLang").textContent    = T.settings.label2[LANG];
  $("saveBtn").textContent      = T.settings.save[LANG];
  $("openSettings").textContent = T.settings.gear[LANG];
};

chrome.storage.sync.get(["openai_key","lang"], cfg=>{
  if(cfg.openai_key) $("apiKey").value = cfg.openai_key;
  LANG = cfg.lang || "ru";
  $("lang").value = LANG;
  applyLang();
});

$("saveBtn").onclick = () => {
  const key  = $("apiKey").value.trim();
  const lang = $("lang").value;
  if(key && !/^sk-/.test(key)){ alert("Некорректный OpenAI-ключ"); return;}
  chrome.storage.sync.set({openai_key:key,lang}, ()=>{
    LANG = lang; applyLang();
    const s=$("saveStatus"); s.textContent = T.settings.saved[LANG];
    s.style.display="block"; setTimeout(()=>s.style.display="none",1200);
  });
};

async function fetchEmailText(){
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  return new Promise(res=>{
    if(!tab?.id) return res("");
    chrome.tabs.sendMessage(tab.id,{type:"REQUEST_EMAIL_TEXT"},r=>res(r?.text||""));
  });
}
fetchEmailText().then(t=>{ if(t) $("messageInput").value = t; });

async function classify(text){
  const r = await fetch("http://127.0.0.1:8000/classify",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})
  });
  const j = await r.json();
  if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);
  return j.score;
}

const askGPT = messages => new Promise(res=>{
  chrome.runtime.sendMessage({type:"GPT_EXPLAIN",messages},r=>{
    res(r?.ok ? r.explanation : '{"risk":"medium","explanation":"GPT-error"}');
  });
});

const PROMPT = {
  ru:{ sys:`Ты эксперт по фишингу. Отвечай ТОЛЬКО JSON на русском:
{"risk":"low|medium|high","explanation":"3-4 предложения"}
Риск: score>=0.60→high, 0.25–0.59→medium, иначе low.`,
       lbl:{high:["⚠ Опасно","warn"],medium:["❓ Подозрительно","mid"],low:["✅ Безопасно","ok"]}},
  kz:{ sys:`Сен фишинг сарапшысысың. Тек қазақша және тек JSON:
{"risk":"low|medium|high","explanation":"3–4 қысқа сөйлем"}
score>=0.60→high, 0.25–0.59→medium, әйтпесе low.`,
       lbl:{high:["⚠ Қауіпті","warn"],medium:["❓ Күмәнді","mid"],low:["✅ Қауіпсіз","ok"]}},
  en:{ sys:`You are a phishing expert. Respond ONLY JSON in English:
{"risk":"low|medium|high","explanation":"3-4 sentences"}
score>=0.60→high, 0.25–0.59→medium, otherwise low.`,
       lbl:{high:["⚠ Dangerous","warn"],medium:["❓ Suspicious","mid"],low:["✅ Safe","ok"]}}
};

let dotsTimer = null;

$("analyzeBtn").onclick = async () => {
  let text = $("messageInput").value.trim();
  if(!text){ text = await fetchEmailText(); $("messageInput").value = text; }
  if(!text){ alert(T.noText[LANG]); return; }


  const base = T.wait[LANG];
  $("analyzeBtn").disabled = true;
  $("analyzeBtn").textContent = base;
  let d = 0;
  dotsTimer = setInterval(()=>{
    d = (d+1)%4;
    $("analyzeBtn").textContent = base + ".".repeat(d);
  }, 300);

  $("resultBox").style.display = "none";

  try{
    const score  = await classify(text);
    const prompt = PROMPT[LANG];
    const raw    = await askGPT([
      {role:"system",content:prompt.sys},
      {role:"user",  content:JSON.stringify({score,text})}
    ]);
    const {risk,explanation} = JSON.parse(raw);
    const [lbl,css]          = prompt.lbl[risk] || prompt.lbl.medium;

    $("riskHeader").textContent     = lbl;
    $("gptExplanation").textContent = explanation;
    $("resultBox").className        = css;
    $("resultBox").style.display    = "block";
  }catch(e){
    console.error(e); alert(e.message);
  }finally{
    clearInterval(dotsTimer); dotsTimer = null;
    $("analyzeBtn").disabled = false;
    $("analyzeBtn").textContent = T.check[LANG];
  }
};
