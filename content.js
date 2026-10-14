(() => {
  const WIDGET_ID = "chatgpt-usage-tracker";
  const NETWORK_EVENT = "chatgpt-usage-tracker:network";
  const FOOTER_TEXT = "ChatGPT can make mistakes. Check important info.";
  const DEFAULT_STATE = { apiUsage: null };
  let currentState = DEFAULT_STATE;
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

  function safeSendMessage(message) {
    if (!hasValidContext()) {
      stopInvalidContext();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, () => {
        try {
          const error = chrome.runtime?.lastError;
          if (error) {
            handleChromeError(error);
            return;
          }
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
    widget.className = "cut-tracker";
    widget.setAttribute("aria-label", "Codex / Work usage");
    widget.innerHTML = ChatGPTUsage.markup();
    ChatGPTUsage.render(widget, currentState.apiUsage);
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
    }, 50);
  }

  function updateWidget(state) {
    currentState = state;
    const widget = document.getElementById(WIDGET_ID);
    if (widget) ChatGPTUsage.render(widget, state.apiUsage);
  }

  function refreshStoredState() {
    const readId = ++stateReadId;
    safeStorageGet(DEFAULT_STATE, (state) => {
      if (readId === stateReadId) updateWidget(state);
    });
  }

  function updateCountdown() {
    if (!hasValidContext()) {
      stopInvalidContext();
      return;
    }
    updateWidget(currentState);
  }

  window.addEventListener(NETWORK_EVENT, (event) => {
    if (event.detail?.type !== "usage-detected") return;
    const usage = ChatGPTUsage.normalizeUsage(event.detail.usage);
    if (usage) safeSendMessage({ type: "UPDATE_API_USAGE", usage });
  }, { signal: eventController.signal });

  storageChangeListener = (_changes, areaName) => {
    if (areaName === "local" && _changes.apiUsage) refreshStoredState();
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
    domObserver = new MutationObserver(() => {
      if (!hasValidContext()) {
        stopInvalidContext();
        return;
      }
      placeWidget();
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
