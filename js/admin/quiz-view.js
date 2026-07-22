import { db } from '../firebase-init.js';
import { doc, getDocs, collection, deleteDoc } from '../firebase-init.js';
import { SCREENS, FIREBASE_COLLECTIONS, QUIZ_VISIBILITY } from '../constants.js';
import { dom, escapeHtml, isSubQuizItem } from '../utils.js';
import { UI } from '../ui-components.js';
import { adminState, elements } from './state.js';
import { getTeacherUid, isVisibleToTeacher, assertCanManage } from './auth.js';
import { downloadQuizExport } from '../quiz-export.js';
import { loadQuizzes, getVisibilityLabel } from './dashboard.js';

export function loadQuizForView(docId) {
    adminState.viewingQuizId = docId;
    adminState.router?.navigate(`admin-view-${docId}`);
}

export async function setupQuizView(quizId) {
    if (!adminState.quizzesById[quizId]) {
        await loadQuizzesMap();
    }
    const quiz = adminState.quizzesById[quizId];
    if (!quiz || !isVisibleToTeacher(quiz, getTeacherUid())) {
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
        return;
    }
    adminState.viewingQuizId = quizId;
    renderQuizView(quiz);
}

async function loadQuizzesMap() {
    adminState.adminQuizCache = [];
    adminState.quizzesById = {};
    const snapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.QUIZZES));
    snapshot.forEach((docSnap) => {
        const quiz = { id: docSnap.id, ...docSnap.data() };
        adminState.quizzesById[docSnap.id] = quiz;
        adminState.adminQuizCache.push(quiz);
    });
}

function renderQuizView(quiz) {
    dom.setText(elements.quizViewTitle, quiz.title || 'View Quiz');
    closeQuizViewExportMenu();
    const visibility = quiz.visibility || QUIZ_VISIBILITY.ALL;
    const timeLabel = quiz.timeLimit > 0
        ? `${Math.floor(quiz.timeLimit / 60)} min limit`
        : 'No time limit';
    dom.setHTML(elements.quizViewMeta, `
        <div class="quiz-view-meta-grid">
            <div><span class="text-muted">Mode</span><strong>${escapeHtml(quiz.mode || 'practice')}</strong></div>
            <div><span class="text-muted">Questions</span><strong>${quiz.questions?.length ?? 0}</strong></div>
            <div><span class="text-muted">Time</span><strong>${timeLabel}</strong></div>
            <div><span class="text-muted">Access</span><strong>${getVisibilityLabel(visibility, quiz.assignedStudents)}</strong></div>
            ${isSubQuizItem(quiz) ? '<div><span class="text-muted">Type</span><strong>Sub-quiz</strong></div>' : ''}
        </div>
    `);
    dom.setHTML(elements.quizViewQuestions, UI.buildQuizViewHTML(quiz));
}

export function closeQuizViewExportMenu() {
    if (!elements.quizViewExportMenu) return;
    dom.hide(elements.quizViewExportMenu);
    elements.quizViewExportBtn?.setAttribute('aria-expanded', 'false');
}

export function toggleQuizViewExportMenu() {
    if (!elements.quizViewExportMenu) return;
    const isOpen = !elements.quizViewExportMenu.classList.contains('hidden');
    if (isOpen) closeQuizViewExportMenu();
    else {
        dom.show(elements.quizViewExportMenu);
        elements.quizViewExportBtn?.setAttribute('aria-expanded', 'true');
    }
}

export function exportViewingQuiz(format) {
    const quiz = adminState.quizzesById[adminState.viewingQuizId];
    if (!quiz) { alert('Quiz not found.'); return; }
    downloadQuizExport(quiz, format);
    closeQuizViewExportMenu();
}

export async function deleteQuiz(id, { redirectToDashboard = false } = {}) {
    if (!assertCanManage(adminState.quizzesById[id])) return;
    if (confirm("Permanently delete this quiz?")) {
        try {
            await deleteDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, id));
            delete adminState.quizzesById[id];
            if (redirectToDashboard) {
                adminState.viewingQuizId = null;
                adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
            } else {
                loadQuizzes();
            }
        } catch (err) {
            console.error(err);
            alert("Error deleting quiz");
        }
    }
}
