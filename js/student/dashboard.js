import API from '../api.js';
import state from '../state.js';
import { dom, escapeHtml } from '../utils.js';
import { UI, animateCardScoreCircles } from '../ui-components.js';
import { filterStudentQuizzes, sortQuizzes, groupQuizzes } from '../quiz-list-utils.js';
import {
    elements, router, studentDashboardCache, studentTypeFilter, studentStatusFilter, studentAccessFilter,
    STUDENT_QUIZ_SORT_VALUES, STUDENT_QUIZ_GROUP_VALUES, STUDENT_QUIZ_STATUS_VALUES,
    STUDENT_QUIZ_TYPE_VALUES, STUDENT_QUIZ_ACCESS_VALUES,
    STUDENT_QUIZ_LIST_PREFS_KEY, ASSIGNMENTS_CACHE_TTL,
    lastLoadTimestamp, isLoadingAssignments,
    setStudentDashboardCache, setLastLoadTimestamp, setIsLoadingAssignments,
    setStudentTypeFilter, setStudentStatusFilter, setStudentAccessFilter,
    studentSearchTimer, setStudentSearchTimer
} from './state.js';

export function setStudentTypeFilterValue(value) {
    if (!STUDENT_QUIZ_TYPE_VALUES.has(value)) return;
    setStudentTypeFilter(value);
    elements.studentTypeFilterChips?.forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.studentTypeFilter === value);
    });
}

export function setStudentStatusFilterValue(value) {
    if (!STUDENT_QUIZ_STATUS_VALUES.has(value)) return;
    setStudentStatusFilter(value);
    elements.studentStatusFilterChips?.forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.studentStatusFilter === value);
    });
}

export function setStudentAccessFilterValue(value) {
    if (!STUDENT_QUIZ_ACCESS_VALUES.has(value)) return;
    setStudentAccessFilter(value);
    elements.studentAccessFilterChips?.forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.studentAccessFilter === value);
    });
}

export function restoreStudentQuizListPrefs() {
    try {
        const raw = localStorage.getItem(STUDENT_QUIZ_LIST_PREFS_KEY);
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (prefs.sort && STUDENT_QUIZ_SORT_VALUES.has(prefs.sort) && elements.studentQuizSort) {
            elements.studentQuizSort.value = prefs.sort;
        }
        if (prefs.group && STUDENT_QUIZ_GROUP_VALUES.has(prefs.group) && elements.studentQuizGroup) {
            elements.studentQuizGroup.value = prefs.group;
        }
        if (prefs.status && STUDENT_QUIZ_STATUS_VALUES.has(prefs.status)) {
            setStudentStatusFilterValue(prefs.status);
        }
        if (prefs.type && STUDENT_QUIZ_TYPE_VALUES.has(prefs.type)) {
            setStudentTypeFilterValue(prefs.type);
        }
        if (prefs.access && STUDENT_QUIZ_ACCESS_VALUES.has(prefs.access)) {
            setStudentAccessFilterValue(prefs.access);
        }
    } catch {
        /* ignore invalid stored prefs */
    }
}

export function saveStudentQuizListPrefs() {
    try {
        localStorage.setItem(STUDENT_QUIZ_LIST_PREFS_KEY, JSON.stringify({
            sort: elements.studentQuizSort?.value || 'date-desc',
            group: elements.studentQuizGroup?.value || 'none',
            status: studentStatusFilter,
            type: studentTypeFilter,
            access: studentAccessFilter
        }));
    } catch {
        /* ignore quota / private mode */
    }
}

export function getStudentListFilters() {
    return {
        search: elements.studentQuizSearch?.value || '',
        typeFilter: studentTypeFilter,
        statusFilter: studentStatusFilter,
        accessFilter: studentAccessFilter,
        sortKey: elements.studentQuizSort?.value || 'date-desc',
        groupBy: elements.studentQuizGroup?.value || 'none'
    };
}

function getAccessFilteredQuizzes(quizzes, accessFilter, teacherUid) {
    if (accessFilter === 'only-for-you') {
        return quizzes.filter((quiz) => API.isMyQuizForStudent(quiz, teacherUid));
    }
    if (accessFilter === 'shared-for-everyone') {
        return quizzes.filter((quiz) => API.isSharedQuizForStudent(quiz));
    }
    return quizzes;
}

export function getStudentFilteredQuizzes() {
    const filters = getStudentListFilters();
    const accessFiltered = getAccessFilteredQuizzes(
        studentDashboardCache.allQuizzes,
        filters.accessFilter,
        studentDashboardCache.teacherUid
    );
    const filtered = filterStudentQuizzes(accessFiltered, {
        search: filters.search,
        typeFilter: filters.typeFilter,
        statusFilter: filters.statusFilter,
        resultSummary: studentDashboardCache.resultSummary
    });
    return { accessFiltered, filtered, filters };
}

function updateStudentQuizCount(shown, total) {
    const countText = elements.studentQuizCount?.querySelector('.student-quiz-count-text');
    if (!countText) return;
    if (total === 0) {
        countText.textContent = 'No quizzes yet';
        return;
    }
    if (shown === total) {
        countText.textContent = `${total} quiz${total !== 1 ? 'zes' : ''}`;
        return;
    }
    countText.textContent = `Showing ${shown} of ${total} quizzes`;
}

function renderGroupedAssignmentCards(container, sections, createCardFn) {
    dom.setHTML(container, '');
    const hasItems = sections.some((section) => section.quizzes.length > 0);
    if (!hasItems) return false;

    sections.forEach((section) => {
        if (section.title) {
            const group = document.createElement('section');
            group.className = 'student-quiz-group';
            group.innerHTML = `
                <header class="student-quiz-group-header">
                    <h4 class="student-quiz-group-title">${escapeHtml(section.title)}</h4>
                    <span class="student-quiz-group-count">${section.quizzes.length}</span>
                </header>
            `;
            const grid = document.createElement('div');
            grid.className = 'assignments-grid';
            section.quizzes.forEach((quiz) => grid.appendChild(createCardFn(quiz)));
            group.appendChild(grid);
            container.appendChild(group);
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'assignments-grid';
        section.quizzes.forEach((quiz) => grid.appendChild(createCardFn(quiz)));
        container.appendChild(grid);
    });

    return true;
}

function createStudentAssignmentCard(quiz, resultSummary) {
    const summary = resultSummary[quiz.id];
    if (summary?.completed) {
        return UI.createCompletedAssignmentCard(quiz, summary, {
            onReview: () => {
                const resultId = summary.latestResultId;
                if (resultId) router.current?.navigate(`review-${resultId}`);
            },
            onRetake: () => router.current?.navigate(`quiz-${quiz.id}`)
        });
    }
    return UI.createAssignmentCard(quiz, summary, () => {
        router.current?.navigate(`quiz-${quiz.id}`);
    });
}

function renderAssignmentSection(quizzes, resultSummary, {
    listEl,
    emptyEl,
    emptyMessage,
    filters
}) {
    dom.setHTML(listEl, '');
    dom.hide(emptyEl);

    const totalCount = quizzes.length;
    const filtered = sortQuizzes(
        filterStudentQuizzes(quizzes, {
            search: filters.search,
            typeFilter: filters.typeFilter,
            statusFilter: filters.statusFilter,
            resultSummary
        }),
        filters.sortKey
    );

    if (!totalCount) {
        dom.setText(emptyEl, emptyMessage);
        dom.show(emptyEl);
        return { shown: 0, total: 0 };
    }

    if (!filtered.length) {
        dom.setText(emptyEl, 'No quizzes match your filters.');
        dom.show(emptyEl);
        return { shown: 0, total: totalCount };
    }

    const sections = groupQuizzes(filtered, filters.groupBy, { resultSummary });
    const rendered = renderGroupedAssignmentCards(
        listEl,
        sections,
        (quiz) => createStudentAssignmentCard(quiz, resultSummary)
    );
    if (rendered) animateCardScoreCircles(listEl);

    return { shown: filtered.length, total: totalCount };
}

export function refreshStudentDashboard() {
    const { accessFiltered, filtered, filters } = getStudentFilteredQuizzes();

    renderAssignmentSection(
        accessFiltered,
        studentDashboardCache.resultSummary,
        {
            listEl: elements.assignmentsList,
            emptyEl: elements.assignmentsEmpty,
            emptyMessage: 'No quizzes available yet.',
            filters
        }
    );

    updateStudentQuizCount(
        filtered.length,
        studentDashboardCache.allQuizzes.length
    );
}

function scheduleStudentDashboardRefresh() {
    clearTimeout(studentSearchTimer);
    setStudentSearchTimer(setTimeout(() => refreshStudentDashboard(), 200));
}

export function formatProfileDate(timestamp) {
    const date = timestamp?.toDate?.() || (timestamp?.seconds ? new Date(timestamp.seconds * 1000) : null);
    if (!date) return '\u2014';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function renderStudentProfile() {
    const username = state.user.current || 'Student';
    const initial = username.charAt(0).toUpperCase();
    const { allQuizzes, resultSummary, profile } = studentDashboardCache;
    const results = state.quiz.studentResults || [];

    dom.setText(elements.profileAvatar, initial);
    dom.setText(elements.profileUsername, username);
    dom.setText(elements.profileMemberSince, `Member since ${formatProfileDate(profile?.createdAt)}`);

    const completedCount = Object.keys(resultSummary || {}).length;
    const totalAttempts = Object.values(resultSummary || {}).reduce((sum, item) => sum + (item.attempts || 0), 0);
    const avgBestPct = completedCount > 0
        ? Object.values(resultSummary).reduce((sum, item) => sum + (item.bestPct || 0), 0) / completedCount
        : null;

    dom.setText(elements.profileStatQuizzes, String(allQuizzes?.length ?? 0));
    dom.setText(elements.profileStatCompleted, String(completedCount));
    dom.setText(elements.profileStatAttempts, String(totalAttempts));
    dom.setText(elements.profileStatAvg, avgBestPct === null ? '\u2014' : `${Math.round(avgBestPct * 100)}%`);

    const recent = [...results]
        .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))
        .slice(0, 8);

    if (!recent.length) {
        dom.setHTML(elements.profileRecentList, '');
        dom.show(elements.profileRecentEmpty);
        return;
    }

    dom.hide(elements.profileRecentEmpty);
    dom.setHTML(elements.profileRecentList, recent.map((result) => {
        const title = escapeHtml(result.quizTitle || 'Quiz');
        const score = `${result.score ?? 0}/${result.total ?? 0}`;
        const date = formatProfileDate(result.timestamp);
        return `
            <li class="student-profile-activity-item">
                <div class="student-profile-activity-main">
                    <p class="student-profile-activity-title">${title}</p>
                    <p class="student-profile-activity-date">${date}</p>
                </div>
                <span class="student-profile-activity-score">${score}</span>
            </li>
        `;
    }).join(''));
}

export async function loadAssignments(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && lastLoadTimestamp && (now - lastLoadTimestamp < ASSIGNMENTS_CACHE_TTL)) {
        refreshStudentDashboard();
        return;
    }

    if (isLoadingAssignments) return;
    setIsLoadingAssignments(true);

    dom.setHTML(elements.assignmentsList, '');
    dom.hide(elements.assignmentsEmpty);
    dom.show(elements.assignmentsLoader);
    if (elements.studentQuizCount) {
        const countText = elements.studentQuizCount.querySelector('.student-quiz-count-text');
        if (countText) countText.textContent = 'Loading\u2026';
    }

    try {
        const username = state.user.current;
        const profile = await API.getStudentProfile(username);

        if (!profile) {
            throw new Error("Student profile could not be loaded");
        }

        const [assignments, results] = await Promise.all([
            API.getAssignments(username, profile),
            API.getStudentResults(username)
        ]);
        const resultSummary = API.summarizeResultsByQuiz(results);
        state.quiz.setAssignments(assignments);
        state.quiz.setStudentResults(results);

        setStudentDashboardCache({
            allQuizzes: assignments,
            teacherUid: profile?.createdByUid || null,
            resultSummary,
            profile
        });

        setLastLoadTimestamp(Date.now());
        refreshStudentDashboard();
    } catch (err) {
        console.error('Failed to load assignments:', err);
        dom.show(elements.assignmentsEmpty);
    } finally {
        setIsLoadingAssignments(false);
        dom.hide(elements.assignmentsLoader);
    }
}

export function bindDashboardEvents() {
    elements.studentQuizSearch?.addEventListener('input', scheduleStudentDashboardRefresh);
    elements.studentQuizSort?.addEventListener('change', () => {
        saveStudentQuizListPrefs();
        refreshStudentDashboard();
    });
    elements.studentQuizGroup?.addEventListener('change', () => {
        saveStudentQuizListPrefs();
        refreshStudentDashboard();
    });

    elements.studentTypeFilterChips?.forEach((chip) => {
        chip.addEventListener('click', () => {
            setStudentTypeFilterValue(chip.dataset.studentTypeFilter || 'all');
            saveStudentQuizListPrefs();
            refreshStudentDashboard();
        });
    });

    elements.studentStatusFilterChips?.forEach((chip) => {
        chip.addEventListener('click', () => {
            setStudentStatusFilterValue(chip.dataset.studentStatusFilter || 'all');
            saveStudentQuizListPrefs();
            refreshStudentDashboard();
        });
    });

    elements.studentAccessFilterChips?.forEach((chip) => {
        chip.addEventListener('click', () => {
            setStudentAccessFilterValue(chip.dataset.studentAccessFilter || 'all');
            saveStudentQuizListPrefs();
            refreshStudentDashboard();
        });
    });
}
