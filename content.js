function grabText() {
  const a3s = document.querySelector("div.a3s");   
  if (a3s) return a3s.innerText.trim();

  const legacy =
        document.querySelector(".adn.ads") ||
        document.querySelector(".ii.gt")   ||
        document.querySelector("div[role='main'] .ii");
  if (legacy) return legacy.innerText.trim();

  const frame = document.querySelector("iframe[role='presentation']");
  if (frame?.contentDocument?.body)
    return frame.contentDocument.body.innerText.trim();

  return "";
}


chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.type === "REQUEST_EMAIL_TEXT") send({ text: grabText() });
});


let lastText = "";
const sendIfChanged = () => {
  const txt = grabText();
  if (txt && txt !== lastText) {
    lastText = txt;
    chrome.runtime.sendMessage({ type: "EMAIL_UPDATED", text: txt });
  }
};


const observer = new MutationObserver(() => sendIfChanged());
observer.observe(document.body, { childList: true, subtree: true });


setInterval(sendIfChanged, 1500);
