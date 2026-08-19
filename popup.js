const DEFAULT_STATE = {
  currentModel: "Unknown",
  currentPlan: null,
  sharedUsage: { messageCount: 0, sessionStartedAt: null, resetAt: null }
};
let currentState = DEFAULT_STATE;

function render(state) {
  currentState = state;
  const model = state.currentModel;
  const config = ChatGPTUsageConfig.SHARED_LIMIT;
  const storedUsage = state.sharedUsage;
  const expired = storedUsage?.resetAt && Date.now() >= storedUsage.resetAt;
  const usage = expired || !storedUsage
    ? { messageCount: 0, sessionStartedAt: null, resetAt: null }
    : storedUsage;

  document.getElementById("model").textContent = formatModel(model);
  document.getElementById("plan").textContent = formatPlan(state.currentPlan) || "Unknown";
  document.getElementById("count").textContent = config
    ? `${usage.messageCount} / ${config.limit}`
    : String(usage.messageCount);
  document.getElementById("limit-status").textContent = config ? "" : "Limit not configured";
  document.getElementById("reset-time").textContent = config
    ? formatResetTime(usage.resetAt)
    : "";
}

function formatResetTime(resetAt) {
  if (!resetAt) return "Session not started";
  const remaining = Math.max(0, resetAt - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return `Reset in ${hours ? `${hours}h ` : ""}${minutes}m`;
}

function formatModel(model) {
  if (!model || model === "Unknown") return "Unknown";
  const match = model.match(/^gpt-([0-9]+[a-z]?)(?:-([0-9]+[a-z]?))?(.*)$/);
  if (!match) {
    const [name, ...suffixes] = model.split("-");
    return [name, ...suffixes.map(titleCase)].join(" ");
  }
  const version = match[2] ? `${match[1]}.${match[2]}` : match[1];
  const suffix = match[3].split("-").filter(Boolean).map(titleCase).join(" ");
  return `GPT-${version}${suffix ? ` ${suffix}` : ""}`;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPlan(plan) {
  if (!plan) return null;
  return plan === "edu" ? "Edu" : titleCase(plan);
}

chrome.storage.local.get(DEFAULT_STATE, render);
chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === "local") chrome.storage.local.get(DEFAULT_STATE, render);
});
document.getElementById("reset-development-data").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RESET_DEVELOPMENT_DATA" });
});
setInterval(() => render(currentState), 15000);
