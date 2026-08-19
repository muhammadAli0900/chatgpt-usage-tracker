(() => {
  const WIDGET_ID = "chatgpt-usage-tracker";
  const NETWORK_EVENT = "chatgpt-usage-tracker:network";
  const FOOTER_TEXT = "ChatGPT can make mistakes. Check important info.";
  const DEFAULT_STATE = {
    currentModel: "Unknown",
    currentPlan: null,
    modelSource: null,
    sharedUsage: { messageCount: 0, sessionStartedAt: null, resetAt: null }
  };
  let currentState = DEFAULT_STATE;
  let expirationPending = false;
  let lastSubmission = { text: "", time: 0 };
  let fallbackTimer;
  let modelCheckTimer;
  let placementTimer;
  let domObserver;
  let stateReadId = 0;
  let countdownInterval;
  let storageChangeListener;
  let contextActive = true;
  const eventController = new AbortController();

  function hasValidContext() {
    return contextActive
      && typeof chrome !== "undefined"
      && Boolean(chrome.runtime?.id);
  }

  function isContextError(error) {
    return /extension context invalidated|message port closed|receiving end does not exist/i
      .test(error?.message || String(error || ""));
  }

  function stopInvalidContext() {
    if (!contextActive) return;
    contextActive = false;
    clearTimeout(fallbackTimer);
    clearTimeout(modelCheckTimer);
    clearTimeout(placementTimer);
    clearInterval(countdownInterval);
    domObserver?.disconnect();
    eventController.abort();

    try {
      if (storageChangeListener && typeof chrome !== "undefined") {
        chrome.storage?.onChanged?.removeListener(storageChangeListener);
      }
    } catch (_error) {
      // The old extension context is already detached.
    }
  }

  function handleChromeError(error) {
    if (!hasValidContext() || isContextError(error)) stopInvalidContext();
  }

  function safeSendMessage(message, callback) {
    if (!hasValidContext()) {
      stopInvalidContext();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        try {
          const error = chrome.runtime?.lastError;
          if (error) {
            handleChromeError(error);
            return;
          }
          callback?.(response);
        } catch (error) {
          handleChromeError(error);
        }
      });
    } catch (error) {
      handleChromeError(error);
    }
  }

  function safeStorageGet(defaults, callback) {
    if (!hasValidContext() || !chrome.storage?.local) {
      stopInvalidContext();
      return;
    }
    try {
      chrome.storage.local.get(defaults, (state) => {
        try {
          const error = chrome.runtime?.lastError;
          if (error) {
            handleChromeError(error);
            return;
          }
          if (hasValidContext()) callback(state);
        } catch (error) {
          handleChromeError(error);
        }
      });
    } catch (error) {
      handleChromeError(error);
    }
  }

  function createWidget() {
    const existingWidget = document.getElementById(WIDGET_ID);
    if (existingWidget) return existingWidget;

    const widget = document.createElement("aside");
    widget.id = WIDGET_ID;
    widget.setAttribute("aria-label", "ChatGPT usage tracker");
    widget.innerHTML = `
      <div class="cut-model" data-cut-model>Unknown</div>
      <div class="cut-details">
        <div class="cut-session-row">
          <span class="cut-label" data-cut-label>Session</span>
          <span class="cut-session" data-cut-session>0</span>
        </div>
        <div class="cut-meter" data-cut-meter>
          <div class="cut-progress"><span data-cut-progress></span></div>
          <span class="cut-percentage" data-cut-percentage>0%</span>
        </div>
        <div class="cut-reset-time" data-cut-reset-time>Limit not configured</div>
      </div>
    `;

    updateWidget(currentState);
    refreshStoredState();
    return widget;
  }

  function findFooterAnchor() {
    if (!document.body) return null;
    const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
    const isFooterText = (value) => normalizeText(value).replace(/\s/g, "")
      .includes(FOOTER_TEXT.replace(/\s/g, ""));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode;

    while ((textNode = walker.nextNode())) {
      if (!textNode.nodeValue?.includes("ChatGPT can make mistakes")) continue;
      let element = textNode.parentElement;
      while (element && !isFooterText(element.textContent)) {
        element = element.parentElement;
      }
      if (!element) continue;

      while (element.parentElement
        && normalizeText(element.parentElement.textContent) === normalizeText(element.textContent)) {
        element = element.parentElement;
      }
      return element;
    }
    return null;
  }

  function placeWidget() {
    if (!hasValidContext()) {
      stopInvalidContext();
      return;
    }
    clearTimeout(placementTimer);
    placementTimer = setTimeout(() => {
      if (!hasValidContext()) {
        stopInvalidContext();
        return;
      }
      const anchor = findFooterAnchor();
      if (!anchor) return;
      const widget = createWidget();
      if (widget.parentElement !== anchor.parentElement || widget.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement("afterend", widget);
      }
      updateWidget(currentState);
    }, 50);
  }

  function updateWidget(state) {
    currentState = state;
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    const model = state.currentModel;
    const config = ChatGPTUsageConfig.SHARED_LIMIT;
    let usage = state.sharedUsage || { messageCount: 0, sessionStartedAt: null, resetAt: null };

    if (usage.resetAt && Date.now() >= usage.resetAt) {
      usage = { messageCount: 0, sessionStartedAt: null, resetAt: null };
      if (!expirationPending) {
        expirationPending = true;
        safeSendMessage({ type: "EXPIRE_SESSION" }, () => {
          expirationPending = false;
        });
      }
    }

    const formattedPlan = formatPlan(state.currentPlan);
    widget.querySelector("[data-cut-model]").textContent = formattedPlan
      ? `${formatModel(model)} · ${formattedPlan}`
      : formatModel(model);
    widget.querySelector("[data-cut-label]").textContent = config
      ? `Session (${formatWindow(config.windowMs)})`
      : "Session";
    widget.querySelector("[data-cut-session]").textContent = config
      ? `${usage.messageCount} / ${config.limit}`
      : String(usage.messageCount);
    widget.querySelector("[data-cut-meter]").hidden = !config;
    widget.querySelector("[data-cut-progress]").style.width = config
      ? `${Math.min(100, (usage.messageCount / config.limit) * 100)}%`
      : "0%";
    widget.querySelector("[data-cut-percentage]").textContent = config
      ? `${Math.floor((usage.messageCount / config.limit) * 100)}%`
      : "";
    widget.querySelector("[data-cut-reset-time]").textContent = config
      ? formatResetTime(usage.resetAt)
      : "Limit not configured";
  }

  function refreshStoredState() {
    const readId = ++stateReadId;
    safeStorageGet(DEFAULT_STATE, (state) => {
      if (readId !== stateReadId) return;
      updateWidget(state);
    });
  }

  function updateCountdown() {
    if (!hasValidContext()) {
      stopInvalidContext();
      return;
    }
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    const config = ChatGPTUsageConfig.SHARED_LIMIT;
    const usage = currentState.sharedUsage;
    if (usage?.resetAt && Date.now() >= usage.resetAt) {
      updateWidget(currentState);
      return;
    }
    widget.querySelector("[data-cut-reset-time]").textContent = config
      ? formatResetTime(usage?.resetAt)
      : "Limit not configured";
  }

  function formatWindow(windowMs) {
    const hours = windowMs / 3600000;
    return Number.isInteger(hours) ? `${hours}h` : `${Math.round(windowMs / 60000)}m`;
  }

  function formatResetTime(resetAt) {
    if (!resetAt) return "Session not started";
    const remaining = Math.max(0, resetAt - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return `Reset in ${hours ? `${hours}h ` : ""}${minutes}m`;
  }

  function isValidModelSlug(model) {
    return /^(?:gpt-[0-9]+[a-z]?(?:-[0-9]+[a-z]?)?(?:-[a-z0-9]+)*|o[0-9]+(?:-[a-z0-9]+)*)$/.test(model);
  }

  function normalizeDomModel(label) {
    const slug = label.toLowerCase().replace(/\./g, "-").replace(/\s+/g, "-");
    return isValidModelSlug(slug) ? slug : null;
  }

  function formatModel(model) {
    if (!model || model === "Unknown") return "Unknown";
    const match = model.match(/^gpt-([0-9]+[a-z]?)(?:-([0-9]+[a-z]?))?(.*)$/);
    if (!match) {
      const [name, ...suffixes] = model.split("-");
      return [name, ...suffixes.map((part) => part.charAt(0).toUpperCase() + part.slice(1))].join(" ");
    }
    const version = match[2] ? `${match[1]}.${match[2]}` : match[1];
    const suffix = match[3].split("-").filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    return `GPT-${version}${suffix ? ` ${suffix}` : ""}`;
  }

  function formatPlan(plan) {
    if (!plan) return null;
    return plan === "edu" ? "Edu" : plan.charAt(0).toUpperCase() + plan.slice(1);
  }

  function getComposerText(scope = document) {
    const composer = scope.querySelector(
      '#prompt-textarea, textarea[data-testid="prompt-textarea"], textarea[placeholder], [contenteditable="true"][data-lexical-editor="true"]'
    );
    return (composer?.value || composer?.innerText || composer?.textContent || "").trim();
  }

  function scheduleFallback(scope = document) {
    const text = getComposerText(scope);
    if (!text) return;

    const now = Date.now();
    if (lastSubmission.text === text && now - lastSubmission.time < 1000) return;
    lastSubmission = { text, time: now };
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      safeSendMessage({ type: "TRACK_MESSAGE", messageId: `dom-${now}` });
    }, 3000);
  }

  function detectModel() {
    const selectors = [
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-label*="model" i]',
      'button[data-testid*="model" i]'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest(`#${WIDGET_ID}`)) continue;
        const label = (element.innerText || element.getAttribute("aria-label") || "")
          .replace(/select model|model selector|model/gi, "")
          .replace(/\s+/g, " ")
          .trim();
        const model = normalizeDomModel(label);
        if (model) return model;
      }
    }
    return "Unknown";
  }

  function refreshModel() {
    clearTimeout(modelCheckTimer);
    modelCheckTimer = setTimeout(() => {
      const currentModel = detectModel();
      safeStorageGet(DEFAULT_STATE, (state) => {
        if (state.modelSource !== "network" && currentModel !== "Unknown" && currentModel !== state.currentModel) {
          safeSendMessage({ type: "UPDATE_MODEL", model: currentModel, modelSource: "dom" });
        }
      });
    }, 250);
  }

  window.addEventListener(NETWORK_EVENT, (event) => {
    const detail = event.detail;
    if (!detail || !["conversation", "conversation-pending", "model-change", "plan-detected"].includes(detail.type)) return;

    if (detail.type === "conversation-pending") {
      clearTimeout(fallbackTimer);
      return;
    }

    if (detail.type === "conversation") {
      clearTimeout(fallbackTimer);
      safeSendMessage({
        type: "TRACK_MESSAGE",
        messageId: detail.messageId,
        model: detail.model,
        modelSource: "network"
      });
    } else if (detail.type === "model-change" && detail.model) {
      safeSendMessage({ type: "UPDATE_MODEL", model: detail.model, modelSource: "network" });
    } else if (detail.type === "plan-detected" && detail.plan) {
      safeSendMessage({ type: "UPDATE_PLAN", plan: detail.plan });
    }
  }, { signal: eventController.signal });

  document.addEventListener("submit", (event) => scheduleFallback(event.target), {
    capture: true,
    signal: eventController.signal
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const descriptor = `${button.dataset.testid || ""} ${button.getAttribute("aria-label") || ""}`;
    if (/send|submit/i.test(descriptor)) scheduleFallback(button.closest("form") || document);
  }, { capture: true, signal: eventController.signal });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (event.target.matches('#prompt-textarea, textarea, [contenteditable="true"]')) {
      scheduleFallback(event.target.closest("form") || document);
    }
  }, { capture: true, signal: eventController.signal });

  storageChangeListener = (_changes, areaName) => {
    if (areaName === "local") refreshStoredState();
  };
  try {
    if (hasValidContext() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(storageChangeListener);
    } else {
      stopInvalidContext();
    }
  } catch (error) {
    handleChromeError(error);
  }

  function initializeDomIntegration() {
    if (!hasValidContext()) {
      stopInvalidContext();
      return;
    }
    if (!document.body || domObserver) return;
    placeWidget();
    refreshModel();
    domObserver = new MutationObserver(() => {
      if (!hasValidContext()) {
        stopInvalidContext();
        return;
      }
      placeWidget();
      refreshModel();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  refreshStoredState();
  countdownInterval = setInterval(updateCountdown, 15000);
  if (document.body) {
    initializeDomIntegration();
  } else {
    document.addEventListener("DOMContentLoaded", initializeDomIntegration, {
      once: true,
      signal: eventController.signal
    });
  }
})();
