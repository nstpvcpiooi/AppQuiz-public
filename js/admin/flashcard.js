import API from '../api.js';
import { dom, initCustomSelect } from '../utils.js';
import { adminState } from './state.js';
import { getTeacherUid, getTeacherOwnerFields } from './auth.js';

let flashcardSets = [];
let editingSetId = null;
const selectedSetIds = new Set();
let assignFlashcardIds = [];

const elements = {
    list: document.getElementById('admin-flashcard-list'),
    search: document.getElementById('admin-flashcard-search'),
    sort: document.getElementById('admin-flashcard-sort'),
    group: document.getElementById('admin-flashcard-group'),
    count: document.getElementById('admin-flashcard-count'),
    createBtn: document.getElementById('btn-create-flashcard'),
    // Bulk bar
    bulkBar: document.getElementById('admin-flashcard-bulk-bar'),
    selectAll: document.getElementById('admin-flashcard-select-all'),
    selectedCount: document.getElementById('admin-flashcard-selected-count'),
    bulkActions: document.getElementById('admin-flashcard-bulk-actions'),
    bulkDelete: document.getElementById('admin-flashcard-bulk-delete'),
    bulkAccess: document.getElementById('admin-flashcard-bulk-access'),
    clearSelection: document.getElementById('admin-flashcard-clear-selection'),
    // Editor
    editorScreen: document.getElementById('admin-flashcard-editor-screen'),
    feBackBtn: document.getElementById('fe-back-btn'),
    feSaveBtn: document.getElementById('fe-save-btn'),
    feTitle: document.getElementById('fe-title'),
    feCardsContainer: document.getElementById('fe-cards-container'),
    feAddCardBtn: document.getElementById('fe-add-card-btn'),
    fePageTitle: document.getElementById('fe-page-title'),
    feVisibility: document.getElementById('fe-visibility'),
    feStudentsPanel: document.getElementById('fe-students-panel'),
    feStudentsList: document.getElementById('fe-students-list'),
    // Assign modal
    fcAssignModal: document.getElementById('fc-assign-modal'),
    fcAssignModalBackdrop: document.getElementById('fc-assign-modal-backdrop'),
    fcAssignModalClose: document.getElementById('fc-assign-modal-close'),
    fcAssignCancelBtn: document.getElementById('fc-assign-cancel-btn'),
    fcAssignSaveBtn: document.getElementById('fc-assign-save-btn'),
    fcAssignModalName: document.getElementById('fc-assign-modal-name'),
    fcAssignModalTitle: document.getElementById('fc-assign-modal-title'),
    fcAssignStudentsPanel: document.getElementById('fc-assign-students-panel'),
    fcAssignStudentsList: document.getElementById('fc-assign-students-list'),
    fcAssignSelectedCount: document.getElementById('fc-assign-selected-count')
};

function normalizeUsername(u) {
    return String(u || '').trim().toLowerCase();
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(ts) {
    if (!ts) return '—';
    const d = ts?.toDate?.() || (ts?.seconds ? new Date(ts.seconds * 1000) : null);
    if (!d) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getTs(obj) {
    const ts = obj.createdAt;
    if (!ts) return 0;
    if (ts?.toDate) return ts.toDate().getTime();
    if (ts?.seconds) return ts.seconds * 1000;
    return 0;
}

// ── Load ───────────────────────────────────────────────

export async function loadFlashcardSets() {
    const uid = getTeacherUid();
    if (!uid) return;
    dom.setHTML(elements.list, '<div class="dashboard-loader"><div class="spinner"></div><p>Loading...</p></div>');
    flashcardSets = await API.getTeacherFlashcardSets(uid);
    renderFlashcardList();
}

// ── Filter / Sort / Group ──────────────────────────────

function getVisibleFilteredSets() {
    const search = (elements.search?.value || '').trim().toLowerCase();
    const sortVal = elements.sort?.value || 'date-desc';
    let filtered = flashcardSets;
    if (search) filtered = filtered.filter(s => (s.title || '').toLowerCase().includes(search));
    return sortFlashcardSets(filtered, sortVal);
}

function sortFlashcardSets(sets, sortVal) {
    const sorted = [...sets];
    switch (sortVal) {
        case 'date-asc': sorted.sort((a, b) => getTs(a) - getTs(b)); break;
        case 'name-asc': sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
        case 'name-desc': sorted.sort((a, b) => (b.title || '').localeCompare(a.title || '')); break;
        case 'cards-desc': sorted.sort((a, b) => (b.cards || []).length - (a.cards || []).length); break;
        case 'cards-asc': sorted.sort((a, b) => (a.cards || []).length - (b.cards || []).length); break;
        default: sorted.sort((a, b) => getTs(b) - getTs(a));
    }
    return sorted;
}

function groupSets(sets, groupBy) {
    if (groupBy === 'none' || !sets.length) return [{ title: null, quizzes: sets }];
    const groups = new Map();
    sets.forEach((set) => {
        if (groupBy === 'name') {
            const title = String(set.title || '').trim();
            const firstChar = title ? title[0].toUpperCase() : '#';
            const groupKey = /[A-Z]/.test(firstChar) ? firstChar : '#';
            if (!groups.has(groupKey)) groups.set(groupKey, { quizzes: [], sortKey: groupKey });
            groups.get(groupKey).quizzes.push(set);
            return;
        }
        const ms = getTs(set);
        let label, orderRank, tieBreak;
        if (!ms) { label = 'Unknown date'; orderRank = -1; tieBreak = 0; }
        else {
            const d = new Date(ms);
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const weekStart = todayStart - now.getDay() * 86400000;
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
            tieBreak = ms;
            if (ms >= todayStart) { label = 'Today'; orderRank = 3; }
            else if (ms >= weekStart) { label = 'This week'; orderRank = 2; }
            else if (ms >= monthStart) { label = 'This month'; orderRank = 1; }
            else { label = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' }); orderRank = 0; }
        }
        if (!groups.has(label)) groups.set(label, { quizzes: [], sortKey: orderRank, orderRank, tieBreak });
        const g = groups.get(label);
        g.quizzes.push(set);
        g.tieBreak = Math.max(g.tieBreak, tieBreak);
        g.sortKey = g.tieBreak;
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

// ── Render ─────────────────────────────────────────────

function renderFlashcardList() {
    pruneSelection();
    const total = flashcardSets.length;
    const filtered = getVisibleFilteredSets();
    const groupBy = elements.group?.value || 'none';
    const sections = groupSets(filtered, groupBy);
    updateCount(filtered.length, total);
    updateBulkBarUI(filtered);
    if (!total) {
        dom.setHTML(elements.list, `
            <div class="admin-quiz-empty">
                <i class="fas fa-clone" aria-hidden="true"></i>
                <p>No flashcard sets yet. Create your first one!</p>
            </div>
        `);
        return;
    }
    if (!filtered.length) {
        dom.setHTML(elements.list, `
            <div class="admin-quiz-empty">
                <i class="fas fa-search" aria-hidden="true"></i>
                <p>No sets match your search.</p>
            </div>
        `);
        return;
    }
    dom.setHTML(elements.list, sections.map(section => {
        const rows = section.quizzes.map(set => buildRowHtml(set)).join('');
        if (!section.title) return `<div class="admin-quiz-rows" role="list">${rows}</div>`;
        return `
            <section class="admin-quiz-group">
                <header class="admin-quiz-group-header">
                    <h4 class="admin-quiz-group-title">${escHtml(section.title)}</h4>
                    <span class="admin-quiz-group-count">${section.quizzes.length}</span>
                </header>
                <div class="admin-quiz-rows" role="list">${rows}</div>
            </section>
        `;
    }).join(''));
}

function buildRowHtml(set) {
    const isSelected = selectedSetIds.has(set.id);
    const cardCount = (set.cards || []).length;
    const visibility = set.visibility || 'my_students';
    let visLabel = 'All students';
    let visClass = 'is-all';
    if (visibility === 'hidden') { visLabel = 'Hidden'; visClass = 'is-hidden'; }
    else if (visibility === 'my_students') { visLabel = 'My students'; visClass = 'is-my-students'; }
    else if (visibility === 'specific') { visLabel = `${(set.assignedStudents || []).length} students`; visClass = 'is-specific'; }
    const title = set.title || 'Untitled set';
    return `
        <article class="admin-quiz-row${isSelected ? ' is-selected' : ''}" data-set-id="${escHtml(set.id)}" role="listitem" tabindex="0" aria-label="Open ${escHtml(title)}">
            <label class="admin-quiz-row-check" aria-label="Select ${escHtml(title)}">
                <input type="checkbox" class="admin-flashcard-row-checkbox" data-set-id="${escHtml(set.id)}"${isSelected ? ' checked' : ''}>
            </label>
            <div class="admin-quiz-row-icon" aria-hidden="true">📇</div>
            <div class="admin-quiz-row-body">
                <h4 class="admin-quiz-row-title">${escHtml(title)}</h4>
                <div class="admin-quiz-row-pills">
                    <span class="admin-quiz-pill is-neutral">${cardCount} card${cardCount !== 1 ? 's' : ''}</span>
                    <span class="admin-quiz-pill ${visClass}">${escHtml(visLabel)}</span>
                </div>
            </div>
            <div class="admin-quiz-row-aside">
                <span class="admin-quiz-row-date">${formatDate(set.createdAt)}</span>
                <i class="fas fa-chevron-right admin-quiz-row-chevron" aria-hidden="true"></i>
            </div>
        </article>
    `;
}

function updateCount(shown, total) {
    if (!elements.count) return;
    if (total === 0) { elements.count.textContent = 'No sets yet'; return; }
    if (shown === total) { elements.count.textContent = `${total} set${total !== 1 ? 's' : ''}`; return; }
    elements.count.textContent = `Showing ${shown} of ${total} sets`;
}

// ── Selection / Bulk Bar ───────────────────────────────

function pruneSelection() {
    const ids = new Set(flashcardSets.map(s => s.id));
    for (const id of selectedSetIds) { if (!ids.has(id)) selectedSetIds.delete(id); }
}

function updateBulkBarUI(visibleSets) {
    const visibleIds = visibleSets.map(s => s.id);
    const selectedVisible = visibleIds.filter(id => selectedSetIds.has(id));
    if (elements.bulkBar) {
        if (flashcardSets.length > 0) dom.show(elements.bulkBar);
        else dom.hide(elements.bulkBar);
    }
    if (elements.bulkActions) {
        if (selectedSetIds.size > 0) dom.show(elements.bulkActions);
        else dom.hide(elements.bulkActions);
    }
    if (elements.selectedCount) {
        elements.selectedCount.textContent = `${selectedSetIds.size} selected`;
    }
    if (elements.selectAll) {
        const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
        elements.selectAll.checked = allSelected;
        elements.selectAll.indeterminate = selectedVisible.length > 0 && !allSelected;
    }
}

function setSetSelected(id, checked) {
    if (!id) return;
    if (checked) selectedSetIds.add(id);
    else selectedSetIds.delete(id);
    renderFlashcardList();
}

function setSelectAllVisible(checked) {
    const visible = getVisibleFilteredSets();
    visible.forEach(s => {
        if (checked) selectedSetIds.add(s.id);
        else selectedSetIds.delete(s.id);
    });
    renderFlashcardList();
}

function clearSelection() {
    selectedSetIds.clear();
    renderFlashcardList();
}

async function bulkDeleteSets() {
    const ids = [...selectedSetIds];
    if (!ids.length) return;
    const label = `${ids.length} set${ids.length !== 1 ? 's' : ''}`;
    if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
    try {
        const results = await Promise.allSettled(ids.map(id => API.deleteFlashcardSet(id)));
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length) console.error('Bulk delete failures:', failed);
        selectedSetIds.clear();
        await loadFlashcardSets();
    } catch (err) {
        console.error(err);
        alert('Error deleting sets');
    }
}

// ── Editor ────────────────────────────────────────────

function openEditor(setId = null) {
    editingSetId = setId;
    elements.feTitle.value = '';
    elements.feVisibility.value = 'my_students';
    dom.hide(elements.feStudentsPanel);
    dom.setHTML(elements.feCardsContainer, '');
    if (setId) {
        const set = flashcardSets.find(s => s.id === setId);
        if (set) {
            elements.fePageTitle.textContent = 'Edit flashcard set';
            elements.feTitle.value = set.title || '';
            const visibility = set.visibility || 'my_students';
            elements.feVisibility.value = visibility;
            if (visibility === 'specific') {
                renderEditorStudentsList(set.assignedStudents || []);
                dom.show(elements.feStudentsPanel);
            }
            (set.cards || []).forEach(c => addCardRow(c.front, c.back));
            return;
        }
    }
    elements.fePageTitle.textContent = 'Create flashcard set';
    renderEditorStudentsList([]);
    addCardRow();
    addCardRow();
}

function renderEditorStudentsList(selectedUsernames = []) {
    const students = adminState.allStudents || [];
    const selected = new Set(selectedUsernames.map(normalizeUsername));
    if (!students.length) {
        dom.setHTML(elements.feStudentsList, '<p class="text-muted" style="padding:1rem;">No students available. Add students first.</p>');
        return;
    }
    dom.setHTML(elements.feStudentsList, students.map(s => {
        const username = normalizeUsername(s.username);
        const checked = selected.has(username) ? 'checked' : '';
        return `
            <label class="assign-student-row">
                <input type="checkbox" class="fe-student-cb" value="${escHtml(username)}" ${checked}>
                <span>${escHtml(username)}</span>
            </label>
        `;
    }).join(''));
}

function addCardRow(front = '', back = '') {
    const idx = elements.feCardsContainer.children.length;
    const card = document.createElement('div');
    card.className = 'fe-card';
    card.draggable = true;
    card.dataset.index = idx;
    card.innerHTML = `
        <span class="fe-drag-handle" aria-label="Drag to reorder"><i class="fas fa-grip-lines"></i></span>
        <span class="fe-card-index">${idx + 1}</span>
        <textarea id="fe-front-${idx}" class="input-full fe-front-input" placeholder="Word" autocomplete="off" rows="1">${escHtml(front)}</textarea>
        <span class="fe-card-divider"></span>
        <textarea id="fe-back-${idx}" class="input-full fe-back-input" placeholder="Meaning" autocomplete="off" rows="1">${escHtml(back)}</textarea>
        <button type="button" class="fe-remove-card" title="Remove card">
            <i class="fas fa-trash"></i>
        </button>
    `;
    elements.feCardsContainer.appendChild(card);

    // Auto-resize textareas
    card.querySelectorAll('textarea').forEach(ta => {
        ta.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
        // Initial resize
        setTimeout(() => {
            ta.style.height = 'auto';
            ta.style.height = (ta.scrollHeight) + 'px';
        }, 0);
    });

    // Remove
    card.querySelector('.fe-remove-card').addEventListener('click', () => {
        if (elements.feCardsContainer.children.length <= 1) {
            card.querySelector('.fe-front-input').value = '';
            card.querySelector('.fe-back-input').value = '';
            card.querySelector('.fe-front-input').focus();
            return;
        }
        card.classList.add('removing');
        setTimeout(() => { card.remove(); reindexCards(); }, 220);
    });

    // Drag events
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.index);
        setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        elements.feCardsContainer.querySelectorAll('.fe-card').forEach(c => {
            c.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    });
    card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dragging = elements.feCardsContainer.querySelector('.dragging');
        if (!dragging || dragging === card) return;
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        elements.feCardsContainer.querySelectorAll('.fe-card').forEach(c => {
            c.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        if (e.clientY < mid) {
            card.classList.add('drag-over-top');
        } else {
            card.classList.add('drag-over-bottom');
        }
    });
    card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget)) {
            card.classList.remove('drag-over-top', 'drag-over-bottom');
        }
    });
    card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over-top', 'drag-over-bottom');
        const dragging = elements.feCardsContainer.querySelector('.dragging');
        if (!dragging || dragging === card) return;
        const container = elements.feCardsContainer;
        const allCards = [...container.querySelectorAll('.fe-card')];
        const fromIdx = allCards.indexOf(dragging);
        const toIdx = allCards.indexOf(card);
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
            card.before(dragging);
        } else {
            card.after(dragging);
        }
        reindexCards();
    });

    // Tab key: front → back → next card front
    const frontInput = card.querySelector('.fe-front-input');
    const backInput = card.querySelector('.fe-back-input');
    frontInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            backInput.focus();
        } else if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            const prev = card.previousElementSibling;
            if (prev && prev.classList.contains('fe-card')) {
                prev.querySelector('.fe-back-input').focus();
            }
        }
    });
    backInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const next = card.nextElementSibling;
            if (next && next.classList.contains('fe-card')) {
                next.querySelector('.fe-front-input').focus();
            } else {
                addCardRow();
                elements.feCardsContainer.lastElementChild.querySelector('.fe-front-input').focus();
            }
        } else if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            frontInput.focus();
        }
    });

    reindexCards();
    return card;
}

function reindexCards() {
    elements.feCardsContainer.querySelectorAll('.fe-card').forEach((card, i) => {
        card.dataset.index = i;
        const idxEl = card.querySelector('.fe-card-index');
        if (idxEl) idxEl.textContent = i + 1;
        const frontInput = card.querySelector('.fe-front-input');
        const backInput = card.querySelector('.fe-back-input');
        if (frontInput) frontInput.id = `fe-front-${i}`;
        if (backInput) backInput.id = `fe-back-${i}`;
    });
}

function getCardsFromEditor() {
    const cards = [];
    elements.feCardsContainer.querySelectorAll('.fe-card').forEach(card => {
        const front = card.querySelector('.fe-front-input').value.trim();
        const back = card.querySelector('.fe-back-input').value.trim();
        if (front || back) cards.push({ front, back });
    });
    return cards;
}

async function saveEditor() {
    const title = elements.feTitle.value.trim();
    const description = '';
    const cards = getCardsFromEditor();
    if (!title) { alert('Please enter a set title.'); return; }
    if (!cards.length) { alert('Please add at least one card.'); return; }
    const uid = getTeacherUid();
    if (!uid) { alert('You must be logged in as a teacher.'); return; }
    const visibility = elements.feVisibility?.value || 'my_students';
    let assignedStudents = [];
    if (visibility === 'specific') {
        const checked = elements.feStudentsList.querySelectorAll('.fe-student-cb:checked');
        assignedStudents = Array.from(checked).map(cb => normalizeUsername(cb.value));
    }
    const payload = {
        title, description, cards, visibility, assignedStudents,
        creatorType: 'teacher', ...getTeacherOwnerFields()
    };
    elements.feSaveBtn.disabled = true;
    try {
        if (editingSetId) {
            const result = await API.updateFlashcardSet(editingSetId, payload);
            if (!result.success) throw new Error(result.error);
        } else {
            const result = await API.createFlashcardSet(payload);
            if (!result.success) throw new Error(result.error);
        }
        adminState.router?.navigate('admin-dashboard-flashcard');
    } catch (err) {
        console.error(err);
        alert('Error saving: ' + err.message);
    } finally {
        elements.feSaveBtn.disabled = false;
    }
}

async function deleteSet(setId) {
    const set = flashcardSets.find(s => s.id === setId);
    if (!set) return;
    if (!confirm(`Delete "${set.title || 'Untitled'}"? This cannot be undone.`)) return;
    const result = await API.deleteFlashcardSet(setId);
    if (result.success) {
        flashcardSets = flashcardSets.filter(s => s.id !== setId);
        selectedSetIds.delete(setId);
        renderFlashcardList();
    } else {
        alert('Error deleting: ' + result.error);
    }
}

// ── Assign / Manage Access Modal ──────────────────────

function getFcVisibility() {
    const checked = document.querySelector('input[name="fc-assign-visibility"]:checked');
    return checked?.value || 'my_students';
}

function setFcVisibility(value) {
    const radio = document.querySelector(`input[name="fc-assign-visibility"][value="${value}"]`);
    if (radio) radio.checked = true;
    updateFcAssignModalVisibilityPanel();
}

function updateFcAssignModalVisibilityPanel() {
    const vis = getFcVisibility();
    if (vis === 'specific') {
        dom.show(elements.fcAssignStudentsPanel);
    } else {
        dom.hide(elements.fcAssignStudentsPanel);
    }
}

function updateFcAssignSelectedCount() {
    const checked = elements.fcAssignStudentsList.querySelectorAll('.fc-assign-student-cb:checked');
    if (elements.fcAssignSelectedCount) {
        elements.fcAssignSelectedCount.textContent = `${checked.length} selected`;
    }
}

function openFcAssignModal(ids) {
    assignFlashcardIds = ids;
    const sets = ids.map(id => flashcardSets.find(s => s.id === id)).filter(Boolean);
    if (!sets.length) return;

    // Set title/name
    if (sets.length === 1) {
        dom.setText(elements.fcAssignModalName, sets[0].title || 'Untitled set');
        dom.setText(elements.fcAssignModalTitle, 'Manage Flashcard Access');
    } else {
        dom.setText(elements.fcAssignModalName, `${sets.length} sets selected`);
        dom.setText(elements.fcAssignModalTitle, 'Manage Flashcard Access');
    }

    // Derive initial visibility
    const visibilities = new Set(sets.map(s => s.visibility || 'my_students'));
    let initialVis = 'my_students', initialStudents = [];
    if (visibilities.size === 1) {
        initialVis = [...visibilities][0];
        if (initialVis === 'specific') {
            initialStudents = [...new Set(sets.flatMap(s => s.assignedStudents || []))];
        }
    }
    setFcVisibility(initialVis);
    renderFcAssignStudentList(initialStudents);
    dom.show(elements.fcAssignModal);
    elements.fcAssignModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function closeFcAssignModal() {
    dom.hide(elements.fcAssignModal);
    elements.fcAssignModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    assignFlashcardIds = [];
}

function renderFcAssignStudentList(selectedUsernames = []) {
    const students = adminState.allStudents || [];
    const selected = new Set(selectedUsernames.map(normalizeUsername));
    if (!students.length) {
        dom.setHTML(elements.fcAssignStudentsList, '<p class="text-muted" style="padding:1rem;">No students available. Add students first.</p>');
        return;
    }
    dom.setHTML(elements.fcAssignStudentsList, students.map(s => {
        const username = normalizeUsername(s.username);
        const checked = selected.has(username) ? 'checked' : '';
        return `
            <label class="assign-student-row student-checkbox-item">
                <input type="checkbox" class="fc-assign-student-cb" value="${escHtml(username)}" ${checked}>
                <span>${escHtml(username)}</span>
            </label>
        `;
    }).join(''));
    updateFcAssignSelectedCount();
}

async function saveFcAssignModal() {
    if (!assignFlashcardIds.length) return;
    const visibility = getFcVisibility();
    let assignedStudents = [];
    if (visibility === 'specific') {
        const checked = elements.fcAssignStudentsList.querySelectorAll('.fc-assign-student-cb:checked');
        assignedStudents = Array.from(checked).map(cb => normalizeUsername(cb.value));
        if (!assignedStudents.length) {
            alert('Please select at least one student, or choose a different visibility option.');
            return;
        }
    }
    const payload = { visibility, assignedStudents };
    elements.fcAssignSaveBtn.disabled = true;
    try {
        await Promise.all(assignFlashcardIds.map(id => API.updateFlashcardSet(id, payload)));
        assignFlashcardIds.forEach(id => {
            const set = flashcardSets.find(s => s.id === id);
            if (set) { set.visibility = visibility; set.assignedStudents = assignedStudents; }
        });
        if (assignFlashcardIds.length > 1) selectedSetIds.clear();
        closeFcAssignModal();
        renderFlashcardList();
    } catch (err) {
        console.error(err);
        alert('Failed to update access: ' + err.message);
    } finally {
        elements.fcAssignSaveBtn.disabled = false;
    }
}

// ── Event binding ─────────────────────────────────────

export function initAdminFlashcard() {
    // Init custom selects
    [elements.sort, elements.group].filter(Boolean).forEach((selectEl) => initCustomSelect(selectEl));

    // Tab events
    elements.createBtn?.addEventListener('click', () => { openEditor(); adminState.router?.navigate('admin-flashcard-editor'); });
    elements.search?.addEventListener('input', renderFlashcardList);
    elements.sort?.addEventListener('change', renderFlashcardList);
    elements.group?.addEventListener('change', renderFlashcardList);

    // Bulk bar
    elements.selectAll?.addEventListener('change', (e) => setSelectAllVisible(e.target.checked));
    elements.bulkAccess?.addEventListener('click', () => {
        if (!selectedSetIds.size) return;
        openFcAssignModal([...selectedSetIds]);
    });
    elements.bulkDelete?.addEventListener('click', bulkDeleteSets);
    elements.clearSelection?.addEventListener('click', clearSelection);

    // Row click delegation
    elements.list?.addEventListener('click', (e) => {
        const row = e.target.closest('.admin-quiz-row[data-set-id]');
        if (!row) return;
        const setId = row.dataset.setId;
        if (e.target.closest('.admin-quiz-row-check')) return;
        openEditor(setId);
        adminState.router?.navigate(`admin-flashcard-editor-${setId}`);
    });
    elements.list?.addEventListener('change', (e) => {
        if (!e.target.classList.contains('admin-flashcard-row-checkbox')) return;
        setSetSelected(e.target.dataset.setId, e.target.checked);
    });
    elements.list?.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('admin-flashcard-row-checkbox')) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.admin-quiz-row[data-set-id]');
        if (!row?.dataset.setId) return;
        e.preventDefault();
        openEditor(row.dataset.setId);
        adminState.router?.navigate(`admin-flashcard-editor-${row.dataset.setId}`);
    });

    // Editor
    elements.feBackBtn?.addEventListener('click', () => { adminState.router?.navigate('admin-dashboard-flashcard'); });
    elements.feSaveBtn?.addEventListener('click', saveEditor);
    elements.feAddCardBtn?.addEventListener('click', () => {
        addCardRow();
        setTimeout(() => {
            const last = elements.feCardsContainer.lastElementChild;
            if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
    });

    const feImportBtn = document.getElementById('fe-import-btn');
    if (feImportBtn) {
        feImportBtn.addEventListener('click', () => {
            window.currentImportTarget = 'admin';
            document.getElementById('import-flashcard-modal')?.classList.remove('hidden');
        });
    }

    const feExportBtn = document.getElementById('fe-export-btn');
    if (feExportBtn) {
        feExportBtn.addEventListener('click', () => {
            const cards = getCardsFromEditor();
            if (!cards.length) {
                alert('No cards to export.');
                return;
            }
            let textContent = '';
            cards.forEach(card => {
                textContent += `${card.front}\t${card.back}\n`;
            });
            const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const title = elements.feTitle.value.trim() || 'flashcard_set';
            a.download = `${title}.txt`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    document.getElementById('import-flashcard-submit')?.addEventListener('click', () => {
        if (window.currentImportTarget !== 'admin') return;
        const textarea = document.getElementById('import-flashcard-textarea');
        const text = textarea?.value || '';
        if (!text.trim()) {
            alert('Please paste some text to import.');
            return;
        }

        const lines = text.split('\n');
        let addedCount = 0;
        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const front = parts[0].trim();
                const back = parts[1].trim();
                if (front || back) {
                    addCardRow(front, back);
                    addedCount++;
                }
            } else if (parts.length === 1 && parts[0].trim()) {
                addCardRow(parts[0].trim(), '');
                addedCount++;
            }
        });

        alert(`Imported ${addedCount} cards successfully.`);
        document.getElementById('import-flashcard-modal')?.classList.add('hidden');
        if (textarea) textarea.value = '';
        window.currentImportTarget = null;
    });
    elements.feVisibility?.addEventListener('change', () => {
        if (elements.feVisibility.value === 'specific') {
            renderEditorStudentsList([]);
            dom.show(elements.feStudentsPanel);
        } else {
            dom.hide(elements.feStudentsPanel);
        }
    });

    // Assign modal
    elements.fcAssignModalClose?.addEventListener('click', closeFcAssignModal);
    elements.fcAssignModalBackdrop?.addEventListener('click', closeFcAssignModal);
    elements.fcAssignCancelBtn?.addEventListener('click', closeFcAssignModal);
    elements.fcAssignSaveBtn?.addEventListener('click', saveFcAssignModal);
    document.querySelectorAll('input[name="fc-assign-visibility"]').forEach(radio => {
        radio.addEventListener('change', updateFcAssignModalVisibilityPanel);
    });
    elements.fcAssignStudentsList?.addEventListener('change', (e) => {
        if (e.target.classList.contains('fc-assign-student-cb')) updateFcAssignSelectedCount();
    });

    return {
        onTabActive() { loadFlashcardSets(); },
        onEditorOpen(setId) { openEditor(setId || null); }
    };
}
