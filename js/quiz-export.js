import { htmlToPlainText, isEffectivelyEmptyHtml, resolveCorrectAnswer, getCorrectOptionIndex } from './utils.js';



function plainContent(html) {
    if (isEffectivelyEmptyHtml(html)) return '';
    return htmlToPlainText(html);
}

function typeLabel(type) {
    return String(type || 'question').replace(/_/g, ' ');
}

function getQuestionText(q) {
    const text = plainContent(q.text);
    if (text) return text;
    if (q.type === 'pronunciation') return 'Pronunciation — choose the correct option';
    return '(No question text)';
}

function sanitizeFilename(title) {
    return String(title || 'quiz')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 120) || 'quiz';
}

function appendMeta(lines, quiz, format) {
    const timeLabel = quiz.timeLimit > 0
        ? `${Math.floor(quiz.timeLimit / 60)} min`
        : 'No limit';
    const questionCount = quiz.questions?.length ?? 0;

    if (format === 'md') {
        lines.push(`**Mode:** ${quiz.mode || 'practice'} · **Questions:** ${questionCount} · **Time limit:** ${timeLabel}`);
        if (quiz.isSubQuiz) lines.push('');
        if (quiz.isSubQuiz) lines.push('*Sub-quiz*');
    } else {
        lines.push(`Mode: ${quiz.mode || 'practice'}`);
        lines.push(`Questions: ${questionCount}`);
        lines.push(`Time limit: ${timeLabel}`);
        if (quiz.isSubQuiz) lines.push('Type: Sub-quiz');
    }
}

function appendQuestionBlock(lines, q, num, format) {
    const labelNum = q.blankNumber ?? num;
    const correctIdx = getCorrectOptionIndex(q);
    const correctDisplay = plainContent(resolveCorrectAnswer(q));

    if (format === 'md') {
        lines.push(`### Q${labelNum} — ${typeLabel(q.type)}`);
        lines.push('');
        lines.push(getQuestionText(q));
    } else {
        lines.push(`Q${labelNum} [${typeLabel(q.type)}]`);
        lines.push(getQuestionText(q));
    }

    if (q.options?.length && q.type !== 'reading_fill_essay') {
        lines.push('');
        q.options.forEach((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const text = plainContent(opt) || '(empty option)';
            if (format === 'md') {
                lines.push(`${letter}. ${text}${idx === correctIdx ? ' ✓' : ''}`);
            } else {
                lines.push(`${letter}. ${text}${idx === correctIdx ? ' *' : ''}`);
            }
        });
    } else if (q.type === 'reading_fill_essay' && correctDisplay) {
        lines.push('');
        if (format === 'md') {
            lines.push(`**Correct answer:** ${correctDisplay}`);
        } else {
            lines.push(`Correct answer: ${correctDisplay}`);
        }
    }

    const explanation = plainContent(q.explanation);
    if (explanation) {
        lines.push('');
        if (format === 'md') {
            lines.push(`**Explanation:** ${explanation}`);
        } else {
            lines.push(`Explanation: ${explanation}`);
        }
    }

    lines.push('');
}

function appendPassage(lines, passage, format) {
    const text = plainContent(passage);
    if (!text) return;

    if (format === 'md') {
        lines.push('## Reading passage');
        lines.push('');
        lines.push(text);
    } else {
        lines.push('READING PASSAGE');
        lines.push(text);
    }
    lines.push('');
}

/**
 * @param {object} quiz
 * @param {'md'|'txt'} format
 * @returns {string}
 */
export function buildQuizExportContent(quiz, format) {
    const lines = [];
    const title = quiz?.title?.trim() || 'Untitled Quiz';

    if (format === 'md') {
        lines.push(`# ${title}`);
        lines.push('');
        appendMeta(lines, quiz, format);
        lines.push('');
        lines.push('---');
        lines.push('');
    } else {
        lines.push(`QUIZ: ${title}`);
        appendMeta(lines, quiz, format);
        lines.push('');
        lines.push('='.repeat(72));
        lines.push('');
    }

    const questions = quiz?.questions || [];
    if (!questions.length) {
        lines.push(format === 'md' ? '*This quiz has no questions.*' : 'This quiz has no questions.');
        return lines.join('\n');
    }

    let i = 0;
    let displayNum = 1;

    while (i < questions.length) {
        const q = questions[i];
        const isReading = String(q.type || '').startsWith('reading_');

        if (isReading && q.passage) {
            const passage = q.passage;
            appendPassage(lines, passage, format);

            while (
                i < questions.length
                && String(questions[i].type || '').startsWith('reading_')
                && questions[i].passage === passage
            ) {
                appendQuestionBlock(lines, questions[i], displayNum++, format);
                i++;
            }

            if (format === 'md') lines.push('---');
            else lines.push('-'.repeat(72));
            lines.push('');
        } else {
            appendQuestionBlock(lines, q, displayNum++, format);
            if (format === 'md') lines.push('---');
            else lines.push('-'.repeat(72));
            lines.push('');
            i++;
        }
    }

    return lines.join('\n').trimEnd() + '\n';
}

/**
 * @param {object} quiz
 * @param {'md'|'txt'} format
 */
export function downloadQuizExport(quiz, format) {
    const ext = format === 'md' ? 'md' : 'txt';
    const mime = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const content = '\uFEFF' + buildQuizExportContent(quiz, format);
    const filename = `${sanitizeFilename(quiz?.title)}.${ext}`;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
