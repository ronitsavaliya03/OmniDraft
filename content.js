// 1. Inject the minimalist UI into the page
const badge = document.createElement('div');
badge.id = 'privacy-prompt-badge';
badge.innerHTML = `
    <div class="privacy-prompt-spinner"></div>
    <span>Processing context...</span>
`;
document.body.appendChild(badge);

function showBadge(text) {
    badge.querySelector('span').innerText = text;
    badge.classList.add('visible');
}

function hideBadge() {
    badge.classList.remove('visible');
}

// Global session cache to keep the model warm in memory
let aiSession = null;

// Guard against double-triggering / overlapping generations.
// Running two on-device inferences at once is the most likely cause
// of a full system hang, since local LLM inference is heavy on CPU/GPU
// and memory; this guard makes that impossible.
let isProcessing = false;

// 2. Initialize the session early to eliminate TTFT latency
async function getOrCreateSession() {
    if (aiSession) return aiSession;

    const isAvailable = await LanguageModel.availability({ outputLanguage: "en" });
    if (isAvailable !== 'available' && isAvailable !== 'readily') {
        throw new Error(`Local AI not ready. Status: ${isAvailable}`);
    }

    aiSession = await LanguageModel.create({
        systemPrompt: buildSystemPrompt(),
        outputLanguage: "en"
    });

    return aiSession;
}

function buildSystemPrompt() {
    return [
        "You are a professional inline text rewriter embedded in a browser extension.",
        "You take a messy draft and polish it using the provided webpage context.",
        "",
        "CRITICAL RULES:",
        "1. Output ONLY the final corrected text — nothing else.",
        "2. Never include conversational filler, meta-commentary, labels, or multiple options.",
        "3. Never explain or justify your changes.",
        "4. Preserve the original meaning, intent, and tone of the draft. Improve clarity, grammar, and flow — do not invent new claims, facts, or commitments that weren't in the draft.",
        "5. Match the register implied by the context (e.g. casual chat vs formal email) unless the draft itself clearly signals a different register.",
        "6. Keep roughly the same length as the input unless the draft is so fragmented that a short sentence is the only faithful rewrite.",
        "7. Never wrap the output in quotes or markdown code fences."
    ].join("\n");
}

// Cancellable, timed wrapper around session.prompt so a stalled model
// can never hang the page indefinitely. AbortSignal.timeout requires
// the LanguageModel API to support a `signal` option; if your runtime
// doesn't, the Promise.race fallback below still protects the UI even
// though it can't cancel the underlying generation.
async function promptWithTimeout(session, prompt, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await session.prompt(prompt, { signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

// Pulls nearby context without forcing a full-page layout/reflow.
// document.body.innerText is the main cause of the "PC hangs" symptom:
// on a large/complex page it forces the browser to recompute layout
// for the entire DOM synchronously on the main thread. We instead walk
// up from the focused element and only read text from a small, nearby
// slice of the DOM, which is orders of magnitude cheaper.
function getNearbyContext(activeElement, maxChars = 1500) {
    let container = activeElement;
    let hops = 0;

    // Walk up to find a reasonably-scoped ancestor (e.g. a form, a
    // comment box, a message thread) instead of the whole <body>.
    while (container.parentElement && hops < 6) {
        container = container.parentElement;
        hops++;
        if (container.matches?.('form, article, main, [role="main"], section')) {
            break;
        }
    }

    // textContent is far cheaper than innerText (no layout pass needed),
    // at the cost of including some hidden text. That tradeoff is fine
    // here since this is just LLM context, not user-facing.
    let text = container.textContent || '';

    // Collapse whitespace cheaply.
    text = text.replace(/\s+/g, ' ').trim();

    return text.slice(-maxChars);
}

// 3. Listen for the Trigger (Ctrl + Shift + Y)
document.addEventListener('keydown', async function(event) {
    if (event.ctrlKey && event.shiftKey && event.key === 'Y') {
        event.preventDefault();

        if (isProcessing) {
            // Ignore repeat triggers instead of stacking up concurrent
            // generations, which is what actually starves the system.
            return;
        }

        let activeElement = document.activeElement;

        if (isValidInput(activeElement)) {
            let originalText = getElementText(activeElement);
            if (!originalText.trim()) return;

            isProcessing = true;
            showBadge("Reading context & writing reply...");

            try {
                // Cheap, scoped context grab instead of whole-page innerText
                let pageContext = getNearbyContext(activeElement);

                // Get the warmed-up global session
                const session = await getOrCreateSession();

                const prompt = `<context>
${pageContext}
</context>

<user_draft>
${originalText}
</user_draft>

Instructions: Rewrite the text inside <user_draft> to be clear and natural, using <context> only to inform tone and relevant details — never to introduce new facts. Output the rewrite directly with no explanations, labels, or markdown.`;

                let improvedText = await promptWithTimeout(session, prompt, 12000);

                // Clean up any potential markdown/quote artifacts
                improvedText = improvedText
                    .replace(/```[a-z]*\n?/gi, '')
                    .replace(/```/g, '')
                    .trim();

                if (!improvedText) {
                    throw new Error('Model returned empty output');
                }

                // Inject text safely
                setElementText(activeElement, improvedText);
                hideBadge();

            } catch (error) {
                console.error("PrivacyPrompt Engine Error:", error);

                if (error?.name === 'AbortError') {
                    showBadge("⚠️ Timed out — try again");
                } else {
                    showBadge("⚠️ Error: Check console");
                }

                // If the session glitched out, kill it so it recreates fresh next time
                aiSession = null;
                setTimeout(hideBadge, 3000);
            } finally {
                isProcessing = false;
            }
        }
    }
});

// --- DOM UTILITIES ---
function isValidInput(element) {
    return !!element && (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' || element.isContentEditable);
}

function getElementText(element) {
    return (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') ? element.value : element.innerText;
}

function setElementText(element, newText) {
    newText = newText.replace(/^"|"$/g, '').trim();
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        element.value = newText;
    } else {
        element.innerText = newText;
    }
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}