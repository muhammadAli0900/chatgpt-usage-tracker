# ChatGPT Usage Tracker

ChatGPT Usage Tracker is a Chrome Manifest V3 extension that aims to track ChatGPT usage limits and estimate conversation context and token usage.

## Current MVP

The extension currently:

- detects successful ChatGPT conversation requests and keeps one shared session count across models;
- stores the count with `chrome.storage.local`;
- reads the selected model from conversation payloads and model-configuration request URLs, with the visible model switcher as a fallback;
- detects ChatGPT plan metadata from cloned conversation response streams when available;
- displays the active model session in a compact usage bar below ChatGPT's composer footer and in the extension popup.

The temporary shared development limit lives in `config.js` and is currently 160 messages per 3-hour session. The selected model is displayed separately and does not change the shared count or reset time.

For testing, the extension popup includes a **Reset development data** button that clears the shared session and processed message IDs.

Counts are local estimates, not official ChatGPT quota values. Token estimation and feature-limit parsing are not implemented yet.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this project folder.
4. Open or refresh `https://chatgpt.com/`.

After editing extension files, use the extension's **Reload** button on `chrome://extensions` and refresh the ChatGPT tab.
