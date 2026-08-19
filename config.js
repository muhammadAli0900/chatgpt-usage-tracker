(function initializeUsageConfig(global) {
  const SHARED_LIMIT = Object.freeze({
    limit: 160,
    windowMs: 3 * 60 * 60 * 1000
  });

  global.ChatGPTUsageConfig = Object.freeze({
    SHARED_LIMIT
  });
})(globalThis);
