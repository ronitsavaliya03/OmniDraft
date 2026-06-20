# InlineRewrite

Rewrite and polish text in any input field on any website — emails, chat
messages, prompts to other AI tools — using a free, private AI model that
runs entirely on your own computer. Nothing you type is ever sent to a
server.

This README assumes no prior knowledge of browser extensions or developer
tools. Follow the steps in order.

## 🚀 Installation & Setup

### Step 1: Enable Chrome's built-in local AI

This extension uses Chrome's on-device AI model (called "Gemini Nano"),
which is built into Chrome but turned off by default. You only need to do
this once.

1. Open Chrome and go to this address: `chrome://flags/#optimization-guide-on-device-model`
   Click the dropdown on the right and set it to **Enabled BypassPerfRequirement**.
2. Go to this address: `chrome://flags/#prompt-api-for-gemini-nano`
   Set it to **Enabled**.
3. A blue **Relaunch** button will appear at the bottom of the page — click it
   to restart Chrome with the new settings.
4. **Wait a few minutes.** After relaunching, Chrome downloads the AI model
   (about 4GB) in the background. You don't need to do anything — just leave
   Chrome open for a while. This only happens once.
5. **Check if it's ready:**
   - Press `F12` (or right-click anywhere on a page → **Inspect**) to open
     DevTools.
   - Click the **Console** tab.
   - Click into the console, type the line below, and press Enter:
     ```js
     await LanguageModel.availability()
     ```
   - If it prints `"available"` or `"readily"`, you're ready — go to Step 2.
   - If it prints `"downloadable"` or `"downloading"`, the model isn't ready
     yet. Wait a few more minutes and try again.
   - If it prints `"unavailable"` or you get an error, your device or Chrome
     version may not support this feature yet (it requires a fairly recent
     Chrome and a reasonably modern computer). See **Troubleshooting** below.

### Step 2: Install the extension

This extension isn't on the Chrome Web Store, so it's installed manually —
this is completely normal for personal/dev extensions and takes under a
minute.

1. **Download the extension files.** Either:
   - Download the ZIP file provided and extract/unzip it somewhere you'll
     remember (e.g. your Desktop), **or**
   - If you're comfortable with Git:
     ```bash
     git clone https://github.com/ronitsavaliya03/OmniDraft.git
     ```
2. Open Chrome and go to: `chrome://extensions`
3. Turn on **Developer mode** — it's a toggle switch, usually in the
   top-right corner of the page.
4. Click the **Load unpacked** button that appears.
5. In the file picker, select the extracted/cloned folder (the one
   containing `manifest.json` — not a parent or sub-folder).
6. The extension should now appear in your extensions list with a blue
   icon. Click the puzzle-piece icon in Chrome's toolbar and **pin** it so
   it's always visible.

That's it — installation is done.

## ✏️ How to use it

### The basics

1. Click into **any text box** on any website — an email draft, a chat
   message, a comment box, a prompt to ChatGPT/Claude, anything.
2. Type a rough draft. Don't worry about grammar or phrasing — that's what
   this fixes.
3. Press **`Ctrl + Shift + Y`**.
4. A small badge appears in the bottom-right corner while it works
   (usually 1-3 seconds). Your text is replaced in place with the polished
   version.

That's the entire core workflow. Everything below is optional, for more
control.

### Preview before applying

If you want to see the rewrite before it replaces your text:

- Hold **Alt** (or **Cmd** on Mac, depending on your settings — see below)
  while pressing **`Ctrl + Shift + Y`**.
- A small popup appears near your text box showing the proposed rewrite.
- Click **Accept** to use it, **Regenerate** to try again, or **✕ Cancel**
  to discard it and keep your original text.
- You can also just press **Enter** to accept or **Esc** to cancel.

### Undo a rewrite

If a rewrite already got applied and you want your original text back:

- Press **`Ctrl + Shift + Z`** while still focused in that same text box.

This works independently of Chrome's normal undo, so it's reliable even on
websites with complex text editors (like Gmail).

### Rewrite only part of your text

If you select/highlight a portion of text inside a text box before
pressing the shortcut, only the **selected portion** gets rewritten — the
rest of your text is left untouched. If nothing is selected, the whole box
is rewritten as usual.

### Adjusting settings

Click the extension's icon in your Chrome toolbar to open settings:

| Setting | What it does |
|---|---|
| **Tone mode** | Leave on "Auto-detect" and it adjusts automatically — professional for email, casual for chat apps, and a mode that preserves directness for AI tools like ChatGPT/Claude (so it doesn't over-polish your prompts). You can also force one tone everywhere. |
| **Preview modifier key** | Choose whether holding Alt or Cmd/Win triggers the preview popup. |
| **Allow on sensitive pages** | Off by default. When off, the extension won't read nearby page text as context on pages with password or card fields. |
| **Timeout** | How many seconds to wait before giving up on a stuck rewrite (default 12s). |

### Keyboard shortcuts, all in one place

| Shortcut | Action |
|---|---|
| `Ctrl + Shift + Y` | Rewrite instantly |
| `Ctrl + Shift + Y` + modifier (Alt by default) | Preview before applying |
| `Ctrl + Shift + Z` | Undo the last rewrite |
| `Esc` (while preview is open) | Cancel the preview |
| `Enter` (while preview is open) | Accept the preview |

## 🛟 Troubleshooting

**"Local AI not ready" error, or the badge shows an error icon:**
Go back to Step 1 above and re-check the availability command in the
console. If it still doesn't say `"available"`, your Chrome version may be
too old — make sure Chrome is fully updated (`chrome://settings/help`), or
your hardware may not meet the minimum requirements for the on-device model
(this is a Chrome limitation, not something this extension can work around).

**Nothing happens when I press the shortcut:**
Make sure your cursor is actually inside a text box (click into it first).
Some websites use custom text editors that may not be fully supported yet
— see "Known limits" below.

**The rewrite looks wrong or made up information:**
The model only sees nearby page text as context, plus what you typed — it
shouldn't invent unrelated facts, but like any AI it can occasionally get
things wrong. Always read before sending anything important. Press
`Ctrl + Shift + Z` to undo if needed.

---

## What changed and why (technical notes)

This is a full rebuild of an earlier single-file content script. Every
issue identified during development is addressed below, with the exact
mechanism and where to find it in the code.

## Issue → fix map

| # | Issue | Fix | Where |
|---|---|---|---|
| Hang | `document.body.innerText` forces full-page layout | Replaced with scoped `.textContent` read from a nearby ancestor | `getNearbyContext()` in content.js |
| Hang | Concurrent generations could run if shortcut hit twice | `isProcessing` lock ignores repeat triggers | content.js, trigger handler |
| Hang | No timeout on `session.prompt()` | `promptWithTimeout()` aborts after `settings.timeoutMs` | content.js |
| 1 | Direct `.value`/`.innerText` assignment corrupts rich-text/framework editors | `applyToFormField` uses `setRangeText` + native `InputEvent`; `applyToContentEditable` uses `execCommand('insertText', …)`, both of which route through the same pipeline real typing uses | `applyText()` and helpers |
| 2 | No undo path, and native undo may not work after synthetic events | Explicit `undoStack` (WeakMap) + dedicated **Ctrl+Shift+Z** shortcut | `rememberForUndo`, `undoLastRewrite` |
| 3 | Gmail-style iframes never receive the content script | `"all_frames": true` in manifest.json | manifest.json |
| 4a | Sensitive nearby text (cards, passwords) sent as context | `pageLooksSensitive()` heuristic skips context grab unless explicitly allowed in settings | content.js |
| 4b | Context grab could leak the AI's own prior reply as "context" on chat sites | Site-mode detection treats AI-chat domains differently (ai-prompt mode preserves the user's own voice instead of blending in) | `detectSiteMode()` |
| 5 | No preview before replacing | Preview popup with Accept / Regenerate / Cancel, shown when holding the configured modifier key | `showPreview()`, overlay.css |
| 6 | No retry/tone adjustment | Regenerate button in preview; tone override in settings (manual or auto) | settings.html/js, `resolveMode()` |
| 7 | Always rewrites whole field, never just selection | `getDraftAndRange()` detects an active selection (via `selectionStart/End` for inputs, `window.getSelection()` for contentEditable) and rewrites only that range | content.js |
| 8 | No visual cue on which field is targeted | Considered, then removed — an always-on outline on every focused field was distracting and made typing feel constrained. The corner badge (shown only during an actual rewrite) is the only visual feedback now. | overlay.css, content.js |
| 9 | "Professional polish" hurts LLM prompt quality | `ai-prompt` mode in the system prompt explicitly preserves directness/specificity instead of formalizing | `buildSystemPrompt()` |
| 10 | Context contamination from AI's own replies | Same site-mode detection narrows what context is used/how it's framed on AI chat domains | `detectSiteMode()` |
| 11 | Cold-start latency on first use per page | Session is pre-warmed on first `focusin` into any valid field, not on first keypress | `focusin` listener → `getOrCreateSession()` |
| 12 | No cap on oversized drafts | `MAX_DRAFT_CHARS` guard throws a clear error before hitting the model's real context ceiling | `generateRewrite()` |

## Known limits (being upfront about these)

- **Heavily framework-controlled editors** (Slate/ProseMirror-based boxes
  some sites use) keep additional internal state beyond what
  `execCommand('insertText', …)` touches. This fix covers the large
  majority of real editors, including Gmail's compose box, but an editor
  that diverges enough may still need page-specific handling.
- **AI-chat-domain detection** is allowlist-based (`AI_CHAT_HOSTS`). It
  won't recognize self-hosted or unlisted AI chat UIs automatically —
  the tone-override setting is the manual fallback for those.
- **`execCommand`** is technically a legacy API in some specs, but it
  remains the most broadly compatible way to insert text such that
  framework editors observe it correctly; the fallback path covers
  browsers where it's unavailable.
