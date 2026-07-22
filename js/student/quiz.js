import API from '../api.js';
import state from '../state.js';
import { SCREENS, QUIZ_MODES } from '../constants.js';
import { dom, formatTime } from '../utils.js';
import { UI } from '../ui-components.js';
import { PracticeMode, ExamMode } from '../quiz-engine.js';
import { sounds } from '../sounds.js';
import {
    elements, router,
    setLastLoadTimestamp
} from './state.js';

export async function setupQuiz(quizId) {
    let assignment = state.quiz.assignments.find(a => a.id === quizId);
    if (!assignment) {
        const assignments = await API.getAssignments(state.user.current);
        state.quiz.setAssignments(assignments);
        assignment = assignments.find(a => a.id === quizId);
    }

    if (!assignment) {
        router.current?.navigate(SCREENS.DASHBOARD);
        return;
    }

    startQuiz(assignment);
}

function startQuiz(quiz) {
    dom.hide(elements.practiceContainer);
    dom.hide(elements.examContainer);
    dom.hide(elements.resultsContainer);
    dom.hide(elements.quizTimer);
    dom.hide(elements.examSubmitBtn);
    dom.hide(elements.examPartNav);
    if (elements.examPartNav) elements.examPartNav.innerHTML = '';
    elements.quizProgress.style.width = '0%';

    dom.setText(elements.quizTitle, quiz.title);
    dom.setText(elements.quizModeBadge, quiz.mode.toUpperCase());
    elements.quizModeBadge.className = `badge ${quiz.mode}`;

    if (quiz.mode === QUIZ_MODES.PRACTICE) {
        dom.show(elements.soundToggleBtn);
        dom.show(elements.practiceHelpBtn);
    } else {
        dom.hide(elements.soundToggleBtn);
        dom.hide(elements.practiceHelpBtn);
        dom.show(elements.examSubmitBtn);
    }

    let instance;
    if (quiz.mode === QUIZ_MODES.PRACTICE) {
        dom.show(elements.practiceContainer);
        instance = new PracticeMode(quiz, handleQuizFinish);
    } else {
        dom.show(elements.examContainer);
        instance = new ExamMode(quiz, handleQuizFinish);
    }

    state.quiz.setInstance(instance);
    instance.start();
}

async function handleQuizFinish(result) {
    const quiz = state.quiz.instance.quiz;
    await API.submitResult(state.user.current, quiz.id, {
        quizTitle: quiz.title,
        score: result.score,
        total: result.total,
        timeSpent: result.timeSpent,
        answers: result.answers
    });

    setLastLoadTimestamp(0);

    dom.hide(elements.practiceContainer);
    dom.hide(elements.examContainer);
    dom.hide(elements.quizTimer);
    dom.hide(elements.examSubmitBtn);
    dom.hide(elements.examPartNav);
    if (elements.examPartNav) elements.examPartNav.innerHTML = '';
    dom.hide(elements.soundToggleBtn);
    dom.hide(elements.practiceHelpBtn);
    dom.show(elements.resultsContainer);

    const percentage = Math.round((result.score / result.total) * 100);
    dom.setText(elements.scorePercentage, `${percentage}%`);

    setTimeout(() => {
        elements.scoreCirclePath.style.strokeDasharray = `${percentage}, 100`;
        elements.scoreCirclePath.style.stroke = percentage >= 80 ? 'var(--success)' : (percentage >= 50 ? 'var(--primary)' : 'var(--danger)');
    }, 100);

    dom.setText(elements.statCorrect, result.score);
    dom.setText(elements.statIncorrect, result.total - result.score);
    dom.setText(elements.statTime, formatTime(result.timeSpent));

    dom.hide(elements.examReview);
    dom.hide(elements.practiceReview);

    sounds.play('result');

    const instance = state.quiz.instance;
    if (instance.quiz.mode === QUIZ_MODES.EXAM) {
        dom.show(elements.examReview);
        renderExamReview(instance.quiz, result.answers);
    } else if (instance.initialWrongQuestions?.length > 0) {
        dom.show(elements.practiceReview);
        renderPracticeReview(instance.quiz, result.answers, instance.initialWrongQuestions);
    }
}

function renderExamReview(quiz, userAnswers) {
    let html = '';
    quiz.questions.forEach((q, i) => {
        const ans = userAnswers[q.id];
        const feedbackHTML = state.quiz.instance.generateFeedbackHTML(q, ans?.isCorrect, {
            showStatus: false,
            showCorrectAnswer: false
        });
        html += UI.createReviewItem(i, q, ans, feedbackHTML);
    });
    dom.setHTML(elements.examReviewList, html);
    state.quiz.instance.bindTTS(elements.examReviewList);
}

function renderPracticeReview(quiz, userAnswers, wrongQuestions) {
    let html = '';
    wrongQuestions.forEach((q) => {
        const globalIndex = quiz.questions.findIndex(x => x.id === q.id);
        const ans = userAnswers[q.id];
        const feedbackHTML = state.quiz.instance.generateFeedbackHTML(q, false, {
            showStatus: false,
            showCorrectAnswer: false
        });
        html += UI.createReviewItem(globalIndex, q, ans, feedbackHTML);
    });
    dom.setHTML(elements.practiceReviewList, html);
    state.quiz.instance.bindTTS(elements.practiceReviewList);
}

export function bindQuizEvents() {
    elements.backToDashboardBtn?.addEventListener('click', () => {
        state.quiz.clearInstance();
        dom.hide(elements.soundToggleBtn);
        dom.hide(elements.practiceHelpBtn);
        dom.hide(elements.examSubmitBtn);
        dom.hide(elements.examPartNav);
        if (elements.examPartNav) elements.examPartNav.innerHTML = '';
        router.current?.navigate(SCREENS.DASHBOARD);
    });

    elements.resultsHomeBtn?.addEventListener('click', () => {
        router.current?.navigate(SCREENS.DASHBOARD);
    });
}
