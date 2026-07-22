import { db } from '../firebase-init.js';
import { doc, getDoc } from '../firebase-init.js';
import { FIREBASE_COLLECTIONS } from '../constants.js';
import { dom, formatTime } from '../utils.js';
import { UI } from '../ui-components.js';
import { adminState, elements } from './state.js';
import { getTeacherUid, isVisibleToTeacher } from './auth.js';
import { navigateAdminTab } from './dashboard.js';

export function updateAdminResultDetailFilterBtn() {
    const ctx = adminState.adminResultDetailContext;
    const btn = elements.adminResultDetailWrongFilterBtn;
    if (!btn || !ctx) return;
    const wrongCount = UI.countWrongAnswers(ctx.quiz, ctx.resultData);
    btn.setAttribute('aria-pressed', String(!!ctx.incorrectOnly));
    btn.classList.toggle('is-active', !!ctx.incorrectOnly);
    btn.disabled = wrongCount === 0;
    btn.textContent = wrongCount > 0
        ? `Wrong answers only (${wrongCount})`
        : 'Wrong answers only';
}

export function renderAdminResultDetailContent() {
    const ctx = adminState.adminResultDetailContext;
    if (!ctx) return;
    const { quiz, resultData, incorrectOnly } = ctx;
    const answers = resultData?.answers || {};
    if (!Object.keys(answers).length) {
        dom.setHTML(elements.adminResultDetailContent, '<p class="text-muted review-filter-empty">This attempt has no saved answers (submitted before detailed tracking was enabled).</p>');
        if (elements.adminResultDetailWrongFilterBtn) elements.adminResultDetailWrongFilterBtn.disabled = true;
        return;
    }
    dom.setHTML(elements.adminResultDetailContent, UI.buildStudentReviewHTML(quiz, resultData, { incorrectOnly }));
    updateAdminResultDetailFilterBtn();
}

export function renderAdminResultDetailPage() {
    const ctx = adminState.adminResultDetailContext;
    if (!ctx) return;
    const { quiz, resultData } = ctx;
    const dateStr = resultData.timestamp?.toDate?.().toLocaleString() ?? '—';
    const scoreLabel = resultData.total != null
        ? `${resultData.score}/${resultData.total}`
        : String(resultData.score ?? '—');
    dom.setText(elements.adminResultDetailTitle, resultData.quizTitle || quiz?.title || 'Quiz');
    dom.setText(elements.adminResultDetailStudent, resultData.username ? `Student: ${resultData.username}` : '');
    dom.setText(elements.adminResultDetailScore, scoreLabel);
    dom.setText(elements.adminResultDetailTime, formatTime(resultData.timeSpent ?? 0));
    dom.setText(elements.adminResultDetailDate, dateStr);
    renderAdminResultDetailContent();
}

export async function getAdminResultById(resultId) {
    const id = String(resultId || '').trim();
    if (!id) return null;
    let found = adminState.adminResultsCache.find((r) => r.id === id);
    if (found) return found;
    const { loadResults } = await import('./dashboard.js');
    await loadResults();
    found = adminState.adminResultsCache.find((r) => r.id === id);
    if (found) return found;
    if (!db) return null;
    try {
        const snap = await getDoc(doc(db, FIREBASE_COLLECTIONS.RESULTS, id));
        if (!snap.exists()) return null;
        const result = { id: snap.id, ...snap.data() };
        const quiz = await ensureQuizInCache(result.quizId);
        if (!quiz || !isVisibleToTeacher(quiz, getTeacherUid())) return null;
        return result;
    } catch (e) {
        console.error('Failed to load result:', e);
        return null;
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

export async function setupAdminResultDetailScreen(resultId) {
    adminState.adminResultDetailContext = null;
    const resultData = await getAdminResultById(resultId);
    if (!resultData) { alert('Result not found or you do not have access.'); openAdminDashboardResultsTab(); return; }
    const quiz = await ensureQuizInCache(resultData.quizId);
    if (!quiz) { alert('Quiz not found. It may have been deleted.'); openAdminDashboardResultsTab(); return; }
    adminState.adminResultDetailContext = { quiz, resultData, incorrectOnly: false };
    renderAdminResultDetailPage();
}

function openAdminDashboardResultsTab() {
    navigateAdminTab('tab-results');
}

export function resetAdminResultDetailScreen() {
    adminState.adminResultDetailContext = null;
}
