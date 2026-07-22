import {
    getCurrentTeacher,
    getTeacherOwnerFields,
    isVisibleToTeacher,
    canManageItem
} from '../admin-auth.js';
import { adminState } from './state.js';

export { getTeacherOwnerFields, isVisibleToTeacher, canManageItem } from '../admin-auth.js';

export function getTeacherUid() {
    return getCurrentTeacher()?.uid || null;
}

export function filterVisibleToTeacher(items) {
    const uid = getTeacherUid();
    return items.filter((item) => isVisibleToTeacher(item, uid));
}

export function assertCanManage(item, message = 'You can only manage quizzes and students you created.') {
    if (!item || !canManageItem(item, getTeacherUid())) {
        alert(message);
        return false;
    }
    return true;
}

export function isOwnedQuizId(quizId) {
    const quiz = adminState.quizzesById[quizId];
    return quiz ? isVisibleToTeacher(quiz, getTeacherUid()) : false;
}

export function isOwnedStudentUsername(username) {
    const normalized = String(username || '').trim().toLowerCase();
    return adminState.allStudents.some((s) =>
        s.username === normalized && isVisibleToTeacher(s, getTeacherUid())
    );
}
