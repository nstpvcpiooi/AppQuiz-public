import API from '../api.js';
import state from '../state.js';
import { SCREENS, STUDENT_TAB_ROUTES } from '../constants.js';
import { dom, initCustomSelect } from '../utils.js';
import { sounds } from '../sounds.js';
import { initDictionary } from '../dictionary.js';
import {
    elements, router, setRouter,
    STUDENT_TAB_IDS, activeStudentTab, setActiveStudentTab,
    setDictionaryHandlers
} from './state.js';
import {
    loadAssignments, renderStudentProfile, restoreStudentQuizListPrefs, bindDashboardEvents
} from './dashboard.js';
import { openStudentReview, bindReviewEvents } from './review.js';
import { setupQuiz, bindQuizEvents } from './quiz.js';
import { initStudentFlashcard } from './flashcard.js';

export function initApp() {
    restoreStudentQuizListPrefs();

    [elements.studentQuizSort, elements.studentQuizGroup]
        .filter(Boolean)
        .forEach((selectEl) => initCustomSelect(selectEl));

    const dictionaryHandlers = initDictionary(elements);
    setDictionaryHandlers(dictionaryHandlers);

    function openPracticeHelp() {
        dom.show(elements.practiceHelpModal);
        elements.practiceHelpModal?.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
    }

    function closePracticeHelp() {
        dom.hide(elements.practiceHelpModal);
        elements.practiceHelpModal?.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    }

    elements.practiceHelpBtn?.addEventListener('click', openPracticeHelp);
    elements.practiceHelpClose?.addEventListener('click', closePracticeHelp);
    elements.practiceHelpBackdrop?.addEventListener('click', closePracticeHelp);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !elements.practiceHelpModal?.classList.contains('hidden')) {
            closePracticeHelp();
        }
    });

    function updateSoundToggleUI() {
        if (!elements.soundToggleBtn) return;
        const enabled = sounds.isEnabled();
        elements.soundToggleBtn.classList.toggle('sound-off', !enabled);
        elements.soundToggleBtn.title = enabled ? 'Turn sound off' : 'Turn sound on';
        elements.soundToggleBtn.innerHTML = enabled
            ? '<i class="fas fa-volume-up"></i>'
            : '<i class="fas fa-volume-mute"></i>';
    }

    elements.soundToggleBtn?.addEventListener('click', () => {
        sounds.setEnabled(!sounds.isEnabled());
        updateSoundToggleUI();
    });

    elements.loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = elements.usernameInput.value.trim();
        if (!username) return;
        const submitBtn = elements.loginForm?.querySelector('button[type="submit"]');

        dom.show(elements.loginLoader);
        dom.setText(elements.loginBtnText, "Logging in...");
        if (submitBtn) submitBtn.disabled = true;

        try {
            const success = await API.login(username);
            if (success) {
                state.user.login(username.trim().toLowerCase());
                elements.usernameInput.value = '';
                if (router.current) router.current.navigate(SCREENS.DASHBOARD);
                else window.location.hash = SCREENS.DASHBOARD;
            } else {
                alert("Invalid username. Please try again.");
            }
        } finally {
            dom.hide(elements.loginLoader);
            dom.setText(elements.loginBtnText, "Log in");
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    elements.logoutBtn?.addEventListener('click', () => {
        state.user.logout();
        dom.setHTML(elements.assignmentsList, '');
        router.current?.navigate(SCREENS.LOGIN);
    });

    function showStudentPanel(panelId) {
        if (!STUDENT_TAB_IDS.has(panelId)) return;

        const isNavTab = panelId !== 'profile';

        elements.studentNavTabs.forEach((btn) => {
            const isActive = isNavTab && btn.dataset.studentTab === panelId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        elements.studentUserBtn?.classList.toggle('active', panelId === 'profile');
        elements.studentUserBtn?.setAttribute('aria-expanded', panelId === 'profile' ? 'true' : 'false');

        Object.entries(elements.studentTabPanels).forEach(([id, panel]) => {
            if (!panel) return;
            const isActive = id === panelId;
            if (isActive) {
                dom.show(panel);
                panel.removeAttribute('hidden');
                setTimeout(() => dom.active(panel), 10);
            } else {
                dom.inactive(panel);
                dom.hide(panel);
                panel.setAttribute('hidden', '');
            }
        });
    }

    function activateStudentTab(tabId) {
        if (!STUDENT_TAB_IDS.has(tabId)) return;
        if (activeStudentTab === 'dictionary' && tabId !== 'dictionary') {
            dictionaryHandlers.onTabClose();
        }
        setActiveStudentTab(tabId);
        showStudentPanel(tabId);
        if (tabId === 'dictionary') {
            dictionaryHandlers.onTabOpen();
        }
        if (tabId === 'profile') {
            renderStudentProfile();
        }
    }

    function navigateStudentTab(tabId) {
        const route = STUDENT_TAB_ROUTES[tabId];
        if (route) router.current?.navigate(route);
    }

    elements.studentNavTabs.forEach((btn) => {
        btn.addEventListener('click', () => {
            navigateStudentTab(btn.dataset.studentTab);
        });
    });

    elements.studentUserBtn?.addEventListener('click', () => {
        if (elements.studentUserBtn.classList.contains('active')) {
            navigateStudentTab('quiz');
            return;
        }
        navigateStudentTab('profile');
    });

    bindDashboardEvents();
    bindReviewEvents();
    bindQuizEvents();

    const studentFlashcard = initStudentFlashcard();

    return {
        onNavigate(screen, params) {
            if (screen === SCREENS.DASHBOARD) {
                dom.setText(elements.displayUsername, state.user.current);
                activateStudentTab(params?.dashboardTab || 'quiz');
                loadAssignments();
                if (params?.dashboardTab === 'flashcard') {
                    studentFlashcard.onTabActive();
                }
            } else if (screen === SCREENS.QUIZ && params.quizId) {
                setupQuiz(params.quizId);
            } else if (screen === SCREENS.STUDENT_REVIEW && params.resultId) {
                openStudentReview(params.resultId);
            } else if (screen === SCREENS.STUDENT_FLASHCARD_EDITOR) {
                studentFlashcard.onEditorOpen(params?.setId || null);
            } else if (screen === SCREENS.STUDENT_FLASHCARD_STUDY && params?.setId) {
                studentFlashcard.onStudyOpen(params.setId);
            } else {
                if (activeStudentTab === 'dictionary') {
                    dictionaryHandlers.onTabClose();
                    setActiveStudentTab('quiz');
                }
                closePracticeHelp();
                state.quiz.clearInstance();
                dom.hide(elements.soundToggleBtn);
                dom.hide(elements.practiceHelpBtn);
            }
        },
        setRouter(r) { setRouter(r); }
    };
}
