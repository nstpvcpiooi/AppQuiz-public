import { AI_CONFIG } from './config/ai.js';
import { htmlToPlainText, escapeHtml } from './utils.js';

export class AiExplanationError extends Error {
    constructor(message, { code = 'unknown', provider, httpStatus } = {}) {
        super(message);
        this.name = 'AiExplanationError';
        this.code = code;
        this.provider = provider;
        this.httpStatus = httpStatus;
    }
}

function isPlaceholderKey(key) {
    const k = String(key ?? '').trim();
    return !k || k.includes('YOUR_API_KEY') || k.includes('YOUR_GEMINI_API_KEY');
}

function isGeminiConfigured() {
    return !isPlaceholderKey(AI_CONFIG.geminiApiKey);
}

function isBeeknoeeConfigured() {
    return !isPlaceholderKey(AI_CONFIG.apiKey);
}

function isAbortError(err, signal) {
    return signal?.aborted || err?.name === 'AbortError';
}

function plain(html) {
    return htmlToPlainText(html).replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxChars) {
    const limit = Math.floor(Number(maxChars) || 0);
    if (!limit || text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}…`;
}

function getCorrectLetter(question) {
    const raw = String(question.correctAnswer ?? '').trim();
    if (/^[A-D]$/i.test(raw)) return raw.toUpperCase();
    const options = question.options || [];
    const idx = options.findIndex((opt) => plain(opt).toLowerCase() === plain(raw).toLowerCase());
    return idx >= 0 ? String.fromCharCode(65 + idx) : '';
}

function plainWithPronunciationHints(html) {
    let s = String(html ?? '');
    if (!s.trim()) return '';
    s = s.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '[$1]');
    s = s.replace(/<span[^>]*class="[^"]*ql-underline[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '[$1]');
    const div = document.createElement('div');
    div.innerHTML = s;
    return (div.textContent || '').replace(/\u00A0/g, ' ').trim();
}

function formatOptionForPrompt(opt, isPronunciation) {
    return isPronunciation ? plainWithPronunciationHints(opt) : plain(opt);
}

function formatOptionsCompact(options, { isPronunciation = false } = {}) {
    return (options || [])
        .map((opt, idx) => `${String.fromCharCode(65 + idx)}.${formatOptionForPrompt(opt, isPronunciation)}`)
        .filter((line) => line.length > 2)
        .join(' ');
}

function formatOptionsVerbose(options, { isPronunciation = false } = {}) {
    return (options || [])
        .map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${formatOptionForPrompt(opt, isPronunciation)}`)
        .filter((line) => line.length > 2)
        .join('\n');
}

function useCompactUserPrompt() {
    return AI_CONFIG.compactUserPrompt !== false;
}

function getMaxPassageChars() {
    const n = Number(AI_CONFIG.maxPassageChars);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function htmlHasUnderlineHint(html) {
    const s = String(html ?? '');
    if (/<u\b/i.test(s)) return true;
    if (/\bql-underline\b/i.test(s)) return true;
    if (/text-decoration\s*:\s*underline/i.test(s)) return true;
    return /\[[^\]]+\]/.test(plainWithPronunciationHints(s));
}

/** @returns {'sound'|'stress'} */
function classifyPronunciationSubType(question) {
    const options = question?.options || [];
    if (options.some((opt) => htmlHasUnderlineHint(opt))) return 'sound';
    if (htmlHasUnderlineHint(question?.text)) return 'sound';
    return 'stress';
}

function classifyExplanationCategory(question) {
    const type = question.type || 'multiple_choice';
    if (type === 'reading_mcq') {
        return 'reading';
    }
    if (type === 'pronunciation') {
        return 'pronunciation';
    }
    return 'grammar_or_vocab';
}

function getPronunciationInstruction(question) {
    const subType = classifyPronunciationSubType(question);
    if (subType === 'sound') {
        return [
            'Loại: phát âm ÂM (sound) — KHÔNG phải trọng âm.',
            'Áp dụng 【Phát âm — âm】. Trong đáp án, [chữ] là phần gạch chân — chỉ giải thích ÂM đọc khác ở đó.',
            'Cấm giải thích trọng âm/stress.'
        ].join(' ');
    }
    return [
        'Loại: TRỌNG ÂM (stress) — KHÔNG phải phát âm âm gạch chân.',
        'Áp dụng 【Phát âm — trọng âm】. Đáp án không có [gạch chân] — chỉ giải thích vị trí trọng âm khác biệt.',
        'Cấm giải thích âm/phoneme gạch chân.'
    ].join(' ');
}

function getPronunciationQuestionFallback(question) {
    return classifyPronunciationSubType(question) === 'sound'
        ? 'Q: [phát âm ÂM — chọn từ có cách đọc âm khác ở phần [gạch chân]]'
        : 'Q: [trọng âm — chọn từ có vị trí trọng âm khác các từ còn lại]';
}

function getCategoryInstruction(category, question) {
    switch (category) {
        case 'reading':
            return 'Loại: đọc hiểu (Reading MCQ) — áp dụng quy tắc 【Đọc hiểu】';
        case 'pronunciation':
            return getPronunciationInstruction(question);
        default:
            return 'Loại: ngữ pháp hoặc từ vựng — tự phân loại từ nội dung, rồi áp dụng đúng quy tắc 【Ngữ pháp】 hoặc 【Từ vựng】';
    }
}

/**
 * @param {object} question
 * @param {string} [question.type]
 * @param {string} [question.text]
 * @param {string} [question.passage]
 * @param {string[]} [question.options]
 * @param {string} [question.correctAnswer]
 */
export function buildExplanationPrompt(question) {
    const type = question.type || 'multiple_choice';
    const category = classifyExplanationCategory(question);
    const isPronunciation = category === 'pronunciation';
    const compact = useCompactUserPrompt();
    const maxPassage = getMaxPassageChars();

    let passage = plain(question.passage);
    if (passage && maxPassage) passage = truncateText(passage, maxPassage);

    const text = plain(question.text);
    const options = question.options || [];
    const correct = plain(question.correctAnswer);
    const letter = getCorrectLetter(question);

    const header = getCategoryInstruction(category, question);

    if (compact) {
        const lines = [header];
        if (passage) lines.push(`Passage: ${passage}`);
        if (text) {
            lines.push(`Q: ${text}`);
        } else if (isPronunciation) {
            lines.push(getPronunciationQuestionFallback(question));
        }
        if (isPronunciation) {
            lines.push(`Gạch chân trong đáp án: ${classifyPronunciationSubType(question) === 'sound' ? 'có' : 'không'}`);
        }
        const opts = formatOptionsCompact(options, { isPronunciation });
        if (opts) lines.push(opts);
        if (letter) {
            lines.push(`Key: ${letter}`);
        } else if (correct) {
            lines.push(`Key: ${correct}`);
        }
        return lines.join('\n');
    }

    const parts = [header, `Type: ${type.replace(/_/g, ' ')}`];
    if (passage) parts.push(`Passage:\n${passage}`);
    if (text) {
        parts.push(`Q:\n${text}`);
    } else if (isPronunciation) {
        parts.push(getPronunciationQuestionFallback(question));
    }
    if (isPronunciation) {
        parts.push(`Gạch chân trong đáp án: ${classifyPronunciationSubType(question) === 'sound' ? 'có' : 'không'}`);
    }
    const optionsBlock = formatOptionsVerbose(options, { isPronunciation });
    if (optionsBlock) parts.push(`Options:\n${optionsBlock}`);
    if (correct) parts.push(`Key: ${correct}`);
    return parts.join('\n\n');
}

const EXPLANATION_STYLE_RULES = [
    'Phong cách (bắt buộc):',
    '- Ngắn gọn, đi thẳng trọng tâm. Không dài dòng, không lặp ý.',
    '- KHÔNG chào hỏi ("Chào các em", "cùng phân tích", "nhé").',
    '- KHÔNG câu mở đầu thừa ("Đây là câu hỏi về...", "Trong câu này chúng ta cần...").',
    '- Mỗi ý 1 câu ngắn. Không ví dụ dài, không giảng dài quy tắc chung.',
    '- Giới hạn: ngữ pháp ~100 từ; từ vựng ~150 từ; đọc hiểu ~180 từ; phát âm ~80 từ.'
].join('\n');

const EXPLANATION_FORMAT_RULES = [
    'Định dạng trình bày (bắt buộc):',
    '- Viết tiếng Việt, plain text.',
    '- Xuống dòng giữa các phần; KHÔNG viết liền một đoạn dài.',
    '- Dùng "- " (gạch đầu dòng) khi liệt kê đáp án hoặc các ý.',
    '- Mỗi phần có nhãn ngắn kết thúc bằng ":" (vd: "Cấu trúc ngữ pháp:", "Lý do chọn đáp án đúng:", "Các đáp án khác:").',
    '- Kết bằng một dòng "Kết luận: Đáp án X."'
].join('\n');

const DEFAULT_SYSTEM_PROMPT = [
    'Bạn viết lời giải đề tiếng Anh cho học sinh THPT.',
    '',
    EXPLANATION_STYLE_RULES,
    '',
    EXPLANATION_FORMAT_RULES,
    '',
    '【Ngữ pháp】 (multiple choice, reading fill)',
    '- Cấu trúc ngữ pháp: 1 câu.',
    '- Lý do chọn đáp án đúng: 1-2 câu.',
    '- Các đáp án khác: chỉ các đáp án SAI, mỗi đáp án 1 dòng (tối đa 12 từ).',
    '',
    '【Từ vựng】 (multiple choice, reading fill)',
    '- Dịch nghĩa từng đáp án A/B/C/D: 1 dòng/đáp án.',
    '- Dịch câu hỏi sang tiếng Việt: 1 dòng.',
    '- Lý do đáp án đúng: 1 câu.',
    '',
    '【Đọc hiểu】 (chỉ Reading MCQ)',
    '- Câu hỏi yêu cầu gì: 1 câu.',
    '- Từng đáp án: 1 dòng ngắn (gạch đầu dòng).',
    '- Thông tin trong đoạn văn + vì sao đúng: 1-2 câu.',
    '',
    '【Phát âm — âm (sound)】 (chỉ khi input ghi "phát âm ÂM" hoặc "Gạch chân trong đáp án: có")',
    '- Câu phân biệt ÂM đọc ở phần [gạch chân], KHÔNG phải trọng âm.',
    '- Chỉ nêu âm/phoneme khác biệt tại [chữ] gạch chân (1-2 câu).',
    '- Cấm giải thích trọng âm/stress.',
    '',
    '【Phát âm — trọng âm (stress)】 (chỉ khi input ghi "TRỌNG ÂM" hoặc "Gạch chân trong đáp án: không")',
    '- Câu phân biệt vị trí TRỌNG ÂM giữa các từ, KHÔNG phải âm gạch chân.',
    '- Nêu trọng âm khác biệt (1-2 câu), có thể dùng ký hiệu nhấn mạnh.',
    '- Cấm giải thích âm/phoneme gạch chân.',
    '- Kết luận đáp án đúng.',
    '',
    'Phân loại phát âm: bắt buộc theo dòng "Loại:" trong input — không tự đoán ngược loại.',
    '',
    'Áp dụng đúng quy tắc theo Loại trong input.'
].join('\n');

function getSystemPrompt() {
    const custom = String(AI_CONFIG.systemPrompt ?? '').trim();
    return custom || DEFAULT_SYSTEM_PROMPT;
}

function buildUserMessage(question) {
    const base = buildExplanationPrompt(question);
    const suffix = String(AI_CONFIG.userPromptSuffix ?? '').trim();
    if (!suffix) return base;
    return `${base}\nNote: ${suffix}`;
}

const SECTION_LABEL_RE = /^(Cấu trúc ngữ pháp|Lý do chọn đáp án đúng|Các đáp án khác|Kết luận|Dịch câu hỏi|Câu hỏi yêu cầu|Thông tin trong đoạn văn)/i;

function isOptionLine(line) {
    return /^[-•*]?\s*[A-D]\.\s/.test(line);
}

function isOrphanDash(line) {
    return /^[-•*]\s*$/.test(line);
}

function isSectionLabelOnly(line) {
    return SECTION_LABEL_RE.test(line) && /:\s*$/.test(line);
}

function formatLabelParagraph(line) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0 || colonIdx > 48) {
        return `<p>${escapeHtml(line)}</p>`;
    }
    const label = line.slice(0, colonIdx + 1);
    const rest = line.slice(colonIdx + 1).trim();
    if (!rest) {
        return `<p><strong>${escapeHtml(label)}</strong></p>`;
    }
    return `<p><strong>${escapeHtml(label)}</strong> ${escapeHtml(rest)}</p>`;
}

function nextNonEmptyLine(lines, startIdx) {
    for (let j = startIdx + 1; j < lines.length; j += 1) {
        const line = lines[j]?.trim();
        if (line && !isOrphanDash(line)) {
            return { line, index: j };
        }
    }
    return null;
}

function mergeExplanationLines(lines) {
    const merged = [];
    for (let i = 0; i < lines.length; i += 1) {
        let line = lines[i].trim();
        if (!line || isOrphanDash(line)) continue;

        const optColon = line.match(/^(-\s*)?([A-D])\.\s+(.+):\s*$/);
        if (optColon) {
            const next = nextNonEmptyLine(lines, i);
            if (next && !isOptionLine(next.line) && !isSectionLabelOnly(next.line)) {
                merged.push(`- ${optColon[2]}. ${optColon[3]}: ${next.line}`);
                i = next.index;
                continue;
            }
        }

        if (isSectionLabelOnly(line)) {
            const next = nextNonEmptyLine(lines, i);
            if (next && !isOptionLine(next.line) && !isSectionLabelOnly(next.line)) {
                merged.push(`${line} ${next.line}`);
                i = next.index;
                continue;
            }
        }

        if (isOptionLine(line) && !/^[-•*]\s+/.test(line)) {
            line = `- ${line.replace(/^[-•*]\s+/, '')}`;
        }

        merged.push(line);
    }
    return merged;
}

function stripFillerContent(text) {
    const fillerLine = /^(?:chào các em|xin chào|cùng phân tích|đây là (?:một )?câu hỏi|trong câu này,? chúng ta|hãy cùng|bây giờ chúng ta)/i;
    return String(text ?? '')
        .split('\n')
        .filter((line) => !fillerLine.test(line.trim()))
        .join('\n')
        .trim();
}

function normalizeExplanationText(text) {
    let s = stripFillerContent(String(text ?? '').replace(/\r\n/g, '\n').trim());
    if (!s) return '';

    s = s
        .replace(/\.\s*-\s*(?=[A-D]\.)/g, '.\n')
        .replace(/\.\s*-\s*(?=\n|$)/g, '.')
        .replace(/:\s*-\s*(?=\n|$)/g, ':')
        .replace(/:\s*-\s*([A-D])\./g, ':\n- $1.');

    return mergeExplanationLines(s.split('\n').map((line) => line.trim())).join('\n');
}

/** Plain text → HTML safe for Quill */
export function explanationTextToHtml(text) {
    const normalized = normalizeExplanationText(text);
    if (!normalized) return '';

    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const parts = [];
    let listItems = [];

    const flushList = () => {
        if (listItems.length === 0) return;
        const items = listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        parts.push(`<ul>${items}</ul>`);
        listItems = [];
    };

    for (const line of lines) {
        const bulletMatch = line.match(/^[-•*]\s+(.+)$/);
        if (bulletMatch) {
            listItems.push(bulletMatch[1].trim());
            continue;
        }
        flushList();
        parts.push(formatLabelParagraph(line));
    }
    flushList();
    return parts.join('');
}

const DEFAULT_GEMINI_MODELS = [
    'gemini-pro-latest',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite'
];

function getGeminiModelPriority() {
    const custom = AI_CONFIG.geminiModels;
    if (Array.isArray(custom) && custom.length) {
        return custom.map((model) => String(model).trim()).filter(Boolean);
    }
    const single = String(AI_CONFIG.geminiModel ?? '').trim();
    if (single) {
        return [single, ...DEFAULT_GEMINI_MODELS.filter((model) => model !== single)];
    }
    return [...DEFAULT_GEMINI_MODELS];
}

function shouldFallbackToNextGeminiModel(err) {
    if (!(err instanceof AiExplanationError)) return true;
    if (err.code === 'blocked' || err.code === 'missing_key') return false;
    if (err.code === 'empty_response') return true;

    const status = Number(err.httpStatus);
    if (status === 401 || status === 403) return false;
    if (status === 429 || status === 503 || status === 404 || status === 502) return true;

    const msg = String(err.message || '').toLowerCase();
    return /quota|rate.?limit|resource_exhausted|overloaded|unavailable|capacity|exhausted/.test(msg);
}

function getMaxTokensForQuestion(question) {
    const configured = Number(AI_CONFIG.maxTokens);
    const base = Number.isFinite(configured) && configured > 0 ? configured : 512;
    const category = classifyExplanationCategory(question);
    if (category === 'reading') return Math.max(base, 640);
    if (category === 'grammar_or_vocab') return Math.max(base, 560);
    return Math.max(base, 448);
}

async function requestGeminiExplanation({ model, userContent, maxTokens, temperature, signal }) {
    const apiKey = String(AI_CONFIG.geminiApiKey || '').trim();
    const baseUrl = String(AI_CONFIG.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const modelId = model || getGeminiModelPriority()[0] || 'gemini-flash-latest';
    const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: getSystemPrompt() }]
            },
            contents: [
                {
                    role: 'user',
                    parts: [{ text: userContent }]
                }
            ],
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
            }
        }),
        signal
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const apiMsg = payload?.error?.message || payload?.error?.status || response.statusText;
        throw new AiExplanationError(
            typeof apiMsg === 'string' ? apiMsg : `Gemini API error (${response.status})`,
            { code: 'api_error', provider: 'gemini', httpStatus: response.status }
        );
    }

    return payload;
}

function extractGeminiText(payload) {
    const candidate = payload?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'SAFETY' || payload?.promptFeedback?.blockReason) {
        throw new AiExplanationError('Gemini blocked the response (safety filter).', { code: 'blocked', provider: 'gemini' });
    }

    const text = (candidate?.content?.parts || [])
        .map((part) => part?.text)
        .filter(Boolean)
        .join('')
        .trim();

    return { text, finishReason };
}

async function requestBeeknoeeExplanation({ userContent, maxTokens, temperature, signal }) {
    const baseUrl = String(AI_CONFIG.baseUrl || 'https://platform.beeknoee.com/api/v1').replace(/\/$/, '');
    const model = AI_CONFIG.model || 'gpt-5.5';

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${AI_CONFIG.apiKey.trim()}`
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: getSystemPrompt() },
                { role: 'user', content: userContent }
            ],
            temperature,
            max_tokens: maxTokens
        }),
        signal
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const apiMsg = payload?.error?.message || payload?.error || payload?.message || response.statusText;
        throw new AiExplanationError(
            typeof apiMsg === 'string' ? apiMsg : `Beeknoee API error (${response.status})`,
            { code: 'api_error' }
        );
    }

    return payload;
}

function extractBeeknoeeText(payload) {
    const message = payload?.choices?.[0]?.message;
    const text = String(message?.content ?? message?.reasoning_content ?? '').trim();
    const finishReason = payload?.choices?.[0]?.finish_reason;
    return { text, finishReason };
}

function isTruncatedFinishReason(finishReason) {
    return finishReason === 'length' || finishReason === 'MAX_TOKENS';
}

async function generateGeminiExplanationText(userContent, question, signal, runWithRetry) {
    const models = getGeminiModelPriority();
    const temperature = AI_CONFIG.temperature ?? 0.2;
    const errors = [];

    for (let i = 0; i < models.length; i += 1) {
        const model = models[i];
        try {
            const text = await runWithRetry(
                (tokens) => requestGeminiExplanation({ model, userContent, maxTokens: tokens, temperature, signal }),
                extractGeminiText
            );
            return { text, model, provider: 'gemini' };
        } catch (err) {
            throw err;
        }
    }

    throw errors[errors.length - 1] || new AiExplanationError('All Gemini models failed.', { code: 'api_error', provider: 'gemini' });
}

async function generateRawExplanationText(userContent, question, signal) {
    let maxTokens = getMaxTokensForQuestion(question);
    const temperature = AI_CONFIG.temperature ?? 0.2;
    const errors = [];

    const runWithRetry = async (requestFn, extractFn) => {
        let tokens = maxTokens;
        let payload = await requestFn(tokens);
        let { text, finishReason } = extractFn(payload);

        if (isTruncatedFinishReason(finishReason) && tokens < 1024) {
            tokens = Math.min(tokens * 2, 1024);
            payload = await requestFn(tokens);
            ({ text, finishReason } = extractFn(payload));
        }

        if (!text) {
            throw new AiExplanationError('AI returned an empty explanation.', { code: 'empty_response' });
        }
        return text;
    };

    const preferBeeknoee = AI_CONFIG.preferredProvider === 'beeknoee';

    if (preferBeeknoee) {
        if (!isBeeknoeeConfigured()) {
            throw new AiExplanationError('Beeknoee API key is missing. Please configure it in js/config/ai.js.', { code: 'missing_key' });
        }
        const model = AI_CONFIG.model || 'gpt-5.5';
        const text = await runWithRetry(
            (tokens) => requestBeeknoeeExplanation({ userContent, maxTokens: tokens, temperature, signal }),
            extractBeeknoeeText
        );
        return { text, model, provider: 'beeknoee' };
    } else {
        if (!isGeminiConfigured()) {
            throw new AiExplanationError('Google Gemini API key is missing. Please configure it in js/config/ai.js.', { code: 'missing_key' });
        }
        return await generateGeminiExplanationText(userContent, question, signal, runWithRetry);
    }
}

/**
 * @param {{ provider?: string, model?: string }} [meta]
 * @returns {string}
 */
export function formatExplanationModelLabel({ provider, model } = {}) {
    const modelId = String(model || '').trim();
    if (!modelId) return '';

    if (provider === 'beeknoee') {
        if (modelId === 'gpt-5.5') return 'Beeknoee - GPT-5.5';
        if (modelId === 'google/gemini-3.1-flash-lite-preview' || modelId === 'gemini-3.1-flash-lite-preview') return 'Beeknoee - Gemini 3.1 Flash Lite';
        if (modelId === 'google/gemini-2.5-flash-lite' || modelId === 'gemini-2.5-flash-lite') return 'Beeknoee - Gemini 2.5 Flash Lite';
        return `Beeknoee - ${modelId}`;
    }

    if (modelId === 'gemini-3.5-flash') return 'Google - Gemini 3.5 Flash';
    if (modelId === 'gemini-3.1-flash-lite') return 'Google - Gemini 3.1 Flash Lite';
    if (modelId === 'gemini-3.0-flash' || modelId === 'gemini-3-flash') return 'Google - Gemini 3 Flash';
    if (modelId === 'gemini-2.5-flash') return 'Google - Gemini 2.5 Flash';
    if (modelId === 'gemini-2.5-flash-lite') return 'Google - Gemini 2.5 Flash Lite';

    return provider === 'gemini' ? `Google - ${modelId}` : modelId;
}

/**
 * @param {object} question
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ html: string, model: string, provider: string }>}
 */
export async function generateExplanation(question, options = {}) {
    if (!isAiExplanationAvailable()) {
        throw new AiExplanationError(
            'No AI API key configured. Copy ai.config.example.js to ai.config.js and set geminiApiKey and/or Beeknoee apiKey.',
            { code: 'missing_key' }
        );
    }

    const userContent = buildUserMessage(question);
    const { text, model, provider } = await generateRawExplanationText(userContent, question, options.signal);
    return {
        html: explanationTextToHtml(text),
        model,
        provider
    };
}

export function isAiExplanationAvailable() {
    return isGeminiConfigured() || isBeeknoeeConfigured();
}
