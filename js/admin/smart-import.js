import { EXPLANATION_SOURCE } from '../constants.js';
import { SmartParser } from '../parser.js';
import { adminState, elements } from './state.js';
const quillToolbarOptions = [
    ['bold', 'italic', 'underline'],
    [{ 'color': [] }],
    ['clean']
];

export function initSmartImportQuill() {
    if (adminState.smartImportQuill) return;
    adminState.smartImportQuill = new Quill('#smart-import-input', {
        theme: 'snow',
        placeholder: 'Paste your questions here...',
        modules: { toolbar: quillToolbarOptions }
    });
    adminState.smartImportQuill.on('text-change', () => updateSmartPreview());
}

export function focusSmartImportEditor() {
    if (!adminState.smartImportQuill) return;
    adminState.smartImportQuill.focus();
    adminState.smartImportQuill.setSelection(0, 0, 'silent');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { adminState.smartImportQuill.focus(); });
    });
}

export function updateSmartPreview() {
    const html = adminState.smartImportQuill ? adminState.smartImportQuill.root.innerHTML : '';
    const { questions, keyMap, explanationMap } = SmartParser.parseWithAnswerKeys(html);
    adminState.parsedQuestions = questions;
    if (Object.keys(keyMap).length > 0) {
        adminState.parsedQuestions.forEach((q, idx) => {
            const questionNum = idx + 1;
            if (keyMap[questionNum]) q.correctAnswer = keyMap[questionNum];
        });
    }
    if (Object.keys(explanationMap || {}).length > 0) {
        adminState.parsedQuestions.forEach((q, idx) => {
            const questionNum = String(idx + 1);
            if (explanationMap[questionNum]) {
                q.explanation = explanationMap[questionNum];
                q.explanationSource = EXPLANATION_SOURCE.TEACHER;
            }
        });
    }
    renderSmartPreview(adminState.parsedQuestions);
    elements.parsedCountBadge.textContent = `${adminState.parsedQuestions.length} questions`;
    elements.smartImportConfirmBtn.disabled = adminState.parsedQuestions.length === 0;
}

function renderSmartPreview(questions) {
    if (questions.length === 0) {
        elements.smartImportPreview.classList.add('is-empty');
        elements.smartImportPreview.innerHTML = `
            <div class="preview-content">
                <div class="empty-state">
                    <i class="fas fa-magic mb-6 text-muted"></i>
                    <p class="text-muted">Detected questions will appear here automatically</p>
                </div>
            </div>
        `;
        return;
    }
    elements.smartImportPreview.classList.remove('is-empty');
    const cleanInline = (s) => {
        try { return SmartParser.cleanInlineHtml ? SmartParser.cleanInlineHtml(s) : (s || ''); } catch { return s || ''; }
    };
    const renderQuestionBlock = (q, displayNumber) => {
        const cleanedText = cleanInline(q.text);
        const cleanedOpts = (q.options || []).map(o => cleanInline(o));
        return `
            <div class="preview-item">
                <div class="preview-q-text"><span class="preview-q-number">Question ${displayNumber}.</span> ${cleanedText}</div>
                <div class="preview-options">
                    ${cleanedOpts.map((opt, i) => {
                        const letter = String.fromCharCode(65 + i);
                        const isCorrect = q.correctAnswer === letter || q.correctAnswer === opt;
                        return `<div class="preview-opt ${isCorrect ? 'correct' : ''}"><span class="preview-opt-letter">${letter}.</span><span class="preview-opt-text">${opt}</span></div>`;
                    }).join('')}
                </div>
                ${q.explanation ? `<div class="preview-explanation">${q.explanation}</div>` : ''}
                ${q.correctAnswer && !(q.options || []).some((opt, i) => q.correctAnswer === String.fromCharCode(65 + i)) ?
                    `<div class="preview-opt correct">Ans: ${q.correctAnswer}</div>` : ''}
            </div>
        `;
    };
    let displayNumber = 1;
    const blocks = [];
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const isReading = String(q.type || '').startsWith('reading_');
        const passage = q.passage || '';
        if (isReading && passage) {
            const groupQs = [q];
            let j = i + 1;
            while (j < questions.length && String(questions[j].type || '').startsWith('reading_') && (questions[j].passage || '') === passage) {
                groupQs.push(questions[j]); j++;
            }
            blocks.push(`
                <div class="preview-group">
                    <div class="preview-passage-box">${SmartParser.formatPassageHtml(passage)}</div>
                    ${groupQs.map((qq) => renderQuestionBlock(qq, displayNumber++)).join('')}
                </div>
            `);
            i = j - 1;
        } else {
            blocks.push(renderQuestionBlock(q, displayNumber++));
        }
    }
    elements.smartImportPreview.innerHTML = `<div class="preview-content">${blocks.join('')}</div>`;
}
