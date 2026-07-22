import { getQuizCreatedMillis } from './utils.js';


function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
    const d = startOfDay(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getQuizDateGroupInfo(quiz) {
    const ms = getQuizCreatedMillis(quiz);
    if (!ms) return { label: 'Unknown date', orderRank: -1, tieBreak: 0 };

    const created = new Date(ms);
    const now = new Date();
    const createdDay = startOfDay(created).getTime();
    const todayStart = startOfDay(now).getTime();
    const weekStart = startOfWeek(now).getTime();
    const monthStart = startOfMonth(now).getTime();

    if (createdDay >= todayStart) {
        return { label: 'Today', orderRank: 3, tieBreak: ms };
    }
    if (createdDay >= weekStart) {
        return { label: 'This week', orderRank: 2, tieBreak: ms };
    }
    if (createdDay >= monthStart) {
        return { label: 'This month', orderRank: 1, tieBreak: ms };
    }

    const label = created.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    return { label, orderRank: 0, tieBreak: ms };
}

function getQuizNameGroupKey(quiz) {
    const title = String(quiz.title || '').trim();
    if (!title) return '#';
    const char = title[0].toUpperCase();
    return /[A-Z]/.test(char) ? char : '#';
}

export function filterStudentQuizzes(quizzes, { search = '', typeFilter = 'all', statusFilter = 'all', resultSummary = {} } = {}) {
    const query = String(search || '').trim().toLowerCase();
    let list = [...quizzes];

    if (query) {
        list = list.filter((quiz) => String(quiz.title || '').toLowerCase().includes(query));
    }

    if (typeFilter === 'practice') {
        list = list.filter((quiz) => quiz.mode === 'practice');
    } else if (typeFilter === 'exam') {
        list = list.filter((quiz) => quiz.mode === 'exam');
    }

    if (statusFilter === 'not-completed') {
        list = list.filter((quiz) => !resultSummary[quiz.id]?.completed);
    } else if (statusFilter === 'completed') {
        list = list.filter((quiz) => resultSummary[quiz.id]?.completed);
    }

    return list;
}

export function sortQuizzes(quizzes, sortKey = 'date-desc') {
    const list = [...quizzes];

    list.sort((a, b) => {
        const titleA = String(a.title || '').toLowerCase();
        const titleB = String(b.title || '').toLowerCase();
        const qA = a.questions?.length ?? 0;
        const qB = b.questions?.length ?? 0;
        const dateA = getQuizCreatedMillis(a);
        const dateB = getQuizCreatedMillis(b);

        switch (sortKey) {
            case 'name-asc': return titleA.localeCompare(titleB);
            case 'name-desc': return titleB.localeCompare(titleA);
            case 'date-asc': return dateA - dateB || titleA.localeCompare(titleB);
            case 'questions-desc': return qB - qA || titleA.localeCompare(titleB);
            case 'questions-asc': return qA - qB || titleA.localeCompare(titleB);
            case 'date-desc':
            default:
                return dateB - dateA || titleA.localeCompare(titleB);
        }
    });

    return list;
}

export function groupQuizzes(quizzes, groupBy = 'none', { resultSummary = {} } = {}) {
    if (groupBy === 'none' || !quizzes.length) {
        return [{ title: null, quizzes }];
    }

    const groups = new Map();
    quizzes.forEach((quiz) => {
        if (groupBy === 'name') {
            const key = getQuizNameGroupKey(quiz);
            if (!groups.has(key)) {
                groups.set(key, { quizzes: [], sortKey: key, orderRank: null, tieBreak: 0 });
            }
            groups.get(key).quizzes.push(quiz);
            return;
        }

        if (groupBy === 'status') {
            const completed = resultSummary[quiz.id]?.completed === true;
            const label = completed ? 'Completed' : 'Not completed';
            const orderRank = completed ? 0 : 1;
            if (!groups.has(label)) {
                groups.set(label, { quizzes: [], sortKey: label, orderRank, tieBreak: 0 });
            }
            groups.get(label).quizzes.push(quiz);
            return;
        }

        const { label, orderRank, tieBreak } = getQuizDateGroupInfo(quiz);
        if (!groups.has(label)) {
            groups.set(label, { quizzes: [], sortKey: tieBreak, orderRank, tieBreak });
        }
        const group = groups.get(label);
        group.quizzes.push(quiz);
        group.tieBreak = Math.max(group.tieBreak, tieBreak);
        group.sortKey = group.tieBreak;
    });

    const entries = [...groups.entries()].sort((a, b) => {
        if (groupBy === 'name') {
            if (a[0] === '#') return 1;
            if (b[0] === '#') return -1;
            return a[0].localeCompare(b[0]);
        }
        if (groupBy === 'status') {
            return (b[1].orderRank ?? 0) - (a[1].orderRank ?? 0);
        }
        const rankDiff = (b[1].orderRank ?? 0) - (a[1].orderRank ?? 0);
        if (rankDiff !== 0) return rankDiff;
        return b[1].tieBreak - a[1].tieBreak;
    });

    return entries.map(([title, data]) => ({ title, quizzes: data.quizzes }));
}
