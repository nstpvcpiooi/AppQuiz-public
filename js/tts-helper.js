import { tts } from './utils.js';
import { API_CONFIG } from './config/tts.js';

const SPEECH_SDK_URL =
    'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.42.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle.min.js';

let sdkLoadPromise = null;
let activeSynthesizer = null;
let activeAudio = null;

/**
 * Chuyển HTML (vd. want<u>ed</u>) thành chuỗi phát âm.
 * Gộp các trường hợp morpheme bị tách do gạch chân: "want ed" → "wanted"
 */
export function normalizeTtsText(input) {
    const raw = String(input ?? '');
    const div = document.createElement('div');
    div.innerHTML = raw;
    let text = (div.textContent || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    text = text.replace(/\b([a-z]+)\s+(ed|es|s|ing|er|est)\b/gi, (_, base, suffix) => {
        const suf = suffix.toLowerCase();
        const b = base.toLowerCase();
        if (suf === 'ed') {
            if (/e$/i.test(b)) return b.slice(0, -1) + 'ed';
            return b + 'ed';
        }
        if (suf === 'es') return b + 'es';
        if (suf === 's') return b + 's';
        return b + suf;
    });

    return text;
}

export function getTtsWordForOption(question, optionIndex, optionHtml) {
    const override = question?.audioWords?.[optionIndex];
    if (override && String(override).trim()) {
        return normalizeTtsText(override);
    }
    return normalizeTtsText(optionHtml);
}

function isAzureConfigured() {
    return Boolean(getAzureKeys().length) && Boolean(API_CONFIG.azure?.region?.trim());
}

function getAzureKeys() {
    const { subscriptionKey, subscriptionKeyAlt } = API_CONFIG.azure ?? {};
    return [subscriptionKey, subscriptionKeyAlt]
        .map((key) => String(key ?? '').trim())
        .filter(Boolean);
}

function isMerriamWebsterConfigured() {
    return Boolean(API_CONFIG.merriamWebster?.learnersKey?.trim())
        || Boolean(API_CONFIG.merriamWebster?.collegiateKey?.trim());
}

function loadSpeechSdk() {
    if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);

    if (!sdkLoadPromise) {
        sdkLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SPEECH_SDK_URL;
            script.async = true;
            script.onload = () => {
                if (window.SpeechSDK) resolve(window.SpeechSDK);
                else reject(new Error('Azure Speech SDK failed to load'));
            };
            script.onerror = () => reject(new Error('Azure Speech SDK script error'));
            document.head.appendChild(script);
        });
    }

    return sdkLoadPromise;
}

export function cancelActiveSpeech() {
    if (activeSynthesizer) {
        try {
            activeSynthesizer.close();
        } catch {
            // ignore
        }
        activeSynthesizer = null;
    }

    if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
    }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
}

function escapeSsml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildSsml(text) {
    const voice = API_CONFIG.azure?.voice || 'en-US-JennyNeural';
    const safe = escapeSsml(text);
    return `<speak version="1.0" xml:lang="en-US"><voice name="${voice}">${safe}</voice></speak>`;
}

async function speakWithAzureKey(text, onEnd, subscriptionKey) {
    const SpeechSDK = await loadSpeechSdk();
    const { region, voice } = API_CONFIG.azure;

    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
        subscriptionKey,
        region.trim()
    );
    speechConfig.speechSynthesisVoiceName = voice || 'en-US-JennyNeural';

    const audioConfig = SpeechSDK.AudioConfig.fromDefaultSpeakerOutput();
    const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);
    activeSynthesizer = synthesizer;

    const ssml = buildSsml(text);

    return new Promise((resolve, reject) => {
        synthesizer.speakSsmlAsync(
            ssml,
            (result) => {
                synthesizer.close();
                if (activeSynthesizer === synthesizer) activeSynthesizer = null;

                if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                    onEnd?.();
                    resolve();
                    return;
                }

                const detail = result.errorDetails || SpeechSDK.ResultReason[result.reason] || 'Azure TTS failed';
                reject(new Error(detail));
            },
            (err) => {
                synthesizer.close();
                if (activeSynthesizer === synthesizer) activeSynthesizer = null;
                reject(err);
            }
        );
    });
}

async function speakWithAzure(text, onEnd) {
    const keys = getAzureKeys();
    let lastError = null;

    for (const key of keys) {
        try {
            await speakWithAzureKey(text, onEnd, key);
            return;
        } catch (err) {
            lastError = err;
            console.warn('Azure TTS key failed, trying next key if available:', err);
        }
    }

    throw lastError || new Error('Azure TTS failed');
}

function normalizeMwHeadword(hw) {
    return String(hw ?? '')
        .replace(/\*/g, '')
        .replace(/\u00B7/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/-/g, '')
        .toLowerCase()
        .trim();
}

function normalizeLookupWord(word) {
    return String(word ?? '')
        .replace(/-/g, '')
        .toLowerCase()
        .trim();
}

function getMwAudioUrl(audioName) {
    let subdirectory;
    if (audioName.startsWith('bix')) subdirectory = 'bix';
    else if (audioName.startsWith('gg')) subdirectory = 'gg';
    else if (/^[0-9_]/.test(audioName)) subdirectory = 'number';
    else subdirectory = audioName.charAt(0);
    return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdirectory}/${audioName}.mp3`;
}

function findExactMwEntry(data, word) {
    if (!Array.isArray(data)) return null;
    const target = normalizeLookupWord(word);

    for (const entry of data) {
        if (!entry || typeof entry === 'string') continue;
        const hw = normalizeMwHeadword(entry.hwi?.hw);
        const audioName = entry.hwi?.prs?.[0]?.sound?.audio;
        if (hw === target && audioName) return entry;
    }

    return null;
}

async function fetchExactMwAudioUrl(word) {
    const { learnersKey, collegiateKey } = API_CONFIG.merriamWebster;
    const encoded = encodeURIComponent(word);

    if (learnersKey?.trim()) {
        const res = await fetch(
            `https://www.dictionaryapi.com/api/v3/references/learners/json/${encoded}?key=${learnersKey.trim()}`
        );
        const data = await res.json();
        const entry = findExactMwEntry(data, word);
        const audioName = entry?.hwi?.prs?.[0]?.sound?.audio;
        if (audioName) return getMwAudioUrl(audioName);
    }

    if (collegiateKey?.trim()) {
        const res = await fetch(
            `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encoded}?key=${collegiateKey.trim()}`
        );
        const data = await res.json();
        const entry = findExactMwEntry(data, word);
        const audioName = entry?.hwi?.prs?.[0]?.sound?.audio;
        if (audioName) return getMwAudioUrl(audioName);
    }

    throw new Error('No exact Merriam-Webster match');
}

function playAudioUrl(url, onEnd) {
    return new Promise((resolve, reject) => {
        const audio = new Audio(url);
        activeAudio = audio;
        audio.onended = () => {
            if (activeAudio === audio) activeAudio = null;
            onEnd?.();
            resolve();
        };
        audio.onerror = () => {
            if (activeAudio === audio) activeAudio = null;
            reject(new Error('Audio playback failed'));
        };
        audio.play().catch((err) => {
            if (activeAudio === audio) activeAudio = null;
            reject(err);
        });
    });
}

async function speakWithMerriamWebster(text, onEnd) {
    const url = await fetchExactMwAudioUrl(text);
    await playAudioUrl(url, onEnd);
}

function speakWithBrowser(text, onEnd) {
    tts.speak(text, onEnd);
}

const TTS_PROVIDERS = {
    azure: speakWithAzure,
    merriamWebster: speakWithMerriamWebster,
    browser: speakWithBrowser
};

function getTtsOrder() {
    const order = API_CONFIG.ttsOrder;
    if (Array.isArray(order) && order.length) return order;
    return ['azure', 'merriamWebster', 'browser'];
}

function canUseProvider(name) {
    if (name === 'azure') return isAzureConfigured();
    if (name === 'merriamWebster') return isMerriamWebsterConfigured();
    if (name === 'browser') return 'speechSynthesis' in window;
    return false;
}

/**
 * Phát âm từ tiếng Anh theo thứ tự trong API_CONFIG.ttsOrder.
 * Mặc định: Azure (thử cả 2 key) → Merriam-Webster khi Azure lỗi.
 */
export async function speakEnglishWord(word, onEnd = () => {}) {
    const text = normalizeTtsText(word);
    if (!text) {
        onEnd();
        return;
    }

    cancelActiveSpeech();

    const order = getTtsOrder();
    let lastError = null;

    for (const providerName of order) {
        const speakFn = TTS_PROVIDERS[providerName];
        if (!speakFn || !canUseProvider(providerName)) continue;

        try {
            await speakFn(text, onEnd);
            return;
        } catch (err) {
            lastError = err;
            console.warn(`${providerName} TTS failed:`, err);
        }
    }

    if (lastError) {
        console.warn('All TTS providers failed, last error:', lastError);
    }
    onEnd();
}

export function speakEnglishWordFireAndForget(word, onEnd = () => {}) {
    speakEnglishWord(word, onEnd).catch(() => onEnd());
}
