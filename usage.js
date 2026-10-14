(() => {
  const VALID_PLANS = new Set(["free", "plus", "pro", "business", "enterprise", "edu", "team"]);
  const STALE_AFTER_MS = 5 * 60 * 1000;

  function normalizeWindow(window) {
    if (!window || typeof window !== "object" || Array.isArray(window)
      || !Number.isFinite(window.used_percent) || window.used_percent < 0 || window.used_percent > 100
      || !Number.isSafeInteger(window.reset_at) || window.reset_at < 0) return null;
    return { used_percent: window.used_percent, reset_at: window.reset_at };
  }

  function normalizeUsage(usage) {
    const plan = typeof usage?.plan_type === "string" ? usage.plan_type.trim().toLowerCase() : null;
    const rateLimit = usage?.rate_limit;
    if (!VALID_PLANS.has(plan) || !rateLimit || typeof rateLimit !== "object" || Array.isArray(rateLimit)) return null;
    return {
      plan_type: plan,
      rate_limit: {
        primary_window: normalizeWindow(rateLimit.primary_window),
        secondary_window: normalizeWindow(rateLimit.secondary_window)
      }
    };
  }

  function level(percent) {
    if (percent >= 100) return "reached";
    if (percent >= 90) return "critical";
    if (percent >= 80) return "caution";
    return "normal";
  }

  function countdown(resetAt, now) {
    const remaining = resetAt * 1000 - now;
    if (remaining <= 0) return "Reset time reached; awaiting update";
    const minutes = Math.ceil(remaining / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `Resets in ${days ? `${days}d ` : ""}${hours ? `${hours}h ` : ""}${minutes % 60}m`;
  }

  function markup() {
    const windowMarkup = (key, label) => `
      <section class="cut-window" data-cut-window="${key}">
        <div class="cut-window-heading"><span>${label}</span><strong data-cut-percent>Usage not available</strong></div>
        <div class="cut-progress" data-cut-meter role="progressbar" aria-label="${label} usage used" aria-valuemin="0" aria-valuemax="100" hidden><span data-cut-progress></span></div>
        <div class="cut-reset" data-cut-reset></div>
      </section>`;
    return `
      <div class="cut-heading"><strong>Codex / Work usage</strong><span class="cut-plan" data-cut-plan>Plan unavailable</span></div>
      ${windowMarkup("primary_window", "5-hour")}
      ${windowMarkup("secondary_window", "Weekly")}
      <div class="cut-footer">
        <span>Regular ChatGPT conversations are excluded.</span>
        <span class="cut-updated"><time data-cut-updated>Last updated unavailable</time><strong class="cut-stale" data-cut-stale hidden>Stale data</strong></span>
      </div>`;
  }

  function render(root, apiUsage, now = Date.now()) {
    const usage = normalizeUsage(apiUsage);
    const plan = usage?.plan_type;
    root.querySelector("[data-cut-plan]").textContent = plan
      ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Plan unavailable";
    for (const key of ["primary_window", "secondary_window"]) {
      const section = root.querySelector(`[data-cut-window="${key}"]`);
      const window = usage?.rate_limit[key];
      const meter = section.querySelector("[data-cut-meter]");
      meter.hidden = !window;
      section.dataset.level = window ? level(window.used_percent) : "unavailable";
      const status = { normal: "", caution: "Caution", critical: "Critical", reached: "Limit reached" }[section.dataset.level];
      section.querySelector("[data-cut-percent]").textContent = window
        ? `${window.used_percent}% used${status ? ` · ${status}` : ""}` : "Usage not available";
      section.querySelector("[data-cut-progress]").style.width = window ? `${window.used_percent}%` : "0%";
      if (window) {
        meter.setAttribute("aria-valuenow", String(window.used_percent));
        meter.setAttribute("aria-valuetext", `${window.used_percent}% used${status ? `, ${status}` : ""}`);
      } else {
        meter.removeAttribute("aria-valuenow");
        meter.removeAttribute("aria-valuetext");
      }
      section.querySelector("[data-cut-reset]").textContent = window ? countdown(window.reset_at, now) : "";
    }

    const updated = root.querySelector("[data-cut-updated]");
    const retrievedAt = apiUsage?.retrievedAt;
    const validTime = Boolean(usage) && Number.isFinite(retrievedAt) && retrievedAt > 0
      && retrievedAt <= now && !Number.isNaN(new Date(retrievedAt).getTime());
    if (validTime) {
      const date = new Date(retrievedAt);
      const minutes = Math.floor((now - retrievedAt) / 60000);
      updated.textContent = `Updated ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${minutes < 1 ? "just now" : `${minutes}m ago`})`;
      updated.dateTime = date.toISOString();
      updated.title = date.toLocaleString();
    } else {
      updated.textContent = "Last updated unavailable";
      updated.removeAttribute("datetime");
      updated.removeAttribute("title");
    }
    root.querySelector("[data-cut-stale]").hidden = !usage || (validTime && now - retrievedAt <= STALE_AFTER_MS);
  }

  globalThis.ChatGPTUsage = Object.freeze({ normalizeUsage, level, countdown, markup, render });
})();
