import { db } from '../firebase-init.js';
import { collection, addDoc, updateDoc, doc, Timestamp } from '../firebase-init.js';
import { SCREENS, FIREBASE_COLLECTIONS, QUIZ_VISIBILITY, EXPLANATION_SOURCE } from '../constants.js';
import { dom, escapeHtml, isEffectivelyEmptyHtml, isSubQuizItem } from '../utils.js';
import { adminState, elements } from './state.js';
import { getTeacherUid, assertCanManage, isOwnedStudentUsername, getTeacherOwnerFields, canManageItem, filterVisibleToTeacher } from './auth.js';
import { generateExplanation, AiExplanationError, isAiExplanationAvailable, formatExplanationModelLabel } from '../ai-explanation.js';
import { isAiReviewableSource, normalizeExplanationSource } from '../explanation-source.js';
import { SmartParser } from '../parser.js';
import { collectQuestionsFromQuizzes, pickRandomQuestions } from '../sub-quiz-utils.js';
import { loadQuizzes } from './dashboard.js';

const quillToolbarOptions = [
    ['bold', 'italic', 'underline'],
    [{ 'color': [] }],
    ['clean']
];

// ─── Editor Navigation ──────────────────────────────────────────

export function navigateAfterEditorExit() {
    if (adminState.viewingQuizId) {
        adminState.router?.navigate(`admin-view-${adminState.viewingQuizId}`);
    } else {
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
    }
}

export function resetEditorForCreate() {
    adminState.editingQuizId = null;
    adminState.pendingSubQuizMeta = null;
    adminState.editingSubQuizMeta = null;
    dom.setText(elements.editorPageTitle, 'Create New Quiz');
    dom.setHTML(elements.qbSaveBtn, '<i class="fas fa-save"></i> Save Quiz');
    if (elements.qbVisibility) elements.qbVisibility.value = QUIZ_VISIBILITY.MY_STUDENTS;
    dom.hide(elements.qbStudentsPanel);
    updateEditorSubQuizSyncUI();
}

export function updateEditorSubQuizSyncUI() {
    if (!elements.qbSyncExplanationsBtn) return;
    if (!adminState.editingSubQuizMeta?.isSubQuiz) { dom.hide(elements.qbSyncExplanationsBtn); return; }
    const hasLinkable = getQuizBuilderQuestionsInOrder().some((q) => q.sourceQuizId && q.sourceQuestionId);
    if (hasLinkable) dom.show(elements.qbSyncExplanationsBtn);
    else dom.hide(elements.qbSyncExplanationsBtn);
}

async function syncExplanationsToSourceQuizzes(syncItems) {
    const byQuiz = new Map();
    for (const item of syncItems || []) {
        if (!item?.sourceQuizId || !item?.sourceQuestionId) continue;
        if (!byQuiz.has(item.sourceQuizId)) byQuiz.set(item.sourceQuizId, []);
        byQuiz.get(item.sourceQuizId).push(item);
    }
    let updated = 0, skipped = 0;
    const uid = getTeacherUid();
    for (const [quizId, items] of byQuiz) {
        let sourceQuiz = adminState.quizzesById[quizId];
        if (!sourceQuiz) {
            try {
                const snap = await getDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, quizId));
                if (snap.exists()) {
                    sourceQuiz = { id: snap.id, ...snap.data() };
                    adminState.quizzesById[quizId] = sourceQuiz;
                }
            } catch (err) { console.error(err); }
        }
        if (!sourceQuiz || !canManageItem(sourceQuiz, uid)) { skipped += items.length; continue; }
        const questions = (sourceQuiz.questions || []).map((q) => ({ ...q }));
        let changed = false;
        for (const item of items) {
            const idx = questions.findIndex((q) => q.id === item.sourceQuestionId);
            if (idx < 0) { skipped += 1; continue; }
            if (String(questions[idx].explanation ?? '') === String(item.explanation ?? '')
                && String(questions[idx].explanationSource ?? '') === String(item.explanationSource ?? '')) continue;
            questions[idx] = { ...questions[idx], explanation: item.explanation ?? '', explanationSource: item.explanationSource ?? questions[idx].explanationSource ?? '' };
            changed = true; updated += 1;
        }
        if (changed) {
            await updateDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, quizId), { questions });
            adminState.quizzesById[quizId] = { ...sourceQuiz, questions };
        }
    }
    return { updated, skipped };
}

export async function promptCopyExplanationsToSource(syncItems) {
    if (!syncItems?.length) return { updated: 0, skipped: 0, declined: true };
    const n = syncItems.length;
    const message = n === 1
        ? 'Copy this explanation to the source quiz? This overwrites the explanation on the original question.'
        : `Copy ${n} explanations to their source quizzes? This overwrites explanations on the original questions.`;
    if (!confirm(message)) return { updated: 0, skipped: 0, declined: true };
    return syncExplanationsToSourceQuizzes(syncItems);
}

export function loadQuizForEdit(docId, data) {
    if (!assertCanManage(data)) return;
    adminState.editingQuizId = docId;
    adminState.editingSubQuizMeta = isSubQuizItem(data)
        ? { isSubQuiz: true, sourceQuizIds: data.sourceQuizIds || [] }
        : null;
    dom.setText(elements.editorPageTitle, isSubQuizItem(data) ? 'Edit Sub-Quiz' : 'Edit Quiz');
    dom.setHTML(elements.qbSaveBtn, '<i class="fas fa-save"></i> Update Quiz');
    document.getElementById('qb-title').value = data.title || '';
    document.getElementById('qb-mode').value = data.mode || 'practice';
    const mins = data.timeLimit ? Math.floor(data.timeLimit / 60) : 0;
    document.getElementById('qb-time').value = mins > 0 ? String(mins) : '';
    if (elements.qbVisibility) elements.qbVisibility.value = data.visibility || QUIZ_VISIBILITY.ALL;
    renderStudentCheckboxes(elements.qbStudentsList, data.assignedStudents || []);
    updateEditorVisibilityPanel();
    populateQuizBuilder(data.questions || []);
    updateEditorSubQuizSyncUI();
    adminState.router?.navigate(SCREENS.ADMIN_EDITOR);
}

// ─── Assign Modal ───────────────────────────────────────────────

export function openAssignModal(docId, data) {
    if (!assertCanManage(data)) return;
    adminState.assignQuizIds = [docId];
    dom.setText(elements.assignModalQuizName, data.title || docId);
    setAssignVisibility(data.visibility || QUIZ_VISIBILITY.ALL);
    renderStudentCheckboxes(elements.assignStudentsList, data.assignedStudents || [], { onChange: updateAssignSelectedCount });
    updateAssignModalVisibilityPanel();
    dom.show(elements.assignModal);
    elements.assignModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

export function openBulkAssignModal() {
    const uid = getTeacherUid();
    const ids = [...adminState.selectedQuizIds].filter((id) => canManageItem(adminState.quizzesById[id], uid));
    if (!ids.length) { alert('You can only manage access for quizzes you created.'); return; }
    if (ids.length !== adminState.selectedQuizIds.size) alert('Some selected quizzes were skipped because you do not own them.');
    adminState.assignQuizIds = ids;
    const quizzes = ids.map((id) => adminState.quizzesById[id]).filter(Boolean);
    if (quizzes.length === 1) dom.setText(elements.assignModalQuizName, quizzes[0].title || quizzes[0].id);
    else dom.setText(elements.assignModalQuizName, `${quizzes.length} quizzes selected`);
    const visibilities = new Set(quizzes.map((q) => q.visibility || QUIZ_VISIBILITY.ALL));
    let initialVis = QUIZ_VISIBILITY.ALL, initialStudents = [];
    if (visibilities.size === 1) {
        initialVis = [...visibilities][0];
        if (initialVis === QUIZ_VISIBILITY.SPECIFIC) initialStudents = [...new Set(quizzes.flatMap((q) => q.assignedStudents || []))];
    }
    setAssignVisibility(initialVis);
    renderStudentCheckboxes(elements.assignStudentsList, initialStudents, { onChange: updateAssignSelectedCount });
    updateAssignModalVisibilityPanel();
    dom.show(elements.assignModal);
    elements.assignModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

export function closeAssignModal() {
    adminState.assignQuizIds = [];
    dom.hide(elements.assignModal);
    elements.assignModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

// ─── Mix Quiz Modal ─────────────────────────────────────────────

function setMixQuizError(message) {
    if (!elements.mixQuizError) return;
    if (message) { dom.setText(elements.mixQuizError, message); dom.show(elements.mixQuizError); }
    else { dom.setText(elements.mixQuizError, ''); dom.hide(elements.mixQuizError); }
}

function getMixVisibility() {
    return document.querySelector('input[name="mix-visibility"]:checked')?.value || QUIZ_VISIBILITY.MY_STUDENTS;
}

function setMixVisibility(value) {
    const radio = document.querySelector(`input[name="mix-visibility"][value="${value}"]`);
    if (radio) radio.checked = true;
    else {
        const fallback = document.querySelector(`input[name="mix-visibility"][value="${QUIZ_VISIBILITY.MY_STUDENTS}"]`);
        if (fallback) fallback.checked = true;
    }
}

function updateMixSelectedCount() {
    if (!elements.mixSelectedCount) return;
    const count = getSelectedStudentsFrom(elements.mixStudentsList).length;
    dom.setText(elements.mixSelectedCount, `${count} selected`);
}

export function updateMixModalVisibilityPanel() {
    const visibility = getMixVisibility();
    if (visibility === QUIZ_VISIBILITY.SPECIFIC) { dom.show(elements.mixStudentsPanel); updateMixSelectedCount(); }
    else dom.hide(elements.mixStudentsPanel);
}

export function updateMixPoolInfo() {
    if (!elements.mixQuizPoolInfo || !elements.mixQuizCount) return;
    elements.mixQuizCount.max = String(adminState.mixPoolSize);
    const requested = parseInt(elements.mixQuizCount.value, 10);
    const hasInvalidCount = Number.isFinite(requested) && requested > adminState.mixPoolSize;
    if (adminState.mixPoolSize === 0) dom.setText(elements.mixQuizPoolInfo, 'Selected quizzes have no questions.');
    else if (!Number.isFinite(requested) || requested <= 0) dom.setText(elements.mixQuizPoolInfo, `${adminState.mixPoolSize} questions available. 0 = shuffle all questions.`);
    else if (hasInvalidCount) dom.setText(elements.mixQuizPoolInfo, `Cannot exceed ${adminState.mixPoolSize} questions (pool size).`);
    else dom.setText(elements.mixQuizPoolInfo, `${adminState.mixPoolSize} questions available. Will pick ${requested} at random after shuffle.`);
}

export function openMixQuizModal() {
    const uid = getTeacherUid();
    const ids = [...adminState.selectedQuizIds].filter((id) => canManageItem(adminState.quizzesById[id], uid));
    if (!ids.length) { alert('Select at least one quiz you created to mix.'); return; }
    if (ids.length !== adminState.selectedQuizIds.size) alert('Some selected quizzes were skipped because you do not own them.');
    const quizzes = ids.map((id) => adminState.quizzesById[id]).filter(Boolean);
    const pool = collectQuestionsFromQuizzes(quizzes);
    if (!pool.length) { alert('Selected quizzes have no questions to mix.'); return; }
    adminState.mixSourceQuizIds = ids;
    adminState.mixPoolSize = pool.length;
    setMixQuizError('');
    if (elements.mixQuizModalSubtitle) {
        const label = quizzes.length === 1 ? quizzes[0].title || quizzes[0].id : `${quizzes.length} quizzes · ${pool.length} questions in pool`;
        dom.setText(elements.mixQuizModalSubtitle, label);
    }
    if (elements.mixQuizTitle) elements.mixQuizTitle.value = quizzes.length === 1 ? `Mix — ${quizzes[0].title || 'Quiz'}` : `Mixed Quiz (${quizzes.length} sources)`;
    if (elements.mixQuizMode) elements.mixQuizMode.value = 'practice';
    if (elements.mixQuizTime) elements.mixQuizTime.value = '';
    if (elements.mixQuizCount) { elements.mixQuizCount.value = '0'; elements.mixQuizCount.min = '0'; elements.mixQuizCount.max = String(adminState.mixPoolSize); }
    setMixVisibility(QUIZ_VISIBILITY.MY_STUDENTS);
    renderStudentCheckboxes(elements.mixStudentsList, [], { onChange: updateMixSelectedCount });
    updateMixModalVisibilityPanel();
    updateMixPoolInfo();
    dom.show(elements.mixQuizModal);
    elements.mixQuizModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    elements.mixQuizTitle?.focus();
}

export function closeMixQuizModal() {
    adminState.mixSourceQuizIds = [];
    adminState.mixPoolSize = 0;
    setMixQuizError('');
    elements.mixQuizForm?.reset();
    if (elements.mixQuizCount) elements.mixQuizCount.value = '0';
    dom.hide(elements.mixQuizModal);
    elements.mixQuizModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

export async function submitMixQuiz(e) {
    e?.preventDefault();
    if (!adminState.mixSourceQuizIds.length || !db) return;
    const title = elements.mixQuizTitle?.value.trim();
    const mode = elements.mixQuizMode?.value || 'practice';
    const timeLimitMinutes = parseInt(elements.mixQuizTime?.value, 10) || 0;
    const timeLimit = timeLimitMinutes > 0 ? timeLimitMinutes * 60 : 0;
    const countRaw = elements.mixQuizCount?.value;
    const count = countRaw === '' ? 0 : parseInt(countRaw, 10);
    if (!title) { setMixQuizError('Please enter a quiz title.'); return; }
    if (!Number.isFinite(count) || count < 0) { setMixQuizError('Enter a valid number of questions (0 or more).'); return; }
    if (count > adminState.mixPoolSize) { setMixQuizError(`Cannot pick more than ${adminState.mixPoolSize} questions.`); return; }
    const visibility = getMixVisibility();
    const assignedStudents = visibility === QUIZ_VISIBILITY.SPECIFIC
        ? getSelectedStudentsFrom(elements.mixStudentsList).filter((username) => isOwnedStudentUsername(username))
        : [];
    if (visibility === QUIZ_VISIBILITY.SPECIFIC && !assignedStudents.length) { setMixQuizError('Select at least one student for specific access.'); return; }
    const quizzes = adminState.mixSourceQuizIds.map((id) => adminState.quizzesById[id]).filter(Boolean);
    const poolTagged = buildTaggedQuestionPool(quizzes);
    const result = pickRandomQuestions(poolTagged, count);
    const questions = result.questions.map(stripSubQuizMeta);
    if (!questions.length) { setMixQuizError('No questions could be generated from the selected quizzes.'); return; }
    const submitBtn = elements.mixQuizSubmitBtn;
    if (submitBtn) submitBtn.disabled = true;
    try {
        await addDoc(collection(db, FIREBASE_COLLECTIONS.QUIZZES), {
            title, mode, timeLimit, questions, isSubQuiz: true,
            sourceQuizIds: [...adminState.mixSourceQuizIds], visibility, assignedStudents,
            ...getTeacherOwnerFields(), createdAt: Timestamp.now()
        });
        closeMixQuizModal();
        const { clearQuizSelection } = await import('./dashboard.js');
        clearQuizSelection();
        await loadQuizzes();
        alert('Mixed quiz created successfully!');
    } catch (err) { console.error(err); setMixQuizError('Failed to create mixed quiz: ' + (err.message || 'Unknown error')); }
    finally { if (submitBtn) submitBtn.disabled = false; }
}

// ─── Student Checkboxes ─────────────────────────────────────────

export function renderStudentCheckboxes(container, selectedUsernames = [], { onChange } = {}) {
    if (!container) return;
    const selected = new Set(selectedUsernames.map(s => String(s).trim().toLowerCase()));
    const visibleStudents = filterVisibleToTeacher(adminState.allStudents);
    if (!visibleStudents.length) {
        dom.setHTML(container, '<p class="text-muted text-sm assign-students-empty">No students registered yet.</p>');
        if (onChange) onChange(0);
        return;
    }
    dom.setHTML(container, '');
    visibleStudents.forEach(student => {
        const username = student.username;
        const label = document.createElement('label');
        label.className = 'student-checkbox-item';
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(username)}" ${selected.has(username) ? 'checked' : ''}><span>${escapeHtml(username)}</span>`;
        label.querySelector('input').addEventListener('change', () => {
            if (onChange) onChange(getSelectedStudentsFrom(container).length);
        });
        container.appendChild(label);
    });
    if (onChange) onChange(getSelectedStudentsFrom(container).length);
}

export function getAssignVisibility() {
    return document.querySelector('input[name="assign-visibility"]:checked')?.value || QUIZ_VISIBILITY.MY_STUDENTS;
}

export function setAssignVisibility(value) {
    const radio = document.querySelector(`input[name="assign-visibility"][value="${value}"]`);
    if (radio) radio.checked = true;
    else {
        const fallback = document.querySelector(`input[name="assign-visibility"][value="${QUIZ_VISIBILITY.MY_STUDENTS}"]`);
        if (fallback) fallback.checked = true;
    }
}

export function updateAssignSelectedCount() {
    if (!elements.assignSelectedCount) return;
    dom.setText(elements.assignSelectedCount, `${getSelectedStudentsFrom(elements.assignStudentsList).length} selected`);
}

export function getSelectedStudentsFrom(container) {
    return Array.from(container?.querySelectorAll('input[type="checkbox"]:checked') || []).map(cb => cb.value.trim().toLowerCase());
}

export function updateEditorVisibilityPanel() {
    const visibility = elements.qbVisibility?.value || QUIZ_VISIBILITY.MY_STUDENTS;
    if (visibility === QUIZ_VISIBILITY.SPECIFIC) dom.show(elements.qbStudentsPanel);
    else dom.hide(elements.qbStudentsPanel);
}

export function updateAssignModalVisibilityPanel() {
    const visibility = getAssignVisibility();
    if (visibility === QUIZ_VISIBILITY.SPECIFIC) { dom.show(elements.assignStudentsPanel); updateAssignSelectedCount(); }
    else dom.hide(elements.assignStudentsPanel);
}

// ─── CSV Import ─────────────────────────────────────────────────

export function mapCSVToQuestions(rows) {
    if (rows.length < 2) throw new Error("CSV is empty or missing data.");
    const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    const dataRows = rows.slice(1);
    const questions = [];
    let currentPassage = '';
    dataRows.forEach(row => {
        const getVal = (colName) => { const idx = headers.findIndex(h => h.includes(colName)); return idx !== -1 && row[idx] ? row[idx] : ''; };
        const type = getVal('type') || 'multiple_choice';
        const passageRaw = getVal('passage');
        const text = getVal('question');
        if (!text && type !== 'reading_group') return;
        if (type.startsWith('reading_')) { if (passageRaw) currentPassage = passageRaw; }
        else currentPassage = '';
        questions.push({
            type, passage: currentPassage, text,
            options: [getVal('optiona'), getVal('optionb'), getVal('optionc'), getVal('optiond')].filter(Boolean),
            correctAnswer: getVal('correctanswer') || getVal('correct'),
            explanation: getVal('explanation'),
            explanationSource: getVal('explanation') ? EXPLANATION_SOURCE.TEACHER : ''
        });
    });
    return questions;
}

// ─── Quiz Builder ───────────────────────────────────────────────

export function populateQuizBuilder(questions) {
    dom.setHTML(elements.qbQuestionsContainer, '');
    const list = Array.isArray(questions) ? questions : [];
    const groupByPassage = new Map();
    list.forEach((q) => {
        const isReading = String(q?.type || '').startsWith('reading_');
        if (!isReading) { addQuestionCard(q, { scroll: false }); return; }
        const passageHtml = q.passage || '';
        let g = groupByPassage.get(passageHtml);
        if (!g) {
            g = addReadingGroupCard({ passage: passageHtml, questions: [] }, { scroll: false });
            groupByPassage.set(passageHtml, g);
        }
        const qWrap = g.querySelector('.qb-group-questions');
        const child = addQuestionCard({
            id: q.id, type: q.type, text: q.text, options: q.options,
            correctAnswer: q.correctAnswer, explanation: q.explanation,
            blankNumber: q.blankNumber, sourceQuizId: q.sourceQuizId,
            sourceQuestionId: q.sourceQuestionId,
            explanationSource: q.explanationSource,
            explanationModel: q.explanationModel,
            explanationProvider: q.explanationProvider
        }, { scroll: false, inGroup: true, groupCard: g });
        qWrap.appendChild(child);
    });
    ensureQuizBuilderEmptyState();
    updateEditorSubQuizSyncUI();
}

export function ensureQuizBuilderEmptyState() {
    const hasCards = elements.qbQuestionsContainer.querySelector('.qb-question-card');
    const emptyState = elements.qbQuestionsContainer.querySelector('.studio-empty-state');
    if (hasCards) { if (emptyState) emptyState.remove(); return; }
    if (emptyState) return;
    const wrap = document.createElement('div');
    wrap.className = 'empty-state studio-empty-state';
    wrap.innerHTML = `<i class="fas fa-layer-group" style="font-size: 3rem; color: var(--border); margin-bottom: 1.5rem; display: block;"></i><h4 class="text-muted">No questions added yet</h4><p class="text-muted">Choose a question type below to get started</p>`;
    elements.qbQuestionsContainer.appendChild(wrap);
}

function getPassageHtmlForQuestionCard(card) {
    const group = card.closest('.qb-group-card');
    if (group?.quillPassage) return group.quillPassage.root.innerHTML;
    if (card.quillPassage) return card.quillPassage.root.innerHTML;
    return '';
}

function getQuestionDataFromCard(card) {
    const type = card.dataset.type;
    const options = Array.from(card.querySelectorAll('.qb-opt')).map((opt) => opt.value.trim()).filter(Boolean);
    let correctAnswer = '';
    if (type === 'reading_fill_essay') correctAnswer = (card.querySelector('.qb-correct-text')?.value || '').trim();
    else if (options.length > 0) {
        const letter = (card.dataset.correctLetter || '').toUpperCase();
        const optIdx = ['A', 'B', 'C', 'D'].indexOf(letter);
        if (optIdx >= 0 && options[optIdx]) correctAnswer = options[optIdx];
    }
    return { type, text: card.quillText ? card.quillText.root.innerHTML : '', passage: getPassageHtmlForQuestionCard(card), options, correctAnswer };
}

function hasCardExplanation(card) {
    const html = card.quillExplanation?.root?.innerHTML || '';
    return !isEffectivelyEmptyHtml(html);
}

function setCardExplanationSource(card, source) {
    const normalized = normalizeExplanationSource(source);
    if (normalized) {
        card.dataset.explanationSource = normalized;
        if (!isAiReviewableSource(normalized)) {
            delete card.dataset.explanationModel;
            delete card.dataset.explanationProvider;
        }
    } else {
        delete card.dataset.explanationSource;
        delete card.dataset.explanationModel;
        delete card.dataset.explanationProvider;
    }
    updateCardExplanationSourceUi(card);
}

function updateCardExplanationSourceUi(card) {
    const sourceToggle = card.querySelector('.qb-explanation-source-toggle');
    const reviewToggle = card.querySelector('.qb-explanation-review-toggle');
    const src = card.dataset.explanationSource || '';
    const hasExpl = hasCardExplanation(card);
    const showSourceToggle = hasExpl;
    sourceToggle?.classList.toggle('hidden', !showSourceToggle);
    if (showSourceToggle && sourceToggle) {
        const isAiTag = isAiReviewableSource(src);
        sourceToggle.querySelectorAll('.qb-explanation-source-btn').forEach((btn) => {
            const pick = btn.dataset.source;
            const isActive = pick === 'teacher' ? src === EXPLANATION_SOURCE.TEACHER : isAiTag;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }
    const showReview = hasExpl && isAiReviewableSource(src);
    reviewToggle?.classList.toggle('hidden', !showReview);
    if (showReview && reviewToggle) {
        reviewToggle.querySelectorAll('.qb-explanation-review-btn').forEach((btn) => {
            const state = btn.dataset.reviewState;
            const isActive = state === EXPLANATION_SOURCE.AI_APPROVED ? src === EXPLANATION_SOURCE.AI_APPROVED : src === EXPLANATION_SOURCE.AI;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    const modelEl = card.querySelector('.qb-ai-explain-model');
    if (modelEl) {
        if (isAiReviewableSource(src) && modelEl.title.trim() !== '') {
            modelEl.classList.remove('hidden');
        } else {
            modelEl.classList.add('hidden');
        }
    }
}

function applyExplanationHtmlToCard(card, html, source) {
    if (!card.quillExplanation) return;
    card._explanationProgrammatic = true;
    card.quillExplanation.root.innerHTML = html || '';
    if (source) setCardExplanationSource(card, source);
    else if (isEffectivelyEmptyHtml(html)) setCardExplanationSource(card, '');
    updateCardExplanationSourceUi(card);
    requestAnimationFrame(() => { card._explanationProgrammatic = false; });
}

function getCardAiExplainBtn(card) { return card?.querySelector('.qb-ai-explain-btn') || null; }

function saveCardAiExplainBtnOriginal(btn) { if (btn && !btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML; }

function restoreCardAiExplainBtnOriginal(btn) { if (btn?.dataset.originalHtml) { btn.innerHTML = btn.dataset.originalHtml; delete btn.dataset.originalHtml; } }

function setCardAiExplainWaiting(card) {
    const btn = getCardAiExplainBtn(card);
    if (!btn) return;
    saveCardAiExplainBtnOriginal(btn);
    btn.disabled = true;
    btn.classList.add('is-loading', 'is-bulk-waiting');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Waiting…';
}

function setAllCardsAiExplainBulkRunning(running) {
    getAllQuestionCardsInBuilder().forEach((card) => {
        if (running) { setCardAiExplainWaiting(card); return; }
        const btn = getCardAiExplainBtn(card);
        btn?.classList.remove('is-loading', 'is-bulk-waiting');
        if (btn) { btn.disabled = false; restoreCardAiExplainBtnOriginal(btn); }
        const modelEl = card.querySelector('.qb-ai-explain-model');
        if (modelEl?.title.trim() === 'generating…') setCardAiExplainModelLabel(card, null);
    });
}

function setCardAiExplainModelLabel(card, meta = null) {
    const el = card?.querySelector('.qb-ai-explain-model');
    if (!el) return;
    if (!meta) {
        el.title = ''; el.classList.add('hidden');
        delete card.dataset.explanationModel;
        delete card.dataset.explanationProvider;
        return;
    }
    if (meta.pending) { el.title = 'generating…'; el.classList.remove('hidden'); return; }
    if (meta.model) card.dataset.explanationModel = meta.model;
    if (meta.provider) card.dataset.explanationProvider = meta.provider;
    const label = formatExplanationModelLabel({ provider: meta.provider, model: meta.model });
    if (label) { el.title = label; el.classList.remove('hidden'); }
    else { el.title = ''; el.classList.add('hidden'); }
}

function setCardAiExplainLoading(card, loading) {
    const btn = getCardAiExplainBtn(card);
    if (!btn) return;
    if (loading) {
        saveCardAiExplainBtnOriginal(btn);
        btn.disabled = true;
        btn.classList.add('is-loading');
        btn.classList.remove('is-bulk-waiting');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Generating…';
        setCardAiExplainModelLabel(card, { pending: true });
        return;
    }
    btn.classList.remove('is-loading', 'is-bulk-waiting');
    if (adminState.bulkExplanationRunning) { setCardAiExplainWaiting(card); return; }
    btn.disabled = false;
    restoreCardAiExplainBtnOriginal(btn);
}

function updateBulkExplanationProgress(completed, total, meta = {}) {
    const totalCount = Math.max(0, total);
    const done = Math.min(Math.max(0, completed), totalCount);
    const pct = totalCount > 0 ? Math.round((done / totalCount) * 100) : 0;
    if (elements.qbAiBulkProgressFill) elements.qbAiBulkProgressFill.style.width = `${pct}%`;
    if (elements.qbAiBulkProgressText) {
        elements.qbAiBulkProgressText.textContent = totalCount > 0
            ? `Generating AI explanations… ${pct}% (${done}/${totalCount})`
            : 'Generating AI explanations… 0%';
    }
    const modelEl = elements.qbAiBulkProgressModel;
    if (!modelEl) return;
    const questionNum = Number(meta.questionNum);
    const hasQuestionNum = Number.isFinite(questionNum) && questionNum > 0;
    const modelLabel = meta.model ? formatExplanationModelLabel({ provider: meta.provider, model: meta.model }) : '';
    if (meta.pending && hasQuestionNum) { modelEl.textContent = `Question ${questionNum}: generating…`; modelEl.classList.remove('hidden'); }
    else if (hasQuestionNum && modelLabel) { modelEl.textContent = `Question ${questionNum}: ${modelLabel}`; modelEl.classList.remove('hidden'); }
    else if (modelLabel) { modelEl.textContent = modelLabel; modelEl.classList.remove('hidden'); }
    else { modelEl.textContent = ''; modelEl.classList.add('hidden'); }
}

function setBulkExplanationUiRunning(running) {
    adminState.bulkExplanationRunning = running;
    elements.qbGenerateExplanationsBtn?.toggleAttribute('disabled', running);
    elements.qbStopExplanationsBtn?.classList.toggle('hidden', !running);
    if (elements.qbStopExplanationsBtn) elements.qbStopExplanationsBtn.disabled = false;
    elements.qbAiBulkProgress?.classList.toggle('hidden', !running);
    elements.qbSaveBtn?.toggleAttribute('disabled', running);
    setAllCardsAiExplainBulkRunning(running);
    if (!running) updateBulkExplanationProgress(0, 0);
}

async function generateExplanationForCard(card, { force = false, signal, skipExistingConfirm = false } = {}) {
    if (!card || card.classList.contains('qb-group-card')) return false;
    if (signal?.aborted) return 'aborted';
    if (adminState.bulkExplanationRunning && signal !== adminState.bulkExplanationAbortController?.signal) return false;
    if (!isAiExplanationAvailable()) { alert('Configure Gemini and/or Beeknoee API key in js/ai.config.js (see ai.config.example.js).'); return false; }
    if (hasCardExplanation(card) && !force) {
        if (skipExistingConfirm) return false;
        if (!confirm('This question already has an explanation. Replace it with a new AI-generated one?')) return false;
    }
    const questionData = getQuestionDataFromCard(card);
    setCardAiExplainLoading(card, true);
    try {
        const { html, model, provider } = await generateExplanation(questionData, { signal });
        if (signal?.aborted) return 'aborted';
        applyExplanationHtmlToCard(card, html, EXPLANATION_SOURCE.AI);
        setCardAiExplainModelLabel(card, { model, provider });
        return { ok: true, model, provider };
    } catch (err) {
        if (signal?.aborted || err?.name === 'AbortError') { setCardAiExplainModelLabel(card, null); return 'aborted'; }
        console.error(err);
        setCardAiExplainModelLabel(card, null);
        const message = err instanceof AiExplanationError ? err.message : (err.message || 'Failed to generate explanation.');
        if (!adminState.bulkExplanationRunning) alert(message);
        return false;
    } finally { setCardAiExplainLoading(card, false); }
}

export function getAllQuestionCardsInBuilder() {
    return Array.from(elements.qbQuestionsContainer?.querySelectorAll('.qb-question-card:not(.qb-group-card)') || []);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function closeBulkAiConfirmModal(result = null) {
    dom.hide(elements.qbBulkAiModal);
    elements.qbBulkAiModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (adminState.bulkAiConfirmResolve) {
        adminState.bulkAiConfirmResolve(result);
        adminState.bulkAiConfirmResolve = null;
    }
}

export function getBulkAiConfirmMode() {
    return document.querySelector('input[name="qb-bulk-ai-mode"]:checked')?.value || 'all';
}

function openBulkAiConfirmModal({ total, withExplanation }) {
    const withoutExplanation = Math.max(0, total - withExplanation);
    const hasExisting = withExplanation > 0;
    if (elements.qbBulkAiModalDesc) {
        if (!hasExisting) elements.qbBulkAiModalDesc.textContent = `Generate AI explanations for all ${total} question${total === 1 ? '' : 's'} in this quiz?`;
        else elements.qbBulkAiModalDesc.textContent = `${withExplanation} question${withExplanation === 1 ? ' has' : 's have'} an explanation already. Choose what to generate.`;
    }
    elements.qbBulkAiOptions?.classList.toggle('hidden', !hasExisting);
    if (hasExisting) {
        if (elements.qbBulkAiMissingCount) elements.qbBulkAiMissingCount.textContent = withoutExplanation > 0
            ? `Generate for ${withoutExplanation} remaining question${withoutExplanation === 1 ? '' : 's'}`
            : 'No questions left without an explanation';
        if (elements.qbBulkAiAllCount) elements.qbBulkAiAllCount.textContent = `Regenerate all ${total} question${total === 1 ? '' : 's'} (replace existing)`;
        const missingRadio = document.querySelector('input[name="qb-bulk-ai-mode"][value="missing_only"]');
        const allRadio = document.querySelector('input[name="qb-bulk-ai-mode"][value="all"]');
        if (missingRadio) missingRadio.disabled = withoutExplanation === 0;
        elements.qbBulkAiModeMissingLabel?.classList.toggle('is-disabled', withoutExplanation === 0);
        if (withoutExplanation > 0 && missingRadio) missingRadio.checked = true;
        else if (allRadio) allRadio.checked = true;
    }
    dom.show(elements.qbBulkAiModal);
    elements.qbBulkAiModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    return new Promise((resolve) => { adminState.bulkAiConfirmResolve = resolve; });
}

export async function generateAllExplanationsBulk() {
    if (adminState.bulkExplanationRunning) return;
    if (!isAiExplanationAvailable()) { alert('Configure Gemini and/or Beeknoee API key in js/ai.config.js (see ai.config.example.js).'); return; }
    const cards = getAllQuestionCardsInBuilder();
    if (!cards.length) { alert('Add at least one question first.'); return; }
    const withExplanation = cards.filter((card) => hasCardExplanation(card)).length;
    const choice = await openBulkAiConfirmModal({ total: cards.length, withExplanation });
    if (!choice) return;
    const cardsToProcess = choice === 'missing_only' ? cards.filter((card) => !hasCardExplanation(card)) : cards;
    if (!cardsToProcess.length) { alert('No questions selected for generation.'); return; }
    adminState.bulkExplanationAbortController = new AbortController();
    const { signal } = adminState.bulkExplanationAbortController;
    const total = cardsToProcess.length;
    const replaceExisting = choice === 'all';
    let ok = 0, failed = 0, stopped = false;
    setBulkExplanationUiRunning(true);
    updateBulkExplanationProgress(0, total);
    try {
        for (let i = 0; i < cardsToProcess.length; i++) {
            if (signal.aborted) { stopped = true; break; }
            updateBulkExplanationProgress(i, total, { questionNum: i + 1, pending: true });
            const result = await generateExplanationForCard(cardsToProcess[i], { force: replaceExisting, signal, skipExistingConfirm: true });
            if (result === 'aborted') { stopped = true; break; }
            if (result?.ok) { ok += 1; updateBulkExplanationProgress(i + 1, total, { questionNum: i + 1, model: result.model, provider: result.provider }); }
            else failed += 1;
            updateBulkExplanationProgress(i + 1, total);
            if (i < cardsToProcess.length - 1 && !signal.aborted) await sleep(450);
        }
    } finally {
        adminState.bulkExplanationAbortController = null;
        setBulkExplanationUiRunning(false);
        if (stopped) alert(`Stopped. Generated ${ok} explanation(s)${failed ? `; ${failed} failed.` : '.'}`);
        else if (ok > 0) alert(`Generated ${ok} explanation(s)${failed ? `; ${failed} failed.` : '.'}`);
        else if (failed > 0) alert('Could not generate explanations. Check your API keys (Gemini / Beeknoee) and quota.');
    }
}

// ─── Question Card ──────────────────────────────────────────────

export function addQuestionCard(q = {}, opts = { scroll: true, inGroup: false, groupCard: null }) {
    const initialType = q.type || (opts?.inGroup ? 'reading_mcq' : 'multiple_choice');
    const qId = q.id || ('q_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    const card = document.createElement('div');
    card.className = 'qb-question-card';
    card.dataset.type = initialType;
    card.dataset.id = qId;
    const getTypeLabel = (t) => {
        if (t === 'multiple_choice') return 'Multiple Choice';
        if (t === 'pronunciation') return 'Pronunciation';
        if (t === 'reading_mcq') return 'Reading (MCQ)';
        if (t === 'reading_fill_mcq') return 'Reading Fill (Choice)';
        if (t === 'reading_fill_essay') return 'Reading Fill (Text)';
        return String(t || '').replace(/_/g, ' ');
    };
    const standaloneTypeOptions = [
        { value: 'multiple_choice', label: 'Multiple Choice' },
        { value: 'pronunciation', label: 'Pronunciation' }
    ];
    const groupReadingTypeOptions = [
        { value: 'reading_mcq', label: 'Reading (MCQ)' },
        { value: 'reading_fill_mcq', label: 'Reading Fill (Choice)' },
        { value: 'reading_fill_essay', label: 'Reading Fill (Text)' }
    ];
    const typeOptions = opts?.inGroup ? groupReadingTypeOptions : standaloneTypeOptions;
    const defaultType = opts?.inGroup ? 'reading_mcq' : 'multiple_choice';
    card.dataset.type = typeOptions.some(o => o.value === initialType) ? initialType : defaultType;
    if (q.blankNumber != null) card.dataset.blankNumber = String(q.blankNumber);
    if (q.sourceQuizId) card.dataset.sourceQuizId = q.sourceQuizId;
    if (q.sourceQuestionId) card.dataset.sourceQuestionId = q.sourceQuestionId;
    if (q.explanationSource) {
        card.dataset.explanationSource = q.explanationSource;
    } else if (q.explanationModel) {
        card.dataset.explanationSource = EXPLANATION_SOURCE.AI;
    }
    if (q.explanationModel) card.dataset.explanationModel = q.explanationModel;
    if (q.explanationProvider) card.dataset.explanationProvider = q.explanationProvider;

    const serializeCard = (c) => {
        const options = Array.from(c.querySelectorAll('.qb-opt')).map(opt => opt.value.trim()).filter(Boolean);
        const correctLetter = (c.dataset.correctLetter || '').toUpperCase();
        const correctText = (c.querySelector('.qb-correct-text')?.value || '').trim();
        const data = {
            id: c.dataset.id, type: c.dataset.type,
            passage: c.quillPassage ? c.quillPassage.root.innerHTML : '',
            text: c.quillText ? c.quillText.root.innerHTML : '',
            options, correctAnswer: c.dataset.type === 'reading_fill_essay' ? correctText : (correctLetter || ''),
            explanation: c.quillExplanation ? c.quillExplanation.root.innerHTML : ''
        };
        if (c.dataset.explanationSource) data.explanationSource = c.dataset.explanationSource;
        if (c.dataset.explanationModel) data.explanationModel = c.dataset.explanationModel;
        if (c.dataset.explanationProvider) data.explanationProvider = c.dataset.explanationProvider;
        if (c.dataset.blankNumber) data.blankNumber = parseInt(c.dataset.blankNumber, 10);
        if (c.dataset.sourceQuizId) data.sourceQuizId = c.dataset.sourceQuizId;
        if (c.dataset.sourceQuestionId) data.sourceQuestionId = c.dataset.sourceQuestionId;
        return data;
    };

    const replaceCardWithType = (newType) => {
        const data = serializeCard(card);
        data.type = newType;
        data.id = card.dataset.id;
        const pageScrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
        const newCard = addQuestionCard(data, { scroll: false, inGroup: opts?.inGroup, groupCard: opts?.groupCard });
        card.replaceWith(newCard);
        document.documentElement.scrollTop = pageScrollTop;
        document.body.scrollTop = pageScrollTop;
    };

    card.innerHTML = `
        <div class="qb-card-header">
            <div class="flex items-center gap-4">
                <select class="input-full qb-type-select" aria-label="Question type">
                    ${typeOptions.map(o => `<option value="${o.value}" ${o.value === card.dataset.type ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </div>
            <button type="button" class="qb-remove-btn" title="Delete question"><i class="fas fa-trash"></i></button>
        </div>
        ${card.dataset.type.includes('reading') ? `
            ${opts?.inGroup ? '' : `
                <label class="studio-label text-xs">Reading Passage</label>
                <div class="qb-quill-container mb-6"><div class="qb-passage-editor" style="min-height: 120px;">${q.passage || ''}</div></div>
            `}
        ` : ''}
        <label class="studio-label text-xs">Question Text</label>
        <div class="qb-quill-container mb-6"><div class="qb-text-editor" style="min-height: 80px;">${q.text || ''}</div></div>
        ${card.dataset.type !== 'reading_fill_essay' ? `
            <div class="qb-correct-picker-row">
                <label class="studio-label text-xs" style="margin: 0;">Correct Answer</label>
                <div class="qb-correct-picker" role="group" aria-label="Correct answer">
                    <button type="button" class="qb-correct-pill" data-letter="A">A</button>
                    <button type="button" class="qb-correct-pill" data-letter="B">B</button>
                    <button type="button" class="qb-correct-pill" data-letter="C">C</button>
                    <button type="button" class="qb-correct-pill" data-letter="D">D</button>
                </div>
            </div>
            <div class="qb-options-grid mb-6">
                <div class="qb-opt-wrap">
                    <button type="button" class="qb-opt-label" data-letter="A" aria-label="Mark A as correct">A</button>
                    <input type="text" class="input-full qb-opt" placeholder="Option A" value="${(q.options?.[0] || '').replace(/"/g, '&quot;')}" required>
                </div>
                <div class="qb-opt-wrap">
                    <button type="button" class="qb-opt-label" data-letter="B" aria-label="Mark B as correct">B</button>
                    <input type="text" class="input-full qb-opt" placeholder="Option B" value="${(q.options?.[1] || '').replace(/"/g, '&quot;')}" required>
                </div>
                <div class="qb-opt-wrap">
                    <button type="button" class="qb-opt-label" data-letter="C" aria-label="Mark C as correct">C</button>
                    <input type="text" class="input-full qb-opt" placeholder="Option C" value="${(q.options?.[2] || '').replace(/"/g, '&quot;')}">
                </div>
                <div class="qb-opt-wrap">
                    <button type="button" class="qb-opt-label" data-letter="D" aria-label="Mark D as correct">D</button>
                    <input type="text" class="input-full qb-opt" placeholder="Option D" value="${(q.options?.[3] || '').replace(/"/g, '&quot;')}">
                </div>
            </div>` : ''}
        <div class="qb-footer-row">
            ${card.dataset.type === 'reading_fill_essay' ? `
                <input type="text" class="input-full qb-correct-text" placeholder="Correct Answer" value="${(q.correctAnswer || '').replace(/"/g, '&quot;')}" required>
            ` : '<div></div>'}
            <div class="qb-explanation-container">
                <div class="qb-explanation-header">
                    <label class="studio-label text-xs m-0">Explanation</label>
                    <div class="qb-explanation-header-actions">
                        <i class="fas fa-question-circle qb-ai-explain-model hidden" style="margin: 0 0.5rem; color: var(--text-muted); font-size: 1.1rem; cursor: help;" aria-live="polite" title=""></i>
                        <div class="qb-explanation-source-toggle hidden" role="group" aria-label="Explanation source tag">
                            <button type="button" class="qb-explanation-source-btn" data-source="ai" aria-pressed="false">Generated by AI</button>
                            <button type="button" class="qb-explanation-source-btn" data-source="teacher" aria-pressed="false">Created by Teacher</button>
                        </div>
                        <div class="qb-explanation-review-toggle hidden" role="group" aria-label="AI explanation review status">
                            <button type="button" class="qb-explanation-review-btn" data-review-state="ai" aria-pressed="false">Not reviewed</button>
                            <button type="button" class="qb-explanation-review-btn" data-review-state="ai_approved" aria-pressed="false">Reviewed</button>
                        </div>
                        <button type="button" class="btn-text qb-ai-explain-btn" aria-label="Generate explanation with AI"><i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i> AI generate</button>
                    </div>
                </div>
                <div class="qb-quill-container"><div class="qb-explanation-editor" style="min-height: 120px;">${q.explanation || ''}</div></div>
            </div>
        </div>
    `;

    const removeBtn = card.querySelector('.qb-remove-btn');
    removeBtn.addEventListener('click', () => { card.remove(); ensureQuizBuilderEmptyState(); });
    elements.qbQuestionsContainer.appendChild(card);

    // Initialize Quills
    const qTextEl = card.querySelector('.qb-text-editor');
    const qPassageEl = card.querySelector('.qb-passage-editor');
    const qExplanationEl = card.querySelector('.qb-explanation-editor');
    card.quillText = new Quill(qTextEl, { theme: 'snow', placeholder: 'Type your question here...', modules: { toolbar: quillToolbarOptions } });
    if (qPassageEl) card.quillPassage = new Quill(qPassageEl, { theme: 'snow', placeholder: 'Type your reading passage here...', modules: { toolbar: quillToolbarOptions } });
    card.quillExplanation = new Quill(qExplanationEl, { theme: 'snow', placeholder: 'Explanation (optional)...', modules: { toolbar: quillToolbarOptions } });
    card.quillExplanation.on('text-change', () => {
        if (card._explanationProgrammatic) return;
        const html = card.quillExplanation.root.innerHTML;
        if (isEffectivelyEmptyHtml(html)) setCardExplanationSource(card, '');
        else if (!card.dataset.explanationSource) setCardExplanationSource(card, EXPLANATION_SOURCE.TEACHER);
        updateCardExplanationSourceUi(card);
    });
    updateCardExplanationSourceUi(card);
    if (q.explanationModel || q.explanationProvider) setCardAiExplainModelLabel(card, { model: q.explanationModel, provider: q.explanationProvider });

    const typeSelect = card.querySelector('.qb-type-select');
    if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
            const newType = e.target.value;
            if (newType === card.dataset.type) return;
            replaceCardWithType(newType);
        });
    }

    const setCorrectLetter = (letter) => {
        card.dataset.correctLetter = letter;
        card.querySelectorAll('.qb-correct-pill').forEach(b => b.classList.toggle('selected', b.dataset.letter === letter));
        card.querySelectorAll('.qb-opt-wrap').forEach(w => w.classList.toggle('is-correct', w.querySelector('.qb-opt-label')?.dataset?.letter === letter));
    };

    if (typeof q.correctAnswer === 'string') {
        const raw = q.correctAnswer.trim();
        if (/^[A-D]$/i.test(raw)) setCorrectLetter(raw.toUpperCase());
        else if (raw && Array.isArray(q.options)) {
            const idx = q.options.findIndex(o => String(o).trim() === raw);
            if (idx >= 0) setCorrectLetter(String.fromCharCode(65 + idx));
        }
    }

    card.querySelectorAll('.qb-correct-pill').forEach(btn => btn.addEventListener('click', () => setCorrectLetter(btn.dataset.letter)));
    card.querySelectorAll('.qb-opt-label').forEach(btn => btn.addEventListener('click', () => setCorrectLetter(btn.dataset.letter)));
    card.querySelector('.qb-ai-explain-btn')?.addEventListener('click', () => { if (adminState.bulkExplanationRunning) return; generateExplanationForCard(card); });

    card.querySelector('.qb-explanation-source-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.qb-explanation-source-btn');
        if (!btn || !hasCardExplanation(card)) return;
        const pick = btn.dataset.source;
        if (pick === 'teacher') setCardExplanationSource(card, EXPLANATION_SOURCE.TEACHER);
        else if (pick === 'ai') {
            const current = card.dataset.explanationSource || '';
            setCardExplanationSource(card, current === EXPLANATION_SOURCE.AI_APPROVED ? EXPLANATION_SOURCE.AI_APPROVED : EXPLANATION_SOURCE.AI);
        }
    });

    card.querySelector('.qb-explanation-review-toggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.qb-explanation-review-btn');
        if (!btn) return;
        const state = btn.dataset.reviewState;
        if (state === EXPLANATION_SOURCE.AI_APPROVED) setCardExplanationSource(card, EXPLANATION_SOURCE.AI_APPROVED);
        else if (state === EXPLANATION_SOURCE.AI) setCardExplanationSource(card, EXPLANATION_SOURCE.AI);
    });

    if (opts?.scroll !== false) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return card;
}

export function addReadingGroupCard(group = {}, opts = { scroll: true }) {
    const gId = 'g_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const card = document.createElement('div');
    card.className = 'qb-question-card qb-group-card';
    card.dataset.type = 'reading_group';
    card.dataset.id = gId;
    card.innerHTML = `
        <div class="qb-card-header">
            <div class="flex items-center gap-4">
                <span class="qb-type-select qb-group-badge">Reading Passage Group</span>
            </div>
            <button type="button" class="qb-remove-btn" title="Delete group"><i class="fas fa-trash"></i></button>
        </div>
        <label class="studio-label text-xs">Reading Passage</label>
        <div class="qb-quill-container mb-6"><div class="qb-group-passage-editor" style="min-height: 160px;">${SmartParser.formatPassageHtml(group.passage || '')}</div></div>
        <div class="flex justify-between items-center mb-4">
            <label class="studio-label text-xs m-0">Questions in this passage</label>
            <button type="button" class="btn-secondary qb-group-add-q-btn" style="padding: 0.6rem 1rem; border-radius: 12px;"><i class="fas fa-plus mr-2"></i> Add Question</button>
        </div>
        <div class="qb-group-questions"></div>
    `;
    card.querySelector('.qb-remove-btn').addEventListener('click', () => { card.remove(); ensureQuizBuilderEmptyState(); });
    elements.qbQuestionsContainer.appendChild(card);
    const passageEl = card.querySelector('.qb-group-passage-editor');
    card.quillPassage = new Quill(passageEl, { theme: 'snow', placeholder: 'Type your reading passage here...', modules: { toolbar: quillToolbarOptions } });
    const qWrap = card.querySelector('.qb-group-questions');
    const addChild = (qData = {}) => { const child = addQuestionCard(qData, { scroll: false, inGroup: true, groupCard: card }); qWrap.appendChild(child); ensureQuizBuilderEmptyState(); };
    card.querySelector('.qb-group-add-q-btn').addEventListener('click', () => addChild({ type: 'reading_mcq' }));
    (group.questions || []).forEach(qData => addChild(qData));
    if (opts?.scroll !== false) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return card;
}

function stripSubQuizMeta(q) {
    const { _sourceQuizTitle, ...rest } = q;
    return rest;
}

function buildTaggedQuestionPool(selected) {
    const pool = [];
    selected.forEach((quiz) => {
        (quiz.questions || []).forEach((q, index) => {
            pool.push({ ...q, _sourceQuizTitle: quiz.title || quiz.id, sourceQuizId: quiz.id, sourceQuestionId: q.id || `q_${index}` });
        });
    });
    return pool;
}

export function getQuizBuilderQuestionsInOrder() {
    const topLevel = Array.from(elements.qbQuestionsContainer.children).filter(el => el.classList?.contains('qb-question-card') || el.classList?.contains('qb-group-card'));
    let qIndex = 0;
    const questions = [];
    const serializeQuestionCard = (card, index, passageHtml = null) => {
        const type = card.dataset.type;
        const options = Array.from(card.querySelectorAll('.qb-opt')).map(opt => opt.value.trim()).filter(Boolean);
        let correctAnswer = '';
        if (type === 'reading_fill_essay') correctAnswer = (card.querySelector('.qb-correct-text')?.value || '').trim();
        else if (options.length > 0) {
            const letter = (card.dataset.correctLetter || '').toUpperCase();
            const optIdx = ['A', 'B', 'C', 'D'].indexOf(letter);
            if (optIdx >= 0 && options[optIdx]) correctAnswer = options[optIdx];
        }
        const q = {
            id: card.dataset.id || ('q_' + index), type,
            text: card.quillText ? card.quillText.root.innerHTML : '', options, correctAnswer,
            explanation: card.quillExplanation ? card.quillExplanation.root.innerHTML : ''
        };
        if (card.dataset.explanationSource) q.explanationSource = card.dataset.explanationSource;
        if (card.dataset.explanationModel) q.explanationModel = card.dataset.explanationModel;
        if (card.dataset.explanationProvider) q.explanationProvider = card.dataset.explanationProvider;
        if (card.dataset.blankNumber) q.blankNumber = parseInt(card.dataset.blankNumber, 10);
        if (card.dataset.sourceQuizId) q.sourceQuizId = card.dataset.sourceQuizId;
        if (card.dataset.sourceQuestionId) q.sourceQuestionId = card.dataset.sourceQuestionId;
        const passage = passageHtml || (card.quillPassage ? card.quillPassage.root.innerHTML : null);
        if (passage) q.passage = passage;
        return q;
    };
    topLevel.forEach((el) => {
        if (el.classList.contains('qb-group-card')) {
            const passageHtml = el.quillPassage ? el.quillPassage.root.innerHTML : '';
            const children = Array.from(el.querySelectorAll(':scope .qb-group-questions > .qb-question-card'));
            children.forEach((child) => { questions.push(serializeQuestionCard(child, qIndex++, passageHtml)); });
        } else { questions.push(serializeQuestionCard(el, qIndex++)); }
    });
    return questions;
}
