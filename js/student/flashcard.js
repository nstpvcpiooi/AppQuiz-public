import API from '../api.js';
import state from '../state.js';
import { dom, escapeHtml, initCustomSelect } from '../utils.js';
import { initLearnMode } from './learn-mode.js';

// ── Tab elements ──────────────────────────────────────

const tabElements = {
    list: document.getElementById('student-flashcard-list'),
    empty: document.getElementById('student-flashcard-empty'),
    loader: document.getElementById('student-flashcard-loader'),
    content: document.getElementById('student-flashcard-content'),
    createPersonalBtn: document.getElementById('btn-create-personal-flashcard'),
    search: document.getElementById('student-flashcard-search'),
    sort: document.getElementById('student-flashcard-sort'),
    group: document.getElementById('student-flashcard-group'),
    count: document.getElementById('student-flashcard-count'),
    typeFilterChips: document.querySelectorAll('[data-student-fc-type-filter]')
};

// ── Editor elements ───────────────────────────────────

const editorElements = {
    screen: document.getElementById('student-flashcard-editor-screen'),
    backBtn: document.getElementById('sfe-back-btn'),
    saveBtn: document.getElementById('sfe-save-btn'),
    title: document.getElementById('sfe-title'),
    pageTitle: document.getElementById('sfe-page-title'),
    cardsContainer: document.getElementById('sfe-cards-container'),
    addCardBtn: document.getElementById('sfe-add-card-btn')
};

// ── Study elements ────────────────────────────────────

const studyElements = {
    screen: document.getElementById('student-flashcard-study-screen'),
    backBtn: document.getElementById('fs-back-btn'),
    setTitle: document.getElementById('fs-set-title'),
    progress: document.getElementById('fs-progress'),
    card: document.getElementById('fs-card'),
    cardInner: document.getElementById('fs-card-inner'),
    frontText: document.getElementById('fs-front-text'),
    backText: document.getElementById('fs-back-text'),
    frontBadges: document.getElementById('fs-front-badges'),
    backBadges: document.getElementById('fs-back-badges'),
    prevBtn: document.getElementById('fs-prev-btn'),
    nextBtn: document.getElementById('fs-next-btn'),
    editBtn: document.getElementById('fs-edit-btn'),
    exportBtn: document.getElementById('fs-export-btn'),
    deleteBtn: document.getElementById('fs-delete-btn'),
    vocabList: document.getElementById('fs-vocab-list'),
    soundBtn: document.getElementById('fs-sound-btn'),
    autoplayBtn: document.getElementById('fs-autoplay-btn'),
    shuffleBtn: document.getElementById('fs-shuffle-btn'),
    settingsBtn: document.getElementById('fs-settings-btn'),
    fullscreenBtn: document.getElementById('fs-fullscreen-btn'),
    starredOnlyBtn: document.getElementById('fs-starred-only-btn')
};

const fsSettingsModal = {
    modal: document.getElementById('fs-settings-modal'),
    closeBtn: document.getElementById('fs-settings-modal-close'),
    backdrop: document.getElementById('fs-settings-modal-backdrop'),
    faceSelect: document.getElementById('fs-setting-face'),
    timeInput: document.getElementById('fs-setting-time'),
    soundToggle: document.getElementById('fs-setting-sound'),
    saveBtn: document.getElementById('fs-settings-save')
};

let assignedSets = [];
let personalSets = [];
let editingPersonalId = null;
let fcTypeFilter = 'all';
let fcSearchTimer = null;

// ── Study state ───────────────────────────────────────

let studyCards = [];
let studyIndex = 0;
let isFlipped = false;
let currentStudySetId = null;
let currentStudySet = null;

let isAutoPlaying = false;
let autoPlayTimer = null;
let isShuffled = false;
let originalStudyCards = [];
let starredCardsList = [];
let starredOnlyMode = false;
let fsSettings = {
    frontFace: 'word',
    autoPlayTime: 3,
    autoSound: false
};

// ── Load ──────────────────────────────────────────────

// --- Badge Logic ---
function extractCardBadges(text) {
    if (!text) return { cleanText: '', badges: [], isPhrase: false };
    let cleanText = text;
    const posMatches = [];
    const posMap = {
        'n': 'noun',
        'v': 'verb',
        'adj': 'adjective',
        'adv': 'adverb',
        'prep': 'preposition',
        'conj': 'conjunction',
        'pron': 'pronoun',
        'int': 'interjection',
        'phr': 'phrase',
        'idiom': 'idiom'
    };

    const regex = /\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const innerRaw = match[1].trim().toLowerCase();
        const parts = innerRaw.split('/').map(p => p.trim());
        let allValid = true;
        const badgesToAdd = [];
        
        for (let p of parts) {
            const inner = p.replace(/\.$/, '');
            if (inner === 'np' || inner === 'n.p') {
                badgesToAdd.push('noun', 'phrase');
            } else if (inner === 'vp' || inner === 'v.p') {
                badgesToAdd.push('verb', 'phrase');
            } else if (posMap[inner]) {
                badgesToAdd.push(posMap[inner]);
            } else {
                allValid = false;
                break;
            }
        }
        
        if (allValid && badgesToAdd.length > 0) {
            posMatches.push(...badgesToAdd);
            cleanText = cleanText.replace(match[0], '');
        }
    }

    cleanText = cleanText.trim();
    
    // Determine if it's a phrase (> 2 words)
    const wordsCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;
    const isPhrase = wordsCount > 2;

    return { cleanText, badges: [...new Set(posMatches)], isPhrase };
}

function renderBadges(container, badges, isPhrase) {
    if (!container) return;
    container.innerHTML = '';
    
    badges.forEach(badge => {
        const span = document.createElement('span');
        const badgeClass = `fs-badge-${badge.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
        span.className = `fs-badge ${badgeClass}`;
        span.textContent = badge;
        container.appendChild(span);
    });

    if (isPhrase && !badges.includes('phrase')) {
        const span = document.createElement('span');
        span.className = 'fs-badge fs-badge-phrase';
        span.textContent = 'phrase';
        container.appendChild(span);
    }
}

function getSortValue() {
    return tabElements.sort?.value || 'date-desc';
}

function getSearchQuery() {
    return (tabElements.search?.value || '').trim().toLowerCase();
}

function getGroupValue() {
    return tabElements.group?.value || 'none';
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

function getTs(obj) {
    const ts = obj.createdAt;
    if (!ts) return 0;
    if (ts?.toDate) return ts.toDate().getTime();
    if (ts?.seconds) return ts.seconds * 1000;
    return 0;
}

function scheduleFilterAndRender() {
    clearTimeout(fcSearchTimer);
    fcSearchTimer = setTimeout(() => filterAndRenderAll(), 200);
}

function filterAndRenderAll() {
    const search = getSearchQuery();
    const sortVal = getSortValue();
    const groupVal = getGroupValue();

    const matches = s => !search || (s.title || '').toLowerCase().includes(search);

    const showAssigned = fcTypeFilter === 'all' || fcTypeFilter === 'assigned';
    const showPersonal = fcTypeFilter === 'all' || fcTypeFilter === 'personal';

    const filteredAssigned = showAssigned ? sortFlashcardSets(assignedSets.filter(matches), sortVal) : [];
    const filteredPersonal = showPersonal ? sortFlashcardSets(personalSets.filter(matches), sortVal) : [];

    const allFiltered = [
        ...filteredAssigned.map(s => ({ ...s, _setType: 'assigned' })),
        ...filteredPersonal.map(s => ({ ...s, _setType: 'personal' }))
    ];

    renderFlashcardSets(allFiltered, groupVal);

    const total = assignedSets.length + personalSets.length;
    updateCount(allFiltered.length, total);
}

export async function loadStudentFlashcardSets() {
    const username = state.user.current;
    if (!username) return;
    dom.hide(tabElements.content);
    dom.show(tabElements.loader);
    try {
        const result = await API.getStudentFlashcardSets(username);
        assignedSets = result.assigned || [];
        personalSets = result.personal || [];
        filterAndRenderAll();
    } catch (err) {
        console.error('Failed to load flashcard sets:', err);
    } finally {
        dom.hide(tabElements.loader);
        dom.show(tabElements.content);
    }
}

// ── Render ────────────────────────────────────────────

function renderFlashcardSets(sets, groupBy) {
    const list = tabElements.list;
    if (!list) return;

    if (!sets.length) {
        dom.hide(list);
        dom.show(tabElements.empty);
        return;
    }
    dom.show(list);
    dom.hide(tabElements.empty);

    const groups = buildGroups(sets, groupBy);
    dom.setHTML(list, '');

    groups.forEach((section) => {
        const container = document.createElement('div');
        container.className = 'assignments-grid';

        section.sets.forEach((set) => {
            container.appendChild(createFlashcardCard(set));
        });

        if (section.title) {
            const groupEl = document.createElement('section');
            groupEl.className = 'student-quiz-group';
            const header = document.createElement('header');
            header.className = 'student-quiz-group-header';
            header.innerHTML = `
                <h4 class="student-quiz-group-title">${escapeHtml(section.title)}</h4>
                <span class="student-quiz-group-count">${section.sets.length}</span>
            `;
            groupEl.appendChild(header);
            groupEl.appendChild(container);
            list.appendChild(groupEl);
        } else {
            list.appendChild(container);
        }
    });
}

function buildGroups(sets, groupBy) {
    if (groupBy === 'none' || !sets.length) {
        return [{ title: null, sets }];
    }

    if (groupBy === 'type') {
        const assigned = sets.filter(s => s._setType === 'assigned');
        const personal = sets.filter(s => s._setType === 'personal');
        const groups = [];
        if (assigned.length) groups.push({ title: 'Assigned by teachers', sets: assigned });
        if (personal.length) groups.push({ title: 'My personal sets', sets: personal });
        return groups.length ? groups : [{ title: null, sets }];
    }

    if (groupBy === 'name') {
        const map = new Map();
        sets.forEach((set) => {
            const title = (set.title || '').trim();
            const char = title ? title[0].toUpperCase() : '#';
            const key = /[A-Z]/.test(char) ? char : '#';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(set);
        });
        const sorted = [...map.entries()].sort((a, b) => {
            if (a[0] === '#') return 1;
            if (b[0] === '#') return -1;
            return a[0].localeCompare(b[0]);
        });
        return sorted.map(([title, groupSets]) => ({ title, sets: groupSets }));
    }

    // groupBy === 'date'
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = (() => {
        const d = new Date(todayStart);
        const day = d.getDay();
        d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
        return d.getTime();
    })();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const groups = [];
    const today = [], thisWeek = [], thisMonth = [], older = [];

    sets.forEach((set) => {
        const ms = getTs(set);
        if (!ms) { older.push(set); return; }
        if (ms >= todayStart) { today.push(set); return; }
        if (ms >= weekStart) { thisWeek.push(set); return; }
        if (ms >= monthStart) { thisMonth.push(set); return; }
        older.push(set);
    });

    const dateGroups = [
        { title: 'Today', sets: today },
        { title: 'This week', sets: thisWeek },
        { title: 'This month', sets: thisMonth }
    ];

    dateGroups.forEach(g => { if (g.sets.length) groups.push(g); });

    if (older.length) {
        const monthMap = new Map();
        older.forEach((set) => {
            const ms = getTs(set);
            const d = ms ? new Date(ms) : null;
            const label = d
                ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
                : 'Unknown date';
            if (!monthMap.has(label)) monthMap.set(label, []);
            monthMap.get(label).push(set);
        });
        const sortedMonths = [...monthMap.entries()]
            .sort((a, b) => {
                const ma = a[1][0]; const mb = b[1][0];
                return getTs(mb) - getTs(ma);
            });
        sortedMonths.forEach(([label, monthSets]) => {
            groups.push({ title: label, sets: monthSets });
        });
    }

    return groups.length ? groups : [{ title: null, sets }];
}

function createFlashcardCard(set) {
    const isPersonal = set._setType === 'personal';
    const count = (set.cards || []).length;
    const card = document.createElement('div');
    card.className = 'assignment-card';
    card.dataset.id = set.id;

    const typeBadgeLabel = isPersonal ? 'My flashcard' : 'Created by teacher';
    const typeBadgeClass = isPersonal ? 'mine' : 'teacher';

    card.innerHTML = `
        <div class="card-badges">
            <span class="badge ${typeBadgeClass}">${typeBadgeLabel}</span>
        </div>
        <div class="card-body-row">
            <div class="card-main-info">
                <h4>${escapeHtml(set.title || 'Untitled')}</h4>
                <p>${count} word${count !== 1 ? 's' : ''}</p>
            </div>
        </div>
        <div class="card-footer card-footer-actions">
            <div class="card-action-btns">
                <button type="button" class="btn-text btn-text-with-icon btn-text-forward fc-card-study" data-id="${set.id}">
                    View <i class="fas fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
        </div>
    `;

    card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const viewBtn = card.querySelector('.fc-card-study');
        if (viewBtn) viewBtn.click();
    });

    return card;
}

function updateCount(shown, total) {
    if (!tabElements.count) return;
    const span = tabElements.count.querySelector('span');
    if (!span) return;
    if (total === 0) { span.textContent = 'No sets yet'; return; }
    if (shown === total) { span.textContent = `${total} set${total !== 1 ? 's' : ''}`; return; }
    span.textContent = `Showing ${shown} of ${total} sets`;
}

// ── Editor ────────────────────────────────────────────

function openPersonalEditor(setId = null) {
    editingPersonalId = setId;
    editorElements.title.value = '';
    dom.setHTML(editorElements.cardsContainer, '');
    if (setId) {
        const set = personalSets.find(s => s.id === setId);
        if (set) {
            editorElements.pageTitle.textContent = 'Edit flashcard set';
            editorElements.title.value = set.title || '';
            (set.cards || []).forEach(c => addPersonalCardRow(c.front, c.back));
            return;
        }
    }
    editorElements.pageTitle.textContent = 'Create flashcard set';
    addPersonalCardRow();
    addPersonalCardRow();
}

function addPersonalCardRow(front = '', back = '') {
    const idx = editorElements.cardsContainer.children.length;
    const row = document.createElement('div');
    row.className = 'fe-card';
    row.innerHTML = `
        <span class="fe-drag-handle" aria-label="Drag to reorder"><i class="fas fa-grip-lines"></i></span>
        <span class="fe-card-index">${idx + 1}</span>
        <textarea class="input-full fe-front-input" placeholder="Word" autocomplete="off" rows="1">${escapeHtml(front)}</textarea>
        <span class="fe-card-divider"></span>
        <textarea class="input-full fe-back-input" placeholder="Meaning" autocomplete="off" rows="1">${escapeHtml(back)}</textarea>
        <button type="button" class="fe-remove-card" title="Remove card">
            <i class="fas fa-trash"></i>
        </button>
    `;
    editorElements.cardsContainer.appendChild(row);

    // Auto-resize textareas
    row.querySelectorAll('textarea').forEach(ta => {
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

    row.querySelector('.fe-remove-card').addEventListener('click', () => {
        row.remove();
        reindexPersonalCards();
    });
    reindexPersonalCards();
}

function reindexPersonalCards() {
    editorElements.cardsContainer.querySelectorAll('.fe-card').forEach((row, i) => {
        row.querySelector('.fe-card-index').textContent = i + 1;
    });
}

function getPersonalCardsFromEditor() {
    const cards = [];
    editorElements.cardsContainer.querySelectorAll('.fe-card').forEach(row => {
        const front = row.querySelector('.fe-front-input').value.trim();
        const back = row.querySelector('.fe-back-input').value.trim();
        if (front || back) cards.push({ front, back });
    });
    return cards;
}

async function savePersonalEditor() {
    const title = editorElements.title.value.trim();
    const cards = getPersonalCardsFromEditor();
    const username = state.user.current;
    if (!title) { alert('Please enter a set title.'); return; }
    if (!cards.length) { alert('Please add at least one card.'); return; }
    if (!username) return;
    const payload = { title, cards, creatorType: 'student', createdByUsername: username };
    editorElements.saveBtn.disabled = true;
    try {
        if (editingPersonalId) {
            const result = await API.updateFlashcardSet(editingPersonalId, payload);
            if (!result.success) throw new Error(result.error);
        } else {
            const result = await API.createFlashcardSet({ ...payload, assignedStudents: [] });
            if (!result.success) throw new Error(result.error);
        }
        window.location.hash = 'dashboard-flashcard';
    } catch (err) {
        console.error(err);
        alert('Error saving: ' + err.message);
    } finally {
        editorElements.saveBtn.disabled = false;
    }
}

async function deletePersonalSet(setId) {
    const set = personalSets.find(s => s.id === setId);
    if (!set) return;
    if (!confirm(`Delete "${set.title || 'Untitled'}"?`)) return;
    const result = await API.deleteFlashcardSet(setId);
    if (result.success) {
        personalSets = personalSets.filter(s => s.id !== setId);
        filterAndRenderAll();
    } else {
        alert('Error deleting: ' + result.error);
    }
}

// ── Study ─────────────────────────────────────────────

async function openStudy(setId) {
    let set = assignedSets.find(s => s.id === setId) || personalSets.find(s => s.id === setId);
    if (!set) {
        set = await API.getFlashcardSetById(setId);
    }
    if (!set || !set.cards || !set.cards.length) {
        alert('No cards in this set.');
        return;
    }
    
    const username = state.user.current;
    
    // 1. Instantly load from cache to prevent lag
    if (username) {
        const cacheKey = `stars_${String(username).trim().toLowerCase()}_${setId}`;
        const local = localStorage.getItem(cacheKey);
        starredCardsList = local ? JSON.parse(local) : [];
    } else {
        starredCardsList = [];
    }

    starredOnlyMode = false;
    updateStarredOnlyBtnUI();

    currentStudySetId = setId;
    currentStudySet = set;
    studyCards = set.cards;
    originalStudyCards = [...set.cards];
    studyIndex = 0;
    isFlipped = false;
    isShuffled = false;
    studyElements.shuffleBtn?.classList.remove('active');
    stopAutoPlay();

    studyElements.setTitle.textContent = set.title || 'Study';
    studyElements.cardInner.classList.remove('flipped');
    studyElements.vocabList.classList.remove('expanded');

    document.getElementById('fs-card-container').parentElement.classList.remove('hidden');
    document.getElementById('fs-learn-body').classList.add('hidden');

    const modeBtn = document.getElementById('fs-mode-btn');
    if (modeBtn) {
        modeBtn.innerHTML = '<i class="fas fa-layer-group"></i> Flashcard <i class="fas fa-chevron-down"></i>';
        document.querySelectorAll('#fs-mode-menu .fs-dropdown-option').forEach(o => o.classList.remove('active'));
        const fcOpt = document.querySelector('#fs-mode-menu .fs-dropdown-option[data-mode="flashcard"]');
        if (fcOpt) fcOpt.classList.add('active');
    }

    showCard(0);
    renderVocabList(set.cards);
    
    const isPersonal = personalSets.some(s => s.id === setId);
    studyElements.editBtn.classList.toggle('hidden', !isPersonal);
    studyElements.deleteBtn.classList.toggle('hidden', !isPersonal);

    // 2. Fetch fresh stars from Firebase in the background
    if (username) {
        API.getFlashcardStars(username, setId).then(stars => {
            // Only update if the user hasn't switched to a different set while waiting
            if (currentStudySetId === setId) {
                starredCardsList = stars;
                renderCardStarUI(studyCards[studyIndex]?.front);
                renderVocabList(originalStudyCards);
                updateStarredOnlyBtnUI();
                
                // If they quickly clicked 'Starred Only' before network finished
                if (starredOnlyMode) {
                    studyCards = originalStudyCards.filter(c => starredCardsList.includes(c.front));
                    if (studyCards.length === 0) {
                        toggleStarredOnly();
                    } else {
                        if (studyIndex >= studyCards.length) studyIndex = studyCards.length - 1;
                        showCard(studyIndex);
                    }
                }
            }
        });
    }
}

function showCard(index, direction) {
    const card = studyCards[index];
    if (!card) return;
    isFlipped = false;
    studyElements.cardInner.style.transition = 'none';
    studyElements.cardInner.classList.remove('flipped');
    void studyElements.cardInner.offsetWidth;
    studyElements.cardInner.style.transition = '';
    
    const frontInfo = extractCardBadges(card.front || '');
    const backText = card.back || '-';
    
    if (fsSettings.frontFace === 'meaning') {
        studyElements.frontText.textContent = backText;
        renderBadges(studyElements.frontBadges, [], false);
        
        studyElements.backText.textContent = frontInfo.cleanText || '-';
        renderBadges(studyElements.backBadges, frontInfo.badges, frontInfo.isPhrase);
    } else {
        studyElements.frontText.textContent = frontInfo.cleanText || '-';
        renderBadges(studyElements.frontBadges, frontInfo.badges, frontInfo.isPhrase);
        
        studyElements.backText.textContent = backText;
        renderBadges(studyElements.backBadges, [], false);
    }

    studyElements.progress.textContent = `${index + 1} / ${studyCards.length}`;
    studyElements.prevBtn.disabled = index === 0;
    studyElements.nextBtn.disabled = index === studyCards.length - 1;
    if (direction) {
        studyElements.card.classList.remove('slide-in-right', 'slide-in-left');
        void studyElements.card.offsetWidth;
        studyElements.card.classList.add(direction === 'next' ? 'slide-in-right' : 'slide-in-left');
    }

    if (fsSettings.autoSound) {
        setTimeout(() => {
            if (!isFlipped && fsSettings.frontFace === 'word') {
                playVocabSound(card.front);
            }
        }, direction ? 250 : 0);
    }
    renderCardStarUI(card.front);
}

function renderVocabList(cards) {
    dom.setHTML(studyElements.vocabList, cards.map((c, i) => {
        const frontInfo = extractCardBadges(c.front || '');
        const backText = c.back || '';
        
        let badgesHtml = '';
        frontInfo.badges.forEach(b => {
            const badgeClass = `fs-badge-${b.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
            badgesHtml += `<span class="fs-badge ${badgeClass}" style="padding: 0.1rem 0.4rem; font-size: 0.7rem;">${b}</span>`;
        });
        if (frontInfo.isPhrase && !frontInfo.badges.includes('phrase')) {
            badgesHtml += `<span class="fs-badge fs-badge-phrase" style="padding: 0.1rem 0.4rem; font-size: 0.7rem;">phrase</span>`;
        }
        
        return `
        <div class="fs-vocab-item">
            <span class="fs-vocab-index">${i + 1}</span>
            <div style="flex:1; display:flex; flex-direction:row; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <span class="fs-vocab-front" style="flex:none; width:auto; margin-right: 0.25rem;">${escapeHtml(frontInfo.cleanText || '')}</span>
                ${badgesHtml ? `<div style="display:flex; gap:0.25rem; flex-wrap:wrap;">${badgesHtml}</div>` : ''}
            </div>
            <span class="fs-vocab-back">${escapeHtml(backText)}</span>
            <button type="button" class="fs-item-star-btn" onclick="window.toggleStarCard(this.dataset.text)" data-text="${escapeHtml(c.front || '')}" aria-label="Star">
                <i class="${starredCardsList.includes(c.front || '') ? 'fas' : 'far'} fa-star" style="${starredCardsList.includes(c.front || '') ? 'color: #EAB308;' : ''}"></i>
            </button>
            <button type="button" class="fs-item-sound-btn" onclick="playVocabSound(this.dataset.text)" data-text="${escapeHtml(c.front || '')}" aria-label="Phát âm">
                <i class="fas fa-volume-up"></i>
            </button>
        </div>
        `;
    }).join(''));
}

window.playVocabSound = function(text) {
    if (text && text !== '-' && 'speechSynthesis' in window) {
        // Remove text inside parentheses, e.g., (n), (adj), etc.
        let cleanText = text.replace(/\s*\([^)]*\)/g, '').trim();
        // Replace abbreviations sb and sth
        cleanText = cleanText.replace(/\bsb\b/gi, 'somebody').replace(/\bsth\b/gi, 'something');
        
        if (!cleanText) return;

        speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(cleanText);
        utter.lang = 'en-US';
        utter.rate = 0.9;
        speechSynthesis.speak(utter);
    }
};
function flipCard() {
    isFlipped = !isFlipped;
    studyElements.cardInner.classList.toggle('flipped', isFlipped);

    if (fsSettings.autoSound) {
        const card = studyCards[studyIndex];
        setTimeout(() => {
            if (isFlipped && fsSettings.frontFace === 'meaning') {
                playVocabSound(card.front);
            }
        }, 250);
    }
}

function nextCard() {
    if (studyIndex < studyCards.length - 1) {
        studyIndex++;
        showCard(studyIndex, 'next');
    }
}

function prevCard() {
    if (studyIndex > 0) {
        studyIndex--;
        showCard(studyIndex, 'prev');
    }
}

// ── Stars ─────────────────────────────────────────────

window.toggleStarCard = async function(frontText) {
    if (!frontText || !currentStudySetId) return;
    const isStarred = starredCardsList.includes(frontText);
    if (isStarred) {
        starredCardsList = starredCardsList.filter(t => t !== frontText);
    } else {
        starredCardsList.push(frontText);
    }
    
    renderCardStarUI(studyCards[studyIndex]?.front);
    renderVocabList(originalStudyCards);
    updateStarredOnlyBtnUI();
    
    if (starredOnlyMode && isStarred) {
        studyCards = originalStudyCards.filter(c => starredCardsList.includes(c.front));
        if (studyCards.length === 0) {
            toggleStarredOnly();
        } else {
            if (studyIndex >= studyCards.length) studyIndex = studyCards.length - 1;
            showCard(studyIndex);
        }
    }
    
    const username = state.user.current;
    if (username) {
        await API.updateFlashcardStars(username, currentStudySetId, starredCardsList);
    }
};

function renderCardStarUI(frontText) {
    if (!frontText || !studyElements.card) return;
    const isStarred = starredCardsList.includes(frontText);
    const starBtns = studyElements.card.querySelectorAll('.fs-star-btn i');
    starBtns.forEach(icon => {
        icon.className = isStarred ? 'fas fa-star' : 'far fa-star';
        icon.style.color = isStarred ? '#EAB308' : '';
    });
}

function updateStarredOnlyBtnUI() {
    if (!studyElements.starredOnlyBtn) return;
    if (starredCardsList.length === 0) {
        studyElements.starredOnlyBtn.disabled = true;
        studyElements.starredOnlyBtn.classList.remove('active');
        if (starredOnlyMode) toggleStarredOnly();
    } else {
        studyElements.starredOnlyBtn.disabled = false;
        if (starredOnlyMode) {
            studyElements.starredOnlyBtn.classList.add('active');
            studyElements.starredOnlyBtn.innerHTML = '<i class="fas fa-star"></i>';
        } else {
            studyElements.starredOnlyBtn.classList.remove('active');
            studyElements.starredOnlyBtn.innerHTML = '<i class="far fa-star"></i>';
        }
    }
}

function toggleStarredOnly() {
    if (starredCardsList.length === 0) return;
    starredOnlyMode = !starredOnlyMode;
    
    if (starredOnlyMode) {
        studyCards = originalStudyCards.filter(c => starredCardsList.includes(c.front));
    } else {
        studyCards = [...originalStudyCards];
    }
    
    if (isShuffled) {
        studyCards.sort(() => Math.random() - 0.5);
    }
    
    studyIndex = 0;
    updateStarredOnlyBtnUI();
    showCard(0);
}

// ── Advanced Study Features ─────────────────────────

function toggleShuffle() {
    isShuffled = !isShuffled;
    studyElements.shuffleBtn.classList.toggle('active', isShuffled);
    
    if (isShuffled) {
        studyCards = [...originalStudyCards].sort(() => Math.random() - 0.5);
    } else {
        studyCards = [...originalStudyCards];
    }
    
    studyIndex = 0;
    showCard(0);
}

function toggleAutoPlay() {
    if (isAutoPlaying) {
        stopAutoPlay();
    } else {
        startAutoPlay();
    }
}

function startAutoPlay() {
    isAutoPlaying = true;
    studyElements.autoplayBtn.classList.add('active');
    studyElements.autoplayBtn.innerHTML = '<i class="fas fa-pause"></i>';
    
    const intervalTime = (fsSettings.autoPlayTime * 1000) / 2;
    
    autoPlayTimer = setInterval(() => {
        if (!isFlipped) {
            flipCard();
        } else {
            if (studyIndex < studyCards.length - 1) {
                nextCard();
            } else {
                stopAutoPlay();
            }
        }
    }, intervalTime);
}

function stopAutoPlay() {
    isAutoPlaying = false;
    studyElements.autoplayBtn.classList.remove('active');
    studyElements.autoplayBtn.innerHTML = '<i class="fas fa-play"></i>';
    clearInterval(autoPlayTimer);
}

function openSettings() {
    fsSettingsModal.faceSelect.value = fsSettings.frontFace;
    fsSettingsModal.timeInput.value = fsSettings.autoPlayTime;
    fsSettingsModal.soundToggle.checked = fsSettings.autoSound;
    
    fsSettingsModal.modal.classList.remove('hidden');
}

function closeSettings() {
    fsSettingsModal.modal.classList.add('hidden');
}

function saveSettings() {
    fsSettings.frontFace = fsSettingsModal.faceSelect.value;
    fsSettings.autoPlayTime = parseInt(fsSettingsModal.timeInput.value) || 3;
    fsSettings.autoSound = fsSettingsModal.soundToggle.checked;
    
    closeSettings();
    
    // Restart autoplay if running to apply new timing
    if (isAutoPlaying) {
        stopAutoPlay();
        startAutoPlay();
    }
    
    // Refresh current card to apply front face settings
    showCard(studyIndex);
}

function toggleFullscreen() {
    const isFullscreen = document.body.classList.contains('fs-fullscreen-active');
    if (isFullscreen) {
        document.body.classList.remove('fs-fullscreen-active');
        studyElements.fullscreenBtn.classList.remove('active');
        studyElements.fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    } else {
        document.body.classList.add('fs-fullscreen-active');
        studyElements.fullscreenBtn.classList.add('active');
        studyElements.fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    }
}

function exportFlashcardToText() {
    if (!currentStudySet || !studyCards || studyCards.length === 0) return;
    
    let textContent = '';
    studyCards.forEach(card => {
        const front = card.front || '';
        const back = card.back || '';
        textContent += `${front}\t${back}\n`;
    });
    
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentStudySet.title || 'flashcard_set'}.txt`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Keyboard navigation ──────────────────────────────

function handleStudyKeydown(e) {
    const isStudyScreen = !studyElements.screen.classList.contains('hidden');
    if (!isStudyScreen) return;
    
    // Ignore keyboard shortcuts if the user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        if (isFlipped) nextCard();
        else flipCard();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isFlipped) prevCard();
    } else if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        flipCard();
    }
}

// ── Init ──────────────────────────────────────────────

function setFcTypeFilterValue(value) {
    fcTypeFilter = value;
    tabElements.typeFilterChips?.forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.studentFcTypeFilter === value);
    });
}

export function initStudentFlashcard() {
    // Init custom selects
    if (tabElements.sort) initCustomSelect(tabElements.sort);
    if (tabElements.group) initCustomSelect(tabElements.group);

    // Tab: search & sort & group
    tabElements.search?.addEventListener('input', scheduleFilterAndRender);
    tabElements.sort?.addEventListener('change', filterAndRenderAll);
    tabElements.group?.addEventListener('change', filterAndRenderAll);

    // Tab: type filter chips
    tabElements.typeFilterChips?.forEach((chip) => {
        chip.addEventListener('click', () => {
            setFcTypeFilterValue(chip.dataset.studentFcTypeFilter || 'all');
            filterAndRenderAll();
        });
    });

    // Tab: click events on cards (Study, Edit, Delete)
    tabElements.list?.addEventListener('click', handleTabCardClick);
    tabElements.createPersonalBtn?.addEventListener('click', () => {
        openPersonalEditor();
        window.location.hash = 'student-flashcard-editor';
    });

    // Editor
    editorElements.backBtn?.addEventListener('click', () => { window.location.hash = 'dashboard-flashcard'; });
    editorElements.saveBtn?.addEventListener('click', savePersonalEditor);
    editorElements.addCardBtn?.addEventListener('click', () => addPersonalCardRow());

    const importModal = document.getElementById('import-flashcard-modal');
    const importBackdrop = document.getElementById('import-flashcard-modal-backdrop');
    const importClose = document.getElementById('import-flashcard-modal-close');
    const importSubmit = document.getElementById('import-flashcard-submit');
    const importTextarea = document.getElementById('import-flashcard-textarea');
    const sfeImportBtn = document.getElementById('sfe-import-btn');

    const sfeExportBtn = document.getElementById('sfe-export-btn');
    if (sfeExportBtn) {
        sfeExportBtn.addEventListener('click', () => {
            const cards = getPersonalCardsFromEditor();
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
            const title = editorElements.title.value.trim() || 'flashcard_set';
            a.download = `${title}.txt`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    const closeImportModal = () => {
        importModal.classList.add('hidden');
        importTextarea.value = '';
        window.currentImportTarget = null;
    };

    if (sfeImportBtn) {
        sfeImportBtn.addEventListener('click', () => {
            window.currentImportTarget = 'student';
            importModal.classList.remove('hidden');
        });
    }

    importClose?.addEventListener('click', closeImportModal);
    importBackdrop?.addEventListener('click', closeImportModal);

    importSubmit?.addEventListener('click', () => {
        if (window.currentImportTarget !== 'student') return; // only handle student here
        const text = importTextarea.value;
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
                    addPersonalCardRow(front, back);
                    addedCount++;
                }
            } else if (parts.length === 1 && parts[0].trim()) {
                addPersonalCardRow(parts[0].trim(), '');
                addedCount++;
            }
        });

        alert(`Imported ${addedCount} cards successfully.`);
        closeImportModal();
    });

    // Study
    studyElements.card?.addEventListener('click', flipCard);
    studyElements.soundBtn?.addEventListener('click', e => {
        e.stopPropagation();
        const text = studyElements.frontText.textContent;
        if (text && text !== '—' && 'speechSynthesis' in window) {
            let cleanText = text.replace(/\s*\([^)]*\)/g, '').trim();
            cleanText = cleanText.replace(/\bsb\b/gi, 'somebody').replace(/\bsth\b/gi, 'something');
            if (!cleanText) return;
            
            speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(cleanText);
            utter.lang = 'en-US';
            utter.rate = 0.9;
            speechSynthesis.speak(utter);
        }
    });
    studyElements.nextBtn?.addEventListener('click', nextCard);
    studyElements.prevBtn?.addEventListener('click', prevCard);
    studyElements.backBtn?.addEventListener('click', () => { window.location.hash = 'dashboard-flashcard'; });
    
    studyElements.card?.querySelectorAll('.fs-star-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (studyCards[studyIndex]) {
                window.toggleStarCard(studyCards[studyIndex].front);
            }
        });
    });
    studyElements.starredOnlyBtn?.addEventListener('click', toggleStarredOnly);
    
    // Dropdown logic
    const modeBtn = document.getElementById('fs-mode-btn');
    const modeMenu = document.getElementById('fs-mode-menu');
    const modeOptions = document.querySelectorAll('#fs-mode-menu .fs-dropdown-option');
    
    const moreBtn = document.getElementById('fs-more-btn');
    const moreMenu = document.getElementById('fs-more-menu');

    document.addEventListener('click', () => {
        modeBtn?.parentElement.classList.remove('open');
        moreBtn?.parentElement.classList.remove('open');
    });

    if (modeBtn && modeMenu) {
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            moreBtn?.parentElement.classList.remove('open');
            modeBtn.parentElement.classList.toggle('open');
        });

        modeOptions.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = opt.dataset.mode;
                
                modeOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                modeBtn.innerHTML = opt.innerHTML + ' <i class="fas fa-chevron-down"></i>';

                if (mode === 'Learn') {
                    modeBtn.parentElement.classList.remove('open');
                    document.getElementById('fs-card-container').parentElement.classList.add('hidden');
                    document.getElementById('fs-learn-body').classList.remove('hidden');
                    
                    const learnElementsMap = {
                        setupScreen: document.getElementById('fs-learn-setup'),
                        playScreen: document.getElementById('fs-learn-play'),
                        resultsScreen: document.getElementById('fs-learn-results'),
                        startBtn: document.getElementById('fs-learn-start-btn'),
                        quitBtn: document.getElementById('fs-learn-quit-btn'),
                        nextBtn: document.getElementById('fs-learn-next-btn'),
                        overrideBtn: document.getElementById('fs-learn-override-btn'),
                        restartBtn: document.getElementById('fs-learn-restart-btn'),
                        backToFlashcardBtn: document.getElementById('fs-learn-back-btn'),
                        timerToggle: document.getElementById('fs-learn-timer-toggle'),
                        starredToggle: document.getElementById('fs-learn-starred-toggle'),
                        starredHint: document.getElementById('fs-learn-starred-hint'),
                        qcountSelect: document.getElementById('fs-learn-qcount'),
                        progressText: document.getElementById('fs-learn-progress'),
                        timerDisplay: document.getElementById('fs-learn-timer-display'),
                        qContainer: document.getElementById('fs-learn-question-container'),
                        feedbackArea: document.getElementById('fs-learn-feedback'),
                        feedbackBanner: document.getElementById('fs-learn-feedback-banner'),
                        feedbackTitle: document.getElementById('fs-learn-feedback-title'),
                        feedbackText: document.getElementById('fs-learn-feedback-text'),
                        scoreDisplay: document.getElementById('fs-learn-score'),
                        correctCountDisplay: document.getElementById('fs-learn-correct-count')
                    };
                    initLearnMode(originalStudyCards, learnElementsMap, starredCardsList);
                } else if (mode === 'flashcard') {
                    modeBtn.parentElement.classList.remove('open');
                    document.getElementById('fs-card-container').parentElement.classList.remove('hidden');
                    document.getElementById('fs-learn-body').classList.add('hidden');
                } else {
                    alert('Chế độ "' + mode + '" đang được phát triển (Coming soon)!');
                }
            });
        });
    }

    if (moreBtn && moreMenu) {
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modeBtn?.parentElement.classList.remove('open');
            moreBtn.parentElement.classList.toggle('open');
        });
    }

    // Advanced feature bindings
    studyElements.shuffleBtn?.addEventListener('click', toggleShuffle);
    studyElements.autoplayBtn?.addEventListener('click', toggleAutoPlay);
    studyElements.settingsBtn?.addEventListener('click', openSettings);
    studyElements.fullscreenBtn?.addEventListener('click', toggleFullscreen);
    
    fsSettingsModal.closeBtn?.addEventListener('click', closeSettings);
    fsSettingsModal.backdrop?.addEventListener('click', closeSettings);
    fsSettingsModal.saveBtn?.addEventListener('click', saveSettings);
    studyElements.editBtn?.addEventListener('click', () => {
        if (currentStudySetId && personalSets.some(s => s.id === currentStudySetId)) {
            openPersonalEditor(currentStudySetId);
            window.location.hash = `student-flashcard-editor-${currentStudySetId}`;
        }
    });
    studyElements.exportBtn?.addEventListener('click', () => {
        exportFlashcardToText();
        const moreBtn = document.getElementById('fs-more-btn');
        moreBtn?.parentElement.classList.remove('open');
    });
    studyElements.deleteBtn?.addEventListener('click', async () => {
        if (currentStudySetId && personalSets.some(s => s.id === currentStudySetId)) {
            await deletePersonalSet(currentStudySetId);
            if (!personalSets.some(s => s.id === currentStudySetId)) {
                window.location.hash = 'dashboard-flashcard';
            }
        }
    });
    document.addEventListener('keydown', handleStudyKeydown);

    return {
        onTabActive() { loadStudentFlashcardSets(); },
        onEditorOpen(setId) { openPersonalEditor(setId || null); },
        onStudyOpen(setId) { openStudy(setId); }
    };
}

function handleTabCardClick(e) {
    const studyBtn = e.target.closest('.fc-card-study');
    if (studyBtn) {
        window.location.hash = `flashcard-study-${studyBtn.dataset.id}`;
    }
}
