(() => {
  const root = document.getElementById("usage-popup");
  root.innerHTML = ChatGPTUsage.markup();
  let apiUsage = null;
  let readId = 0;
  function refresh() {
    const currentRead = ++readId;
    chrome.storage.local.get({ apiUsage: null }, (state) => {
      if (currentRead !== readId) return;
      apiUsage = chrome.runtime.lastError ? null : state.apiUsage;
      ChatGPTUsage.render(root, apiUsage);
    });
  }
  ChatGPTUsage.render(root, apiUsage);
  refresh();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.apiUsage) refresh();
  });
  const timer = setInterval(() => ChatGPTUsage.render(root, apiUsage), 15000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
