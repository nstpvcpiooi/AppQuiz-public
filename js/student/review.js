import API from '../api.js';
import state from '../state.js';
import { SCREENS } from '../constants.js';
import { dom, formatTime } from '../utils.js';
import { UI } from '../ui-components.js';
import {
    elements, router,
    reviewQuizCache, reviewIncorrectOnly, currentReviewResultId,
    setReviewQuizCache, setReviewIncorrectOnly, setCurrentReviewResultId
} from './state.js';

function countWrongAnswers(quiz, result) {
    const answers = result?.answers || {};
    return quiz.questions.filter((q) => !answers[q.id]?.isCorrect).length;
}

function updateReviewFilterBtn(result) {
    const btn = elements.reviewWrongFilterBtn;
    if (!btn || !reviewQuizCache) return;

    const wrongCount = countWrongAnswers(reviewQuizCache, result);
    btn.setAttribute('aria-pressed', String(reviewIncorrectOnly));
    btn.classList.toggle('is-active', reviewIncorrectOnly);
    btn.disabled = wrongCount === 0;
    btn.textContent = wrongCount > 0
        ? `Wrong answers only (${wrongCount})`
        : 'Wrong answers only';
}

function renderStudentReview(result) {
    if (!reviewQuizCache || !result) return;

    dom.setText(elements.reviewQuizTitle, reviewQuizCache.title || 'Quiz');
    dom.setText(elements.reviewScoreLabel, `${result.score}/${result.total}`);
    dom.setText(elements.reviewTimeLabel, formatTime(result.timeSpent ?? 0));
    dom.setText(
        elements.reviewDateLabel,
        result.timestamp?.toDate?.().toLocaleString() || '\u2014'
    );

    dom.setHTML(
        elements.studentReviewList,
        UI.buildStudentReviewHTML(reviewQuizCache, result, { incorrectOnly: reviewIncorrectOnly })
    );
    updateReviewFilterBtn(result);
}

export async function openStudentReview(resultId) {
    const result = state.quiz.resultsById?.[resultId];
    if (!result) {
        router.current?.navigate(SCREENS.DASHBOARD);
        return;
    }

    let quiz = state.quiz.assignments.find((a) => a.id === result.quizId);
    if (!quiz) quiz = await API.getQuizById(result.quizId);
    if (!quiz) {
        alert('Quiz not found.');
        router.current?.navigate(SCREENS.DASHBOARD);
        return;
    }

    setReviewQuizCache(quiz);
    setReviewIncorrectOnly(false);
    setCurrentReviewResultId(resultId);
    renderStudentReview(result);

    const attempts = API.getAttemptsForQuiz(state.quiz.studentResults || [], result.quizId);
    if (attempts.length > 1 && elements.reviewAttemptSelect) {
        dom.show(elements.reviewAttemptWrap);
        elements.reviewAttemptSelect.innerHTML = attempts.map((attempt, idx) => {
            const date = attempt.timestamp?.toDate?.().toLocaleString() || 'N/A';
            const score = `${attempt.score}/${attempt.total}`;
            return `<option value="${attempt.id}" ${attempt.id === resultId ? 'selected' : ''}>Attempt ${attempts.length - idx} \u2014 ${score} \u2014 ${date}</option>`;
        }).join('');
    } else {
        dom.hide(elements.reviewAttemptWrap);
    }
}

export function bindReviewEvents() {
    elements.reviewWrongFilterBtn?.addEventListener('click', () => {
        const result = currentReviewResultId
            ? state.quiz.resultsById?.[currentReviewResultId]
            : null;
        if (!result) return;

        setReviewIncorrectOnly(!reviewIncorrectOnly);
        renderStudentReview(result);
    });

    elements.reviewAttemptSelect?.addEventListener('change', (e) => {
        const next = state.quiz.resultsById?.[e.target.value];
        if (next) {
            setCurrentReviewResultId(e.target.value);
            renderStudentReview(next);
        }
    });

    elements.reviewBackBtn?.addEventListener('click', () => {
        setReviewQuizCache(null);
        setReviewIncorrectOnly(false);
        setCurrentReviewResultId(null);
        router.current?.navigate(SCREENS.DASHBOARD);
    });
}
