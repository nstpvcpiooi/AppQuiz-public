/**
 * Build a sub-quiz by shuffling and sampling questions from parent quizzes.
 */

import { shuffleArray } from './utils.js';

// Re-export so existing consumers of sub-quiz.js are unaffected
export { shuffleArray };


export function cloneQuestion(q, index, sourceMeta = {}) {
    const sourceQuizId = sourceMeta.sourceQuizId || q.sourceQuizId || '';
    const sourceQuestionId = sourceMeta.sourceQuestionId || q.sourceQuestionId || q.id || '';

    const cloned = {
        id: `sq_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        type: q.type,
        text: q.text ?? '',
        correctAnswer: q.correctAnswer ?? '',
        explanation: q.explanation ?? ''
    };
    if (q.explanationSource) cloned.explanationSource = q.explanationSource;
    if (q.options?.length) cloned.options = [...q.options];
    if (q.passage) cloned.passage = q.passage;
    if (q.audioWords?.length) cloned.audioWords = [...q.audioWords];
    if (q.blankNumber != null) cloned.blankNumber = q.blankNumber;
    if (sourceQuizId) cloned.sourceQuizId = sourceQuizId;
    if (sourceQuestionId) cloned.sourceQuestionId = sourceQuestionId;
    return cloned;
}

export function collectQuestionsFromQuizzes(quizzes) {
    const pool = [];
    quizzes.forEach((quiz) => {
        (quiz.questions || []).forEach((q) => pool.push(q));
    });
    return pool;
}

/**
 * From completed submissions, collect every question answered incorrectly (or unanswered).
 * Deduplicates by quizId + original question id across multiple results.
 * @param {Record<string, object>} quizById - quiz id -> quiz doc { id, questions, title, ... }
 * @param {object[]} results - result docs with quizId, answers
 * @returns {{ questions: object[], sourceQuizIds: string[] }}
 */
export function collectWrongQuestionsFromResults(quizById, results) {
    const seen = new Set();
    const questions = [];
    const sourceQuizIds = [];

    for (const result of results || []) {
        const quiz = quizById[result.quizId];
        if (!quiz?.questions?.length) continue;

        if (!sourceQuizIds.includes(quiz.id)) {
            sourceQuizIds.push(quiz.id);
        }

        const answers = result.answers || {};
        const answerKeys = Object.keys(answers);

        for (let i = 0; i < quiz.questions.length; i++) {
            const q = quiz.questions[i];
            const qid = q.id || `q_${i}`;
            let ans = answers[qid];
            if (!ans && answerKeys.length === quiz.questions.length) {
                ans = answers[answerKeys[i]];
            }
            if (ans?.isCorrect === true) continue;

            const key = `${quiz.id}::${qid}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const cloned = cloneQuestion({ ...q, id: qid }, questions.length, {
                sourceQuizId: quiz.id,
                sourceQuestionId: qid
            });
            cloned._sourceQuizTitle = quiz.title || quiz.id;
            questions.push(cloned);
        }
    }

    return { questions, sourceQuizIds };
}

/**
 * @param {object[]} pool - source questions
 * @param {number} count - desired number of questions; 0 = shuffle and use entire pool
 * @returns {{ questions: object[], picked: number, poolSize: number }}
 */
export function pickRandomQuestions(pool, count) {
    const poolSize = pool.length;
    if (poolSize === 0) {
        return { questions: [], picked: 0, poolSize: 0 };
    }

    const requested = Math.floor(Number(count));
    const n = !Number.isFinite(requested) || requested <= 0
        ? poolSize
        : Math.min(requested, poolSize);
    const shuffled = shuffleArray(pool);
    const questions = shuffled.slice(0, n).map((q, i) => {
        const sourceTitle = q._sourceQuizTitle;
        const { _sourceQuizTitle, ...rest } = q;
        const cloned = cloneQuestion(rest, i);
        if (sourceTitle) cloned._sourceQuizTitle = sourceTitle;
        return cloned;
    });

    return { questions, picked: questions.length, poolSize };
}

function normalizeExplanation(html) {
    return String(html ?? '').trim();
}

/**
 * @param {object[]} questions
 * @param {(html: string) => boolean} [hasContent]
 * @returns {{ sourceQuizId: string, sourceQuestionId: string, explanation: string, explanationSource?: string }[]}
 */
export function getSyncableExplanationItems(questions, hasContent = (html) => normalizeExplanation(html).length > 0) {
    return (questions || [])
        .filter((q) => q?.sourceQuizId && q?.sourceQuestionId && hasContent(q.explanation))
        .map((q) => ({
            sourceQuizId: q.sourceQuizId,
            sourceQuestionId: q.sourceQuestionId,
            explanation: q.explanation ?? '',
            explanationSource: q.explanationSource ?? ''
        }));
}
