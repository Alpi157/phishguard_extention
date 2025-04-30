const $ = (id) => document.getElementById(id);

const apiInput   = $("apiKey");
const saveBtn    = $("saveKeyBtn");
const textArea   = $("messageInput");
const analyzeBtn = $("analyzeBtn");
const box        = $("resultBox");
const head       = $("riskHeader");
const explain    = $("gptExplanation");

chrome.storage.sync.get(["openai_key"], ({ openai_key }) => {
  if (openai_key) apiInput.value = openai_key;
});

saveBtn.onclick = () => {
  const k = apiInput.value.trim();
  if (!/^sk-/.test(k)) return alert("Некорректный ключ");
  chrome.storage.sync.set({ openai_key: k }, () => alert("Сохранено ✓"));
};

async function requestEmailText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return new Promise((res) => {
    if (!tab?.id) return res("");
    chrome.tabs.sendMessage(tab.id, { type: "REQUEST_EMAIL_TEXT" }, (r) =>
      res(r?.text || ""));
  });
}

requestEmailText().then((t) => { if (t) textArea.value = t; });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "EMAIL_UPDATED") textArea.value = msg.text;
});

async function classify(text) {
  const r = await fetch("http://127.0.0.1:8000/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.score;
}

const gpt = (messages) =>
  new Promise((res) =>
    chrome.runtime.sendMessage({ type: "GPT_EXPLAIN", messages }, (a) =>
      res(a?.ok ? a.explanation :
          '{"risk":"medium","explanation":"GPT-ошибка"}')));

analyzeBtn.onclick = async () => {
  let text = textArea.value.trim();
  if (!text) { text = await requestEmailText(); textArea.value = text; }
  if (!text)  return alert("Нет текста письма");

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Анализ…";
  box.style.display = "none";

  try {
    const score = await classify(text);

    const system = `
Ты эксперт по фишингу. Отвечай ТОЛЬКО на русском и ТОЛЬКО JSON:
{"risk":"low|medium|high","explanation":"3-4 подробных предложения"}
Риск: score>=0.60→high, 0.25–0.59→medium, иначе low.`;

    const raw = await gpt([
      { role: "system", content: system.trim() },
      { role: "user",   content: JSON.stringify({ score, text }) }
    ]);

    const { risk, explanation } = JSON.parse(raw);

    const map = { high:["⚠ Опасно","warn"],
                  medium:["❓ Подозрительно","mid"],
                  low:["✅ Безопасно","ok"] };
    const [lbl, css] = map[risk] || map.medium;

    head.textContent   = lbl;
    explain.textContent= explanation;
    box.className      = css;
    box.style.display  = "block";
  } catch (e) {
    console.error(e);
    alert("Ошибка: " + e.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Проверить письмо";
  }
};
