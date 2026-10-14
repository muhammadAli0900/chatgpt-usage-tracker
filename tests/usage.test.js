const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const usageContext = vm.createContext({});
vm.runInContext(read("usage.js"), usageContext);
const usage = usageContext.ChatGPTUsage;
const now = 1900000000000;
const snapshot = (primary = 42, secondary = 85) => ({
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: primary, reset_at: now / 1000 + 3600 },
    secondary_window: { used_percent: secondary, reset_at: now / 1000 + 6 * 86400 }
  },
  retrievedAt: now
});

class Element {
  constructor() { this.children = new Map(); this.dataset = {}; this.style = {}; this.attributes = {}; }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element());
    return this.children.get(selector);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
}

test("normalization keeps only allowed fields and treats invalid windows independently", () => {
  const data = snapshot();
  data.account_id = "discard-me";
  data.rate_limit.primary_window.extra = "discard-me";
  assert.deepEqual(plain(usage.normalizeUsage(data)), {
    plan_type: "plus", rate_limit: snapshot().rate_limit
  });
  for (const invalid of [null, [], {}, { used_percent: "5", reset_at: 1 },
    { used_percent: -1, reset_at: 1 }, { used_percent: 101, reset_at: 1 },
    { used_percent: 5, reset_at: 1.5 }, { used_percent: NaN, reset_at: 1 }]) {
    data.rate_limit.primary_window = invalid;
    const normalized = usage.normalizeUsage(data);
    assert.equal(normalized.rate_limit.primary_window, null);
    assert.deepEqual(plain(normalized.rate_limit.secondary_window), snapshot().rate_limit.secondary_window);
  }
  assert.equal(usage.normalizeUsage({ plan_type: "plus", rate_limit: [] }), null);
  assert.equal(usage.normalizeUsage(null), null);
});

test("all threshold boundaries use percentage USED", () => {
  for (const [percent, expected] of [[0, "normal"], [79.9, "normal"], [80, "caution"],
    [89.9, "caution"], [90, "critical"], [99.9, "critical"], [100, "reached"]]) {
    assert.equal(usage.level(percent), expected);
    const root = new Element();
    usage.render(root, snapshot(percent), now);
    const section = root.querySelector('[data-cut-window="primary_window"]');
    assert.equal(section.dataset.level, expected);
    assert.equal(section.querySelector("[data-cut-progress]").style.width, `${percent}%`);
    assert.match(section.querySelector("[data-cut-percent]").textContent, new RegExp(`^${percent}% used`));
    assert.equal(section.querySelector("[data-cut-meter]").attributes["aria-valuenow"], String(percent));
  }
});

test("countdowns convert Unix seconds and do not assume usage resets", () => {
  assert.equal(usage.countdown(now / 1000 + 3600, now), "Resets in 1h 0m");
  assert.equal(usage.countdown(now / 1000 + 6 * 86400, now), "Resets in 6d 0m");
  assert.equal(usage.countdown(now / 1000 + 20, now), "Resets in 1m");
  const root = new Element();
  const data = snapshot(100);
  usage.render(root, data, now + 3600000);
  const section = root.querySelector('[data-cut-window="primary_window"]');
  assert.match(section.querySelector("[data-cut-reset]").textContent, /awaiting update/);
  assert.equal(section.querySelector("[data-cut-progress]").style.width, "100%");
  assert.equal(data.rate_limit.primary_window.used_percent, 100);
});

test("freshness becomes stale only after five minutes, independently of local countdowns", () => {
  const root = new Element();
  usage.render(root, snapshot(), now + 300000);
  assert.equal(root.querySelector("[data-cut-stale]").hidden, true);
  usage.render(root, snapshot(), now + 300001);
  assert.equal(root.querySelector("[data-cut-stale]").hidden, false);
  assert.match(root.querySelector("[data-cut-updated]").textContent, /5m ago/);
  usage.render(root, { ...snapshot(), retrievedAt: null }, now);
  assert.equal(root.querySelector("[data-cut-stale]").hidden, false);
  assert.equal(root.querySelector("[data-cut-updated]").textContent, "Last updated unavailable");
});

test("missing windows hide progress and clearing data clears previous values", () => {
  const root = new Element();
  const data = snapshot(0);
  delete data.rate_limit.secondary_window;
  usage.render(root, data, now);
  assert.equal(root.querySelector('[data-cut-window="primary_window"]').querySelector("[data-cut-percent]").textContent, "0% used");
  const weekly = root.querySelector('[data-cut-window="secondary_window"]');
  assert.equal(weekly.querySelector("[data-cut-meter]").hidden, true);
  assert.equal(weekly.querySelector("[data-cut-percent]").textContent, "Usage not available");
  usage.render(root, null, now);
  assert.equal(root.querySelector("[data-cut-plan]").textContent, "Plan unavailable");
  assert.equal(root.querySelector("[data-cut-stale]").hidden, true);
  const primary = root.querySelector('[data-cut-window="primary_window"]');
  assert.equal(primary.querySelector("[data-cut-percent]").textContent, "Usage not available");
  assert.equal(primary.querySelector("[data-cut-reset]").textContent, "");
  assert.equal(primary.querySelector("[data-cut-meter]").attributes["aria-valuenow"], undefined);
  assert.match(usage.markup(), /Codex \/ Work usage/);
  assert.match(usage.markup(), /Regular ChatGPT conversations are excluded/);
});

function background() {
  const state = { apiUsage: snapshot(), sharedUsage: {}, currentModel: "old" };
  const logs = [];
  let onMessage, onInstalled, failNext = false;
  const context = vm.createContext({ console: { warn: (...args) => logs.push(args) }, chrome: {
    runtime: { id: "extension", onMessage: { addListener(fn) { onMessage = fn; } },
      onInstalled: { addListener(fn) { onInstalled = fn; } } },
    storage: { local: {
      async remove(keys) { for (const key of keys) delete state[key]; },
      async set(values) {
        if (failNext) { failNext = false; throw new Error("mock storage failure"); }
        Object.assign(state, plain(values));
      }
    } }
  } });
  context.importScripts = (file) => vm.runInContext(read(file), context);
  vm.runInContext(read("background.js"), context);
  const sender = { id: "extension", tab: { url: "https://chatgpt.com/" } };
  const send = (message, from = sender) => new Promise(resolve => {
    if (!onMessage(message, from, resolve)) resolve({ ignored: true });
  });
  return { state, logs, send, install: () => onInstalled(), fail: () => { failNext = true; } };
}

test("background preserves API snapshots during legacy cleanup and rejects old tracking messages", async () => {
  const bg = background();
  const original = plain(bg.state.apiUsage);
  bg.install();
  assert.equal((await bg.send({ type: "UPDATE_API_USAGE", usage: null })).ok, false);
  assert.deepEqual(bg.state.apiUsage, original);
  assert.equal(bg.state.sharedUsage, undefined);
  assert.equal(bg.state.currentModel, undefined);
  assert.equal((await bg.send({ type: "TRACK_MESSAGE", messageId: "unused" })).ignored, true);
});

test("background rejects untrusted senders, sanitizes captures, and recovers after storage failure", async () => {
  const bg = background();
  const message = { type: "UPDATE_API_USAGE", usage: { ...snapshot(), account_id: "discard-me" } };
  assert.equal((await bg.send(message, { id: "other", tab: { url: "https://chatgpt.com/" } })).ignored, true);
  assert.equal((await bg.send(message, { id: "extension", tab: { url: "https://example.com/" } })).ignored, true);
  bg.fail();
  assert.equal((await bg.send(message)).ok, false);
  assert.equal((await bg.send(message)).ok, true);
  assert.deepEqual(Object.keys(bg.state.apiUsage).sort(), ["plan_type", "rate_limit", "retrievedAt"]);
  assert.deepEqual(bg.state.apiUsage.rate_limit, snapshot().rate_limit);
  assert.ok(bg.state.apiUsage.retrievedAt > 0);
  assert.ok(bg.logs.every(args => args.length === 1 && typeof args[0] === "string"));
});

test("passive fetch/XHR observation preserves original responses and creates no extra requests", async () => {
  const events = [];
  const logs = [];
  let next, promise, calls = 0;
  const endpoint = "https://chatgpt.com/backend-api/wham/usage";
  class Xhr { open() {} send() {} addEventListener(name, fn) { this[name] = fn; } }
  const window = { fetch() { calls++; promise = Promise.resolve(next); return promise; },
    dispatchEvent(event) { events.push(plain(event.detail)); } };
  const context = vm.createContext({ window, URL, Request, XMLHttpRequest: Xhr, location: { href: "https://chatgpt.com/" },
    console: { debug: (...args) => logs.push(args) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  vm.runInContext(read("page-interceptor.js"), context);
  const data = { ...snapshot(), account_id: "discard-me" };
  const response = (body, status = 200, url = endpoint) => {
    const result = new Response(JSON.stringify(body), { status });
    Object.defineProperty(result, "url", { value: url });
    return result;
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  next = response(data);
  const originalPromise = window.fetch(new Request(endpoint));
  assert.equal(originalPromise, promise);
  const original = await originalPromise;
  await settle();
  assert.deepEqual(await original.json(), data);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].usage, plain(usage.normalizeUsage(data)));
  for (const [url, status, method] of [[endpoint, 401, "GET"], [endpoint, 200, "POST"],
    ["https://example.com/backend-api/wham/usage", 200, "GET"],
    ["https://chatgpt.com/backend-api/conversation", 200, "POST"]]) {
    next = response(data, status, url);
    const init = { method, get body() { throw new Error("request bodies must not be read"); },
      get headers() { throw new Error("authorization headers must not be read"); } };
    await window.fetch(url, init);
    await settle();
  }
  assert.equal(events.length, 1);
  const xhr = new Xhr(); xhr.open("GET", endpoint); xhr.send();
  assert.equal(xhr.__cutObserveUsage, true);
  assert.equal(xhr.__cutRequestUrl, undefined);
  Object.assign(xhr, { status: 200, responseURL: endpoint, responseType: "json", response: data });
  xhr.load();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].usage, events[0].usage);
  const otherXhr = new Xhr(); otherXhr.open("GET", "https://chatgpt.com/backend-api/conversation?private=example"); otherXhr.send();
  assert.equal(otherXhr.__cutObserveUsage, false);
  assert.equal(otherXhr.__cutRequestUrl, undefined);
  assert.equal(calls, 5);
  assert.ok(!JSON.stringify(events).includes("discard-me"));
  assert.ok(logs.every(args => args.length === 1));
});

test("popup responds to API storage changes and its local timer only renders cached data", () => {
  const root = new Element();
  let storageChanged, timer;
  let data = snapshot();
  const context = vm.createContext({ document: { getElementById() { return root; } },
    window: { addEventListener() {} }, clearInterval() {}, setInterval(fn, ms) { timer = fn; assert.equal(ms, 15000); },
    chrome: { runtime: {}, storage: { local: { get(defaults, fn) { fn({ apiUsage: data }); } },
      onChanged: { addListener(fn) { storageChanged = fn; } } } } });
  vm.runInContext(read("usage.js"), context);
  vm.runInContext(read("popup.js"), context);
  assert.equal(root.querySelector("[data-cut-plan]").textContent, "Plus");
  assert.match(root.querySelector('[data-cut-window="secondary_window"]').querySelector("[data-cut-percent]").textContent, /85% used/);
  timer();
  data = null;
  storageChanged({ apiUsage: { newValue: null } }, "local");
  assert.equal(root.querySelector('[data-cut-window="primary_window"]').querySelector("[data-cut-percent]").textContent, "Usage not available");
});

test("composer tracker mounts by the footer and forwards only normalized usage", () => {
  const listeners = new Map();
  const sent = [];
  const parent = { textContent: "Composer and footer" };
  let widget;
  const anchor = { textContent: "ChatGPT can make mistakes. Check important info.", parentElement: parent,
    insertAdjacentElement(_position, element) {
      widget = element;
      element.parentElement = parent;
      element.previousElementSibling = anchor;
    } };
  const document = { body: {}, createTreeWalker() {
    return { nextNode() { if (this.done) return null; this.done = true;
      return { nodeValue: anchor.textContent, parentElement: anchor }; } };
  }, getElementById() { return widget || null; }, createElement() { return new Element(); } };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    clearTimeout() {}, clearInterval() {}, setTimeout(fn) { fn(); return 1; }, setInterval() { return 1; },
    window: { addEventListener(name, fn) { listeners.set(name, fn); } },
    chrome: { runtime: { id: "extension", sendMessage(message, fn) { sent.push(plain(message)); fn(); } },
      storage: { local: { get(_defaults, fn) { fn({ apiUsage: snapshot() }); } },
        onChanged: { addListener() {}, removeListener() {} } } } });
  vm.runInContext(read("usage.js"), context);
  vm.runInContext(read("content.js"), context);
  assert.ok(widget);
  assert.equal(widget.querySelector('[data-cut-window="primary_window"]').querySelector("[data-cut-progress]").style.width, "42%");
  listeners.get("chatgpt-usage-tracker:network")({ detail: {
    type: "usage-detected", usage: { ...snapshot(), account_id: "discard-me" }
  } });
  assert.deepEqual(Object.keys(sent[0].usage).sort(), ["plan_type", "rate_limit"]);
  assert.equal(sent[0].usage.account_id, undefined);
});
