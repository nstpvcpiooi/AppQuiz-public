import { tts, dom, escapeHtml, formatRichHtmlForDisplay, htmlToPlainText, isEffectivelyEmptyHtml, shuffleArray } from './utils.js';
import { QUESTION_TYPES } from './constants.js';
import { renderStudentExplanationHeaderMeta } from './explanation-source.js';
import { sounds } from './sounds.js';
import { normalizeTtsText as normalizeTtsWord, getTtsWordForOption, speakEnglishWordFireAndForget } from './tts-helper.js';


export class QuizMode {
    constructor(quizData, onFinish) {
        this.quiz = quizData;
        this.questions = quizData.questions;
        this.items = this.groupQuestions(this.questions);
        this.onFinish = onFinish;
        this.userAnswers = {};
        this.startTime = Date.now();
        this.score = 0;
    }

    groupQuestions(questions) {
        const items = [];
        let currentGroup = null;

        questions.forEach((q, i) => {
            const isReading = q.type.startsWith('reading_');
            
            if (isReading) {
                const passageText = q.passage || (currentGroup ? currentGroup.passage : '');
                
                if (!currentGroup || currentGroup.passage !== passageText) {
                    currentGroup = {
                        isGroup: true,
                        passage: passageText,
                        questions: [q],
                        startIndex: i
                    };
                    items.push(currentGroup);
                } else {
                    currentGroup.questions.push(q);
                }
            } else {
                currentGroup = null;
                items.push(q);
            }
        });
        return items;
    }

    start() {
        console.warn("start() should be implemented by subclass");
    }

    finish() {
        const timeSpent = Math.floor((Date.now() - this.startTime) / 1000);
        const progressEl = document.getElementById('quiz-progress');
        if (progressEl) progressEl.style.width = '100%';
        
        this.onFinish({
            score: this.score,
            total: this.questions.length,
            timeSpent,
            answers: this.userAnswers
        });
    }

    speak(text, btnElement = null) {
        if (btnElement) {
            btnElement.classList.add('playing');
            const icon = btnElement.querySelector('i');
            if (icon) icon.className = 'fas fa-spinner fa-spin';
        }

        const resetBtn = () => {
            if (btnElement) {
                btnElement.classList.remove('playing');
                const icon = btnElement.querySelector('i');
                if (icon) icon.className = 'fas fa-volume-up';
            }
        };

        speakEnglishWordFireAndForget(text, resetBtn);
    }

    normalizeTtsText(input) {
        return normalizeTtsWord(input);
    }

    bindTTS(container) {
        container.querySelectorAll('.tts-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const word = this.normalizeTtsText(e.currentTarget.dataset.word);
                if (!word) return;
                this.speak(word, e.currentTarget);
            });
        });
    }

    buildFillBlankInput(q, blankNum, isMCQ) {
        return `<span class="fill-blank-wrap"><span class="fill-blank-num">(${blankNum})</span><input type="text" class="fill-blank-input" id="input-${q.id}" placeholder="…" ${isMCQ ? 'readonly' : ''} aria-label="Blank ${blankNum}"></span>`;
    }

    replacePassageBlank(passageHTML, blankNum, inputHTML) {
        const numberedRe = new RegExp(`\\(${blankNum}\\)\\s*(?:_{2,}|___)`);
        if (numberedRe.test(passageHTML)) {
            return passageHTML.replace(numberedRe, inputHTML);
        }
        passageHTML = passageHTML.replace(/<u>\s*___\s*<\/u>/i, inputHTML);
        return passageHTML.replace('___', inputHTML);
    }

    formatPassageWithBlanks(item) {
        let passageHTML = formatRichHtmlForDisplay(item.passage || '');
        const fillQuestions = item.questions.filter((q) =>
            q.type === QUESTION_TYPES.READING_FILL_MCQ || q.type === QUESTION_TYPES.READING_FILL_ESSAY
        );
        const usedIds = new Set();

        fillQuestions.forEach((q, idx) => {
            const blankNum = q.blankNumber ?? (idx + 1);
            const isMCQ = q.type === QUESTION_TYPES.READING_FILL_MCQ;
            const inputHTML = this.buildFillBlankInput(q, blankNum, isMCQ);
            const before = passageHTML;
            passageHTML = this.replacePassageBlank(passageHTML, blankNum, inputHTML);
            if (passageHTML !== before) usedIds.add(q.id);
        });

        fillQuestions.forEach((q, idx) => {
            if (usedIds.has(q.id)) return;
            const blankNum = q.blankNumber ?? (idx + 1);
            const isMCQ = q.type === QUESTION_TYPES.READING_FILL_MCQ;
            const inputHTML = this.buildFillBlankInput(q, blankNum, isMCQ);
            passageHTML = this.replacePassageBlank(passageHTML, blankNum, inputHTML);
        });

        return passageHTML;
    }

    getSubQuestionLabel(q, idx) {
        const num = q.blankNumber ?? (idx + 1);
        return `Question ${num}`;
    }

    renderReadingSplitHTML(item) {
        let html = `<div class="reading-split-layout">`;

        html += `<aside class="reading-passage-col" aria-label="Reading passage">`;
        html += `<div class="reading-passage-card">`;
        html += `<div class="reading-passage-header">`;
        html += `<div class="reading-passage-label"><i class="fas fa-book-open" aria-hidden="true"></i> Reading passage</div>`;
        html += `<div class="reading-passage-toolbar">`;
        html += `<button type="button" class="reading-toolbar-btn btn-font-decrease" title="Decrease font size"><i class="fas fa-minus" style="font-size: 0.7em;"></i>A</button>`;
        html += `<button type="button" class="reading-toolbar-btn btn-font-increase" title="Increase font size"><i class="fas fa-plus" style="font-size: 0.7em;"></i>A</button>`;
        html += `<div class="reading-toolbar-divider"></div>`;
        html += `<div class="reading-toolbar-colors">`;
        html += `<button type="button" class="reading-toolbar-color-btn active" data-color="yellow" style="background-color: #FEF08A;" title="Yellow marker"></button>`;
        html += `<button type="button" class="reading-toolbar-color-btn" data-color="lightgreen" style="background-color: #BBF7D0;" title="Green marker"></button>`;
        html += `<button type="button" class="reading-toolbar-color-btn" data-color="pink" style="background-color: #FBCFE8;" title="Pink marker"></button>`;
        html += `<button type="button" class="reading-toolbar-color-btn" data-color="lightblue" style="background-color: #BAE6FD;" title="Blue marker"></button>`;
        html += `</div>`;
        html += `<div class="reading-toolbar-divider"></div>`;
        html += `<button type="button" class="reading-toolbar-btn btn-clear-all-highlights" title="Clear all highlights"><i class="fas fa-eraser"></i></button>`;
        html += `</div>`;
        html += `</div>`;
        html += `<div class="reading-passage-body rich-content">${this.formatPassageWithBlanks(item)}</div>`;
        html += `</div>`;
        html += `</aside>`;

        html += `<div class="reading-questions-col">`;
        item.questions.forEach((q, idx) => {
            html += `<div class="sub-question${idx > 0 ? ' sub-question-divider' : ''}">`;
            html += `<div class="sub-question-label">${this.getSubQuestionLabel(q, idx)}</div>`;
            html += `<div class="q-text rich-content">${q.text || ''}</div>`;
            html += this.renderOptionsHTML(q);
            html += `<div id="feedback-${q.id}" class="feedback-box hidden"></div>`;
            html += `</div>`;
        });
        html += `</div>`;

        html += `</div>`;
        return html;
    }

    renderItemHTML(item, globalIndex) {
        if (!item.isGroup) {
            return this.renderSingleQuestionHTML(item, globalIndex);
        }

        let html = `<div class="question-card q-group">`;
        html += this.renderReadingSplitHTML(item);
        html += `</div>`;
        return html;
    }

    renderSingleQuestionHTML(q, index) {
        let html = `<div class="question-card" id="q-card-${q.id}">`;
        html += `<span class="q-number">Question ${index + 1} of ${this.questions.length}</span>`;
        html += `<div class="q-text rich-content">${q.text || ''}</div>`;
        html += this.renderOptionsHTML(q);
        html += `<div id="feedback-${q.id}" class="feedback-box hidden"></div>`;
        html += `</div>`;
        return html;
    }

    renderOptionsHTML(q) {
        let html = '';
        if (q.options && q.type !== QUESTION_TYPES.READING_FILL_ESSAY) {
            html += `<div class="options-grid">`;
            q.options.forEach((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const optId = `opt-${Date.now()}-${Math.floor(Math.random() * 10000)}-${i}`;
                html += `
                    <label class="option-label" for="${optId}" data-option-index="${i}">
                        <input type="radio" name="radio-${q.id}" id="${optId}" value="${escapeHtml(opt)}">
                        <span class="option-letter" aria-hidden="true">${letter}</span>
                        <span class="option-text">${opt}</span>
                    </label>
                `;
            });
            html += `</div>`;
        }
        return html;
    }

    getCorrectOptionIndex(q) {
        const raw = String(q.correctAnswer ?? '').trim();
        if (!q.options?.length) return -1;

        if (/^[A-D]$/i.test(raw)) {
            const idx = raw.toUpperCase().charCodeAt(0) - 65;
            return idx >= 0 && idx < q.options.length ? idx : -1;
        }

        const plainRaw = htmlToPlainText(raw).toLowerCase();
        return q.options.findIndex((opt) => htmlToPlainText(opt).toLowerCase() === plainRaw);
    }

    getCorrectAnswerText(q) {
        const raw = String(q.correctAnswer ?? '').trim();
        if (!raw) return '';
        if (!q.options?.length) return raw;

        const idx = this.getCorrectOptionIndex(q);
        if (idx >= 0) return q.options[idx];

        const match = q.options.find((opt) => htmlToPlainText(opt).toLowerCase() === htmlToPlainText(raw).toLowerCase());
        return match ?? raw;
    }

    isAnswerCorrect(q, userAnswer) {
        const user = String(userAnswer ?? '').trim();
        if (!user) return false;

        const correctIdx = this.getCorrectOptionIndex(q);
        if (correctIdx >= 0 && q.options?.length) {
            const selectedIdx = q.options.findIndex((opt) => opt === user
                || htmlToPlainText(opt).toLowerCase() === htmlToPlainText(user).toLowerCase());
            if (selectedIdx >= 0) return selectedIdx === correctIdx;
        }

        const correctText = this.getCorrectAnswerText(q);
        const rawCorrect = String(q.correctAnswer ?? '').trim();

        return htmlToPlainText(user).toLowerCase() === htmlToPlainText(correctText).toLowerCase()
            || user.toLowerCase() === correctText.toLowerCase()
            || (rawCorrect && user.toLowerCase() === rawCorrect.toLowerCase());
    }

    generateFeedbackHTML(q, isCorrect, { showCorrectAnswer = false, showStatus = true } = {}) {
        let html = '';
        const hasExplanation = q.explanation && !isEffectivelyEmptyHtml(q.explanation);
        const explanationMeta = hasExplanation
            ? renderStudentExplanationHeaderMeta(q.explanationSource)
            : '';

        if (showStatus || explanationMeta) {
            const statusClass = isCorrect ? 'feedback-status--correct' : 'feedback-status--incorrect';
            const statusIcon = isCorrect ? 'fa-check-circle' : 'fa-times-circle';
            const statusText = isCorrect ? 'Correct!' : 'Incorrect';
            const statusHtml = showStatus
                ? `<span class="feedback-status ${statusClass}">
                    <i class="fas ${statusIcon}" aria-hidden="true"></i>
                    ${statusText}
                </span>`
                : '<span class="feedback-header-spacer" aria-hidden="true"></span>';

            html += `<div class="feedback-header">
                ${statusHtml}
                ${explanationMeta}
            </div>`;
        }

        if (showCorrectAnswer && !isCorrect) {
            const correctIdx = this.getCorrectOptionIndex(q);
            const answerBody = correctIdx >= 0 && q.type === QUESTION_TYPES.PRONUNCIATION
                ? `<span class="feedback-answer-text rich-content">${q.options[correctIdx]}</span>`
                : `<p class="feedback-answer-text">${escapeHtml(this.getCorrectAnswerText(q))}</p>`;
            html += `<div class="feedback-section feedback-answer">
                <span class="feedback-section-label">Correct answer</span>
                ${answerBody}
            </div>`;
        }

        if (hasExplanation) {
            html += `<div class="feedback-section feedback-explanation">
                <span class="feedback-section-label">Explanation</span>
                <div class="feedback-explanation-body rich-content">${q.explanation}</div>
            </div>`;
        }

        if (q.type === QUESTION_TYPES.PRONUNCIATION && q.options) {
            html += `<div class="feedback-section feedback-pronunciation">
                <span class="feedback-section-label">Pronunciation</span>
                <div class="feedback-tts-list">`;
            q.options.forEach((word, idx) => {
                const wordHtml = String(word ?? '');
                const plain = getTtsWordForOption(q, idx, wordHtml);
                const attr = plain.replace(/"/g, '&quot;');
                html += `<button type="button" class="tts-btn" data-word="${attr}"><i class="fas fa-volume-up"></i> <span class="tts-word">${escapeHtml(plain)}</span></button>`;
            });
            html += `</div></div>`;
        }

        return html;
    }

    highlightPracticeOptions(q, userAnswer, isCorrect) {
        const correctIdx = this.getCorrectOptionIndex(q);

        if (q.type === QUESTION_TYPES.READING_FILL_ESSAY) {
            const inputField = document.getElementById(`input-${q.id}`);
            if (inputField) {
                inputField.classList.toggle('fill-blank-incorrect', !isCorrect);
                if (!isCorrect) inputField.classList.remove('fill-blank-correct');
            }
            return;
        }

        this.container.querySelectorAll(`input[name="radio-${q.id}"]`).forEach(input => {
            const label = input.closest('.option-label');
            if (!label) return;

            const optionIndex = parseInt(label.dataset.optionIndex, 10);
            const matchesCorrect = Number.isFinite(optionIndex) && optionIndex === correctIdx;
            if (matchesCorrect) label.classList.add('option-correct');
            else if (input.checked && !isCorrect) label.classList.add('option-wrong');
        });
    }
}

export class PracticeMode extends QuizMode {
    constructor(quizData, onFinish) {
        super(quizData, onFinish);
        this.container = document.getElementById('practice-question');
        this.currentIndex = 0;
        this.initialItems = [...this.items];
        this.retryQueue = [];
        this.isRetryPhase = false;
        this.lastAllCorrect = false;
        this.initialWrongQuestions = [];
        this.keyboardFocusQuestionId = null;
        this.submitBtn = document.getElementById('practice-submit-btn');
        this.nextBtn = document.getElementById('practice-next-btn');
        this.progressEl = document.getElementById('quiz-progress');
        this.boundKeydown = this.handleKeydown.bind(this);
    }

    start() {
        document.addEventListener('keydown', this.boundKeydown);
        this.renderCurrentItem();
        this.submitBtn.onclick = () => this.checkAnswer();
        this.nextBtn.onclick = () => this.nextItem();
    }

    finish() {
        this.cleanup();
        super.finish();
    }

    cleanup() {
        document.removeEventListener('keydown', this.boundKeydown);
    }

    getCurrentItem() {
        const queue = this.getActiveQueue();
        return queue[this.currentIndex];
    }

    getSelectableQuestions(item) {
        if (!item) return [];
        const qs = item.isGroup ? item.questions : [item];
        return qs.filter(q => q.options?.length && q.type !== QUESTION_TYPES.READING_FILL_ESSAY);
    }

    findKeyboardTargetQuestion() {
        const selectable = this.getSelectableQuestions(this.getCurrentItem());
        if (!selectable.length) return null;

        if (this.keyboardFocusQuestionId) {
            const focused = selectable.find(q => q.id === this.keyboardFocusQuestionId);
            if (focused) return focused;
        }

        const unanswered = selectable.find(q =>
            !this.container.querySelector(`input[name="radio-${q.id}"]:checked`)
        );
        return unanswered || selectable[0];
    }

    selectOptionByIndex(questionId, optionIndex) {
        const inputs = this.container.querySelectorAll(`input[name="radio-${questionId}"]`);
        if (optionIndex < 0 || optionIndex >= inputs.length) return;

        const input = inputs[optionIndex];
        if (input.disabled) return;

        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        this.keyboardFocusQuestionId = questionId;
    }

    handleKeydown(e) {
        const practiceContainer = document.getElementById('practice-container');
        if (!practiceContainer || practiceContainer.classList.contains('hidden')) return;
        const helpModal = document.getElementById('practice-help-modal');
        if (helpModal && !helpModal.classList.contains('hidden')) return;
        if (e.target.matches('.fill-blank-input, input[type="text"], textarea, select')) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        const key = e.key.toLowerCase();

        if (key === 'enter') {
            e.preventDefault();
            if (!this.nextBtn.classList.contains('hidden') && !this.nextBtn.disabled) {
                this.nextItem();
            } else if (!this.submitBtn.classList.contains('hidden') && !this.submitBtn.disabled) {
                this.checkAnswer();
            }
            return;
        }

        let optionIndex = -1;
        if (key >= '1' && key <= '4') optionIndex = parseInt(key, 10) - 1;
        else if (key >= 'a' && key <= 'd') optionIndex = key.charCodeAt(0) - 97;
        else return;

        const targetQ = this.findKeyboardTargetQuestion();
        if (!targetQ) return;

        e.preventDefault();
        this.selectOptionByIndex(targetQ.id, optionIndex);
    }

    bindOptionListeners() {
        this.container.querySelectorAll('.option-label input').forEach(input => {
            input.addEventListener('change', (e) => {
                const label = e.target.closest('.option-label');
                const card = label?.closest('.options-grid');
                if (card) {
                    card.querySelectorAll('.option-label').forEach(l => l.classList.remove('selected'));
                    label.classList.add('selected');
                }

                const qId = e.target.name.replace('radio-', '');
                this.keyboardFocusQuestionId = qId;
                const inputField = document.getElementById(`input-${qId}`);
                if (inputField) inputField.value = e.target.value;
            });
        });

        this.container.querySelectorAll('.option-label').forEach(label => {
            label.addEventListener('mousedown', () => {
                const input = label.querySelector('input[type="radio"]');
                if (input) this.keyboardFocusQuestionId = input.name.replace('radio-', '');
            });
        });
    }

    getActiveQueue() {
        return this.isRetryPhase ? this.retryQueue : this.initialItems;
    }

    updateProgress() {
        const queue = this.getActiveQueue();
        const base = this.isRetryPhase ? this.initialItems.length : 0;
        const current = base + this.currentIndex;
        const total = this.initialItems.length + (this.retryQueue.length || 0);
        const percent = total > 0 ? (current / total) * 100 : 0;
        if (this.progressEl) this.progressEl.style.width = `${Math.min(percent, 100)}%`;
    }

    enterRetryPhase() {
        this.retryQueue = shuffleArray(this.retryQueue);
        this.isRetryPhase = true;
        this.currentIndex = 0;
    }

    renderCurrentItem() {
        if (!this.isRetryPhase) {
            if (this.currentIndex >= this.initialItems.length) {
                if (this.retryQueue.length > 0) {
                    this.enterRetryPhase();
                    return this.renderCurrentItem();
                }
                this.finish();
                return;
            }
        } else if (this.retryQueue.length === 0) {
            this.finish();
            return;
        }

        const queue = this.getActiveQueue();
        if (this.currentIndex >= queue.length) {
            this.currentIndex = 0;
        }

        const item = queue[this.currentIndex];
        const displayIndex = item.isGroup ? item.startIndex : this.questions.findIndex(x => x.id === item.id);

        this.container.innerHTML = this.renderItemHTML(item, displayIndex);
        this.updateProgress();

        if (this.isRetryPhase) {
            const retryBanner = document.createElement('div');
            retryBanner.className = 'retry-phase-banner';
            retryBanner.innerHTML = `<i class="fas fa-redo"></i> Retry phase — ${this.retryQueue.length} question(s) remaining`;
            this.container.prepend(retryBanner);
        }

        const selectable = this.getSelectableQuestions(item);
        this.keyboardFocusQuestionId = selectable[0]?.id ?? null;
        this.bindOptionListeners();

        dom.show(this.submitBtn);
        dom.hide(this.nextBtn);
        this.submitBtn.disabled = false;
    }

    checkAnswer() {
        const queue = this.getActiveQueue();
        const item = queue[this.currentIndex];
        const isRetry = this.isRetryPhase;

        let allCorrect = true;
        let answeredAll = true;

        const qsToCheck = item.isGroup ? item.questions : [item];

        for (const q of qsToCheck) {
            if (q.type === QUESTION_TYPES.READING_FILL_ESSAY) {
                const inputField = document.getElementById(`input-${q.id}`);
                if (!inputField || !inputField.value.trim()) answeredAll = false;
            } else {
                const selectedOpt = this.container.querySelector(`input[name="radio-${q.id}"]:checked`);
                if (!selectedOpt) answeredAll = false;
            }
        }

        if (!answeredAll) {
            alert("Please answer all questions before submitting.");
            return;
        }

        this.container.querySelectorAll('input').forEach(i => i.disabled = true);
        this.submitBtn.disabled = true;

        for (const q of qsToCheck) {
            let userAnswer = '';
            if (q.type === QUESTION_TYPES.READING_FILL_ESSAY) {
                const inputField = document.getElementById(`input-${q.id}`);
                userAnswer = inputField ? inputField.value.trim().toLowerCase() : '';
            } else {
                const selectedOpt = this.container.querySelector(`input[name="radio-${q.id}"]:checked`);
                userAnswer = selectedOpt ? selectedOpt.value : '';
            }

            const isCorrect = this.isAnswerCorrect(q, userAnswer);
            if (!isCorrect) allCorrect = false;

            this.highlightPracticeOptions(q, userAnswer, isCorrect);

            const feedbackBox = document.getElementById(`feedback-${q.id}`);
            if (feedbackBox) {
                feedbackBox.innerHTML = this.generateFeedbackHTML(q, isCorrect, { showCorrectAnswer: true });
                feedbackBox.className = `feedback-box ${isCorrect ? 'correct' : 'incorrect'}`;
                dom.show(feedbackBox);
                this.bindTTS(feedbackBox);
            }

            if (!isRetry) {
                this.userAnswers[q.id] = { answer: userAnswer, isCorrect };
                if (isCorrect) {
                    this.score++;
                } else if (!this.initialWrongQuestions.some(wq => wq.id === q.id)) {
                    this.initialWrongQuestions.push(q);
                }
            }
        }

        if (!isRetry && !allCorrect) {
            this.retryQueue.push(item);
        }

        this.lastAllCorrect = allCorrect;
        sounds.play(allCorrect ? 'correct' : 'incorrect');

        dom.hide(this.submitBtn);
        dom.show(this.nextBtn);

        const base = this.isRetryPhase ? this.initialItems.length : 0;
        const total = this.initialItems.length + (this.retryQueue.length || 0);
        const percent = total > 0 ? ((base + this.currentIndex + 1) / total) * 100 : 100;
        if (this.progressEl) this.progressEl.style.width = `${Math.min(percent, 100)}%`;
    }

    nextItem() {
        if (this.isRetryPhase) {
            const item = this.retryQueue[this.currentIndex];
            if (this.lastAllCorrect) {
                this.retryQueue.splice(this.currentIndex, 1);
            } else if (item) {
                this.retryQueue.splice(this.currentIndex, 1);
                this.retryQueue.push(item);
            }
        } else {
            this.currentIndex++;
        }
        this.renderCurrentItem();
    }
}

export class ExamMode extends QuizMode {
    constructor(quizData, onFinish) {
        super(quizData, onFinish);
        this.examContainer = document.getElementById('exam-container');
        this.container = document.getElementById('exam-questions');
        this.partNavEl = document.getElementById('exam-part-nav');
        this.prevBtn = document.getElementById('exam-prev-btn');
        this.nextBtn = document.getElementById('exam-next-btn');
        this.actionsEl = this.examContainer?.querySelector('.exam-actions');
        this.submitBtn = document.getElementById('exam-submit-btn');
        this.timerEl = document.getElementById('quiz-timer');
        this.progressEl = document.getElementById('quiz-progress');
        this.timeLimit = quizData.timeLimit || 1800;
        this.timerInterval = null;
        this.parts = [];
        this.partRanges = [];
        this.currentPartIndex = 0;
        this.examAnswers = {};
    }

    buildExamParts() {
        const parts = [];
        let regularQuestions = [];

        const flushRegular = () => {
            if (regularQuestions.length === 0) return;
            parts.push({ type: 'regular', questions: regularQuestions });
            regularQuestions = [];
        };

        for (const item of this.items) {
            if (item.isGroup) {
                flushRegular();
                parts.push({ type: 'reading', group: item });
            } else {
                regularQuestions.push(item);
            }
        }
        flushRegular();
        return parts;
    }

    buildPartRanges(parts) {
        const ranges = [];
        let offset = 0;
        parts.forEach((part) => {
            const count = part.type === 'regular' ? part.questions.length : part.group.questions.length;
            ranges.push({ start: offset + 1, end: offset + count });
            offset += count;
        });
        return ranges;
    }

    getPartQuestions(part) {
        return part.type === 'regular' ? part.questions : part.group.questions;
    }

    formatQuestionRange(start, end) {
        return start === end ? `Question ${start}` : `Questions ${start}–${end}`;
    }

    renderExamQuestionHTML(q, questionNum) {
        let html = `<div class="question-card exam-question-card" id="q-card-${q.id}">`;
        html += `<span class="q-number">Question ${questionNum}</span>`;
        html += `<div class="q-text rich-content">${q.text || ''}</div>`;
        html += this.renderOptionsHTML(q);
        html += `</div>`;
        return html;
    }

    renderExamPartHTML(part, partIndex, questionRange) {
        if (part.type === 'regular') {
            let html = `<section class="exam-part exam-part-regular exam-part-active">`;
            html += `<div class="exam-part-body">`;
            part.questions.forEach((q, idx) => {
                html += this.renderExamQuestionHTML(q, questionRange.start + idx);
            });
            html += `</div></section>`;
            return html;
        }

        let html = `<section class="exam-part exam-part-reading exam-part-active">`;
        html += `<div class="exam-part-reading-body">`;
        html += this.renderReadingSplitHTML(part.group);
        html += `</div></section>`;
        return html;
    }

    getPartLabel(part, partIndex) {
        const partNum = partIndex + 1;
        return part.type === 'reading' ? `Part ${partNum} — Reading` : `Part ${partNum}`;
    }

    saveCurrentPartAnswers() {
        const part = this.parts[this.currentPartIndex];
        if (!part) return;

        this.getPartQuestions(part).forEach((q) => {
            if (q.type === QUESTION_TYPES.READING_FILL_ESSAY) {
                const inputField = document.getElementById(`input-${q.id}`);
                this.examAnswers[q.id] = inputField ? inputField.value.trim() : '';
                return;
            }

            const selectedOpt = document.querySelector(`input[name="radio-${q.id}"]:checked`);
            this.examAnswers[q.id] = selectedOpt ? selectedOpt.value : (this.examAnswers[q.id] ?? '');
        });
    }

    restoreCurrentPartAnswers() {
        const part = this.parts[this.currentPartIndex];
        if (!part) return;

        this.getPartQuestions(part).forEach((q) => {
            const saved = this.examAnswers[q.id];
            if (saved == null || saved === '') return;

            if (q.type === QUESTION_TYPES.READING_FILL_ESSAY) {
                const inputField = document.getElementById(`input-${q.id}`);
                if (inputField) inputField.value = saved;
                return;
            }

            this.container.querySelectorAll(`input[name="radio-${q.id}"]`).forEach((input) => {
                const label = input.closest('.option-label');
                const matches = input.value === saved;
                input.checked = matches;
                if (label) label.classList.toggle('selected', matches);
            });

            const inputField = document.getElementById(`input-${q.id}`);
            if (inputField) inputField.value = saved;
        });
    }

    bindPartListeners() {
        this.container.querySelectorAll('.option-label input').forEach((input) => {
            input.addEventListener('change', (e) => {
                const label = e.target.closest('.option-label');
                const card = label?.closest('.options-grid');
                if (card) {
                    card.querySelectorAll('.option-label').forEach((l) => l.classList.remove('selected'));
                    label.classList.add('selected');
                }

                const qId = e.target.name.replace('radio-', '');
                this.examAnswers[qId] = e.target.value;
                this.updateProgress();

                const inputField = document.getElementById(`input-${qId}`);
                if (inputField) inputField.value = e.target.value;
            });
        });

        this.container.querySelectorAll('.fill-blank-input').forEach((input) => {
            input.addEventListener('input', (e) => {
                const qId = e.target.id.replace('input-', '');
                this.examAnswers[qId] = e.target.value.trim();
                this.updateProgress();
            });
        });
    }

    updatePartNav() {
        const totalParts = this.parts.length;
        const part = this.parts[this.currentPartIndex];
        const range = this.partRanges[this.currentPartIndex];
        const showNav = totalParts > 1 || part?.type === 'reading';

        if (!this.partNavEl) return;

        if (!showNav) {
            dom.hide(this.partNavEl);
            this.partNavEl.innerHTML = '';
            return;
        }

        dom.show(this.partNavEl);
        this.partNavEl.innerHTML = `
            <div class="exam-part-nav-inner">
                <span class="exam-part-badge">${this.getPartLabel(part, this.currentPartIndex)}</span>
                <span class="exam-part-meta">Part ${this.currentPartIndex + 1} of ${totalParts}</span>
                <span class="exam-part-range">${this.formatQuestionRange(range.start, range.end)}</span>
            </div>
        `;
    }

    updatePartButtons() {
        const isFirst = this.currentPartIndex <= 0;
        const isLast = this.currentPartIndex >= this.parts.length - 1;
        const showNav = this.parts.length > 1;

        if (this.prevBtn) {
            this.prevBtn.classList.toggle('hidden', !showNav || isFirst);
            this.prevBtn.disabled = isFirst;
        }
        if (this.nextBtn) {
            this.nextBtn.classList.toggle('hidden', !showNav || isLast);
            this.nextBtn.disabled = isLast;
        }
        if (this.actionsEl) {
            const hasVisibleNav = showNav && (!isFirst || !isLast);
            this.actionsEl.classList.toggle('hidden', !hasVisibleNav);
        }
    }

    updateExamLayoutClasses() {
        const part = this.parts[this.currentPartIndex];
        const isReading = part?.type === 'reading';
        this.container.classList.toggle('exam-has-reading', isReading);
        this.examContainer?.classList.toggle('exam-reading-active', isReading);
    }

    renderCurrentPart() {
        const part = this.parts[this.currentPartIndex];
        const range = this.partRanges[this.currentPartIndex];
        if (!part || !range) return;

        this.container.innerHTML = this.renderExamPartHTML(part, this.currentPartIndex, range);
        this.restoreCurrentPartAnswers();
        this.bindPartListeners();
        this.updatePartNav();
        this.updatePartButtons();
        this.updateExamLayoutClasses();
        this.updateProgress();
    }

    goToPart(index) {
        if (index < 0 || index >= this.parts.length || index === this.currentPartIndex) return;
        this.saveCurrentPartAnswers();
        this.currentPartIndex = index;
        this.renderCurrentPart();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    prevPart() {
        this.goToPart(this.currentPartIndex - 1);
    }

    nextPart() {
        this.goToPart(this.currentPartIndex + 1);
    }

    start() {
        this.parts = this.buildExamParts();
        this.partRanges = this.buildPartRanges(this.parts);
        this.currentPartIndex = 0;
        this.examAnswers = {};

        this.examContainer?.classList.add('exam-paginated');
        this.container.classList.add('exam-paginated');

        this.prevBtn.onclick = () => this.prevPart();
        this.nextBtn.onclick = () => this.nextPart();
        this.submitBtn.onclick = () => this.submitExam();

        this.renderCurrentPart();
        this.startTimer();
        dom.show(this.timerEl);
    }

    updateProgress() {
        let answered = 0;
        this.questions.forEach((q) => {
            const saved = this.examAnswers[q.id];
            if (q.type === QUESTION_TYPES.READING_FILL_ESSAY) {
                if (String(saved ?? '').trim() !== '') answered++;
            } else if (saved != null && saved !== '') {
                answered++;
            }
        });
        const percent = this.questions.length > 0 ? (answered / this.questions.length) * 100 : 0;
        if (this.progressEl) this.progressEl.style.width = `${percent}%`;
    }

    startTimer() {
        let timeLeft = this.timeLimit;

        const updateDisplay = () => {
            const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
            const s = (timeLeft % 60).toString().padStart(2, '0');
            this.timerEl.innerText = `${m}:${s}`;
        };

        updateDisplay();

        this.timerInterval = setInterval(() => {
            timeLeft--;
            updateDisplay();

            if (timeLeft <= 60) {
                this.timerEl.style.color = 'var(--danger)';
                this.timerEl.style.animation = 'pulse 1s infinite';
            }

            if (timeLeft <= 0) {
                clearInterval(this.timerInterval);
                alert("Time is up! Submitting exam automatically.");
                this.submitExam(true);
            }
        }, 1000);
    }

    submitExam(skipConfirm = false) {
        this.saveCurrentPartAnswers();

        if (!skipConfirm && !confirm("Are you sure you want to submit your exam?")) return;

        clearInterval(this.timerInterval);

        this.questions.forEach((q) => {
            const userAnswer = String(this.examAnswers[q.id] ?? '').trim();
            const isCorrect = this.isAnswerCorrect(q, userAnswer);
            this.userAnswers[q.id] = { answer: userAnswer, isCorrect };
            if (isCorrect) this.score++;
        });

        this.examContainer?.classList.remove('exam-paginated', 'exam-reading-active');
        this.container.classList.remove('exam-paginated', 'exam-has-reading');
        if (this.partNavEl) dom.hide(this.partNavEl);

        this.finish();
    }
}

// Reading Passage Toolbar Events
// Reading Passage Toolbar Events
// Reading Passage Toolbar Events
document.addEventListener('mousedown', (e) => {
    // Prevent losing text selection when clicking tooltip buttons
    if (e.target.closest('.tooltip-btn') || e.target.closest('.reading-toolbar-btn') || e.target.closest('.reading-toolbar-color-btn')) {
        e.preventDefault();
    }
});

// Setup Highlight Tooltip dynamically
function getHighlightTooltip() {
    let tooltip = document.getElementById('highlight-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'highlight-tooltip';
        tooltip.className = 'highlight-tooltip hidden';
        tooltip.innerHTML = `
            <button type="button" class="tooltip-btn tooltip-btn-highlight"><i class="fas fa-highlighter"></i> Highlight</button>
            <button type="button" class="tooltip-btn tooltip-btn-clear hidden"><i class="fas fa-eraser"></i> Clear</button>
        `;
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

let activeHighlightEl = null;
let currentHighlightColor = 'yellow';

document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    const tooltip = getHighlightTooltip();
    
    if (selection.rangeCount > 0 && !selection.isCollapsed) {
        // Check if selection is inside reading passage
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const passageBody = container.nodeType === 3 ? container.parentNode.closest('.reading-passage-body') : container.closest('.reading-passage-body');
        
        if (passageBody) {
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                tooltip.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
                tooltip.style.top = `${rect.top + window.scrollY}px`;
                
                tooltip.querySelector('.tooltip-btn-highlight').classList.remove('hidden');
                tooltip.querySelector('.tooltip-btn-clear').classList.add('hidden');
                tooltip.classList.remove('hidden');
                activeHighlightEl = null; // Reset active clear target
                return;
            }
        }
    }
    
    // Hide if no valid selection and we aren't clicking a highlight
    if (!activeHighlightEl) {
        tooltip.classList.add('hidden');
    }
});

document.addEventListener('click', (e) => {
    const btnDecrease = e.target.closest('.btn-font-decrease');
    const btnIncrease = e.target.closest('.btn-font-increase');
    const btnColor = e.target.closest('.reading-toolbar-color-btn');
    const btnClearAll = e.target.closest('.btn-clear-all-highlights');
    
    // 1. Handle Font Sizing
    if (btnDecrease || btnIncrease) {
        const passageCard = e.target.closest('.reading-passage-card');
        const passageBody = passageCard?.querySelector('.reading-passage-body');
        if (passageBody) {
            let currentSize = parseFloat(window.getComputedStyle(passageBody).fontSize);
            if (btnIncrease && currentSize < 32) currentSize += 2;
            if (btnDecrease && currentSize > 12) currentSize -= 2;
            passageBody.style.fontSize = `${currentSize}px`;
        }
        return;
    }

    // 2. Handle Color Picker
    if (btnColor) {
        currentHighlightColor = btnColor.dataset.color;
        const colorContainer = btnColor.closest('.reading-toolbar-colors');
        if (colorContainer) {
            colorContainer.querySelectorAll('.reading-toolbar-color-btn').forEach(btn => btn.classList.remove('active'));
        }
        btnColor.classList.add('active');
        return;
    }

    // 3. Handle Clear All
    if (btnClearAll) {
        const passageCard = e.target.closest('.reading-passage-card');
        const passageBody = passageCard?.querySelector('.reading-passage-body');
        if (passageBody) {
            const highlights = passageBody.querySelectorAll('[style*="background-color"]');
            highlights.forEach(el => el.style.backgroundColor = '');
        }
        return;
    }

    const tooltip = getHighlightTooltip();
    const btnHighlight = e.target.closest('.tooltip-btn-highlight');
    const btnClearHighlight = e.target.closest('.tooltip-btn-clear');
    
    // 4. Handle Tooltip Highlight Click
    if (btnHighlight) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const passageBody = container.nodeType === 3 ? container.parentNode.closest('.reading-passage-body') : container.closest('.reading-passage-body');
            
            if (passageBody) {
                passageBody.contentEditable = "true";
                document.execCommand("hiliteColor", false, currentHighlightColor);
                passageBody.contentEditable = "false";
                selection.removeAllRanges();
            }
        }
        tooltip.classList.add('hidden');
        return;
    }
    
    // 5. Handle Tooltip Clear Click
    if (btnClearHighlight) {
        if (activeHighlightEl) {
            activeHighlightEl.style.backgroundColor = '';
            activeHighlightEl = null;
        }
        tooltip.classList.add('hidden');
        return;
    }

    // 6. Handle clicking on an existing highlight
    const highlightTarget = e.target.closest('[style*="background-color"]');
    if (highlightTarget && highlightTarget.closest('.reading-passage-body')) {
        activeHighlightEl = highlightTarget;
        const rect = highlightTarget.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
        tooltip.style.top = `${rect.top + window.scrollY}px`;
        
        tooltip.querySelector('.tooltip-btn-highlight').classList.add('hidden');
        tooltip.querySelector('.tooltip-btn-clear').classList.remove('hidden');
        tooltip.classList.remove('hidden');
        
        window.getSelection().removeAllRanges();
        return;
    }
    
    // 7. Clicked elsewhere, hide tooltip
    if (!e.target.closest('#highlight-tooltip')) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const passageBody = container.nodeType === 3 ? container.parentNode.closest('.reading-passage-body') : container.closest('.reading-passage-body');

            if (passageBody) return; // Keep tooltip visible for active selection
        }
        tooltip.classList.add('hidden');
        activeHighlightEl = null;
    }
});
