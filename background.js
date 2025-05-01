console.log("[PhishGuard] background worker booted");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["openai_key"], d => {
    if (!d.openai_key) chrome.storage.sync.set({ openai_key: "" });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case "GPT_EXPLAIN":
      callGPT(msg.messages).then(sendResponse);
      return true;

    case "CHECK_URL":
      deepInspectURL(msg.url).then(sendResponse);
      return true;


    case "BLOCK_ALERT":
      showToast(msg.url, msg.score);
      break;
  }
});

const BACKEND = "http://127.0.0.1:8000/url";
const MAX_JS  = 3;
const FETCH_OPTS = { headers:{ "User-Agent":"Mozilla" }, timeout: 7000 };

async function deepInspectURL(target) {
  let htmlText = "";
  let basicFeatures = {};

  try {

    const resp = await fetch(target, FETCH_OPTS);
    basicFeatures.status = resp.status;
    htmlText = await resp.text();

    const lower = htmlText.toLowerCase();
    basicFeatures.hasPassword   = /type\s*=\s*["']?password/i.test(lower);
    basicFeatures.formCount     = (lower.match(/<form[\s>]/g)||[]).length;
    basicFeatures.susKeywords   = !!lower.match(/(login|verify|password|wallet|bank|card|account|sms)/);
    basicFeatures.scriptCount   = (lower.match(/<script[\s>]/g)||[]).length;
    basicFeatures.externalLinks = (htmlText.match(/https?:\/\/[^"'\s>]+/g)||[])
                                  .filter(u=>!u.startsWith(location.origin)).length;

    const jsLinks = [...new Set(
      (htmlText.match(/<script[^>]+src=["']([^"']+)/gi)||[])
      .map(x=>x.match(/src=["']([^"']+)/i)[1])
      .slice(0,MAX_JS)
    )];

    for (const link of jsLinks) {
      try {
        const js = await fetch(new URL(link, target).href, FETCH_OPTS).then(r=>r.text());
        htmlText += "\n\n/* ---- external-js ---- */\n" + js.slice(0,3000);
      } catch { /* не критично */ }
    }

  } catch(err){
    console.warn("[PhishGuard] html fetch error:", err);
    basicFeatures.fetchError = true;
  }

  let mlScore = 1.0;
  try {
    const r = await fetch(BACKEND,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ url: target })
    });
    const j = await r.json();
    mlScore = j.score ?? 1.0;
  } catch(e){ console.warn("[PhishGuard] backend error:", e); }

  const gptMessages = [
    { role:"system",
      content:`You are a professional anti-phishing auditor.
Return STRICT JSON ONLY:
{"risk":"low|medium|high","explanation":"short explanation in same language"}
Guideline: mlScore≥0.6 ⇒ high, 0.25–0.59 ⇒ medium, else low.` },
    { role:"user",
      content: JSON.stringify({
        url: target,
        mlScore,
        basic: basicFeatures,
        htmlSnippet: htmlText.slice(0, 6000)
      })
    }
  ];

  const gpt = await callGPT(gptMessages);
  let risk = "medium", explanation = "GPT failed";
  if (gpt.ok) {
    try { ({ risk, explanation } = JSON.parse(gpt.explanation)); }
    catch { /* leave defaults */ }
  }

  return { ok:true, risk, explanation, mlScore };
}

async function callGPT(messages){
  try{
    const { openai_key:KEY } = await chrome.storage.sync.get(["openai_key"]);
    if(!KEY) return { error:"OpenAI key missing" };

    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json","Authorization":`Bearer ${KEY}`},
      body:JSON.stringify({ model:"gpt-4o-mini", messages, max_tokens:180, temperature:0.2 })
    });
    const j = await r.json();
    return { ok:true, explanation: j.choices?.[0]?.message?.content };
  }catch(e){ return { error:e.message }; }
}

function showToast(url, score){
  chrome.notifications.create({
    type:"basic", iconUrl:"assets/icon.png",
    title:"PhishGuard KZ  •  ссылка заблокирована",
    message:`Риск ${(score*100).toFixed(1)} %  \n${url}`,
    priority:2
  });
}
