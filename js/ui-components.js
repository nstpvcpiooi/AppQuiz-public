import { formatTime, escapeHtml, formatRichHtmlForDisplay, htmlToPlainText, isEffectivelyEmptyHtml, resolveCorrectAnswer, getCorrectOptionIndex, isSubQuizItem as isSubQuizQuiz } from './utils.js';
import { QUESTION_TYPES } from './constants.js';
import { renderStudentExplanationHeaderMeta } from './explanation-source.js';


function getSelectedOptionIndex(q, userAnswer) {
    const user = String(userAnswer ?? '').trim();
    if (!user || !q.options?.length) return -1;
    if (/^[A-D]$/i.test(user)) {
        const idx = user.toUpperCase().charCodeAt(0) - 65;
        return idx >= 0 && idx < q.options.length ? idx : -1;
    }
    return q.options.findIndex((opt) => opt === user
        || htmlToPlainText(opt).toLowerCase() === htmlToPlainText(user).toLowerCase());
}

function renderReviewOptionsHTML(q, userAnswer) {
    if (!q.options?.length || q.type === QUESTION_TYPES.READING_FILL_ESSAY) return '';

    const correctIdx = getCorrectOptionIndex(q);
    const selectedIdx = getSelectedOptionIndex(q, userAnswer);

    let html = '<div class="review-options options-grid">';
    q.options.forEach((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        let classes = 'option-label review-option-label';
        if (i === correctIdx) classes += ' option-correct';
        if (i === selectedIdx && i !== correctIdx) classes += ' option-wrong';
        if (i === selectedIdx) classes += ' selected';

        html += `
            <div class="${classes}" data-option-index="${i}">
                <span class="option-letter" aria-hidden="true">${letter}</span>
                <span class="option-text">${opt}</span>
            </div>
        `;
    });
    html += '</div>';
    return html;
}

function getQuestionTextFallback(q) {
    if (q.type === 'pronunciation') {
        return '<span class="quiz-view-qtext-fallback">Pronunciation — choose the correct option:</span>';
    }
    return '<span class="quiz-view-qtext-fallback">(No question text)</span>';
}

function getScoreStrokeColor(percentage) {
    if (percentage >= 80) return 'var(--success)';
    if (percentage >= 50) return 'var(--primary)';
    return 'var(--danger)';
}

function createMiniScoreCircle(percentage, quizId, isCompleted) {
    const pct = isCompleted ? percentage : 0;
    const display = isCompleted ? `${percentage}%` : '—';
    const strokeColor = isCompleted ? getScoreStrokeColor(percentage) : '#D1D5DB';

    return `
        <div class="card-score-circle">
            <svg viewBox="0 0 36 36" class="circular-chart circular-chart-sm" aria-hidden="true">
                <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path class="circle card-score-path"
                    data-quiz-id="${escapeHtml(quizId)}"
                    stroke="${strokeColor}"
                    stroke-dasharray="0, 100"
                    data-target-pct="${pct}"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <text x="18" y="20.35" class="percentage">${display}</text>
            </svg>
            ${isCompleted ? `<span class="card-score-label">Best score</span>` : `<span class="card-score-label">Not done</span>`}
        </div>
    `;
}

export function animateCardScoreCircles(container) {
    container?.querySelectorAll('.card-score-path').forEach((path) => {
        const target = parseInt(path.dataset.targetPct, 10) || 0;
        if (target <= 0) return;
        setTimeout(() => {
            path.style.strokeDasharray = `${target}, 100`;
        }, 120);
    });
}

export const UI = {
    createAssignmentCard(quiz, resultInfo, onClick) {
        const card = document.createElement('div');
        card.className = 'assignment-card';

        const isCompleted = resultInfo?.completed === true;
        const bestScore = resultInfo?.bestScore;
        const bestTotal = resultInfo?.bestTotal;
        const bestPct = bestTotal > 0 ? Math.round((bestScore / bestTotal) * 100) : null;

        const statusBadge = isCompleted
            ? `<span class="badge completed">Completed</span>`
            : `<span class="badge not-started">Not completed</span>`;

        card.innerHTML = `
            <div class="card-badges">
                <span class="badge ${quiz.mode}">${quiz.mode.toUpperCase()}</span>
                ${statusBadge}
            </div>
            <div class="card-body-row">
                <div class="card-main-info">
                    <h4>${escapeHtml(quiz.title)}</h4>
                    <p>${quiz.questions.length} Questions</p>
                    ${isCompleted ? `<p class="card-score-detail text-sm">${bestScore}/${bestTotal} correct</p>` : ''}
                </div>
                ${createMiniScoreCircle(bestPct ?? 0, quiz.id, isCompleted)}
            </div>
            <div class="card-footer">
                <span>${quiz.mode === 'exam' && quiz.timeLimit ? formatTime(quiz.timeLimit) + ' limit' : ''}</span>
                <button class="btn-text btn-text-with-icon btn-text-forward">${isCompleted ? 'Retake' : 'Start'} <i class="fas fa-chevron-right" aria-hidden="true"></i></button>
            </div>
        `;
        card.addEventListener('click', onClick);
        return card;
    },

    createCompletedAssignmentCard(quiz, resultInfo, { onReview, onRetake }) {
        const card = document.createElement('div');
        card.className = 'assignment-card assignment-card-completed';

        const bestScore = resultInfo?.bestScore ?? 0;
        const bestTotal = resultInfo?.bestTotal ?? 0;
        const bestPct = bestTotal > 0 ? Math.round((bestScore / bestTotal) * 100) : null;

        card.innerHTML = `
            <div class="card-badges">
                <span class="badge ${quiz.mode}">${quiz.mode.toUpperCase()}</span>
                <span class="badge completed">Completed</span>
            </div>
            <div class="card-body-row">
                <div class="card-main-info">
                    <h4>${escapeHtml(quiz.title)}</h4>
                    <p>${quiz.questions.length} Questions</p>
                </div>
                ${createMiniScoreCircle(bestPct ?? 0, quiz.id, true)}
            </div>
            <div class="card-footer card-footer-actions">
                <div class="card-action-btns">
                    <button type="button" class="btn-secondary btn-sm card-review-btn">Review</button>
                    <button type="button" class="btn-text btn-text-with-icon btn-text-forward card-retake-btn">Retake <i class="fas fa-chevron-right" aria-hidden="true"></i></button>
                </div>
            </div>
        `;

        card.querySelector('.card-review-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onReview?.();
        });
        card.querySelector('.card-retake-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onRetake?.();
        });
        return card;
    },

    buildStudentReviewHTML(quiz, resultData, { incorrectOnly = false } = {}) {
        const answers = resultData?.answers || {};
        if (!quiz?.questions?.length) {
            return '<p class="text-muted">No questions found for this quiz.</p>';
        }

        let html = '';
        let shown = 0;
        quiz.questions.forEach((q, i) => {
            const ans = answers[q.id];
            if (incorrectOnly && ans?.isCorrect) return;

            shown++;
            const explanationHtml = q.explanation && !isEffectivelyEmptyHtml(q.explanation)
                ? `<div class="feedback-section feedback-explanation">
                    <div class="feedback-header feedback-header--explanation">
                        <span class="feedback-section-label">Explanation</span>
                        ${renderStudentExplanationHeaderMeta(q.explanationSource)}
                    </div>
                    <div class="feedback-explanation-body rich-content">${q.explanation}</div>
                   </div>`
                : '';
            html += this.createReviewItem(i, q, ans, explanationHtml);
        });

        if (shown === 0 && incorrectOnly) {
            return '<p class="text-muted review-filter-empty">No incorrect answers in this attempt.</p>';
        }

        return html;
    },

    createAdminQuizCard(docId, data, onView) {
        const div = document.createElement('div');
        div.className = 'assignment-card glass-card admin-quiz-card';

        const visibility = data.visibility || 'all';
        const visibilityLabel = visibility === 'hidden' ? 'Hidden'
            : visibility === 'my_students' ? 'My students'
            : visibility === 'specific' ? `Specific (${(data.assignedStudents || []).length} students)`
            : 'All students';

        div.innerHTML = `
            <div class="admin-quiz-card-inner">
                <div>
                    <h4 class="mb-1 text-lg">${escapeHtml(data.title)}</h4>
                    <div class="flex gap-2 flex-wrap">
                        <span class="qb-type-badge">${escapeHtml(data.mode)}</span>
                        ${data.isSubQuiz ? '<span class="qb-type-badge sub-quiz-badge">sub-quiz</span>' : ''}
                        <span class="qb-type-badge visibility-badge">${visibilityLabel}</span>
                        <span class="text-muted text-sm">${data.questions?.length ?? 0} questions</span>
                    </div>
                </div>
                <button class="btn-text view-quiz-link">View quiz &rarr;</button>
            </div>
        `;

        div.addEventListener('click', () => onView(docId, data));
        return div;
    },

    buildAdminQuizListHTML(sections, selectedIds) {
        const selected = selectedIds instanceof Set ? selectedIds : new Set();
        const hasQuizzes = sections?.some((s) => s.quizzes?.length);
        if (!hasQuizzes) {
            return `
                <div class="admin-quiz-empty">
                    <i class="fas fa-folder-open" aria-hidden="true"></i>
                    <p>No quizzes match your filters.</p>
                </div>
            `;
        }

        return sections.map((section) => {
            const rows = section.quizzes.map((quiz) => this.buildAdminQuizRowHtml(quiz, selected)).join('');
            if (!section.title) {
                return `<div class="admin-quiz-rows" role="list">${rows}</div>`;
            }
            return `
                <section class="admin-quiz-group">
                    <header class="admin-quiz-group-header">
                        <h4 class="admin-quiz-group-title">${escapeHtml(section.title)}</h4>
                        <span class="admin-quiz-group-count">${section.quizzes.length}</span>
                    </header>
                    <div class="admin-quiz-rows" role="list">${rows}</div>
                </section>
            `;
        }).join('');
    },

    buildAdminQuizRowHtml(quiz, selectedIds) {
        const selected = selectedIds instanceof Set ? selectedIds : new Set();
        const isSelected = selected.has(quiz.id);
        const qCount = quiz.questions?.length ?? 0;
        const mode = quiz.mode || 'practice';
        const visibility = quiz.visibility || 'all';
        let visLabel = 'All students';
        let visClass = 'is-all';
        if (visibility === 'hidden') {
            visLabel = 'Hidden';
            visClass = 'is-hidden';
        } else if (visibility === 'my_students') {
            visLabel = 'My students';
            visClass = 'is-my-students';
        } else if (visibility === 'specific') {
            visLabel = `${(quiz.assignedStudents || []).length} students`;
            visClass = 'is-specific';
        }

        const dateStr = quiz.createdAt?.toDate
            ? quiz.createdAt.toDate().toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            })
            : '—';

        const timeLabel = quiz.timeLimit > 0 ? formatTime(quiz.timeLimit) : '';
        const title = quiz.title || 'Untitled quiz';

        return `
            <article class="admin-quiz-row${isSelected ? ' is-selected' : ''}" data-quiz-id="${escapeHtml(quiz.id)}" role="listitem" tabindex="0" aria-label="Open ${escapeHtml(title)}">
                <label class="admin-quiz-row-check" aria-label="Select ${escapeHtml(title)}">
                    <input type="checkbox" class="admin-quiz-row-checkbox" data-quiz-id="${escapeHtml(quiz.id)}"${isSelected ? ' checked' : ''}>
                </label>
                <div class="admin-quiz-row-icon" aria-hidden="true">${mode === 'exam' ? '📝' : '📖'}</div>
                <div class="admin-quiz-row-body">
                    <h4 class="admin-quiz-row-title">${escapeHtml(title)}</h4>
                    <div class="admin-quiz-row-pills">
                        <span class="admin-quiz-pill mode-${escapeHtml(mode)}">${escapeHtml(mode)}</span>
                        ${isSubQuizQuiz(quiz) ? '<span class="admin-quiz-pill is-sub">sub-quiz</span>' : ''}
                        <span class="admin-quiz-pill ${visClass}">${escapeHtml(visLabel)}</span>
                        <span class="admin-quiz-pill is-neutral">${qCount} question${qCount !== 1 ? 's' : ''}</span>
                        ${timeLabel ? `<span class="admin-quiz-pill is-neutral">${escapeHtml(timeLabel)} limit</span>` : ''}
                    </div>
                </div>
                <div class="admin-quiz-row-aside">
                    <span class="admin-quiz-row-date">${escapeHtml(dateStr)}</span>
                    <i class="fas fa-chevron-right admin-quiz-row-chevron" aria-hidden="true"></i>
                </div>
            </article>
        `;
    },

    buildAdminQuizListSkeleton(count = 6) {
        return `<div class="admin-quiz-skeleton-list" aria-hidden="true">${Array.from({ length: count }, () => `
            <div class="admin-quiz-skeleton-row">
                <div class="admin-quiz-skeleton-icon"></div>
                <div class="admin-quiz-skeleton-body">
                    <div class="admin-quiz-skeleton-line admin-quiz-skeleton-line--title"></div>
                    <div class="admin-quiz-skeleton-line admin-quiz-skeleton-line--short"></div>
                </div>
            </div>
        `).join('')}</div>`;
    },

    buildQuizViewHTML(quiz) {
        if (!quiz?.questions?.length) {
            return '<p class="text-muted">This quiz has no questions.</p>';
        }

        const typeLabel = (t) => String(t || '').replace(/_/g, ' ');
        let html = '';
        let i = 0;
        let displayNum = 1;

        const renderQuestion = (q, num) => {
            const labelNum = q.blankNumber ?? num;
            const correctDisplay = resolveCorrectAnswer(q);
            const qTextHtml = isEffectivelyEmptyHtml(q.text)
                ? getQuestionTextFallback(q)
                : q.text;

            let optionsHtml = '';
            if (q.options?.length && q.type !== 'reading_fill_essay') {
                optionsHtml = `<div class="quiz-view-options">${q.options.map((opt, idx) => {
                    const letter = String.fromCharCode(65 + idx);
                    const isCorrect = opt === correctDisplay
                        || letter === String(q.correctAnswer || '').toUpperCase();
                    return `<div class="quiz-view-opt${isCorrect ? ' is-correct' : ''}"><span class="quiz-view-opt-letter">${letter}.</span><span class="quiz-view-opt-text">${opt}</span></div>`;
                }).join('')}</div>`;
            } else if (q.type === 'reading_fill_essay') {
                optionsHtml = `<p class="quiz-view-answer"><strong>Correct answer:</strong> ${escapeHtml(correctDisplay)}</p>`;
            }

            return `
                <div class="quiz-view-item">
                    <div class="quiz-view-item-header">
                        <span class="quiz-view-num">Q${labelNum}</span>
                        <span class="qb-type-badge">${typeLabel(q.type)}</span>
                    </div>
                    <div class="quiz-view-qtext">${qTextHtml}</div>
                    ${optionsHtml}
                    ${q.explanation && !isEffectivelyEmptyHtml(q.explanation) ? `<div class="quiz-view-explanation"><strong>Explanation:</strong> ${q.explanation}</div>` : ''}
                </div>
            `;
        };

        while (i < quiz.questions.length) {
            const q = quiz.questions[i];
            const isReading = String(q.type || '').startsWith('reading_');

            if (isReading && q.passage) {
                const passage = q.passage;
                const group = [];
                while (i < quiz.questions.length
                    && String(quiz.questions[i].type || '').startsWith('reading_')
                    && quiz.questions[i].passage === passage) {
                    group.push(quiz.questions[i]);
                    i++;
                }

                html += `<div class="quiz-view-group">`;
                html += `<div class="quiz-view-passage"><strong>Reading passage</strong><div class="quiz-view-passage-body">${passage}</div></div>`;
                group.forEach((gq) => {
                    html += renderQuestion(gq, displayNum++);
                });
                html += `</div>`;
            } else {
                html += renderQuestion(q, displayNum++);
                i++;
            }
        }

        return html;
    },

    createResultRow(data, onViewDetails, {
        selectable = false,
        selected = false,
        onSelectChange = null
    } = {}) {
        const dateStr = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'N/A';
        const total = data.total ?? '—';
        const scoreLabel = data.total != null ? `${data.score}/${data.total}` : String(data.score ?? '—');
        const quizLabel = escapeHtml(data.quizTitle || data.quizId || '—');
        const hasAnswers = data.answers && Object.keys(data.answers).length > 0;
        const rid = escapeHtml(data.id || '');

        const selectCell = selectable
            ? `<td class="admin-results-select-cell">
                <input type="checkbox" class="admin-result-select-cb" data-result-id="${rid}" ${selected ? 'checked' : ''} aria-label="Select this result">
               </td>`
            : '';

        const tr = document.createElement('tr');
        tr.className = 'admin-result-row';
        tr.dataset.resultId = data.id || '';
        tr.innerHTML = `
            ${selectCell}
            <td>${dateStr}</td>
            <td><strong>${escapeHtml(data.username)}</strong></td>
            <td>${quizLabel}</td>
            <td>${scoreLabel}</td>
            <td>${data.timeSpent ?? 0}s</td>
            <td>
                <button type="button" class="btn-text result-view-btn" ${hasAnswers ? '' : 'disabled title="No saved answers for this attempt"'}>
                    <i class="fas fa-list-check"></i> View
                </button>
            </td>
        `;

        const btn = tr.querySelector('.result-view-btn');
        if (hasAnswers && onViewDetails) {
            btn.addEventListener('click', () => onViewDetails(data));
        }

        const cb = tr.querySelector('.admin-result-select-cb');
        if (cb && onSelectChange) {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                onSelectChange(data.id, cb.checked);
            });
        }

        return tr;
    },

    countWrongAnswers(quiz, resultData) {
        const answers = resultData?.answers || {};
        return (quiz?.questions || []).filter((q) => {
            const ans = answers[q.id];
            return ans && !ans.isCorrect;
        }).length;
    },

    buildStudentsListSkeleton() {
        return `
            <div class="admin-students-skeleton" aria-hidden="true">
                ${[1, 2, 3].map(() => `
                    <div class="admin-student-row admin-student-row--skeleton">
                        <div class="admin-student-avatar skeleton-block"></div>
                        <div class="admin-student-body">
                            <div class="skeleton-block skeleton-line skeleton-line-lg"></div>
                            <div class="skeleton-block skeleton-line skeleton-line-sm"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    buildStudentsEmptyHTML({ hasSearch = false } = {}) {
        if (hasSearch) {
            return `
                <div class="admin-students-empty">
                    <i class="fas fa-search" aria-hidden="true"></i>
                    <p>No students match your search.</p>
                </div>
            `;
        }

        return `
            <div class="admin-students-empty">
                <i class="fas fa-user-graduate" aria-hidden="true"></i>
                <p>No students yet</p>
                <span class="text-muted text-sm">Add a username above to create a student account.</span>
            </div>
        `;
    },

    createStudentItem(data, { onEdit, onDelete } = {}) {
        const username = data.username || '';
        const initial = username ? username.charAt(0).toUpperCase() : '?';
        const addedLabel = data.createdAt?.toDate
            ? `Added ${data.createdAt.toDate().toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            })}`
            : 'Student account';

        const row = document.createElement('article');
        row.className = 'admin-student-row';
        row.setAttribute('role', 'listitem');
        row.innerHTML = `
            <div class="admin-student-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
            <div class="admin-student-body">
                <h4 class="admin-student-name">${escapeHtml(username)}</h4>
                <p class="admin-student-meta">${escapeHtml(addedLabel)}</p>
            </div>
            <div class="admin-student-actions">
                <button type="button" class="btn-secondary btn-sm admin-student-action-btn student-edit-btn">
                    <i class="fas fa-pen" aria-hidden="true"></i> Edit
                </button>
                <button type="button" class="btn-secondary btn-sm admin-student-action-btn admin-student-delete-btn student-delete-btn">
                    <i class="fas fa-trash" aria-hidden="true"></i> Delete
                </button>
            </div>
        `;

        row.querySelector('.student-edit-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onEdit?.(data);
        });
        row.querySelector('.student-delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            onDelete?.(data);
        });

        return row;
    },

    createReviewItem(index, q, ans, feedbackHTML) {
        const isCorrect = ans && ans.isCorrect;
        const isReading = String(q.type || '').startsWith('reading_');
        const isPronunciation = q.type === 'pronunciation';

        const userAnswerText = ans?.answer
            ? (isPronunciation
                ? `<span class="rich-content">${ans.answer}</span>`
                : escapeHtml(htmlToPlainText(ans.answer) || ans.answer))
            : '—';

        const correctIdx = getCorrectOptionIndex(q);

        const correctDisplay = correctIdx >= 0 && isPronunciation
            ? q.options[correctIdx]
            : escapeHtml(resolveCorrectAnswer(q));

        const correctValueClass = correctIdx >= 0 && isPronunciation ? ' rich-content' : '';
        const optionsHTML = renderReviewOptionsHTML(q, ans?.answer);

        const passageBlock = isReading && q.passage
            ? `<div class="review-passage">
                <span class="review-section-label">Reading passage</span>
                <div class="review-passage-body rich-content">${formatRichHtmlForDisplay(q.passage)}</div>
               </div>`
            : '';

        return `
            <article class="review-item ${isCorrect ? 'correct' : 'incorrect'}">
                <header class="review-item-header">
                    <span class="review-item-num">Question ${q.blankNumber ?? (index + 1)}</span>
                    <span class="review-item-badge ${isCorrect ? 'is-correct' : 'is-wrong'}">
                        ${isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                </header>
                ${passageBlock}
                <div class="review-question rich-content">${q.text || ''}</div>
                ${optionsHTML}
                <div class="review-answers">
                    <div class="review-answer-row">
                        <span class="review-answer-label">Your answer</span>
                        <span class="review-answer-value${isPronunciation ? ' rich-content' : ''}">${userAnswerText}</span>
                    </div>
                    ${!isCorrect ? `
                    <div class="review-answer-row is-correct-row">
                        <span class="review-answer-label">Correct answer</span>
                        <span class="review-answer-value${correctValueClass}">${correctDisplay}</span>
                    </div>` : ''}
                </div>
                ${feedbackHTML ? `<div class="review-feedback">${feedbackHTML}</div>` : ''}
            </article>
        `;
    }
};
