import { db } from '../firebase-init.js';
import { collection, getDocs, deleteDoc, doc } from '../firebase-init.js';
import { SCREENS, FIREBASE_COLLECTIONS, QUIZ_VISIBILITY, ADMIN_TAB_ROUTES } from '../constants.js';
import { dom, isSubQuizItem, getQuizCreatedMillis } from '../utils.js';
import { UI } from '../ui-components.js';
import { adminState, elements } from './state.js';
import { getTeacherUid, filterVisibleToTeacher, canManageItem } from './auth.js';

export const ADMIN_QUIZ_LIST_PREFS_KEY = 'appquiz_admin_quiz_list_prefs';
export const ADMIN_QUIZ_SORT_VALUES = new Set([
    'date-desc', 'date-asc', 'name-asc', 'name-desc', 'questions-desc', 'questions-asc'
]);
export const ADMIN_QUIZ_GROUP_VALUES = new Set(['none', 'date', 'name']);

let onEditStudentCallback = null;
let onDeleteStudentCallback = null;

export function setStudentCallbacks(onEdit, onDelete) {
    onEditStudentCallback = onEdit;
    onDeleteStudentCallback = onDelete;
}

export function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date) {
    const d = startOfDay(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

export function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getQuizDateGroupInfo(quiz) {
    const ms = getQuizCreatedMillis(quiz);
    if (!ms) return { label: 'Unknown date', orderRank: -1, tieBreak: 0 };
    const created = new Date(ms);
    const now = new Date();
    const createdDay = startOfDay(created).getTime();
    const todayStart = startOfDay(now).getTime();
    const weekStart = startOfWeek(now).getTime();
    const monthStart = startOfMonth(now).getTime();
    if (createdDay >= todayStart) return { label: 'Today', orderRank: 3, tieBreak: ms };
    if (createdDay >= weekStart) return { label: 'This week', orderRank: 2, tieBreak: ms };
    if (createdDay >= monthStart) return { label: 'This month', orderRank: 1, tieBreak: ms };
    const label = created.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    return { label, orderRank: 0, tieBreak: ms };
}

export function getQuizNameGroupKey(quiz) {
    const title = String(quiz.title || '').trim();
    if (!title) return '#';
    const char = title[0].toUpperCase();
    return /[A-Z]/.test(char) ? char : '#';
}

export function dedupeQuizzesById(list) {
    const seen = new Set();
    return list.filter((q) => {
        if (!q?.id || seen.has(q.id)) return false;
        seen.add(q.id);
        return true;
    });
}

export function restoreAdminQuizListPrefs() {
    try {
        const raw = localStorage.getItem(ADMIN_QUIZ_LIST_PREFS_KEY);
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (prefs.sort && ADMIN_QUIZ_SORT_VALUES.has(prefs.sort) && elements.adminQuizSort) {
            elements.adminQuizSort.value = prefs.sort;
        }
        if (prefs.group && ADMIN_QUIZ_GROUP_VALUES.has(prefs.group) && elements.adminQuizGroup) {
            elements.adminQuizGroup.value = prefs.group;
        }
    } catch { }
}

export function saveAdminQuizListPrefs() {
    try {
        localStorage.setItem(ADMIN_QUIZ_LIST_PREFS_KEY, JSON.stringify({
            sort: elements.adminQuizSort?.value || 'date-desc',
            group: elements.adminQuizGroup?.value || 'none'
        }));
    } catch { }
}

export function activateAdminTab(tabId) {
    elements.tabBtns.forEach((btn) => {
        const isActive = btn.dataset.tab === tabId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    elements.tabContents.forEach((panel) => {
        const isActive = panel.id === tabId;
        if (isActive) {
            dom.show(panel);
            setTimeout(() => dom.active(panel), 10);
        } else {
            dom.hide(panel);
            dom.inactive(panel);
        }
    });
}

export function navigateAdminTab(tabId) {
    const route = ADMIN_TAB_ROUTES[tabId];
    if (route) adminState.router?.navigate(route);
}

export async function loadAdminData() {
    if (!db) return;
    loadQuizzes();
    await Promise.all([loadResults(), loadStudents()]);
}

export function filterAndSortQuizzes(quizzes) {
    const search = (elements.adminQuizSearch?.value || '').trim().toLowerCase();
    const typeFilter = elements.adminQuizFilterType?.value || 'all';
    const sortKey = elements.adminQuizSort?.value || 'date-desc';
    let list = [...quizzes];
    if (search) list = list.filter((q) => String(q.title || '').toLowerCase().includes(search));
    if (typeFilter === 'practice') list = list.filter((q) => q.mode === 'practice');
    else if (typeFilter === 'exam') list = list.filter((q) => q.mode === 'exam');
    else if (typeFilter === 'sub-quiz') list = list.filter((q) => isSubQuizItem(q));
    else if (typeFilter === 'hidden') list = list.filter((q) => (q.visibility || 'all') === QUIZ_VISIBILITY.HIDDEN);
    list = dedupeQuizzesById(list);
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
            default: return dateB - dateA || titleA.localeCompare(titleB);
        }
    });
    return list;
}

export function groupQuizzes(quizzes, groupBy) {
    if (groupBy === 'none' || !quizzes.length) return [{ title: null, quizzes }];
    const groups = new Map();
    quizzes.forEach((quiz) => {
        if (groupBy === 'name') {
            const key = getQuizNameGroupKey(quiz);
            if (!groups.has(key)) groups.set(key, { quizzes: [], sortKey: key, orderRank: null, tieBreak: 0 });
            groups.get(key).quizzes.push(quiz);
            return;
        }
        const { label, orderRank, tieBreak } = getQuizDateGroupInfo(quiz);
        if (!groups.has(label)) groups.set(label, { quizzes: [], sortKey: tieBreak, orderRank, tieBreak });
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
        const rankDiff = (b[1].orderRank ?? 0) - (a[1].orderRank ?? 0);
        if (rankDiff !== 0) return rankDiff;
        return b[1].tieBreak - a[1].tieBreak;
    });
    return entries.map(([title, data]) => ({ title, quizzes: data.quizzes }));
}

export function updateAdminQuizCount(shown, total) {
    if (!elements.adminQuizCount) return;
    if (total === 0) { elements.adminQuizCount.textContent = 'No quizzes yet'; return; }
    if (shown === total) { elements.adminQuizCount.textContent = `${total} quiz${total !== 1 ? 'zes' : ''}`; return; }
    elements.adminQuizCount.textContent = `Showing ${shown} of ${total} quizzes`;
}

export function pruneQuizSelection() {
    adminState.selectedQuizIds = new Set([...adminState.selectedQuizIds].filter((id) => adminState.quizzesById[id]));
}

export function getVisibleFilteredQuizzes() {
    return filterAndSortQuizzes(adminState.adminQuizCache);
}

export function setQuizSelected(id, checked) {
    if (!id) return;
    if (checked) adminState.selectedQuizIds.add(id);
    else adminState.selectedQuizIds.delete(id);
    renderAdminQuizList();
}

export function setSelectAllVisibleQuizzes(checked) {
    const visible = getVisibleFilteredQuizzes();
    visible.forEach((q) => {
        if (checked) adminState.selectedQuizIds.add(q.id);
        else adminState.selectedQuizIds.delete(q.id);
    });
    renderAdminQuizList();
}

export function clearQuizSelection() {
    adminState.selectedQuizIds.clear();
    renderAdminQuizList();
}

export function updateQuizSelectionUI(visibleQuizzes) {
    const visibleIds = visibleQuizzes.map((q) => q.id);
    const selectedVisible = visibleIds.filter((id) => adminState.selectedQuizIds.has(id));
    if (elements.adminQuizBulkBar) {
        if (adminState.adminQuizCache.length > 0) dom.show(elements.adminQuizBulkBar);
        else dom.hide(elements.adminQuizBulkBar);
    }
    if (elements.adminQuizBulkActions) {
        if (adminState.selectedQuizIds.size > 0) dom.show(elements.adminQuizBulkActions);
        else dom.hide(elements.adminQuizBulkActions);
    }
    if (elements.adminQuizSelectedCount) {
        elements.adminQuizSelectedCount.textContent = `${adminState.selectedQuizIds.size} selected`;
    }
    if (elements.adminQuizSelectAll) {
        const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
        elements.adminQuizSelectAll.checked = allSelected;
        elements.adminQuizSelectAll.indeterminate = selectedVisible.length > 0 && !allSelected;
    }
}

export function renderAdminQuizList() {
    pruneQuizSelection();
    const token = ++adminState.adminQuizRenderToken;
    const total = adminState.adminQuizCache.length;
    const filtered = getVisibleFilteredQuizzes();
    const groupBy = elements.adminQuizGroup?.value || 'none';
    const sections = groupQuizzes(filtered, groupBy);
    updateAdminQuizCount(filtered.length, total);
    updateQuizSelectionUI(filtered);
    if (total === 0) {
        dom.setHTML(elements.adminQuizzesList, `
            <div class="admin-quiz-empty">
                <i class="fas fa-folder-open" aria-hidden="true"></i>
                <p>No quizzes found. Create your first one!</p>
            </div>
        `);
        return;
    }
    const html = UI.buildAdminQuizListHTML(sections, adminState.selectedQuizIds);
    if (token !== adminState.adminQuizRenderToken) return;
    dom.setHTML(elements.adminQuizzesList, html);
}

export async function bulkDeleteQuizzes() {
    const uid = getTeacherUid();
    const ids = [...adminState.selectedQuizIds].filter((id) => canManageItem(adminState.quizzesById[id], uid));
    if (ids.length !== adminState.selectedQuizIds.size) {
        alert('Some selected quizzes were skipped because you do not own them.');
        ids.forEach((id) => adminState.selectedQuizIds.delete(id));
        updateQuizSelectionUI();
    }
    if (!ids.length || !db) return;
    const label = `${ids.length} quiz${ids.length !== 1 ? 'zes' : ''}`;
    if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
    try {
        await Promise.all(ids.map((id) => deleteDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, id))));
        ids.forEach((id) => {
            delete adminState.quizzesById[id];
            adminState.selectedQuizIds.delete(id);
        });
        if (adminState.viewingQuizId && !adminState.quizzesById[adminState.viewingQuizId]) {
            adminState.viewingQuizId = null;
            adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
        } else {
            loadQuizzes();
        }
    } catch (err) {
        console.error(err);
        alert('Error deleting quizzes');
    }
}

export async function loadQuizzes() {
    dom.setHTML(elements.adminQuizzesList, UI.buildAdminQuizListSkeleton());
    if (elements.adminQuizCount) elements.adminQuizCount.textContent = 'Loading quizzes…';
    const snapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.QUIZZES));
    adminState.adminQuizCache = [];
    adminState.quizzesById = {};
    snapshot.forEach((docSnap) => {
        const quiz = { id: docSnap.id, ...docSnap.data() };
        adminState.quizzesById[docSnap.id] = quiz;
        adminState.adminQuizCache.push(quiz);
    });
    adminState.adminQuizCache = dedupeQuizzesById(filterVisibleToTeacher(adminState.adminQuizCache));
    Object.keys(adminState.quizzesById).forEach((id) => {
        if (!adminState.adminQuizCache.some((q) => q.id === id)) delete adminState.quizzesById[id];
    });
    renderAdminQuizList();
}

export function getVisibilityLabel(visibility, assignedStudents = []) {
    if (visibility === QUIZ_VISIBILITY.HIDDEN) return 'Hidden';
    if (visibility === QUIZ_VISIBILITY.MY_STUDENTS) return 'My students';
    if (visibility === QUIZ_VISIBILITY.SPECIFIC) return `Specific (${assignedStudents.length} students)`;
    return 'All students';
}

export async function loadQuizzesMap() {
    adminState.adminQuizCache = [];
    adminState.quizzesById = {};
    const snapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.QUIZZES));
    snapshot.forEach((docSnap) => {
        const quiz = { id: docSnap.id, ...docSnap.data() };
        adminState.quizzesById[docSnap.id] = quiz;
        adminState.adminQuizCache.push(quiz);
    });
    adminState.adminQuizCache = dedupeQuizzesById(filterVisibleToTeacher(adminState.adminQuizCache));
    Object.keys(adminState.quizzesById).forEach((id) => {
        if (!adminState.adminQuizCache.some((q) => q.id === id)) delete adminState.quizzesById[id];
    });
}

export function renderResultsTable() {
    if (!elements.adminResultsTable) return;
    if (!adminState.adminResultsCache.length) {
        dom.setHTML(elements.adminResultsTable, '<tr><td colspan="7" class="text-center p-8 text-muted">No results recorded yet.</td></tr>');
        if (elements.adminResultsSelectAll) { elements.adminResultsSelectAll.checked = false; elements.adminResultsSelectAll.indeterminate = false; }
        dom.hide(elements.adminResultsBulkBar);
        return;
    }
    dom.setHTML(elements.adminResultsTable, '');
    adminState.adminResultsCache.forEach((data) => {
        const hasAnswers = data.answers && Object.keys(data.answers).length > 0;
        const row = UI.createResultRow(data, (resultData) => {
            if (resultData?.id) adminState.router?.navigate(`admin-result-${resultData.id}`);
        }, {
            selectable: true,
            selected: adminState.selectedResultIds.has(data.id),
            onSelectChange: hasAnswers ? (id, checked) => {
                if (checked) adminState.selectedResultIds.add(id);
                else adminState.selectedResultIds.delete(id);
                updateResultsSelectionUI();
            } : null
        });
        if (!hasAnswers) {
            const cb = row.querySelector('.admin-result-select-cb');
            if (cb) { cb.disabled = true; cb.title = 'No saved answers for this attempt'; }
        }
        elements.adminResultsTable.appendChild(row);
    });
    updateResultsSelectionUI();
}

export function updateResultsSelectionUI() {
    const selectable = getSelectableResults();
    const selectableIds = selectable.map((r) => r.id);
    const selectedVisible = selectableIds.filter((id) => adminState.selectedResultIds.has(id));
    if (elements.adminResultsBulkBar) {
        if (adminState.selectedResultIds.size > 0) dom.show(elements.adminResultsBulkBar);
        else dom.hide(elements.adminResultsBulkBar);
    }
    if (elements.adminResultsSelectedCount) {
        dom.setText(elements.adminResultsSelectedCount, `${adminState.selectedResultIds.size} selected`);
    }
    if (elements.adminResultsSelectAll) {
        const allVisibleSelected = selectableIds.length > 0 && selectedVisible.length === selectableIds.length;
        elements.adminResultsSelectAll.checked = allVisibleSelected;
        elements.adminResultsSelectAll.indeterminate = selectedVisible.length > 0 && !allVisibleSelected;
    }
}

export function getSelectableResults() {
    return adminState.adminResultsCache.filter((r) => r.answers && Object.keys(r.answers).length > 0);
}

export function clearResultSelection() {
    adminState.selectedResultIds.clear();
    updateResultsSelectionUI();
    renderResultsTable();
}

export async function loadResults() {
    dom.setHTML(elements.adminResultsTable, '<tr><td colspan="7" class="text-center p-8">Loading results...</td></tr>');
    await loadQuizzesMap();
    const snapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.RESULTS));
    if (snapshot.empty) { adminState.adminResultsCache = []; renderResultsTable(); return; }
    const results = [];
    snapshot.forEach((docSnap) => results.push({ id: docSnap.id, ...docSnap.data() }));
    const ownedQuizIds = new Set(adminState.adminQuizCache.map((q) => q.id));
    adminState.adminResultsCache = results.filter((r) => ownedQuizIds.has(r.quizId));
    adminState.adminResultsCache.sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() ?? 0;
        const tb = b.timestamp?.toMillis?.() ?? 0;
        return tb - ta;
    });
    adminState.selectedResultIds = new Set([...adminState.selectedResultIds].filter((id) =>
        adminState.adminResultsCache.some((r) => r.id === id)
    ));
    renderResultsTable();
}

export async function loadStudents() {
    dom.setHTML(elements.adminStudentsList, UI.buildStudentsListSkeleton());
    if (elements.adminStudentCount) dom.setText(elements.adminStudentCount, 'Loading students…');
    const snapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.STUDENTS));
    adminState.allStudents = [];
    snapshot.forEach((docSnap) => { adminState.allStudents.push({ id: docSnap.id, ...docSnap.data() }); });
    adminState.allStudents = filterVisibleToTeacher(adminState.allStudents);
    adminState.allStudents.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
    renderStudentsList();
}

function getFilteredStudents() {
    const search = (elements.adminStudentSearch?.value || '').trim().toLowerCase();
    if (!search) return adminState.allStudents;
    return adminState.allStudents.filter((student) =>
        String(student.username || '').toLowerCase().includes(search)
    );
}

function updateStudentCount(filteredCount, totalCount) {
    if (!elements.adminStudentCount) return;
    if (totalCount === 0) { dom.setText(elements.adminStudentCount, 'No students yet'); return; }
    if (filteredCount === totalCount) { dom.setText(elements.adminStudentCount, `${totalCount} student${totalCount === 1 ? '' : 's'}`); return; }
    dom.setText(elements.adminStudentCount, `Showing ${filteredCount} of ${totalCount} students`);
}

export function renderStudentsList() {
    const total = adminState.allStudents.length;
    const filtered = getFilteredStudents();
    updateStudentCount(filtered.length, total);
    if (total === 0) { dom.setHTML(elements.adminStudentsList, UI.buildStudentsEmptyHTML()); return; }
    if (!filtered.length) { dom.setHTML(elements.adminStudentsList, UI.buildStudentsEmptyHTML({ hasSearch: true })); return; }
    dom.setHTML(elements.adminStudentsList, '');
    filtered.forEach((data) => {
        const item = UI.createStudentItem(data, {
            onEdit: onEditStudentCallback,
            onDelete: onDeleteStudentCallback
        });
        elements.adminStudentsList.appendChild(item);
    });
}
