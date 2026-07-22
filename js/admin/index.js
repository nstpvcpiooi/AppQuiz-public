import { db } from '../firebase-init.js';
import { doc, updateDoc, addDoc, collection, Timestamp } from '../firebase-init.js';
import { signInAdmin, signOutAdmin, changeAdminPassword, formatAuthError } from '../admin-auth.js';
import { SCREENS, FIREBASE_COLLECTIONS, QUIZ_VISIBILITY } from '../constants.js';
import { dom, debounce, csv, isEffectivelyEmptyHtml, initCustomSelect } from '../utils.js';
import { getSyncableExplanationItems } from '../sub-quiz-utils.js';

import { AI_CONFIG } from '../config/ai.js';
import { adminState, elements } from './state.js';
import { getTeacherUid, isOwnedStudentUsername, canManageItem, getTeacherOwnerFields } from './auth.js';
import {
    setStudentCallbacks, restoreAdminQuizListPrefs, saveAdminQuizListPrefs,
    activateAdminTab, navigateAdminTab, loadAdminData,
    setQuizSelected, setSelectAllVisibleQuizzes,
    clearQuizSelection, renderAdminQuizList,
    bulkDeleteQuizzes, loadQuizzes,
    renderResultsTable, updateResultsSelectionUI, getSelectableResults,
    clearResultSelection, loadStudents, renderStudentsList
} from './dashboard.js';
import { loadQuizForView, setupQuizView, closeQuizViewExportMenu, toggleQuizViewExportMenu, exportViewingQuiz, deleteQuiz } from './quiz-view.js';
import {
    updateAdminResultDetailFilterBtn, renderAdminResultDetailContent,
    renderAdminResultDetailPage, getAdminResultById,
    setupAdminResultDetailScreen, resetAdminResultDetailScreen
} from './results.js';
import { buildSubQuizFromSelectedWrongAnswers, initReviewSubQuizScreen, saveReviewSubQuiz, openReviewSubQuizInStudio } from './sub-quiz.js';
import { initSmartImportQuill, focusSmartImportEditor, updateSmartPreview } from './smart-import.js';
import { normalizeStudentUsername, openEditStudentModal, closeEditStudentModal, saveEditStudent, deleteStudent, isStudentUsernameAvailable } from './student-manager.js';
import { initAdminFlashcard } from './flashcard.js';
import {
    navigateAfterEditorExit, resetEditorForCreate, updateEditorSubQuizSyncUI,
    loadQuizForEdit, openAssignModal, openBulkAssignModal, closeAssignModal,
    openMixQuizModal, closeMixQuizModal, renderStudentCheckboxes,
    getSelectedStudentsFrom, updateEditorVisibilityPanel,
    populateQuizBuilder, mapCSVToQuestions,
    addQuestionCard, addReadingGroupCard, ensureQuizBuilderEmptyState,
    getAllQuestionCardsInBuilder, closeBulkAiConfirmModal,
    getBulkAiConfirmMode, generateAllExplanationsBulk,
    getQuizBuilderQuestionsInOrder, updateAssignModalVisibilityPanel,
    getAssignVisibility, setAssignVisibility, updateAssignSelectedCount,
    promptCopyExplanationsToSource,
    submitMixQuiz, updateMixPoolInfo, updateMixModalVisibilityPanel
} from './quiz-editor.js';

export function initAdmin() {
    // ── Init ─────────────────────────────────────────────────────
    restoreAdminQuizListPrefs();

    [elements.adminQuizFilterType, elements.adminQuizSort, elements.adminQuizGroup]
        .filter(Boolean)
        .forEach((selectEl) => initCustomSelect(selectEl));

    // ── Login ────────────────────────────────────────────────────
    function setAdminLoginError(message = '') {
        if (!elements.adminLoginError) return;
        if (message) { elements.adminLoginError.textContent = message; dom.show(elements.adminLoginError); }
        else { elements.adminLoginError.textContent = ''; dom.hide(elements.adminLoginError); }
    }

    function setChangePasswordError(message = '') {
        if (!elements.changePasswordError) return;
        if (message) { elements.changePasswordError.textContent = message; dom.show(elements.changePasswordError); }
        else { elements.changePasswordError.textContent = ''; dom.hide(elements.changePasswordError); }
    }

    function openChangePasswordModal() {
        if (!elements.changePasswordModal) return;
        setChangePasswordError('');
        elements.changePasswordForm?.reset();
        dom.show(elements.changePasswordModal);
        elements.changePasswordModal.setAttribute('aria-hidden', 'false');
        elements.changePasswordCurrent?.focus();
    }

    function closeChangePasswordModal() {
        if (!elements.changePasswordModal) return;
        dom.hide(elements.changePasswordModal);
        elements.changePasswordModal.setAttribute('aria-hidden', 'true');
        setChangePasswordError('');
        elements.changePasswordForm?.reset();
    }

    elements.teacherLoginLink?.addEventListener('click', (e) => {
        e.preventDefault();
        setAdminLoginError('');
        adminState.router?.navigate(SCREENS.ADMIN_LOGIN);
    });

    elements.backToStudentLogin?.addEventListener('click', () => {
        setAdminLoginError('');
        adminState.router?.navigate(SCREENS.LOGIN);
    });

    elements.adminLoginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        setAdminLoginError('');
        const email = elements.adminEmailInput?.value || '';
        const password = elements.passwordInput?.value || '';
        if (!email || !password) return;
        const submitBtn = elements.adminLoginForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        try {
            await signInAdmin(email, password);
            elements.passwordInput.value = '';
            adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
        } catch (err) {
            setAdminLoginError(formatAuthError(err));
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    elements.adminLogoutBtn?.addEventListener('click', async () => {
        try { await signOutAdmin(); } catch (err) { console.error('Admin logout error:', err); }
        adminState.router?.navigate(SCREENS.ADMIN_LOGIN);
    });

    elements.adminChangePasswordBtn?.addEventListener('click', openChangePasswordModal);
    elements.changePasswordClose?.addEventListener('click', closeChangePasswordModal);
    elements.changePasswordBackdrop?.addEventListener('click', closeChangePasswordModal);
    document.getElementById('change-password-cancel-btn')?.addEventListener('click', closeChangePasswordModal);

    elements.changePasswordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        setChangePasswordError('');
        const currentPassword = elements.changePasswordCurrent?.value || '';
        const newPassword = elements.changePasswordNew?.value || '';
        const confirmPassword = elements.changePasswordConfirm?.value || '';
        if (newPassword.length < 6) { setChangePasswordError('New password must be at least 6 characters.'); return; }
        if (newPassword !== confirmPassword) { setChangePasswordError('New passwords do not match.'); return; }
        if (elements.changePasswordSubmit) elements.changePasswordSubmit.disabled = true;
        try {
            await changeAdminPassword(currentPassword, newPassword);
            closeChangePasswordModal();
            alert('Password updated successfully.');
        } catch (err) {
            setChangePasswordError(formatAuthError(err));
        } finally {
            if (elements.changePasswordSubmit) elements.changePasswordSubmit.disabled = false;
        }
    });

    // ── Tabs ─────────────────────────────────────────────────────
    elements.tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => { navigateAdminTab(btn.dataset.tab); });
    });

    // ── Quiz List ────────────────────────────────────────────────
    const scheduleQuizListRender = debounce(renderAdminQuizList, 200);
    elements.adminQuizSearch?.addEventListener('input', scheduleQuizListRender);
    elements.adminQuizFilterType?.addEventListener('change', renderAdminQuizList);
    elements.adminQuizSort?.addEventListener('change', () => { saveAdminQuizListPrefs(); renderAdminQuizList(); });
    elements.adminQuizGroup?.addEventListener('change', () => { saveAdminQuizListPrefs(); renderAdminQuizList(); });

    elements.adminQuizzesList?.addEventListener('click', (e) => {
        if (e.target.closest('.admin-quiz-row-check')) return;
        const row = e.target.closest('.admin-quiz-row[data-quiz-id]');
        if (row?.dataset.quizId) loadQuizForView(row.dataset.quizId);
    });
    elements.adminQuizzesList?.addEventListener('change', (e) => {
        if (!e.target.classList.contains('admin-quiz-row-checkbox')) return;
        setQuizSelected(e.target.dataset.quizId, e.target.checked);
    });
    elements.adminQuizzesList?.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('admin-quiz-row-checkbox')) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.admin-quiz-row[data-quiz-id]');
        if (!row?.dataset.quizId) return;
        e.preventDefault();
        loadQuizForView(row.dataset.quizId);
    });

    elements.adminQuizSelectAll?.addEventListener('change', (e) => {
        setSelectAllVisibleQuizzes(e.target.checked);
    });
    elements.adminQuizBulkAccess?.addEventListener('click', () => { openBulkAssignModal(); });
    elements.adminQuizBulkMix?.addEventListener('click', () => { openMixQuizModal(); });
    elements.adminQuizBulkDelete?.addEventListener('click', () => { bulkDeleteQuizzes(); });
    elements.adminQuizClearSelection?.addEventListener('click', () => { clearQuizSelection(); });

    // ── Student callbacks ────────────────────────────────────────
    setStudentCallbacks(openEditStudentModal, deleteStudent);

    // ── Results Tab ──────────────────────────────────────────────
    elements.adminResultsSelectAll?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        getSelectableResults().forEach((r) => {
            if (checked) adminState.selectedResultIds.add(r.id);
            else adminState.selectedResultIds.delete(r.id);
        });
        updateResultsSelectionUI();
        renderResultsTable();
    });
    elements.adminResultsClearSelection?.addEventListener('click', clearResultSelection);
    elements.btnResultsWrongSubquiz?.addEventListener('click', buildSubQuizFromSelectedWrongAnswers);

    // ── Result Detail Screen ─────────────────────────────────────
    elements.adminResultDetailBackBtn?.addEventListener('click', () => {
        resetAdminResultDetailScreen();
        navigateAdminTab('tab-results');
    });
    elements.adminResultDetailWrongFilterBtn?.addEventListener('click', () => {
        if (!adminState.adminResultDetailContext) return;
        adminState.adminResultDetailContext.incorrectOnly = !adminState.adminResultDetailContext.incorrectOnly;
        renderAdminResultDetailContent();
    });

    // ── Students Tab ─────────────────────────────────────────────
    elements.addStudentForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = normalizeStudentUsername(elements.newStudentInput?.value);
        if (!username) return;
        const submitBtn = elements.addStudentBtn;
        if (submitBtn) submitBtn.disabled = true;
        try {
            const available = await isStudentUsernameAvailable(username);
            if (!available) { alert('This username is already taken.'); return; }
            await addDoc(collection(db, FIREBASE_COLLECTIONS.STUDENTS), {
                username, ...getTeacherOwnerFields(), createdAt: Timestamp.now()
            });
            elements.newStudentInput.value = '';
            await loadStudents();
        } catch (err) { console.error(err); alert('Error adding student'); }
        finally { if (submitBtn) submitBtn.disabled = false; }
    });

    elements.adminStudentSearch?.addEventListener('input', () => { renderStudentsList(); });

    elements.editStudentClose?.addEventListener('click', closeEditStudentModal);
    elements.editStudentBackdrop?.addEventListener('click', closeEditStudentModal);
    elements.editStudentCancelBtn?.addEventListener('click', closeEditStudentModal);
    elements.editStudentForm?.addEventListener('submit', saveEditStudent);

    // ── Quiz View ────────────────────────────────────────────────
    elements.quizViewBackBtn?.addEventListener('click', () => {
        adminState.viewingQuizId = null;
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
    });
    elements.quizViewExportBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleQuizViewExportMenu();
    });
    elements.quizViewExportMenu?.querySelectorAll('.quiz-view-export-option').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportViewingQuiz(btn.dataset.format === 'md' ? 'md' : 'txt');
        });
    });

    document.addEventListener('click', (e) => {
        if (!elements.quizViewExportMenu?.classList.contains('hidden')
            && !e.target.closest('.quiz-view-export-dropdown')) {
            closeQuizViewExportMenu();
        }
    });

    elements.quizViewEditBtn?.addEventListener('click', () => {
        const quiz = adminState.quizzesById[adminState.viewingQuizId];
        if (quiz) loadQuizForEdit(adminState.viewingQuizId, quiz);
    });
    elements.quizViewAssignBtn?.addEventListener('click', () => {
        const quiz = adminState.quizzesById[adminState.viewingQuizId];
        if (quiz) openAssignModal(adminState.viewingQuizId, quiz);
    });
    elements.quizViewDeleteBtn?.addEventListener('click', () => {
        if (adminState.viewingQuizId) deleteQuiz(adminState.viewingQuizId, { redirectToDashboard: true });
    });

    // ── Smart Import ─────────────────────────────────────────────
    elements.btnSmartImport?.addEventListener('click', () => {
        adminState.router?.navigate(SCREENS.ADMIN_SMART_IMPORT);
    });
    elements.smartImportBackBtn?.addEventListener('click', () => {
        const hasContent = adminState.smartImportQuill ? adminState.smartImportQuill.getText().trim().length > 0 : false;
        if (hasContent && !confirm("Discard your changes and exit?")) return;
        if (adminState.smartImportQuill) adminState.smartImportQuill.setContents([]);
        updateSmartPreview();
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
    });
    elements.smartImportClearBtn?.addEventListener('click', () => {
        if (adminState.smartImportQuill) adminState.smartImportQuill.setContents([]);
        updateSmartPreview();
    });
    elements.smartImportConfirmBtn?.addEventListener('click', () => {
        if (adminState.parsedQuestions.length === 0) return;
        resetEditorForCreate();
        adminState.viewingQuizId = null;
        populateQuizBuilder(adminState.parsedQuestions);
        if (adminState.smartImportQuill) adminState.smartImportQuill.setContents([]);
        updateSmartPreview();
        adminState.router?.navigate(SCREENS.ADMIN_EDITOR);
    });

    // ── Review Sub-Quiz ──────────────────────────────────────────
    elements.reviewSubQuizBackBtn?.addEventListener('click', () => {
        adminState.reviewSubQuizQuestions = [];
        adminState.reviewSubQuizSourceIds = [];
        adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
    });
    elements.reviewSubQuizSaveBtn?.addEventListener('click', saveReviewSubQuiz);
    elements.reviewSubQuizStudioBtn?.addEventListener('click', openReviewSubQuizInStudio);

    // ── CSV Import ───────────────────────────────────────────────
    elements.csvImportInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const rows = csv.parse(event.target.result);
                const questions = mapCSVToQuestions(rows);
                resetEditorForCreate();
                adminState.viewingQuizId = null;
                populateQuizBuilder(questions);
                document.getElementById('qb-title').value = file.name.replace('.csv', '');
                adminState.router?.navigate(SCREENS.ADMIN_EDITOR);
            } catch (err) { alert("Error parsing CSV: " + err.message); }
            elements.csvImportInput.value = '';
        };
        reader.readAsText(file);
    });

    // ── Quiz Editor ──────────────────────────────────────────────
    elements.btnCreateQuiz?.addEventListener('click', () => {
        resetEditorForCreate();
        adminState.viewingQuizId = null;
        dom.setHTML(elements.qbQuestionsContainer, '');
        ensureQuizBuilderEmptyState();
        document.getElementById('qb-title').value = '';
        document.getElementById('qb-time').value = '';
        renderStudentCheckboxes(elements.qbStudentsList, []);
        adminState.router?.navigate(SCREENS.ADMIN_EDITOR);
    });

    elements.qbBackBtn?.addEventListener('click', () => {
        if (elements.qbQuestionsContainer.children.length > 0 && !confirm("Discard changes?")) return;
        resetEditorForCreate();
        navigateAfterEditorExit();
    });

    elements.qbAddQuestionBtn?.addEventListener('click', () => {
        const emptyState = elements.qbQuestionsContainer.querySelector('.studio-empty-state');
        if (emptyState) emptyState.remove();
        addQuestionCard({ type: 'multiple_choice' });
        ensureQuizBuilderEmptyState();
    });

    elements.qbAddGroupBtn?.addEventListener('click', () => {
        const emptyState = elements.qbQuestionsContainer.querySelector('.studio-empty-state');
        if (emptyState) emptyState.remove();
        addReadingGroupCard({ passage: '', questions: [] });
        ensureQuizBuilderEmptyState();
    });

    elements.qbChangeAllBtn?.addEventListener('click', () => {
        const newType = elements.qbChangeAllType?.value || '';
        if (!newType) return;
        const current = getQuizBuilderQuestionsInOrder();
        if (current.length === 0) { alert("No questions to update."); return; }
        const updated = current.map(q => {
            const next = { ...q, type: newType };
            if (!String(newType).startsWith('reading_')) delete next.passage;
            else if (!next.passage) next.passage = '';
            return next;
        });
        populateQuizBuilder(updated);
        alert(`Updated ${updated.length} questions to: ${newType.replace(/_/g, ' ')}`);
    });

    document.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('#qb-change-all-btn');
        if (!btn) return;
        if (btn === elements.qbChangeAllBtn) return;
        const typeSel = document.getElementById('qb-change-all-type');
        const newType = typeSel?.value || '';
        if (!newType) return;
        const current = getQuizBuilderQuestionsInOrder();
        if (current.length === 0) { alert("No questions to update."); return; }
        const updated = current.map(q => {
            const next = { ...q, type: newType };
            if (!String(newType).startsWith('reading_')) delete next.passage;
            else if (!next.passage) next.passage = '';
            return next;
        });
        populateQuizBuilder(updated);
        alert(`Updated ${updated.length} questions to: ${newType.replace(/_/g, ' ')}`);
    });

    const modelDropdownBtn = document.getElementById('qb-ai-model-btn');
    const modelMenu = document.getElementById('qb-ai-model-menu');
    const modelLabel = document.getElementById('qb-ai-model-label');
    
    if (modelDropdownBtn && modelMenu && modelLabel) {
        const updateModelConfig = (val) => {
            const [provider, model] = val.split(':');
            AI_CONFIG.preferredProvider = provider;
            AI_CONFIG.model = model;
            if (provider === 'google') {
                AI_CONFIG.geminiModels = [model];
            } else {
                // Ensure Gemini fallback doesn't happen accidentally by explicitly clearing the models list
                AI_CONFIG.geminiModels = [];
            }
        };

        modelDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            modelDropdownBtn.parentElement.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!modelDropdownBtn.parentElement.contains(e.target)) {
                modelDropdownBtn.parentElement.classList.remove('open');
            }
        });

        modelMenu.querySelectorAll('.fs-dropdown-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                modelMenu.querySelectorAll('.fs-dropdown-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                modelLabel.textContent = opt.textContent.trim();
                updateModelConfig(opt.dataset.value);
                modelDropdownBtn.parentElement.classList.remove('open');
            });
        });

        const defaultVal = (AI_CONFIG.preferredProvider && AI_CONFIG.model) 
            ? `${AI_CONFIG.preferredProvider}:${AI_CONFIG.model}` 
            : 'beeknoee:gpt-5.5';
        const defaultOpt = modelMenu.querySelector(`.fs-dropdown-option[data-value="${defaultVal}"]`) || modelMenu.querySelector('.fs-dropdown-option');
        if (defaultOpt) {
            modelMenu.querySelectorAll('.fs-dropdown-option').forEach(o => o.classList.remove('active'));
            defaultOpt.classList.add('active');
            modelLabel.textContent = defaultOpt.textContent.trim();
            updateModelConfig(defaultOpt.dataset.value);
        }
    }

    elements.qbGenerateExplanationsBtn?.addEventListener('click', () => { generateAllExplanationsBulk(); });

    elements.qbBulkAiCancelBtn?.addEventListener('click', () => closeBulkAiConfirmModal(null));
    elements.qbBulkAiModalClose?.addEventListener('click', () => closeBulkAiConfirmModal(null));
    elements.qbBulkAiModalBackdrop?.addEventListener('click', () => closeBulkAiConfirmModal(null));
    elements.qbBulkAiConfirmBtn?.addEventListener('click', () => {
        const withOptions = !elements.qbBulkAiOptions?.classList.contains('hidden');
        const mode = withOptions ? getBulkAiConfirmMode() : 'all';
        if (mode === 'missing_only') {
            const missingRadio = document.querySelector('input[name="qb-bulk-ai-mode"][value="missing_only"]');
            if (missingRadio?.disabled) return;
        }
        closeBulkAiConfirmModal(mode);
    });

    elements.qbStopExplanationsBtn?.addEventListener('click', () => {
        adminState.bulkExplanationAbortController?.abort();
        elements.qbStopExplanationsBtn?.toggleAttribute('disabled', true);
    });

    elements.qbSyncExplanationsBtn?.addEventListener('click', async () => {
        const questions = getQuizBuilderQuestionsInOrder();
        const syncItems = getSyncableExplanationItems(questions, (html) => !isEffectivelyEmptyHtml(html));
        if (!syncItems.length) { alert('No linked questions with explanations to copy to source quizzes.'); return; }
        const result = await promptCopyExplanationsToSource(syncItems);
        if (result.declined) return;
        if (result.updated > 0) {
            alert(`Copied ${result.updated} explanation(s) to source quiz(es).`);
        } else if (result.skipped > 0) {
            alert(`No explanations were copied (${result.skipped} skipped — source not found or already the same).`);
        } else {
            alert('Source explanations are already up to date.');
        }
    });

    elements.qbSaveBtn?.addEventListener('click', async () => {
        if (adminState.bulkExplanationRunning) return;
        const title = document.getElementById('qb-title').value.trim();
        const mode = document.getElementById('qb-mode').value;
        const timeLimitMinutes = parseInt(document.getElementById('qb-time').value) || 0;
        const timeLimit = timeLimitMinutes > 0 ? timeLimitMinutes * 60 : 0;
        const visibility = elements.qbVisibility?.value || QUIZ_VISIBILITY.MY_STUDENTS;
        if (!title) { alert("Please enter a Quiz Title"); return; }
        const questions = getQuizBuilderQuestionsInOrder();
        if (questions.length === 0) { alert("Please add at least one question."); return; }
        const assignedStudents = visibility === QUIZ_VISIBILITY.SPECIFIC
            ? getSelectedStudentsFrom(elements.qbStudentsList).filter((u) => isOwnedStudentUsername(u))
            : [];
        if (visibility === QUIZ_VISIBILITY.SPECIFIC && assignedStudents.length === 0) {
            alert('Please select at least one of your students for specific assignment, or choose another access option.');
            return;
        }
        const existingQuiz = adminState.editingQuizId ? adminState.quizzesById[adminState.editingQuizId] : null;
        const quizPayload = {
            title, mode, timeLimit, questions, visibility, assignedStudents,
            ...(adminState.pendingSubQuizMeta || {}),
            ...(adminState.editingSubQuizMeta?.isSubQuiz ? {
                isSubQuiz: true,
                sourceQuizIds: adminState.editingSubQuizMeta.sourceQuizIds?.length
                    ? adminState.editingSubQuizMeta.sourceQuizIds
                    : (existingQuiz?.sourceQuizIds || [])
            } : {})
        };
        if (existingQuiz && !existingQuiz.createdByUid) {
            Object.assign(quizPayload, getTeacherOwnerFields());
        }
        let wasEditing = Boolean(adminState.editingQuizId);
        try {
            elements.qbSaveBtn.disabled = true;
            dom.setHTML(elements.qbSaveBtn, '<i class="fas fa-spinner fa-spin"></i> Saving...');
            if (adminState.editingQuizId) {
                await updateDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, adminState.editingQuizId), quizPayload);
                adminState.quizzesById[adminState.editingQuizId] = { id: adminState.editingQuizId, ...quizPayload };
                alert('Quiz updated successfully!');
            } else {
                await addDoc(collection(db, FIREBASE_COLLECTIONS.QUIZZES), {
                    ...quizPayload, ...getTeacherOwnerFields(), createdAt: Timestamp.now()
                });
                alert('Quiz created successfully!');
            }
            adminState.pendingSubQuizMeta = null;
            adminState.editingSubQuizMeta = null;
            const returnToView = adminState.viewingQuizId && adminState.editingQuizId === adminState.viewingQuizId;
            resetEditorForCreate();
            if (returnToView) {
                adminState.router?.navigate(`admin-view-${adminState.viewingQuizId}`);
            } else {
                adminState.router?.navigate(SCREENS.ADMIN_DASHBOARD);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to save quiz: " + e.message);
        } finally {
            elements.qbSaveBtn.disabled = false;
            dom.setHTML(elements.qbSaveBtn, wasEditing
                ? '<i class="fas fa-save"></i> Update Quiz'
                : '<i class="fas fa-save"></i> Save Quiz');
        }
    });

    // ── Assign Modal ─────────────────────────────────────────────
    elements.assignModalClose?.addEventListener('click', closeAssignModal);
    elements.assignModalBackdrop?.addEventListener('click', closeAssignModal);
    elements.assignCancelBtn?.addEventListener('click', closeAssignModal);
    elements.qbVisibility?.addEventListener('change', updateEditorVisibilityPanel);
    document.querySelectorAll('input[name="assign-visibility"]').forEach(radio => {
        radio.addEventListener('change', updateAssignModalVisibilityPanel);
    });

    elements.assignSaveBtn?.addEventListener('click', async () => {
        if (!adminState.assignQuizIds.length || !db) return;
        const uid = getTeacherUid();
        adminState.assignQuizIds = adminState.assignQuizIds.filter((id) => canManageItem(adminState.quizzesById[id], uid));
        if (!adminState.assignQuizIds.length) { alert('You can only manage access for quizzes you created.'); return; }
        const visibility = getAssignVisibility();
        const assignedStudents = visibility === QUIZ_VISIBILITY.SPECIFIC
            ? getSelectedStudentsFrom(elements.assignStudentsList).filter((u) => isOwnedStudentUsername(u))
            : [];
        if (visibility === QUIZ_VISIBILITY.SPECIFIC && assignedStudents.length === 0) {
            alert('Please select at least one student, or choose a different visibility option.');
            return;
        }
        const payload = { visibility, assignedStudents };
        try {
            elements.assignSaveBtn.disabled = true;
            await Promise.all(adminState.assignQuizIds.map((id) =>
                updateDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, id), payload)
            ));
            adminState.assignQuizIds.forEach((id) => {
                if (adminState.quizzesById[id]) {
                    adminState.quizzesById[id].visibility = visibility;
                    adminState.quizzesById[id].assignedStudents = assignedStudents;
                }
                if (adminState.viewingQuizId === id) {
                    const quiz = adminState.quizzesById[id];
                    dom.setText(elements.quizViewTitle, quiz?.title || 'View Quiz');
                }
            });
            if (adminState.assignQuizIds.length > 1) adminState.selectedQuizIds.clear();
            closeAssignModal();
            loadQuizzes();
        } catch (e) { console.error(e); alert('Failed to update access settings: ' + e.message); }
        finally { elements.assignSaveBtn.disabled = false; }
    });

    // ── Mix Quiz Modal ───────────────────────────────────────────
    elements.mixQuizModalClose?.addEventListener('click', closeMixQuizModal);
    elements.mixQuizModalBackdrop?.addEventListener('click', closeMixQuizModal);
    elements.mixQuizCancelBtn?.addEventListener('click', closeMixQuizModal);
    elements.mixQuizForm?.addEventListener('submit', submitMixQuiz);
    elements.mixQuizCount?.addEventListener('input', updateMixPoolInfo);
    document.querySelectorAll('input[name="mix-visibility"]').forEach((radio) => {
        radio.addEventListener('change', updateMixModalVisibilityPanel);
    });

    // ── Flashcard ─────────────────────────────────────────────────
    const adminFlashcard = initAdminFlashcard();

    // ── Return object ────────────────────────────────────────────
    return {
        onNavigate(screen, params) {
            closeAssignModal();
            closeMixQuizModal();
            closeQuizViewExportMenu();
            closeEditStudentModal();
            const fcModal = document.getElementById('fc-assign-modal');
            if (fcModal && !fcModal.classList.contains('hidden')) {
                fcModal.classList.add('hidden');
                fcModal.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('modal-open');
            }

            if (screen !== SCREENS.ADMIN_RESULT_DETAIL) {
                resetAdminResultDetailScreen();
            }

            if (screen === SCREENS.ADMIN_DASHBOARD) {
                activateAdminTab(params?.adminDashboardTab || 'tab-quizzes');
                loadAdminData();
                if (params?.adminDashboardTab === 'tab-flashcard') {
                    adminFlashcard.onTabActive();
                }
            }
            if (screen === SCREENS.ADMIN_VIEW && params?.quizId) setupQuizView(params.quizId);
            if (screen === SCREENS.ADMIN_EDITOR && !adminState.editingQuizId) {
                renderStudentCheckboxes(elements.qbStudentsList, []);
                updateEditorVisibilityPanel();
            }
            if (screen === SCREENS.ADMIN_SMART_IMPORT) {
                initSmartImportQuill();
                focusSmartImportEditor();
            }
            if (screen === SCREENS.ADMIN_REVIEW_SUB_QUIZ) {
                initReviewSubQuizScreen();
            }
            if (screen === SCREENS.ADMIN_RESULT_DETAIL && params?.resultId) {
                setupAdminResultDetailScreen(params.resultId);
            }
            if (screen === SCREENS.ADMIN_FLASHCARD_EDITOR) {
                adminFlashcard.onEditorOpen(params?.setId || null);
            }
        },
        setRouter(r) { adminState.router = r; }
    };
}
