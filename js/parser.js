/**
 * SmartParser - Logic for parsing raw text into structured Quiz objects.
 * Designed for Azota-style text pasting.
 */
export class SmartParser {
    static PATTERNS = {
        QUESTION: /^(?:<[^>]+>\s*)*(?:(?:Câu|Question|Section|Part)\s*(?:<[^>]+>\s*)*)?(\d+)\s*(?:<[^>]+>\s*)*[:.)\]\-]/i,
        OPTION: /^(?:<[^>]+>\s*)*([A-D])(?:<[^>]+>\s*)*[.)\]\-\/:]/i,
        ANSWER_INLINE: /(?:Đáp án|Answer|Key|Ans)\s*(?:<[^>]+>\s*)*:\s*(?:<[^>]+>\s*)*([A-D])/i,
        EXPLANATION: /^(?:<[^>]+>\s*)*(?:Giải\s*thích|Giai\s*thich|Explanation|Reason|Rationale)\s*(?:<[^>]+>\s*)*[:\-]\s*(.*)$/i,
        READING_INDICATOR: /^(?:<[^>]+>\s*)*(?:Read the following|Đọc đoạn văn|Dưới đây là|Choose the correct answer for the (?:following questions|each question))/i,
        READING_SECTION: /^(?:<[^>]+>\s*)*(?:READING|ĐỌC|READING\s*COMPREHENSION|BÀI\s*ĐỌC)/i,
        SECTION_HEADER: /^(?:<[^>]+>\s*)*(?:PHẦN|BÀI|PART|SECTION|UNIT)\s*(?:<[^>]+>\s*)*\d+/i,
        ANSWER_KEYS_HEADER: /^(?:<[^>]+>\s*)*ANSWER\s*KEYS?\s*(?:<[^>]+>\s*)*:?\s*(?:<[^>]+>\s*)*$/i,
        EXPLANATION_KEYS_HEADER: /^(?:<[^>]+>\s*)*(?:HƯỚNG\s*DẪN\s*GIẢI|HUONG\s*DAN\s*GIAI)\s*(?:<[^>]+>\s*)*:?\s*(?:<[^>]+>\s*)*$/i,
        READING_END: /^(?:<[^>]+>\s*)*(?:END\s*PASSAGE|END\s*READING|HẾT\s*ĐOẠN(?:\s*VĂN)?|KẾT\s*THÚC\s*ĐOẠN(?:\s*VĂN)?|---+)\s*(?:<[^>]+>\s*)*$/i
    };

    /**
     * Extract inline options inside a single line, e.g:
     * "a. village b. dangerous c. gossip d. passenger"
     * Returns { stem, options } or null if not confidently parseable.
     */
    static extractInlineOptions(text) {
        const raw = String(text || '');
        const s = this.cleanInlineHtml(raw).replace(/\s+/g, ' ').trim();
        if (!s) return null;

        // Find a./b./c./d. markers, tolerant to:
        // - missing whitespace around markers (e.g. "c.<u>g</u>ossip")
        // - markers preceded by HTML tags or punctuation (e.g. "</u>b.")
        // We treat "non-alphanumeric boundary" as a safe separator.
        const re = /(^|[^a-z0-9])([a-d])\s*[\.)\]\-\/]\s*/gi;
        const hits = [];
        let m;
        while ((m = re.exec(s))) {
            hits.push({ idx: m.index + (m[1] ? m[1].length : 0), letter: m[2].toLowerCase() });
        }

        if (hits.length < 4) return null;

        // Keep only first occurrence of each letter in order of appearance.
        const seen = new Set();
        const ordered = [];
        for (const h of hits) {
            if (seen.has(h.letter)) continue;
            seen.add(h.letter);
            ordered.push(h);
            if (seen.size === 4) break;
        }

        const letters = ordered.map(o => o.letter).join('');
        if (letters !== 'abcd') return null;

        const stem = s.slice(0, ordered[0].idx).trim();
        const opts = [];
        for (let i = 0; i < ordered.length; i++) {
            const start = ordered[i].idx;
            const end = i + 1 < ordered.length ? ordered[i + 1].idx : s.length;
            const chunk = s.slice(start, end);
            const cleaned = chunk.replace(/^[^a-z0-9]*[a-d]\s*[\.)\]\-\/]\s*/i, '').trim();
            opts.push(cleaned);
        }

        if (opts.length !== 4 || opts.some(o => !o)) return null;
        return { stem, options: opts };
    }

    static htmlToLines(html) {
        // Convert blocks to lines while preserving some tags
        // We'll treat <p>, <div>, <br> as line separators
        let processedText = html
            .replace(/<\/p>|<\/div>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, (match) => {
                // Preserve bold, italic, underline, color spans
                if (match.match(/<\/?(b|i|u|strong|em|span|font)/i)) return match;
                return ''; // Strip other tags
            });

        // Heuristic for Word/Docx pastes:
        // Some Word content pastes as long runs with no <p>/<br>.
        // Insert line breaks before common question/option markers so downstream parsing works.
        processedText = processedText
            // Normalize NBSP early so blank lines don't survive as "&nbsp;"
            .replace(/&nbsp;/gi, ' ')
            // Question markers like "Question 12." or "Câu 12:"
            .replace(/(Question\s*(?:<[^>]+>\s*)*\d+\s*(?:<[^>]+>\s*)*[\.:])/gi, '\n$1')
            .replace(/(Câu\s*(?:<[^>]+>\s*)*\d+\s*(?:<[^>]+>\s*)*[:.)\]\-])/gi, '\n$1')
            // Option markers like "A. " "B) " (when not already at line start)
            .replace(/([^\n])(\s*(?:<[^>]+>\s*)*[A-D](?:<[^>]+>\s*)*[.)](?:<[^>]+>\s*)*\s+)/g, '$1\n$2');

        let lines = processedText
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);

        // Drop lines that are only formatting tags or only spacing artifacts from Word paste
        lines = lines
            .filter(l => !l.match(/^<\/?(strong|span|font|b|i|u|em)[^>]*>$/i))
            .filter(l => this.cleanForKeyParsing(l) !== '');

        return lines;
    }

    static cleanForKeyParsing(text) {
        const s = String(text || '');
        return s
            .replace(/&nbsp;/gi, ' ')
            .replace(/<[^>]+>/g, '') // strip all tags
            .replace(/\s+/g, ' ')
            .trim();
    }

    static cleanInlineHtml(html) {
        // Keep underline/italic/bold tags if present, but remove Word-injected strong/span/font wrappers.
        return String(html || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/<\/?(span|font)[^>]*>/gi, '')
            .replace(/<\/?strong[^>]*>/gi, '')
            // Remove any stray closing tags left by line splitting
            .replace(/<\/(strong|span|font|b|i|em)>/gi, '')
            .replace(/\s{2,}/g, ' ')
            // Tighten spacing around underline tags (Word sometimes inserts stray spaces)
            .replace(/<\/u>\s+/gi, '</u>')
            .replace(/\s+<u>/gi, '<u>')
            .trim();
    }

    static isQuestionComplete(q) {
        return Boolean(q && (q.options || []).length >= 2);
    }

    static looksLikePassageLine(line) {
        const clean = this.cleanForKeyParsing(line);
        if (!clean || clean.length < 3) return false;
        if (this.PATTERNS.QUESTION.test(line)) return false;
        if (this.PATTERNS.OPTION.test(line)) return false;
        if (this.PATTERNS.EXPLANATION.test(line)) return false;
        if (this.PATTERNS.READING_END.test(line)) return false;
        if (this.PATTERNS.SECTION_HEADER.test(line)) return false;
        if (/_{2,}/.test(line)) return true;
        if (/^[●•\-\*]\s/.test(clean)) return true;
        if (clean.length >= 40) return true;
        if (clean.length <= 80 && !/\?\s*$/.test(clean) && !/^(A|B|C|D)[.)]/i.test(clean)) {
            return true;
        }
        return false;
    }

    static shouldAttachPassage(passage) {
        const text = String(passage ?? '').trim();
        if (!text) return false;
        if (/(?:Read the following|Đọc đoạn văn|Dưới đây là)/i.test(text)) return true;
        if (/_{2,}/.test(text)) return true;
        if (/^[●•]/m.test(text)) return true;
        const plain = this.cleanForKeyParsing(text);
        const blockCount = (text.match(/<p[\s>]/gi) || []).length;
        if (blockCount >= 2 && plain.length >= 40) return true;
        if (text.includes('\n') && plain.length >= 60) return true;
        if (plain.length >= 120) return true;
        return false;
    }

    static appendPassageLine(currentPassage, line) {
        const chunk = String(line ?? '').trim();
        if (!chunk) return currentPassage;
        const block = `<p>${chunk}</p>`;
        return currentPassage ? `${currentPassage}${block}` : block;
    }

    /** Chuẩn hóa passage để hiển thị / đưa vào Quill (giữ xuống dòng + in đậm) */
    static formatPassageHtml(passage) {
        const raw = String(passage ?? '').trim();
        if (!raw) return '';
        if (/<p[\s>]/i.test(raw)) return raw;
        if (/<br\s*\/?>/i.test(raw)) return raw;
        return raw
            .split(/\n+/)
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => `<p>${part}</p>`)
            .join('');
    }

    static isFillInBlankPassage(passage) {
        const text = String(passage ?? '');
        if (/\(\d+\)\s*_{2,}/.test(text)) return true;
        if (/<u>\s*_{2,}\s*<\/u>/i.test(text)) return true;
        const numberedBlanks = (text.match(/\(\d+\)\s*_{2,}/g) || []).length;
        const underscoreBlanks = (text.match(/_{3,}/g) || []).length;
        return numberedBlanks >= 1 || underscoreBlanks >= 2;
    }

    static normalizePassageBlanks(passageHtml) {
        return String(passageHtml ?? '')
            .replace(/\((\d+)\)\s*_{2,}/g, '($1) ___')
            .replace(/<u>\s*_{2,}\s*<\/u>/gi, '___')
            .replace(/_{4,}/g, '___');
    }

    static inferReadingQuestionType(passage) {
        return this.isFillInBlankPassage(passage) ? 'reading_fill_mcq' : 'reading_mcq';
    }

    static attachPassageToQuestion(question, passage) {
        const text = String(passage ?? '').trim();
        if (!text || !question || !this.shouldAttachPassage(text)) return;
        const formatted = this.formatPassageHtml(text);
        question.passage = this.normalizePassageBlanks(formatted);
        question.type = this.inferReadingQuestionType(text);
    }

    static parseFromLines(lines) {
        const questions = [];
        let currentPassage = "";
        let currentQuestion = null;
        let isReadingSection = false;
        let isExplanationBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 0.5 End a reading passage block explicitly
            if (this.PATTERNS.READING_END.test(line)) {
                if (currentQuestion) {
                    questions.push(currentQuestion);
                    currentQuestion = null;
                }
                isReadingSection = false;
                currentPassage = "";
                continue;
            }

            // 0. Check for Section Header (resets reading/passage; MUST NOT be appended)
            if (this.PATTERNS.SECTION_HEADER.test(line)) {
                if (currentQuestion) {
                    questions.push(currentQuestion);
                    currentQuestion = null;
                }
                if (this.PATTERNS.READING_SECTION.test(line)) {
                    isReadingSection = true;
                    currentPassage = '';
                } else {
                    isReadingSection = false;
                    currentPassage = '';
                }
                isExplanationBlock = false;
                continue;
            }

            // 0.1 Check for Reading Indicator (starts passage; IS appended as first passage line)
            if (this.PATTERNS.READING_INDICATOR.test(line)) {
                if (currentQuestion) {
                    questions.push(currentQuestion);
                    currentQuestion = null;
                    currentPassage = ''; // Reset passage because we are starting a new reading section
                }
                isReadingSection = true;
                currentPassage = this.appendPassageLine(currentPassage, line);
                isExplanationBlock = false;
                continue;
            }

            // 0.2 Explanation marker (supports multi-line explanation blocks)
            const expMatch = line.match(this.PATTERNS.EXPLANATION);
            if (expMatch && currentQuestion) {
                const expText = (expMatch[1] || '').trim();
                currentQuestion.explanation = expText;
                isExplanationBlock = true;
                continue;
            }

            // 1. Check for Question Marker
            const qMatch = line.match(this.PATTERNS.QUESTION);
            if (qMatch) {
                // If we were building a question, save it
                if (currentQuestion) questions.push(currentQuestion);

                const questionNum = parseInt(qMatch[1], 10);
                const afterMarker = this.cleanInlineHtml(line.replace(this.PATTERNS.QUESTION, '').trim());
                const inline = this.extractInlineOptions(afterMarker);

                currentQuestion = {
                    id: 'parsed_' + Date.now() + '_' + questions.length,
                    type: 'multiple_choice',
                    text: afterMarker,
                    options: [],
                    correctAnswer: '',
                    explanation: ''
                };

                if (Number.isFinite(questionNum)) {
                    currentQuestion.blankNumber = questionNum;
                }

                // Pronunciation: inline a/b/c/d without numbered question stem
                if (inline && (inline.stem || '') === '' && !/^(?:<[^>]+>\s*)*Question\s*\d+/i.test(line) && !/^(?:<[^>]+>\s*)*Câu\s*\d+/i.test(line)) {
                    currentQuestion.type = 'pronunciation';
                    currentQuestion.text = '';
                    currentQuestion.options = inline.options.map(o => this.cleanInlineHtml(o));
                }

                if (questions.length === 0) {
                }

                // Check for inline answer in the same line
                const ansMatch = line.match(this.PATTERNS.ANSWER_INLINE);
                if (ansMatch) {
                    currentQuestion.correctAnswer = ansMatch[1].toUpperCase();
                }

                // Attach accumulated passage (with or without explicit reading indicator)
                if (currentPassage.trim() && this.shouldAttachPassage(currentPassage)) {
                    this.attachPassageToQuestion(currentQuestion, currentPassage);
                    isReadingSection = true;
                }

                isExplanationBlock = false;
                continue;
            }

            // 1.5 Pronunciation inline options on a separate line (must be checked BEFORE OPTION parsing),
            // because OPTION regex is case-insensitive and would otherwise treat "a." as option A.
            if (currentQuestion && (currentQuestion.options || []).length === 0) {
                const inlineLine = this.extractInlineOptions(line);
                if (inlineLine && (inlineLine.stem || '') === '') {
                    currentQuestion.type = 'pronunciation';
                    currentQuestion.text = '';
                    currentQuestion.options = inlineLine.options.map(o => this.cleanInlineHtml(o));
                    isExplanationBlock = false;

                    continue;
                }
            }

            // 2. Check for Option Marker
            const optMatch = line.match(this.PATTERNS.OPTION);
            if (optMatch && currentQuestion) {
                const optText = this.cleanInlineHtml(line.replace(this.PATTERNS.OPTION, '').trim());
                currentQuestion.options.push(optText);
                if (questions.length === 0 && currentQuestion.options.length <= 4) {
                }
                isExplanationBlock = false;
                continue;
            }

            // 3. Check for Answer Key inline in the end of a block
            const ansMatch = line.match(this.PATTERNS.ANSWER_INLINE);
            if (ansMatch && currentQuestion) {
                currentQuestion.correctAnswer = ansMatch[1].toUpperCase();
                isExplanationBlock = false;
                continue;
            }

            // 4. If none of the above, it might be part of the question text OR a passage
            if (currentQuestion) {
                if (isExplanationBlock) {
                    currentQuestion.explanation = currentQuestion.explanation
                        ? `${currentQuestion.explanation}<br>${line}`
                        : line;
                    continue;
                }

                if (this.isQuestionComplete(currentQuestion) && this.looksLikePassageLine(line)) {
                    questions.push(currentQuestion);
                    currentQuestion = null;
                    isExplanationBlock = false;
                    isReadingSection = true;
                    currentPassage = this.appendPassageLine('', line);
                    continue;
                }

                // If it looks like part of the question text (e.g., multi-line question)
                if (currentQuestion.options.length === 0) {
                    currentQuestion.text += '\n' + line;
                } else {
                    // If options already started, maybe it's an explanation?
                    currentQuestion.explanation = currentQuestion.explanation
                        ? `${currentQuestion.explanation}<br>${line}`
                        : line;
                }
            } else {
                // No current question, accumulate passage text
                currentPassage = this.appendPassageLine(currentPassage, line);
                if (this.looksLikePassageLine(line)) {
                    isReadingSection = true;
                }
            }
        }

        // Push the last question
        if (currentQuestion) questions.push(currentQuestion);

        return questions;
    }

    /**
     * Parses raw text into an array of question objects.
     * @param {string} text - The raw text pasted by the user.
     * @returns {Array} - Array of objects compatible with the Quiz schema.
     */
    static parse(html) {
        const lines = this.htmlToLines(html);
        return this.parseFromLines(lines);
    }

    /**
     * Parse questions and answer keys from a single pasted block.
     * Answer keys must appear after a line exactly like: "ANSWER KEYS"
     * @param {string} html
     * @returns {{questions: Array, keyMap: Object}}
     */
    static parseWithAnswerKeys(html) {
        const lines = this.htmlToLines(html);
        const answerIdx = lines.findIndex(l => this.PATTERNS.ANSWER_KEYS_HEADER.test(l));
        const explainIdx = lines.findIndex(l => this.PATTERNS.EXPLANATION_KEYS_HEADER.test(l));

        const blockStarts = [answerIdx, explainIdx].filter(i => i >= 0).sort((a, b) => a - b);
        if (blockStarts.length === 0) {
            return { questions: this.parseFromLines(lines), keyMap: {}, explanationMap: {} };
        }

        const firstBlockIdx = blockStarts[0];
        const questionLines = lines.slice(0, firstBlockIdx);
        const questions = this.parseFromLines(questionLines);

        const sliceBlock = (startIdx) => {
            const nextIdx = blockStarts.find(i => i > startIdx);
            return lines.slice(startIdx + 1, nextIdx ?? lines.length);
        };

        const keyMap = answerIdx >= 0 ? this.parseAnswerKey(sliceBlock(answerIdx).join('\n')) : {};
        const explanationMap = explainIdx >= 0 ? this.parseExplanationGuideLines(sliceBlock(explainIdx)) : {};

        return { questions, keyMap, explanationMap };
    }

    /**
     * Parses explanation guide lines into map: questionNumber -> HTML string.
     * Format:
     * 1. Explanation text...
     * 2: Another explanation...
     * Multi-line supported until next numbered line.
     */
    static parseExplanationGuideLines(lines) {
        const map = {};
        let currentNum = null;

        for (const rawLine of (lines || [])) {
            const line = this.cleanForKeyParsing(rawLine);
            if (!line) continue;

            const m = line.match(/^(?:Question\s*)?(\d+)[\s.:)\]\-]*([\s\S]*)$/i);
            if (m) {
                currentNum = m[1];
                const rest = (m[2] || '').trim();
                map[currentNum] = rest;
                continue;
            }
            if (currentNum) {
                map[currentNum] = map[currentNum] ? `${map[currentNum]}<br>${line}` : line;
            }
        }
        return map;
    }

    /**
     * Attempts to parse a block of answers like "1A, 2B, 3C" or "1.A 2.B"
     * @param {string} text 
     * @returns {Object} Map of question index (1-based) to answer (A-D)
     */
    static parseAnswerKey(text) {
        const keyMap = {};
        const cleaned = this.cleanForKeyParsing(text);
        // Match patterns like "1A", "1. A", "1:A", "[1] A"
        const matches = cleaned.matchAll(/(\d+)[\s.:)\]\-]*([A-D])/gi);
        for (const match of matches) {
            keyMap[match[1]] = match[2].toUpperCase();
        }
        return keyMap;
    }
}
