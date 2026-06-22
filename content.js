(function () {
'use strict';

// Avoid double-injection if the script somehow runs twice in the same frame
if (window.__inlineRewriteInjected) return;
window.__inlineRewriteInjected = true;

// =========================================================================
// SETTINGS  (loaded async, with safe defaults so the script never blocks
// waiting on storage before it can respond to a keypress)
// =========================================================================
let settings = {
    shortcut: 'ctrl+shift+y',
    previewModifierKey: 'alt',
    toneOverride: 'auto',
    contextChars: 1500,
    timeoutMs: 20000,
    enabledOnSensitiveSites: false
};

chrome.storage?.sync.get('inlineRewriteSettings').then((res) => {
    if (res?.inlineRewriteSettings) {
        settings = { ...settings, ...res.inlineRewriteSettings };
    }
});

chrome.storage?.onChanged.addListener((changes) => {
    if (changes.inlineRewriteSettings) {
        settings = { ...settings, ...changes.inlineRewriteSettings.newValue };
    }
});

// =========================================================================
// BADGE (status indicator)
// =========================================================================
const badge = document.createElement('div');
badge.id = 'privacy-prompt-badge';
badge.innerHTML = `<div class="privacy-prompt-spinner"></div><span>Processing context...</span>`;
document.documentElement.appendChild(badge);

function showBadge(text) {
    badge.querySelector('span').innerText = text;
    badge.classList.add('visible');
}
function hideBadge() {
    badge.classList.remove('visible');
}

// =========================================================================
// ISSUE #11 FIX: pre-warm the model session on first focus into any valid
// input, rather than waiting for the keyboard shortcut. This hides cold
// -start latency behind the time the user spends typing their draft.
// =========================================================================
let aiSession = null;
let warmupPromise = null;

async function getOrCreateSession() {
    if (aiSession) return aiSession;
    if (warmupPromise) return warmupPromise;

    warmupPromise = (async () => {
        const isAvailable = await LanguageModel.availability({ outputLanguage: 'en' });
        if (isAvailable !== 'available' && isAvailable !== 'readily') {
            throw new Error(`Local AI not ready. Status: ${isAvailable}`);
        }
        aiSession = await LanguageModel.create({
            systemPrompt: buildSystemPrompt('auto'),
            outputLanguage: 'en'
        });
        return aiSession;
    })();

    try {
        return await warmupPromise;
    } finally {
        warmupPromise = null;
    }
}

document.addEventListener('focusin', (e) => {
    if (isValidInput(e.target)) {
        // Fire-and-forget warmup; errors are surfaced later on actual use.
        // No visual indication on focus — the extension stays invisible
        // until a rewrite is actually triggered, so it never interferes
        // with normal typing or interaction with the page.
        getOrCreateSession().catch(() => {});
    }
}, true);

// =========================================================================
// ISSUE #9/#10 FIX: site-aware tone. Auto-detect known AI chat tools and
// switch to a mode that preserves directness/specificity rather than
// "professional polish", which actively hurts prompt quality.
// =========================================================================
const AI_CHAT_HOSTS = [
    'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com',
    'perplexity.ai', 'poe.com', 'copilot.microsoft.com'
];

function detectSiteMode() {
    const host = window.location.hostname.replace(/^www\./, '');
    if (AI_CHAT_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
        return 'ai-prompt';
    }
    if (/mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com/.test(host)) {
        return 'professional';
    }
    if (/slack\.com|discord\.com|teams\.microsoft\.com/.test(host)) {
        return 'casual';
    }
    return 'professional'; // safe general default
}

function buildSystemPrompt(mode) {
    const base = [
        "You are a professional inline text rewriter embedded in a browser extension.",
        "You take a messy draft and polish it using the provided context.",
        "",
        "CRITICAL RULES:",
        "1. Output ONLY the final corrected text — nothing else.",
        "2. Never include conversational filler, meta-commentary, labels, or multiple options.",
        "3. Never explain or justify your changes.",
        "4. Preserve the original meaning and intent. Improve clarity, grammar, and flow — never invent new claims, facts, or commitments absent from the draft.",
        "5. Never wrap the output in quotes or markdown code fences.",
        "6. Keep roughly the same length as the input unless the draft is too fragmented to preserve faithfully."
    ];

    const modeInstructions = {
        'professional': "Tone: clear, polished, professional — suitable for email or formal written communication.",
        'casual': "Tone: relaxed and natural, like a quick message to a colleague or friend. Do not over-formalize short chat messages.",
        'concise': "Tone: as short and direct as possible while keeping all essential meaning. Cut filler aggressively.",
        'ai-prompt': "This text is a PROMPT being sent to an AI assistant, not a message to a human. Preserve specificity, directness, and any unusual phrasing that conveys intent — do NOT soften, formalize, or generalize it. Fix only grammar/clarity issues that would confuse the AI; do not 'smooth over' deliberate precision.",
        'auto': "Match the tone implied by the surrounding context (formal email vs casual chat) using your judgment."
    };

    return base.join('\n') + '\n\n' + (modeInstructions[mode] || modeInstructions.auto);
}

// =========================================================================
// ISSUE #4 FIX (context grab) — cheap, scoped read, no full-page layout.
// ISSUE #4 (sensitive data) — basic heuristic to avoid scraping near
// password fields / common payment-form patterns.
// ISSUE #10 FIX (this was previously incomplete): on AI chat sites,
// detectSiteMode() correctly returns 'ai-prompt' and changes the SYSTEM
// PROMPT tone, but getNearbyContext() ignored mode entirely and grabbed
// raw textContent from the conversation panel — which includes the
// assistant's own prior replies. That meant the rewriter could pick up
// and start mimicking the AI's voice/phrasing instead of the user's own,
// exactly the contamination issue #10 was supposed to prevent.
//
// Fix: getNearbyContext() now takes `mode`. When mode is 'ai-prompt', it
// uses site-specific selectors to collect ONLY the user's own previous
// turns and explicitly excludes assistant turns, rather than walking up
// the DOM blindly. Falls back to the generic ancestor-walk for every
// other site/mode, where role separation isn't relevant.
// =========================================================================
function pageLooksSensitive() {
    if (settings.enabledOnSensitiveSites) return false;
    return !!document.querySelector(
        'input[type="password"], input[autocomplete*="cc-"], input[name*="card"], input[name*="ssn"]'
    );
}

// Site-specific selectors for the user's own message turns. Each entry
// matches *only* elements containing the human's previous messages, never
// the assistant's — verified against each site's current DOM structure
// (data-message-author-role on ChatGPT, data-testid on Claude, etc).
// These are inherently brittle since they depend on each site's markup
// and will need updates if a site redesigns its DOM.
const AI_CHAT_USER_MESSAGE_SELECTORS = {
    'chatgpt.com': '[data-message-author-role="user"]',
    'chat.openai.com': '[data-message-author-role="user"]',
    'claude.ai': '[data-testid="user-message"]',
    'gemini.google.com': '.query-text, [data-test-id="user-query"]',
    'perplexity.ai': '[data-testid="user-message"]',
};

function matchedAiChatSelector() {
    const host = window.location.hostname.replace(/^www\./, '');
    for (const [domain, selector] of Object.entries(AI_CHAT_USER_MESSAGE_SELECTORS)) {
        if (host === domain || host.endsWith('.' + domain)) return selector;
    }
    return null;
}

// Collects only the user's own prior turns on a known AI chat site.
// Returns null if the site isn't in our selector map (caller decides
// what to do — currently: send no context rather than risk grabbing
// the assistant's replies). Returns '' if the site IS recognized but
// no user turns were found yet (e.g. a brand new conversation).
function getUserOnlyContext(maxChars) {
    const selector = matchedAiChatSelector();
    if (!selector) return null; // unrecognized AI-chat-like site; caller falls back

    const userTurns = Array.from(document.querySelectorAll(selector))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);

    if (userTurns.length === 0) return '';

    const text = userTurns.join('\n---\n').replace(/[ \t]+/g, ' ').trim();
    return text.slice(-maxChars);
}

function getNearbyContext(activeElement, maxChars, mode) {
    if (pageLooksSensitive()) return '';

    if (mode === 'ai-prompt') {
        const userOnly = getUserOnlyContext(maxChars);
        if (userOnly !== null) return userOnly;

        // We know this is an AI-chat site (mode is only 'ai-prompt' if
        // detectSiteMode() matched AI_CHAT_HOSTS) but we don't have a
        // selector for it in AI_CHAT_USER_MESSAGE_SELECTORS yet. Falling
        // through to the generic walk-and-grab below would silently
        // reintroduce the exact contamination this mode exists to avoid
        // (pulling in the assistant's own replies as "context"). Safer
        // to send no context at all than wrong context.
        return '';
    }

    let container = activeElement;
    let hops = 0;
    while (container.parentElement && hops < 6) {
        container = container.parentElement;
        hops++;
        if (container.matches?.('form, article, main, [role="main"], section')) break;
    }

    let text = (container.textContent || '').replace(/\s+/g, ' ').trim();
    return text.slice(-maxChars);
}

// =========================================================================
// ISSUE #7 FIX: selection-aware text extraction. If the user has a
// selection inside the field, only that range is sent for rewriting;
// otherwise the whole field is used.
// =========================================================================
function getDraftAndRange(element) {
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        const { selectionStart, selectionEnd, value } = element;
        if (selectionStart != null && selectionEnd != null && selectionEnd > selectionStart) {
            return {
                fullText: value,
                draft: value.slice(selectionStart, selectionEnd),
                isPartial: true,
                start: selectionStart,
                end: selectionEnd
            };
        }
        return { fullText: value, draft: value, isPartial: false };
    }

    // contentEditable: use the live Selection API
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && element.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        return {
            fullText: element.innerText,
            draft: range.toString(),
            isPartial: true,
            domRange: range.cloneRange()
        };
    }
    return { fullText: element.innerText, draft: element.innerText, isPartial: false };
}

// =========================================================================
// ISSUE #1 FIX (the big one): rich-text-safe insertion.
//
// Plain assignment to .value / .innerText bypasses framework-controlled
// editors (Gmail, Outlook, Slate/ProseMirror-based boxes) and can corrupt
// editor state or silently get overwritten on next re-render.
//
// Strategy, in order of preference:
//   1. For INPUT/TEXTAREA: use setRangeText() / native value setter +
//      proper InputEvent, which most frameworks listen to correctly
//      (this matches what real typing does, unlike a bare 'input' event
//      dispatched after direct .value assignment).
//   2. For contentEditable: use document.execCommand('insertText', ...)
//      where available. This routes through the browser's native text
//      insertion pipeline (the same one real keystrokes use), so
//      framework editors that listen for native composition/input events
//      pick it up correctly and undo history stays intact.
//   3. Fallback: direct manipulation + dispatched events (old behavior),
//      used only if the above aren't available.
// =========================================================================
function applyText(element, newText, extraction) {
    newText = newText.replace(/^"|"$/g, '').trim();

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        applyToFormField(element, newText, extraction);
    } else {
        applyToContentEditable(element, newText, extraction);
    }
}

function applyToFormField(element, newText, extraction) {
    element.focus();

    if (extraction.isPartial) {
        element.setSelectionRange(extraction.start, extraction.end);
    } else {
        element.setSelectionRange(0, element.value.length);
    }

    // setRangeText + a native InputEvent is the closest we can get to
    // "the user typed this" without simulating individual keystrokes.
    // This works correctly with React/Vue/etc. controlled inputs because
    // it goes through the same property descriptors the framework patches.
    const supportsRangeText = typeof element.setRangeText === 'function';

    if (supportsRangeText) {
        const start = extraction.isPartial ? extraction.start : 0;
        const end = extraction.isPartial ? extraction.end : element.value.length;
        element.setRangeText(newText, start, end, 'end');
    } else {
        // Fallback for older browsers
        const start = extraction.isPartial ? extraction.start : 0;
        const end = extraction.isPartial ? extraction.end : element.value.length;
        element.value = element.value.slice(0, start) + newText + element.value.slice(end);
    }

    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: newText }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function applyToContentEditable(element, newText, extraction) {
    element.focus();
    const sel = window.getSelection();

    if (extraction.isPartial && extraction.domRange) {
        sel.removeAllRanges();
        sel.addRange(extraction.domRange);
    } else {
        // Select the whole element's contents
        const range = document.createRange();
        range.selectNodeContents(element);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    const usedExecCommand =
        typeof document.execCommand === 'function' &&
        document.execCommand('insertText', false, newText);

    if (!usedExecCommand) {
        // Fallback: manual DOM replace + synthetic events.
        // Less compatible with framework editors, but better than nothing
        // if execCommand is unavailable/deprecated in this browser.
        if (extraction.isPartial && extraction.domRange) {
            extraction.domRange.deleteContents();
            extraction.domRange.insertNode(document.createTextNode(newText));
        } else {
            element.innerText = newText;
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: newText }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }
}

// =========================================================================
// ISSUE #2 FIX: explicit undo stack, independent of the browser's native
// undo (which applyText tries to keep working, but we don't rely on it
// alone — a framework editor's internal undo history may not match what
// execCommand produced).
// =========================================================================
const undoStack = new WeakMap(); // element -> previous full text

function rememberForUndo(element, previousFullText) {
    undoStack.set(element, previousFullText);
}

function undoLastRewrite(element) {
    const previous = undoStack.get(element);
    if (previous == null) return false;

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.focus();
        element.setSelectionRange(0, element.value.length);
        if (element.setRangeText) {
            element.setRangeText(previous, 0, element.value.length, 'end');
        } else {
            element.value = previous;
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'historyUndo' }));
    } else {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        if (!document.execCommand('insertText', false, previous)) {
            element.innerText = previous;
            element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
        }
    }
    undoStack.delete(element);
    return true;
}

// Ctrl+Shift+Z as an explicit "undo last rewrite" shortcut, separate from
// native Ctrl+Z so it works reliably even where native undo doesn't.
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
        const el = document.activeElement;
        if (undoLastRewrite(el)) {
            e.preventDefault();
            showBadge('↩ Reverted');
            setTimeout(hideBadge, 1500);
        }
    }
});

// =========================================================================
// CORE GENERATION (with timeout, length guard, and the existing
// concurrency lock from the previous fix)
// =========================================================================
let isProcessing = false;

async function promptWithTimeout(session, prompt, timeoutMs) {
    const controller = new AbortController();
    const timeoutReason = new DOMException('OmniDraft: generation timed out', 'TimeoutError');

    // Race the model call against a plain timer. This protects the UI
    // (the badge/preview will always resolve within timeoutMs) even on
    // Chrome builds where session.prompt() ignores or rejects the
    // `signal` option outright, rather than relying solely on abort
    // support that may vary by version.
    const uiTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(timeoutReason), timeoutMs);
    });

    const abortTimer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);

    try {
        let modelCall;
        try {
            modelCall = session.prompt(prompt, { signal: controller.signal });
        } catch {
            // Some Chrome builds throw synchronously if `signal` isn't a
            // recognized option, rather than rejecting. Fall back to a
            // plain call so a missing/odd API surface doesn't break
            // generation entirely — the UI is still protected by the
            // uiTimeout race below.
            modelCall = session.prompt(prompt);
        }
        return await Promise.race([modelCall, uiTimeout]);
    } finally {
        clearTimeout(abortTimer);
    }
}

// ISSUE #12 FIX: soft cap + warning on oversized drafts instead of silently
// sending an arbitrarily large prompt that may fail ungracefully against
// the model's real context ceiling.
const MAX_DRAFT_CHARS = 6000;

async function generateRewrite(draft, context, mode) {
    if (draft.length > MAX_DRAFT_CHARS) {
        throw new Error(`Draft too long (${draft.length} chars, limit ${MAX_DRAFT_CHARS}). Try rewriting in smaller sections.`);
    }

    const session = await getOrCreateSession();

    const prompt = `<context>
${context}
</context>

<user_draft>
${draft}
</user_draft>

Instructions: Rewrite the text inside <user_draft> per your system instructions, using <context> only to inform tone and relevant detail — never to introduce new facts. Output the rewrite directly with no explanations, labels, or markdown.`;

    let result = await promptWithTimeout(session, prompt, settings.timeoutMs);
    result = result.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

    if (!result) throw new Error('Model returned empty output');
    return result;
}

function resolveMode() {
    if (settings.toneOverride && settings.toneOverride !== 'auto') return settings.toneOverride;
    return detectSiteMode();
}

// =========================================================================
// ISSUE #5/#6 FIX: preview popup with Accept / Regenerate / Cancel,
// positioned near the active field. Shown only when the configured
// modifier key is held during the shortcut (per chosen UX); otherwise
// instant-replace happens as before.
// =========================================================================
let previewEl = null;

function buildPreviewPopup() {
    if (previewEl) return previewEl;
    previewEl = document.createElement('div');
    previewEl.id = 'privacy-prompt-preview';
    previewEl.innerHTML = `
        <div class="ppp-header">
            <span>Preview rewrite</span>
            <span class="ppp-mode-badge" data-role="mode"></span>
        </div>
        <div class="ppp-body" data-role="body">Generating…</div>
        <div class="ppp-actions">
            <button class="ppp-cancel" data-role="cancel" title="Cancel">✕</button>
            <button class="ppp-regenerate" data-role="regenerate">Regenerate</button>
            <button class="ppp-accept" data-role="accept">Accept</button>
        </div>
        <div class="ppp-hint">Esc to cancel · Enter to accept</div>
    `;
    document.documentElement.appendChild(previewEl);
    return previewEl;
}

function positionPreviewNear(element) {
    const rect = element.getBoundingClientRect();
    const popup = previewEl;
    const top = Math.min(rect.bottom + 8, window.innerHeight - 220);
    const left = Math.min(rect.left, window.innerWidth - 500);
    popup.style.top = `${Math.max(8, top)}px`;
    popup.style.left = `${Math.max(8, left)}px`;
}

// Maps a caught error to a clear, user-facing badge message. Centralized
// so both the instant-replace path and the preview popup show consistent
// wording, and so the timeout case is detected reliably regardless of
// whether the browser surfaces it as 'AbortError' or 'TimeoutError'.
function describeError(error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        return 'Timed out — try again';
    }
    return error?.message || 'Error: check console';
}

function showPreview(element, mode, generateFn) {
    const popup = buildPreviewPopup();
    positionPreviewNear(element);
    popup.querySelector('[data-role="mode"]').textContent = mode;
    const bodyEl = popup.querySelector('[data-role="body"]');
    bodyEl.textContent = 'Generating…';
    bodyEl.classList.add('ppp-loading');
    popup.classList.add('visible');

    let currentResult = null;

    const cleanup = () => {
        popup.classList.remove('visible');
        document.removeEventListener('keydown', onKey, true);
    };

    const run = async () => {
        bodyEl.textContent = 'Generating…';
        bodyEl.classList.add('ppp-loading');
        try {
            currentResult = await generateFn();
            bodyEl.textContent = currentResult;
            bodyEl.classList.remove('ppp-loading');
        } catch (err) {
            currentResult = null;
            bodyEl.textContent = `⚠️ ${describeError(err) || 'Generation failed'}`;
            bodyEl.classList.remove('ppp-loading');
        }
    };

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); }
        if (e.key === 'Enter' && currentResult) { e.preventDefault(); e.stopPropagation(); acceptBtn.click(); }
    };
    document.addEventListener('keydown', onKey, true);

    const acceptBtn = popup.querySelector('[data-role="accept"]');
    const regenBtn = popup.querySelector('[data-role="regenerate"]');
    const cancelBtn = popup.querySelector('[data-role="cancel"]');

    acceptBtn.onclick = () => {
        if (currentResult) {
            applyAndRememberUndo(element, currentResult);
        }
        cleanup();
    };
    regenBtn.onclick = () => run();
    cancelBtn.onclick = () => cleanup();

    run();
}

function applyAndRememberUndo(element, newText) {
    const extraction = getDraftAndRange(element);
    rememberForUndo(element, extraction.fullText);
    applyText(element, newText, extraction);
}

// =========================================================================
// TRIGGER: Ctrl+Shift+Y (instant), Ctrl+Shift+Alt+Y (preview, per chosen
// default modifier). Shortcut/modifier are read from settings so the
// settings UI can change them without touching this file.
// =========================================================================
function matchesShortcut(event) {
    return event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'y';
}

function modifierHeld(event) {
    const mod = settings.previewModifierKey;
    if (mod === 'alt') return event.altKey;
    if (mod === 'meta') return event.metaKey;
    return false;
}

document.addEventListener('keydown', async function (event) {
    if (!matchesShortcut(event)) return;
    event.preventDefault();

    if (isProcessing) return; // concurrency guard from prior fix

    const activeElement = document.activeElement;
    if (!isValidInput(activeElement)) return;

    const extraction = getDraftAndRange(activeElement);
    if (!extraction.draft.trim()) return;

    const mode = resolveMode();
    const wantsPreview = modifierHeld(event);
    const context = getNearbyContext(activeElement, settings.contextChars, mode);

    if (wantsPreview) {
        showPreview(activeElement, mode, () => generateRewrite(extraction.draft, context, mode));
        return;
    }

    isProcessing = true;
    showBadge('Reading context & writing reply...');
    try {
        const improved = await generateRewrite(extraction.draft, context, mode);
        applyAndRememberUndo(activeElement, improved);
        hideBadge();
    } catch (error) {
        console.error('OmniDraft Error:', error);
        showBadge(`⚠️ ${describeError(error)}`);
        aiSession = null; // force fresh session next time in case it's the cause
        setTimeout(hideBadge, 3000);
    } finally {
        isProcessing = false;
    }
});

// =========================================================================
// DOM UTILITIES
// =========================================================================
function isValidInput(element) {
    return !!element && (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' || element.isContentEditable);
}

})();
