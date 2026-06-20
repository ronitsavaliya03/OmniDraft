// Sets sensible defaults on first install so every content script
// (across every tab and frame) reads consistent settings from
// chrome.storage rather than each guessing its own defaults.
chrome.runtime.onInstalled.addListener(async () => {
    const existing = await chrome.storage.sync.get('inlineRewriteSettings');
    if (!existing.inlineRewriteSettings) {
        await chrome.storage.sync.set({
            inlineRewriteSettings: {
                shortcut: 'ctrl+shift+y',
                previewModifierKey: 'alt', // hold Alt while pressing the shortcut to preview instead of instant-replace
                toneOverride: 'auto', // 'auto' | 'professional' | 'casual' | 'concise' | 'ai-prompt'
                contextChars: 1500,
                timeoutMs: 20000,
                enabledOnSensitiveSites: false // banking/password-manager heuristics; off by default
            }
        });
    }
});
