console.log("[PhishGuard] background worker booted");


chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(
    ["openai_key","ha_key","ha_enabled","adblock_enabled"],
    d => {
      if (!d.openai_key) chrome.storage.sync.set({openai_key:""});
      if (!d.ha_key)     chrome.storage.sync.set({ha_key:""});
      if (d.ha_enabled === undefined)     chrome.storage.sync.set({ha_enabled:false});
      if (d.adblock_enabled === undefined) chrome.storage.sync.set({adblock_enabled:false});
    }
  );
});


chrome.runtime.onMessage.addListener((msg, sender, send) => {
  switch (msg.type){
    case "GPT_EXPLAIN": callGPT(msg.messages).then(send); return true;
    case "CHECK_URL":   deepInspectURL(msg.url).then(send); return true;
    case "BLOCK_ALERT": toast(msg.url, msg.risk); break;
  }
});


async function callGPT(messages){
  const {openai_key:KEY} = await chrome.storage.sync.get(["openai_key"]);
  if (!KEY) return {error:"OpenAI key missing"};

  try{
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${KEY}`
      },
      body:JSON.stringify({
        model:"gpt-4o-mini",
        messages,
        max_tokens:200,
        temperature:0.2
      })
    });
    const j = await r.json();
    return {ok:true, text:j.choices?.[0]?.message?.content || ""};
  }catch(e){
    return {error:e.message};
  }
}


const HA_BASE = "https://www.hybrid-analysis.com/api/v2";
const HA_ENV  = 100; // Windows 10

async function haSubmit(url, API){
  const r = await fetch(`${HA_BASE}/submit/url`,{
    method:"POST",
    headers:{
      "Content-Type":"application/x-www-form-urlencoded",
      "api-key":API,
      "User-Agent":"FalconSandboxScript/1.0"
    },
    body:new URLSearchParams({url, environment_id:HA_ENV})
  });
  if(!r.ok) throw new Error(`HA submit HTTP ${r.status}`);
  return (await r.json()).job_id;
}
async function haWait(job, API, timeout=300_000, step=12_000){
  const deadline = Date.now()+timeout;
  while(Date.now()<deadline){
    const r = await fetch(`${HA_BASE}/report/${job}/summary`,{
      headers:{
        "api-key":API,
        "User-Agent":"FalconSandboxScript/1.0"
      }
    });
    if(r.ok){
      const s = await r.json();
      if(s.verdict !== null) return s;
    }
    await new Promise(res=>setTimeout(res,step));
  }
  return null;
}
async function hybridAnalysis(url){
  const {ha_key:API} = await chrome.storage.sync.get(["ha_key"]);
  if(!API) return null;
  try{
    const job = await haSubmit(url, API);
    console.log("[PhishGuard] HA job", job);
    return await haWait(job, API);
  }catch(e){
    console.warn("[PhishGuard] HA error:", e);
    return null;
  }
}


const MAX_RULES = 30_000;
let adblockActive = false;

async function enableAdblock(){
  if(adblockActive) return;
  try{
    const resp  = await fetch(chrome.runtime.getURL("filters.json"));
    let rules   = await resp.json();
    if(rules.length > MAX_RULES){
      console.warn(`AdBlock: trimming to ${MAX_RULES} rules`);
      rules = rules.slice(0, MAX_RULES);
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rules.map(r => r.id), // на всякий случай очищаем старые такие же id
      addRules: rules
    });
    adblockActive = true;
    console.log(`[PhishGuard] AdBlock enabled (${rules.length} rules)`);
  }catch(e){
    console.warn("[PhishGuard] AdBlock enable error:", e);
  }
}
async function disableAdblock(){
  if(!adblockActive) return;
  try{
    const all = await fetch(chrome.runtime.getURL("filters.json")).then(r=>r.json());
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: all.map(r=>r.id),
      addRules:[]
    });
    adblockActive = false;
    console.log("[PhishGuard] AdBlock disabled");
  }catch(e){
    console.warn("[PhishGuard] AdBlock disable error:", e);
  }
}

(async ()=>{
  const {adblock_enabled:ON} = await chrome.storage.sync.get(["adblock_enabled"]);
  if(ON) await enableAdblock();
})();

chrome.storage.onChanged.addListener(changes=>{
  if("adblock_enabled" in changes){
    const val = changes.adblock_enabled.newValue;
    val ? enableAdblock() : disableAdblock();
  }
});


const MAX_JS = 3;
const FETCH_OPTS = {headers:{"User-Agent":"Mozilla"}};

async function deepInspectURL(url){
  const info = {url};
  try{

    const resp = await fetch(url, FETCH_OPTS);
    info.status = resp.status;
    let html    = await resp.text();
    const lower = html.toLowerCase();

    info.hasPassword   = /type\s*=\s*["']?password/i.test(lower);
    info.formCount     = (lower.match(/<form[\s>]/g)   || []).length;
    info.scriptCount   = (lower.match(/<script[\s>]/g) || []).length;
    info.susKeywords   = /(login|verify|password|wallet|bank|card|account|sms)/.test(lower);
    info.externalLinks = (html.match(/https?:\/\/[^"'\s>]+/g) || [])
                          .filter(u => !u.includes(location.hostname)).length;


    const jsLinks = [...new Set(
      (html.match(/<script[^>]+src=["']([^"']+)/gi) || [])
        .map(x => x.match(/src=["']([^"']+)/i)[1])
        .slice(0, MAX_JS)
    )];
    for(const l of jsLinks){
      try{
        const body = await fetch(new URL(l, url).href, FETCH_OPTS).then(r=>r.text());
        html += `\n/* ext JS ${l} */\n` + body.slice(0,4000);
      }catch{}
    }


    const {ha_enabled:HA_ON, ha_key:API} =
          await chrome.storage.sync.get(["ha_enabled","ha_key"]);

    let haPromise = null;
    if (HA_ON && API) haPromise = hybridAnalysis(url);   // параллельно


    const gptPrompt = [
      {role:"system", content:`You are a professional anti‑phishing auditor. Respond STRICT JSON:
{"risk":"low|medium|high","explanation":"concise reason"}`},
      {role:"user", content:JSON.stringify({meta:info, htmlSample:html.slice(0,40_000)})}
    ];
    const gpt = await callGPT(gptPrompt);
    let {risk="medium", explanation="GPT parse error"} = JSON.parse(gpt.text||"{}");

    if (!HA_ON && risk==="high" && API){
      haPromise = hybridAnalysis(url); // fallback
    }

    let sandbox=null;
    if(haPromise){
      sandbox = await haPromise;
      if(sandbox?.verdict){
        explanation += ` — Hybrid‑Analysis: ${sandbox.verdict} (${sandbox.threat_score??"n/a"})`;
      }
    }

    return {ok:true, risk, explanation, sandbox};

  }catch(e){
    console.warn("[PhishGuard] deepInspect error:", e);
    return {ok:true, risk:"medium", explanation:"analysis error"};
  }
}


function toast(url, risk){
  chrome.notifications.create({
    type:"basic",
    iconUrl:"assets/icon.png",
    title:"PhishGuard KZ  •  ссылка заблокирована",
    message:`Риск: ${risk}\n${url}`,
    priority:2
  });
}
