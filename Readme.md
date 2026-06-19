# OmniDraft 🛡️

A 100% private, universal Chrome extension that reads context and perfects your drafts anywhere on the web (Gmail, WhatsApp, GitHub, and more)—powered by Google Chrome's built-in local AI.

Your data never leaves your machine. There are no cloud servers, no API costs, and no tracking.

> **Note:** [Insert a minimalist, professional screenshot or GIF demonstrating the text replacement here. Ensure the visual focuses purely on the UI and technology, keeping the aesthetic clean and natural.]

## ✨ Features
* **Total Privacy:** Runs entirely locally on your machine.
* **Universal Support:** Works on any `<textarea>` or `contenteditable` field (ChatGPT, WhatsApp Web, Reddit, etc.).
* **Zero Cost:** No API keys or subscriptions required.
* **Offline Capable:** Works without an active internet connection once the model is downloaded.

## ⚠️ Prerequisites
Because this extension runs a raw LLM directly on your hardware, your system must meet the following requirements:
1. **Google Chrome:** Version 127 or higher.
2. **Hardware:** At least 8GB of RAM and 4GB of free storage space (for the AI model weights).
3. **Chrome Flags:** You must enable Chrome's experimental AI features (see setup below).

## 🚀 Installation & Setup

### Step 1: Enable Chrome's Local AI
Before installing the extension, you must activate the built-in AI in your browser.
1. Open Chrome and navigate to `chrome://flags/#optimization-guide-on-device-model`. Set it to **Enabled BypassPrefRequirement**.
2. Navigate to `chrome://flags/#prompt-api-for-gemini-nano`. Set it to **Enabled**.
3. Relaunch Chrome.
4. *Wait a few minutes.* Chrome will download the ~4GB AI model in the background. To verify it is ready, press `F12` to open DevTools, go to the Console, type `await window.ai.languageModel.availability();` and press Enter. It should return `"available"`.

### Step 2: Install the Extension
Since this extension is not on the Chrome Web Store, install it manually:
1. Clone this repository or download it as a ZIP file and extract it.
   ```bash
   git clone [https://github.com/ronitsavaliya03/OmniDraft.git](https://github.com/ronitsavaliya03/OmniDraft.git)