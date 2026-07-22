import {
    SCREENS,
    isStudentDashboardRoute,
    parseStudentDashboardRoute,
    isAdminDashboardRoute,
    parseAdminDashboardRoute,
    isStudentFlashcardStudyRoute,
    isStudentFlashcardEditorRoute,
    isAdminFlashcardEditorRoute
} from './constants.js';
import state from './state.js';
import { dom } from './utils.js';

export class Router {
    constructor(onNavigate) {
        this.onNavigate = onNavigate;
        this.screens = document.querySelectorAll('.screen');
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    }

    handleRoute() {
        let hash = window.location.hash.slice(1);
        if (!hash) hash = SCREENS.LOGIN;

        const isAdminView = hash.startsWith('admin-view-');
        const isAdminResult = hash.startsWith('admin-result-');
        const isAdminFlashcardEdit = isAdminFlashcardEditorRoute(hash);
        const isQuiz = hash.startsWith('quiz-');
        const isReview = hash.startsWith('review-');
        const isFlashcardStudy = isStudentFlashcardStudyRoute(hash);
        const isStudentFlashcardEdit = isStudentFlashcardEditorRoute(hash);
        let currentScreen = hash;
        if (isStudentDashboardRoute(hash)) currentScreen = SCREENS.DASHBOARD;
        else if (isAdminDashboardRoute(hash)) currentScreen = SCREENS.ADMIN_DASHBOARD;
        else if (isAdminView) currentScreen = SCREENS.ADMIN_VIEW;
        else if (isAdminResult) currentScreen = SCREENS.ADMIN_RESULT_DETAIL;
        else if (isAdminFlashcardEdit) currentScreen = SCREENS.ADMIN_FLASHCARD_EDITOR;
        else if (isQuiz) currentScreen = SCREENS.QUIZ;
        else if (isReview) currentScreen = SCREENS.STUDENT_REVIEW;
        else if (isFlashcardStudy) currentScreen = SCREENS.STUDENT_FLASHCARD_STUDY;
        else if (isStudentFlashcardEdit) currentScreen = SCREENS.STUDENT_FLASHCARD_EDITOR;

        const isAdminScreen = [
            SCREENS.ADMIN_DASHBOARD,
            SCREENS.ADMIN_EDITOR,
            SCREENS.ADMIN_VIEW,
            SCREENS.ADMIN_SMART_IMPORT,
            SCREENS.ADMIN_REVIEW_SUB_QUIZ,
            SCREENS.ADMIN_RESULT_DETAIL,
            SCREENS.ADMIN_FLASHCARD_EDITOR
        ].includes(currentScreen);
        const isAuthScreen = currentScreen === SCREENS.LOGIN || currentScreen === SCREENS.ADMIN_LOGIN;

        if (!isAuthScreen) {
            if (isAdminScreen) {
                if (!state.user.isAdmin) {
                    window.location.hash = SCREENS.ADMIN_LOGIN;
                    return;
                }
            } else {
                if (!state.user.current) {
                    window.location.hash = SCREENS.LOGIN;
                    return;
                }
            }
        }

        if (state.user.isAdmin && currentScreen === SCREENS.ADMIN_LOGIN) {
            window.location.hash = SCREENS.ADMIN_DASHBOARD;
            return;
        }

        if (state.user.current && currentScreen === SCREENS.LOGIN && !state.user.isAdmin) {
            window.location.hash = SCREENS.DASHBOARD;
            return;
        }

        this.switchScreen(currentScreen);

        let params = {};
        if (currentScreen === SCREENS.DASHBOARD) {
            params = { dashboardTab: parseStudentDashboardRoute(hash) };
        } else if (currentScreen === SCREENS.ADMIN_DASHBOARD) {
            params = { adminDashboardTab: parseAdminDashboardRoute(hash) };
        } else if (isQuiz) params = { quizId: hash.replace('quiz-', '') };
        else if (isAdminView) params = { quizId: hash.replace('admin-view-', '') };
        else if (isAdminResult) params = { resultId: hash.replace('admin-result-', '') };
        else if (isReview) params = { resultId: hash.replace('review-', '') };
        else if (isAdminFlashcardEdit) params = { setId: hash.replace('admin-flashcard-editor', '').replace(/^-/, '') || null };
        else if (isFlashcardStudy) params = { setId: hash.replace('flashcard-study-', '') };
        else if (isStudentFlashcardEdit) params = { setId: hash.replace('student-flashcard-editor', '').replace(/^-/, '') || null };

        this.onNavigate(currentScreen, params);
    }

    switchScreen(screenName) {
        const targetId = `${screenName}-screen`;
        this.screens.forEach((s) => {
            dom.hide(s);
            dom.inactive(s);
        });

        const target = document.getElementById(targetId);
        if (target) {
            dom.show(target);
            setTimeout(() => dom.active(target), 10);
            window.scrollTo(0, 0);
            return;
        }

        // Guard against unexpected/invalid hashes that would hide all screens.
        const fallback = document.getElementById(`${SCREENS.LOGIN}-screen`);
        if (fallback) {
            dom.show(fallback);
            setTimeout(() => dom.active(fallback), 10);
            window.scrollTo(0, 0);
        }
    }

    navigate(screenName) {
        window.location.hash = screenName;
    }
}
