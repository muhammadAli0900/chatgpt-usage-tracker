importScripts("usage.js");
let storageQueue = Promise.resolve();
chrome.runtime.onInstalled.addListener(() => {
  storageQueue = storageQueue.catch(() => {}).then(() => chrome.storage.local.remove([
    "messageCount", "modelUsage", "sharedUsage", "recentMessageIds",
    "currentModel", "modelSource", "currentPlan", "planCheckedAt"
  ]));
});
async function storeApiUsage(message) {
  const usage = ChatGPTUsage.normalizeUsage(message.usage);
  if (!usage) return false;
  await chrome.storage.local.set({ apiUsage: { ...usage, retrievedAt: Date.now() } });
  return true;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab?.url?.startsWith("https://chatgpt.com/")
    || message?.type !== "UPDATE_API_USAGE") return false;
  storageQueue = storageQueue.catch(() => {}).then(() => storeApiUsage(message));
  storageQueue.then((ok) => sendResponse({ ok })).catch(() => {
    console.warn("[ChatGPT Usage Tracker] Usage snapshot could not be stored");
    sendResponse({ ok: false });
  });
  return true;
});
