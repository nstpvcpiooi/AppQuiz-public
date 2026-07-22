import { db } from '../firebase-init.js';
import { collection, addDoc, Timestamp, getDoc, doc } from '../firebase-init.js';
import { SCREENS, FIREBASE_COLLECTIONS, QUIZ_VISIBILITY } from '../constants.js';
import { dom, escapeHtml } from '../utils.js';
import { adminState, elements } from './state.js';
import { getTeacherOwnerFields } from './auth.js';
import { collectWrongQuestionsFromResults } from '../sub-quiz-utils.js';
import { resetEditorForCreate, populateQuizBuilder } from './quiz-editor.js';

export async function buildSubQuizFromSelectedWrongAnswers() {
    const ids = [...adminState.selectedResultIds];
    if (!ids.length) { alert('Select at least one result with saved answers.'); return; }
    const btn = elements.btnResultsWrongSubquiz;
    if (btn) btn.disabled = true;
    try {
        const selectedResults = adminState.adminResultsCache.filter((r) => ids.includes(r.id));
        const quizIds = [...new Set(selectedResults.map((r) => r.quizId).filter(Boolean))];
        await Promise.all(quizIds.map((id) => ensureQuizInCache(id)));
        const { questions: wrongTagged, sourceQuizIds } = collectWrongQuestionsFromResults(adminState.quizzesById, selectedResults);
        if (!wrongTagged.length) { alert('No incorrect answers found in the selected results.'); return; }
        openReviewSubQuizFromResults({ questions: wrongTagged, sourceQuizIds, selectedResults });
    } catch (err) {
        console.error(err);
        alert('Failed to build review quiz: ' + (err.message || 'Unknown error'));
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function ensureQuizInCache(quizId) {
    if (adminState.quizzesById[quizId]?.questions?.length) return adminState.quizzesById[quizId];
    if (!db) return null;
    try {
        const snap = await getDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, quizId));
        if (!snap.exists()) return null;
        const quiz = { id: snap.id, ...snap.data() };
        adminState.quizzesById[quizId] = quiz;
        return quiz;
    } catch (e) { console.error('Failed to load quiz:', e); return null; }
}

function openReviewSubQuizFromResults({ questions, sourceQuizIds, selectedResults }) {
    adminState.reviewSubQuizQuestions = questions;
    adminState.reviewSubQuizSourceIds = [...sourceQuizIds];
    adminState.reviewSubQuizMeta = {
        attemptCount: selectedResults.length,
        students: [...new Set(selectedResults.map((r) => r.username).filter(Boolean))]
    };
    adminState.router?.navigate(SCREENS.ADMIN_REVIEW_SUB_QUIZ);
}

function renderSubQuizPreview(questions, { listEl, badgeEl } = {}) {
    const list = listEl;
    const badge = badgeEl;
    if (!list) return;
    if (!questions.length) {
        dom.setHTML(list, '<p class="text-muted">No questions.</p>');
        if (badge) dom.setText(badge, '0 questions');
        return;
    }
    if (badge) dom.setText(badge, `${questions.length} questions`);
    const stripHtml = (html) => {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return (div.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const html = questions.map((q, i) => {
        const text = stripHtml(q.text) || '(No text)';
        const snippet = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        const src = q._sourceQuizTitle ? escapeHtml(q._sourceQuizTitle) : '';
        return `
            <div class="sub-quiz-preview-item">
                <span class="sub-quiz-preview-num">${i + 1}</span>
                <div>
                    <p class="sub-quiz-preview-text">${escapeHtml(snippet)}</p>
                    ${src ? `<p class="sub-quiz-preview-source text-muted text-sm">From: ${src}</p>` : ''}
                </div>
            </div>
        `;
    }).join('');
    dom.setHTML(list, html);
}

export function initReviewSubQuizScreen() {
    const count = adminState.reviewSubQuizQuestions.length;
    const { attemptCount, students } = adminState.reviewSubQuizMeta;
    if (!count) {
        alert('No wrong-answer questions to build a review quiz.');
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
        return;
    }
    const previewItems = adminState.reviewSubQuizQuestions.map((q) => ({ ...q, _sourceQuizTitle: q._sourceQuizTitle }));
    renderSubQuizPreview(previewItems, { listEl: elements.reviewSubQuizPreviewList, badgeEl: elements.reviewSubQuizPreviewBadge });
    const defaultTitle = students.length === 1
        ? `Review — wrong answers (${students[0]})`
        : `Review — wrong answers (${attemptCount} attempts)`;
    if (elements.reviewSubQuizTitle) elements.reviewSubQuizTitle.value = defaultTitle;
    if (elements.reviewSubQuizMode) elements.reviewSubQuizMode.value = 'practice';
    if (elements.reviewSubQuizTime) elements.reviewSubQuizTime.value = '';
    const studentLabel = students.length ? students.map((s) => `@${s}`).join(', ') : '—';
    dom.setText(elements.reviewSubQuizSummary, `${count} unique wrong-answer question(s) from ${attemptCount} selected attempt(s): ${studentLabel}`);
    if (elements.reviewSubQuizStudioBtn) elements.reviewSubQuizStudioBtn.disabled = false;
    if (elements.reviewSubQuizSaveBtn) elements.reviewSubQuizSaveBtn.disabled = false;
}

export async function saveReviewSubQuiz() {
    const title = elements.reviewSubQuizTitle?.value.trim();
    const mode = elements.reviewSubQuizMode?.value || 'practice';
    const timeLimitMinutes = parseInt(elements.reviewSubQuizTime?.value, 10) || 0;
    const timeLimit = timeLimitMinutes > 0 ? timeLimitMinutes * 60 : 0;
    if (!title) { alert('Please enter a quiz title.'); return; }
    if (!adminState.reviewSubQuizQuestions.length) { alert('No questions to save.'); return; }
    try {
        elements.reviewSubQuizSaveBtn.disabled = true;
        dom.setHTML(elements.reviewSubQuizSaveBtn, '<i class="fas fa-spinner fa-spin"></i> Saving...');
        const stripSubQuizMeta = (q) => { const { _sourceQuizTitle, ...rest } = q; return rest; };
        await addDoc(collection(db, FIREBASE_COLLECTIONS.QUIZZES), {
            title, mode, timeLimit,
            questions: adminState.reviewSubQuizQuestions.map(stripSubQuizMeta),
            isSubQuiz: true,
            builtFromWrongAnswers: true,
            sourceQuizIds: [...adminState.reviewSubQuizSourceIds],
            visibility: QUIZ_VISIBILITY.MY_STUDENTS,
            assignedStudents: [],
            ...getTeacherOwnerFields(),
            createdAt: Timestamp.now()
        });
        alert('Review sub-quiz created successfully!');
        adminState.reviewSubQuizQuestions = [];
        adminState.reviewSubQuizSourceIds = [];
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
    } catch (e) {
        console.error(e);
        alert('Failed to save sub-quiz: ' + e.message);
    } finally {
        if (elements.reviewSubQuizSaveBtn) {
            elements.reviewSubQuizSaveBtn.disabled = adminState.reviewSubQuizQuestions.length === 0;
            dom.setHTML(elements.reviewSubQuizSaveBtn, '<i class="fas fa-save mr-2"></i> Save Sub-Quiz');
        }
    }
}

export function openReviewSubQuizInStudio() {
    if (!adminState.reviewSubQuizQuestions.length) return;
    resetEditorForCreate();
    adminState.viewingQuizId = null;
    adminState.pendingSubQuizMeta = {
        isSubQuiz: true,
        builtFromWrongAnswers: true,
        sourceQuizIds: [...adminState.reviewSubQuizSourceIds]
    };
    const stripSubQuizMeta = (q) => { const { _sourceQuizTitle, ...rest } = q; return rest; };
    populateQuizBuilder(adminState.reviewSubQuizQuestions.map(stripSubQuizMeta));
    document.getElementById('qb-title').value = elements.reviewSubQuizTitle?.value.trim() || '';
    document.getElementById('qb-mode').value = elements.reviewSubQuizMode?.value || 'practice';
    const mins = parseInt(elements.reviewSubQuizTime?.value, 10) || 0;
    document.getElementById('qb-time').value = mins > 0 ? String(mins) : '';
    adminState.router?.navigate(SCREENS.ADMIN_EDITOR);
}


