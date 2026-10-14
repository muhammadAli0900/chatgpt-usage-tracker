(() => {
  const EVENT_NAME = "chatgpt-usage-tracker:network";
  const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
  const nativeFetch = window.fetch;
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  const VALID_PLANS = new Set(["free", "plus", "pro", "business", "enterprise", "edu", "team"]);
  function isUsageUrl(url) {
    try { return new URL(url, location.href).href === USAGE_URL; }
    catch (_error) { return false; }
  }
  function normalizePlan(plan) {
    if (typeof plan !== "string") return null;
    const normalized = plan.trim().toLowerCase();
    return VALID_PLANS.has(normalized) ? normalized : null;
  }

  function normalizeUsageWindow(window) {
    if (!window || typeof window !== "object" || Array.isArray(window)
      || !Number.isFinite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100
      || !Number.isSafeInteger(window.reset_at) || window.reset_at < 0) return null;
    return { used_percent: window.used_percent, reset_at: window.reset_at };
  }

  function reportUsage(data) {
    // Only allowlisted usage fields cross the bridge; missing or invalid windows become null.
    const plan = normalizePlan(data?.plan_type);
    const rateLimit = data?.rate_limit;
    if (!plan || !rateLimit || typeof rateLimit !== "object" || Array.isArray(rateLimit)) {
      return;
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: {
        type: "usage-detected",
        usage: {
          plan_type: plan,
          rate_limit: {
            primary_window: normalizeUsageWindow(rateLimit.primary_window),
            secondary_window: normalizeUsageWindow(rateLimit.secondary_window)
          }
        }
      }
    }));
  }

  async function inspectUsageResponse(response) {
    try {
      reportUsage(await response.clone().json());
    } catch (_error) {}
  }

  window.fetch = function interceptedFetch(input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const responsePromise = nativeFetch.apply(this, arguments);
    if (isUsageUrl(url)) {
      const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET") {
        responsePromise.then((response) => {
          if (response.ok && response.url === USAGE_URL) inspectUsageResponse(response);
        }).catch(() => {});
      }
    }
    return responsePromise;
  };
  XMLHttpRequest.prototype.open = function interceptedOpen(method, url) {
    this.__cutObserveUsage = String(method).toUpperCase() === "GET" && isUsageUrl(url);
    return nativeXhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function interceptedSend() {
    if (this.__cutObserveUsage) {
      this.addEventListener("load", () => {
        if (this.status < 200 || this.status >= 300 || this.responseURL !== USAGE_URL) return;
        try {
          // Reading an XHR response does not consume the application's response.
          reportUsage(this.responseType === "json" ? this.response : JSON.parse(this.responseText));
        } catch (_error) {}
      }, { once: true });
    }
    return nativeXhrSend.apply(this, arguments);
  };
})();
