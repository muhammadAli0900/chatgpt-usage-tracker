(() => {
  const EVENT_NAME = "chatgpt-usage-tracker:network";
  const nativeFetch = window.fetch;
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  const VALID_PLANS = new Set(["free", "plus", "pro", "business", "enterprise", "edu", "team"]);
  let lastReportedPlan = null;

  function requestKind(url) {
    try {
      const parsed = new URL(url, location.href);
      if (/\/conversation\/?$/.test(parsed.pathname)) return "conversation";
      if (parsed.pathname.includes("user_last_used_model_config") && parsed.searchParams.has("model_slug")) {
        return "model-change";
      }
    } catch (_error) {
      // Ignore malformed or non-HTTP request identifiers.
    }
    return null;
  }

  function modelFromUrl(url) {
    try {
      return new URL(url, location.href).searchParams.get("model_slug");
    } catch (_error) {
      return null;
    }
  }

  function parsePayload(body) {
    if (typeof body !== "string") return null;
    try {
      return JSON.parse(body);
    } catch (_error) {
      return null;
    }
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function conversationDetail(payload) {
    if (!payload || payload.action !== "next") return null;
    const userMessages = Array.isArray(payload.messages)
      ? payload.messages.filter((message) => message?.author?.role === "user")
      : [];
    const message = userMessages.at(-1);
    if (!message) return null;

    const content = JSON.stringify(message.content ?? "");
    return {
      type: "conversation",
      model: typeof payload.model === "string" ? payload.model : null,
      messageId: message.id || `content-${hash(content)}`
    };
  }

  function reportSuccessful(url, body) {
    const kind = requestKind(url);
    let detail = null;

    if (kind === "conversation") detail = conversationDetail(parsePayload(body));
    if (kind === "model-change") detail = { type: "model-change", model: modelFromUrl(url) };

    if (detail?.model || detail?.messageId) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
    }
  }

  function reportPendingConversation(body) {
    const detail = conversationDetail(parsePayload(body));
    if (detail) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { ...detail, type: "conversation-pending" }
      }));
    }
  }

  function reportModelChange(url) {
    const model = modelFromUrl(url);
    if (model) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { type: "model-change", model }
      }));
    }
  }

  function normalizePlan(plan) {
    if (typeof plan !== "string") return null;
    const normalized = plan.trim().toLowerCase();
    return VALID_PLANS.has(normalized) ? normalized : null;
  }

  function planFromDataLine(line) {
    const trimmedLine = line.trimStart();
    if (!trimmedLine.startsWith("data:")) return null;
    const candidate = trimmedLine.slice(5).trim();
    if (!candidate || candidate === "[DONE]") return null;
    try {
      const event = JSON.parse(candidate);
      if (event?.type !== "server_ste_metadata") return null;
      return normalizePlan(event.metadata?.plan_type);
    } catch (_error) {
      return null;
    }
  }

  function reportPlan(plan) {
    if (!plan || plan === lastReportedPlan) return;
    lastReportedPlan = plan;
    console.log(`[CUT] detected plan: ${plan}`);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: { type: "plan-detected", plan }
    }));
  }

  async function inspectConversationResponse(response) {
    try {
      const clonedResponse = response.clone();
      const streamedText = await clonedResponse.text();
      for (const line of streamedText.split(/\r?\n/)) {
        const plan = planFromDataLine(line);
        if (plan) {
          reportPlan(plan);
          return;
        }
      }
    } catch (_error) {
      // Plan metadata is optional; response inspection must never affect ChatGPT.
    }
  }

  window.fetch = function interceptedFetch(input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const kind = requestKind(url);
    let bodyPromise = Promise.resolve(init?.body ?? null);

    if (kind === "conversation" && init?.body == null && input instanceof Request) {
      bodyPromise = input.clone().text().catch(() => null);
    }

    if (kind === "conversation") bodyPromise.then(reportPendingConversation);
    if (kind === "model-change") reportModelChange(url);

    const responsePromise = nativeFetch.apply(this, arguments);
    responsePromise.then(async (response) => {
      if (response.ok && kind) {
        if (kind === "conversation") inspectConversationResponse(response);
        reportSuccessful(url, await bodyPromise);
      }
    }).catch(() => {});
    return responsePromise;
  };

  XMLHttpRequest.prototype.open = function interceptedOpen(method, url) {
    this.__cutRequestUrl = String(url);
    return nativeXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function interceptedSend(body) {
    const url = this.__cutRequestUrl;
    if (requestKind(url)) {
      if (requestKind(url) === "conversation") reportPendingConversation(body);
      if (requestKind(url) === "model-change") reportModelChange(url);
      this.addEventListener("load", () => {
        if (this.status >= 200 && this.status < 300) {
          reportSuccessful(url, body);
          if (requestKind(url) === "conversation") {
            try {
              if (typeof this.responseText === "string") {
                for (const line of this.responseText.split(/\r?\n/)) reportPlan(planFromDataLine(line));
              }
            } catch (_error) {
              // Non-text XHR response types do not expose responseText.
            }
          }
        }
      }, { once: true });
    }
    return nativeXhrSend.apply(this, arguments);
  };
})();
