console.log("PhishGuard KZ service-worker запущен");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["openai_key"], (d) => {
    if (!d.openai_key) chrome.storage.sync.set({ openai_key: "" });
  });
});

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.type === "GPT_EXPLAIN") { callGPT(msg.messages, send); return true; }
});

async function callGPT(messages, send) {
  try {
    const { openai_key: KEY } = await chrome.storage.sync.get(["openai_key"]);
    if (!KEY) { send({ error: "Нет OpenAI-ключа" }); return; }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json",
                 "Authorization": `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 180,
        temperature: 0.2
      })
    });

    const j = await r.json();
    const ans = j.choices?.[0]?.message?.content ||
                '{"risk":"medium","explanation":"GPT не ответил"}';

    send({ ok: true, explanation: ans });
  } catch (e) {
    console.error(e);
    send({ error: e.message });
  }
}
