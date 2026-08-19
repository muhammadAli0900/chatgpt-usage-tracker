importScripts("config.js");

const DEFAULT_STATE = {
  currentModel: "Unknown",
  currentPlan: null,
  modelSource: null,
  sharedUsage: { messageCount: 0, sessionStartedAt: null, resetAt: null },
  recentMessageIds: []
};
let storageQueue = Promise.resolve();

function normalizeModel(model) {
  if (typeof model !== "string") return null;
  const slug = model.trim().toLowerCase();
  const valid = /^(?:gpt-[0-9]+[a-z]?(?:-[0-9]+[a-z]?)?(?:-[a-z0-9]+)*|o[0-9]+(?:-[a-z0-9]+)*)$/.test(slug);
  return valid ? slug : null;
}

function normalizePlan(plan) {
  if (typeof plan !== "string") return null;
  const normalized = plan.trim().toLowerCase();
  return ["free", "plus", "pro", "business", "enterprise", "edu", "team"].includes(normalized)
    ? normalized
    : null;
}

function emptyUsage() {
  return { messageCount: 0, sessionStartedAt: null, resetAt: null };
}

function activeUsage(storedUsage, now = Date.now()) {
  const usage = { ...emptyUsage(), ...(storedUsage || {}) };
  if (usage.resetAt && now >= usage.resetAt) return emptyUsage();
  return usage;
}

async function migrateStoredState() {
  const state = await chrome.storage.local.get(null);
  const currentModel = normalizeModel(state.currentModel);
  const legacyUsage = currentModel ? state.modelUsage?.[currentModel] : null;
  const sharedUsage = activeUsage(state.sharedUsage || legacyUsage);

  await chrome.storage.local.set({
    currentModel: currentModel || "Unknown",
    currentPlan: normalizePlan(state.currentPlan),
    modelSource: currentModel ? state.modelSource || null : null,
    sharedUsage,
    recentMessageIds: Array.isArray(state.recentMessageIds) ? state.recentMessageIds : []
  });
  await chrome.storage.local.remove(["messageCount", "modelUsage"]);
}

chrome.runtime.onInstalled.addListener(() => {
  storageQueue = storageQueue.then(migrateStoredState);
});

async function updateStoredState(message) {
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  const changes = {};
  const suppliedModel = normalizeModel(message.model);
  const isNetworkModel = message.modelSource === "network";
  const mayUseDomModel = message.modelSource === "dom" && state.modelSource !== "network";

  if (suppliedModel && (isNetworkModel || mayUseDomModel)) {
    changes.currentModel = suppliedModel;
    changes.modelSource = message.modelSource;
  }

  const suppliedPlan = normalizePlan(message.plan);
  if (message.type === "UPDATE_PLAN" && suppliedPlan) changes.currentPlan = suppliedPlan;

  if (message.type === "TRACK_MESSAGE" && message.messageId && !state.recentMessageIds.includes(message.messageId)) {
    const now = Date.now();
    const usage = activeUsage(state.sharedUsage, now);
    if (!usage.sessionStartedAt || !usage.resetAt) {
      usage.sessionStartedAt = now;
      usage.resetAt = now + ChatGPTUsageConfig.SHARED_LIMIT.windowMs;
    }
    usage.messageCount = Number.isFinite(usage.messageCount) && usage.messageCount > 0
      ? usage.messageCount + 1
      : 1;
    changes.sharedUsage = usage;
    changes.recentMessageIds = [...state.recentMessageIds, message.messageId].slice(-100);
  }

  await chrome.storage.local.set(changes);
}

async function resetSharedUsage() {
  await chrome.storage.local.set({ sharedUsage: emptyUsage() });
}

async function resetDevelopmentData() {
  await chrome.storage.local.set({
    sharedUsage: emptyUsage(),
    recentMessageIds: []
  });
}

async function expireSharedUsage() {
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  if (state.sharedUsage.resetAt && Date.now() >= state.sharedUsage.resetAt) {
    await resetSharedUsage();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromChatGPT = sender.tab?.url?.startsWith("https://chatgpt.com/");
  const fromExtensionPopup = sender.id === chrome.runtime.id && !sender.tab;
  const allowedTypes = ["TRACK_MESSAGE", "UPDATE_MODEL", "UPDATE_PLAN", "RESET_COUNTER", "EXPIRE_SESSION"];
  if (message?.type === "RESET_DEVELOPMENT_DATA") {
    if (!fromExtensionPopup) return false;
  } else if (!fromChatGPT || !allowedTypes.includes(message?.type)) {
    return false;
  }

  storageQueue = storageQueue.then(() => {
    if (message.type === "RESET_DEVELOPMENT_DATA") return resetDevelopmentData();
    if (message.type === "RESET_COUNTER") return resetSharedUsage();
    if (message.type === "EXPIRE_SESSION") return expireSharedUsage();
    return updateStoredState(message);
  });
  storageQueue.then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error.message }));
  return true;
});
