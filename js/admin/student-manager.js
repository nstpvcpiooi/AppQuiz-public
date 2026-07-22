import { db } from '../firebase-init.js';
import { collection, getDocs, updateDoc, doc, query, where, deleteDoc } from '../firebase-init.js';
import { FIREBASE_COLLECTIONS } from '../constants.js';
import { dom } from '../utils.js';
import { adminState, elements } from './state.js';
import { assertCanManage, getTeacherUid, canManageItem } from './auth.js';
import { loadStudents } from './dashboard.js';

export function normalizeStudentUsername(username) {
    return String(username || '').trim().toLowerCase();
}

export async function isStudentUsernameAvailable(username, excludeStudentId = null) {
    if (!db) return false;
    const normalized = normalizeStudentUsername(username);
    if (!normalized) return false;
    const q = query(collection(db, FIREBASE_COLLECTIONS.STUDENTS), where('username', '==', normalized));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return true;
    if (excludeStudentId && snapshot.docs.length === 1 && snapshot.docs[0].id === excludeStudentId) return true;
    return false;
}

async function getManageableQuizzesFromDb() {
    if (!db) return [];
    const uid = getTeacherUid();
    const snapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.QUIZZES));
    const quizzes = [];
    snapshot.forEach((docSnap) => {
        const quiz = { id: docSnap.id, ...docSnap.data() };
        if (canManageItem(quiz, uid)) quizzes.push(quiz);
    });
    return quizzes;
}

async function syncQuizAssignmentsForUsernameChange(oldUsername, newUsername) {
    const oldName = normalizeStudentUsername(oldUsername);
    const newName = normalizeStudentUsername(newUsername);
    if (!oldName || !newName || oldName === newName) return;
    const quizzes = await getManageableQuizzesFromDb();
    const updates = quizzes.map((quiz) => {
        const assigned = (quiz.assignedStudents || []).map(normalizeStudentUsername);
        if (!assigned.includes(oldName)) return null;
        const nextAssigned = assigned.map((name) => (name === oldName ? newName : name));
        return updateDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, quiz.id), { assignedStudents: nextAssigned });
    }).filter(Boolean);
    if (updates.length) await Promise.all(updates);
}

async function removeUsernameFromQuizAssignments(username) {
    const normalized = normalizeStudentUsername(username);
    if (!normalized) return;
    const quizzes = await getManageableQuizzesFromDb();
    const updates = quizzes.map((quiz) => {
        const assigned = (quiz.assignedStudents || []).map(normalizeStudentUsername);
        if (!assigned.includes(normalized)) return null;
        const nextAssigned = assigned.filter((name) => name !== normalized);
        return updateDoc(doc(db, FIREBASE_COLLECTIONS.QUIZZES, quiz.id), { assignedStudents: nextAssigned });
    }).filter(Boolean);
    if (updates.length) await Promise.all(updates);
}

function setEditStudentError(message = '') {
    if (!elements.editStudentError) return;
    if (message) { dom.setText(elements.editStudentError, message); dom.show(elements.editStudentError); }
    else { dom.setText(elements.editStudentError, ''); dom.hide(elements.editStudentError); }
}

export function openEditStudentModal(student) {
    if (!assertCanManage(student, 'You can only edit students you created.')) return;
    adminState.editingStudentId = student.id;
    adminState.editingStudentOriginalUsername = student.username || '';
    setEditStudentError('');
    if (elements.editStudentUsername) elements.editStudentUsername.value = student.username || '';
    if (elements.editStudentDesc) dom.setText(elements.editStudentDesc, student.username ? `Editing @${student.username}` : 'Update login username');
    dom.show(elements.editStudentModal);
    elements.editStudentModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    elements.editStudentUsername?.focus();
}

export function closeEditStudentModal() {
    adminState.editingStudentId = null;
    adminState.editingStudentOriginalUsername = '';
    setEditStudentError('');
    if (elements.editStudentForm) elements.editStudentForm.reset();
    dom.hide(elements.editStudentModal);
    elements.editStudentModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
}

export async function saveEditStudent(e) {
    e?.preventDefault();
    if (!adminState.editingStudentId || !db) return;
    const student = adminState.allStudents.find((s) => s.id === adminState.editingStudentId);
    if (!assertCanManage(student, 'You can only edit students you created.')) return;
    const username = normalizeStudentUsername(elements.editStudentUsername?.value);
    if (!username) { setEditStudentError('Please enter a username.'); return; }
    const available = await isStudentUsernameAvailable(username, adminState.editingStudentId);
    if (!available) { setEditStudentError('This username is already taken.'); return; }
    const submitBtn = elements.editStudentSubmit;
    if (submitBtn) submitBtn.disabled = true;
    try {
        await updateDoc(doc(db, FIREBASE_COLLECTIONS.STUDENTS, adminState.editingStudentId), { username });
        if (username !== normalizeStudentUsername(adminState.editingStudentOriginalUsername)) {
            await syncQuizAssignmentsForUsernameChange(adminState.editingStudentOriginalUsername, username);
        }
        closeEditStudentModal();
        await loadStudents();
    } catch (err) {
        console.error(err);
        setEditStudentError('Failed to update student: ' + (err.message || 'Unknown error'));
    } finally { if (submitBtn) submitBtn.disabled = false; }
}

export async function deleteStudent(student) {
    if (!student?.id || !db) return;
    if (!assertCanManage(student, 'You can only delete students you created.')) return;
    const label = student.username || student.id;
    if (!confirm(`Delete student "${label}"?\n\nThey will no longer be able to log in. Quiz assignment references will be removed.`)) return;
    try {
        await deleteDoc(doc(db, FIREBASE_COLLECTIONS.STUDENTS, student.id));
        await removeUsernameFromQuizAssignments(student.username);
        await loadStudents();
    } catch (err) { console.error(err); alert('Failed to delete student: ' + (err.message || 'Unknown error')); }
}
