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

// 2. Initialize the session early to eliminate TTFT latency
async function getOrCreateSession() {
    if (aiSession) return aiSession;

    const isAvailable = await LanguageModel.availability({ outputLanguage: "en" });
    if (isAvailable !== 'available' && isAvailable !== 'readily') {
        throw new Error(`Local AI not ready. Status: ${isAvailable}`);
    }

    aiSession = await LanguageModel.create({
        systemPrompt: "You are a professional inline text rewriter. You take a messy draft and polish it using the provided webpage context. CRITICAL RULES:\n1. Output ONLY the final corrected text.\n2. Do NOT include conversational filler, meta-commentary, introductory text, or multiple options.\n3. Do NOT explain your changes.\n4. If the draft is short, output exactly ONE clear, context-aware sentence or paragraph.",
        outputLanguage: "en"
    });

    return aiSession;
}

// 3. Listen for the Trigger (Ctrl + Shift + Y)
document.addEventListener('keydown', async function(event) {
    if (event.ctrlKey && event.shiftKey && event.key === 'Y') {
        event.preventDefault(); 
        
        let activeElement = document.activeElement;
        
        if (isValidInput(activeElement)) {
            let originalText = getElementText(activeElement);
            if (!originalText.trim()) return;

            showBadge("Reading context & writing reply...");

            try {
                // Slice context strictly to speed up the pre-fill phase
                let pageContext = document.body.innerText.slice(-1500);

                // Get the warmed-up global session
                const session = await getOrCreateSession();

                const prompt = `
<context>
${pageContext}
</context>

<user_draft>
${originalText}
</user_draft>

Instructions: Rewrite the text inside <user_draft> to be professional, clear, and natural based on the historical context in <context>. Output your rewrite directly without any explanations or markdown options.`;

                // Generate the response
                let improvedText = await session.prompt(prompt);
                
                // Clean up any potential markdown artifacts
                improvedText = improvedText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

                // Inject text safely
                setElementText(activeElement, improvedText);
                hideBadge();

            } catch (error) {
                console.error("PrivacyPrompt Engine Error:", error);
                showBadge("⚠️ Error: Check console");
                // If the session glitched out, kill it so it recreates fresh next time
                aiSession = null; 
                setTimeout(hideBadge, 3000);
            }
        }
    }
});

// --- DOM UTILITIES ---
function isValidInput(element) {
    return (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' || element.isContentEditable);
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