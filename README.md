# ChatGPT Usage Tracker
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4)
![ChatGPT](https://img.shields.io/badge/ChatGPT-Compatible-10A37F)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-555555)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-555555)

**Monitor your Codex and ChatGPT Work usage directly inside ChatGPT.**

ChatGPT Usage Tracker is a lightweight Chrome extension that displays your OpenAI usage limits without requiring you to repeatedly visit the Usage settings page.

It shows how much of your available usage you've consumed, when your limits reset, and updates whenever ChatGPT receives fresh usage information.

## What Does It Track?

The extension displays two shared usage limits:

- **5-hour usage:** Percentage of your 5-hour allowance consumed.
- **Weekly usage:** Percentage of your weekly allowance consumed.

These limits are shared across supported OpenAI products, including:

- Codex
- ChatGPT Work
- Workspace Agents
- ChatGPT for Excel

**Important:** This extension does NOT track regular ChatGPT conversations or their message limits.

It is intended for users with access to the supported products and their usage dashboard, including eligible Plus and Pro users. Availability depends on your OpenAI plan.

## Features

- **Actual usage percentages** — Displays server-reported usage rather than estimated message counts.
- **Two progress bars** — Track 5-hour and weekly consumption.
- **Automatic updates** — Captures fresh usage data when ChatGPT requests it.
- **Reset countdowns** — See when each usage window resets.
- **Usage warnings** — Visual indicators at 80%, 90%, and 100% usage.
- **On-screen tracker** — View usage directly below the ChatGPT composer.
- **Extension popup** — Check your usage by clicking the extension icon.
- **Last updated indicator** — Know when the latest data was captured.
- **Lightweight and private** — No external tracking server, account credentials, or message-count estimation.

## Installation

The extension is currently installed manually through Chrome.

1. Download the project from GitHub using **Code → Download ZIP**.
2. Extract the ZIP file to a folder on your computer.
3. Open Google Chrome and visit `chrome://extensions`.
4. Enable **Developer mode** in the upper-right corner.
5. Click **Load unpacked**.
6. Select the extracted project folder containing `manifest.json`.
7. Open or refresh [ChatGPT](https://chatgpt.com/).

The extension is now installed.

**Tip:** Pin ChatGPT Usage Tracker from Chrome's Extensions menu for easy access.

## How to Use

Once installed, the extension displays a compact usage tracker near the ChatGPT message composer.

You can also click the extension icon to open a popup showing the same information.

The tracker includes:

- Current OpenAI plan
- 5-hour usage percentage
- Weekly usage percentage
- Reset countdowns
- Last updated time

For example, **75% used** means you've consumed 75% of that usage window.

### How Updates Work

The extension observes usage information returned by ChatGPT's own authenticated requests.

When ChatGPT receives fresh usage information, the tracker updates automatically.

It does not continuously request the API or refresh every minute.

If no new usage information has been received, the extension displays the last captured values and may mark them as stale.

For an initial capture, open **ChatGPT → Settings → Usage**.

## Privacy

ChatGPT Usage Tracker:

- Stores usage information locally using Chrome extension storage.
- Does not collect passwords, authentication tokens, or cookies.
- Does not read or store your conversation messages.
- Does not send usage data to an external developer-operated server.
- Does not require your OpenAI API key.

Usage information is stored per Chrome profile, not separately per ChatGPT account. If you switch accounts, previously captured data may remain visible until a new snapshot is received.

## Limitations

- Does not track regular ChatGPT conversation limits.
- Requires access to the supported OpenAI usage dashboard.
- Uses an undocumented ChatGPT usage endpoint, which OpenAI may change.
- Updates depend on ChatGPT making a successful usage request.
- The on-screen tracker placement may be affected by future ChatGPT interface changes.

## Troubleshooting

**Usage not available?**

Make sure you're signed in to ChatGPT and can access Settings → Usage. Visit that page once to allow the extension to capture data.

**Usage percentage isn't changing?**

The extension displays the latest captured data. It cannot independently force a fresh authenticated request.

**Tracker not visible?**

Reload the extension from `chrome://extensions`, then refresh ChatGPT.

## Disclaimer

ChatGPT Usage Tracker is an independent, unofficial Chrome extension. It is not developed, endorsed, or affiliated with OpenAI.

## License

License information will be added before the public release.