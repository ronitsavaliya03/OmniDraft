const toneEl = document.getElementById('tone');
const previewModEl = document.getElementById('previewMod');
const sensitiveEl = document.getElementById('sensitive');
const timeoutEl = document.getElementById('timeout');
const statusEl = document.getElementById('status');

const DEFAULTS = {
    shortcut: 'ctrl+shift+y',
    previewModifierKey: 'alt',
    toneOverride: 'auto',
    contextChars: 1500,
    timeoutMs: 20000,
    enabledOnSensitiveSites: false
};

async function load() {
    const res = await chrome.storage.sync.get('inlineRewriteSettings');
    const s = { ...DEFAULTS, ...(res.inlineRewriteSettings || {}) };

    toneEl.value = s.toneOverride;
    previewModEl.value = s.previewModifierKey;
    sensitiveEl.checked = !!s.enabledOnSensitiveSites;
    timeoutEl.value = Math.round(s.timeoutMs / 1000);
}

async function save() {
    const updated = {
        toneOverride: toneEl.value,
        previewModifierKey: previewModEl.value,
        enabledOnSensitiveSites: sensitiveEl.checked,
        timeoutMs: Math.max(3, Math.min(60, Number(timeoutEl.value) || 20)) * 1000,
        shortcut: DEFAULTS.shortcut,
        contextChars: DEFAULTS.contextChars
    };
    await chrome.storage.sync.set({ inlineRewriteSettings: updated });
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 1200);
}

[toneEl, previewModEl, sensitiveEl, timeoutEl].forEach((el) => {
    el.addEventListener('change', save);
});

load();
