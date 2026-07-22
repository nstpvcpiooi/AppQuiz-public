import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from './firebase-init.js';
import state from './state.js';

export function formatAuthError(error) {
    const code = error?.code || '';
    const messages = {
        'auth/invalid-credential': 'Incorrect password. Please try again.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/user-not-found': 'Admin account not found. Check Firebase Authentication setup.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
        'auth/weak-password': 'New password must be at least 6 characters.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/requires-recent-login': 'Please log out and log in again before changing your password.'
    };
    return messages[code] || error?.message || 'Authentication failed. Please try again.';
}

export function initAdminAuth(onChange) {
    if (!auth) {
        state.user.setAdminFromAuth(false);
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let first = true;
        onAuthStateChanged(auth, (user) => {
            const isAdmin = !!user;
            state.user.setAdminFromAuth(isAdmin);
            onChange?.(isAdmin);
            if (first) {
                first = false;
                resolve(isAdmin);
            }
        });
    });
}

export async function signInAdmin(email, password) {
    if (!auth) throw new Error('Firebase Auth is not available.');
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) throw new Error('Please enter your email.');
    await signInWithEmailAndPassword(auth, normalizedEmail, password);
}

export async function signOutAdmin() {
    if (auth) await signOut(auth);
    state.user.setAdminFromAuth(false);
}

export async function changeAdminPassword(currentPassword, newPassword) {
    if (!auth?.currentUser?.email) {
        throw new Error('You must be logged in to change your password.');
    }
    const user = auth.currentUser;
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
}

export function getAdminAuthUser() {
    return auth?.currentUser ?? null;
}

export function getCurrentTeacher() {
    const user = getAdminAuthUser();
    if (!user) return null;
    return { uid: user.uid, email: user.email || '' };
}

/** Fields stamped on new quizzes / students. */
export function getTeacherOwnerFields() {
    const teacher = getCurrentTeacher();
    if (!teacher) return {};
    return {
        createdByUid: teacher.uid,
        createdByEmail: teacher.email
    };
}

/** Admin lists: own items + legacy items without an owner yet. */
export function isVisibleToTeacher(item, teacherUid) {
    if (!teacherUid) return false;
    if (!item?.createdByUid) return true;
    return item.createdByUid === teacherUid;
}

/** Writes / deletes: own items, or legacy items any teacher may claim on save. */
export function canManageItem(item, teacherUid) {
    if (!teacherUid) return false;
    if (!item?.createdByUid) return true;
    return item.createdByUid === teacherUid;
}
