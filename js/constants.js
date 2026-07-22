export const SCREENS = {
    LOGIN: 'login',
    ADMIN_LOGIN: 'admin-login',
    ADMIN_DASHBOARD: 'admin-dashboard',
    ADMIN_EDITOR: 'admin-editor',
    ADMIN_VIEW: 'admin-view',
    ADMIN_SMART_IMPORT: 'admin-smart-import',
    ADMIN_REVIEW_SUB_QUIZ: 'admin-review-sub-quiz',
    ADMIN_RESULT_DETAIL: 'admin-result-detail',
    ADMIN_FLASHCARD_EDITOR: 'admin-flashcard-editor',
    DASHBOARD: 'dashboard',
    QUIZ: 'quiz',
    STUDENT_REVIEW: 'student-review',
    STUDENT_FLASHCARD_EDITOR: 'student-flashcard-editor',
    STUDENT_FLASHCARD_STUDY: 'student-flashcard-study'
};

export const STUDENT_TAB_ROUTES = {
    quiz: SCREENS.DASHBOARD,
    dictionary: 'dashboard-dictionary',
    flashcard: 'dashboard-flashcard',
    profile: 'dashboard-profile'
};

export const ADMIN_TAB_ROUTES = {
    'tab-quizzes': SCREENS.ADMIN_DASHBOARD,
    'tab-flashcard': 'admin-dashboard-flashcard',
    'tab-results': 'admin-dashboard-results',
    'tab-students': 'admin-dashboard-students'
};

const STUDENT_ROUTE_TO_TAB = {
    [SCREENS.DASHBOARD]: 'quiz',
    'dashboard-quiz': 'quiz',
    [STUDENT_TAB_ROUTES.dictionary]: 'dictionary',
    [STUDENT_TAB_ROUTES.flashcard]: 'flashcard',
    [STUDENT_TAB_ROUTES.profile]: 'profile'
};

const ADMIN_ROUTE_TO_TAB = {
    [SCREENS.ADMIN_DASHBOARD]: 'tab-quizzes',
    'admin-dashboard-quizzes': 'tab-quizzes',
    [ADMIN_TAB_ROUTES['tab-flashcard']]: 'tab-flashcard',
    [ADMIN_TAB_ROUTES['tab-results']]: 'tab-results',
    [ADMIN_TAB_ROUTES['tab-students']]: 'tab-students'
};

export function isStudentDashboardRoute(hash) {
    return Object.prototype.hasOwnProperty.call(STUDENT_ROUTE_TO_TAB, hash);
}

export function isStudentFlashcardStudyRoute(hash) {
    return hash.startsWith('flashcard-study-');
}

export function isStudentFlashcardEditorRoute(hash) {
    return hash.startsWith('student-flashcard-editor');
}

export function isAdminFlashcardEditorRoute(hash) {
    return hash.startsWith('admin-flashcard-editor');
}

export function parseStudentDashboardRoute(hash) {
    return STUDENT_ROUTE_TO_TAB[hash] || 'quiz';
}

export function isAdminDashboardRoute(hash) {
    return Object.prototype.hasOwnProperty.call(ADMIN_ROUTE_TO_TAB, hash);
}

export function parseAdminDashboardRoute(hash) {
    return ADMIN_ROUTE_TO_TAB[hash] || 'tab-quizzes';
}

export const QUIZ_MODES = {
    PRACTICE: 'practice',
    EXAM: 'exam'
};

export const QUESTION_TYPES = {
    MULTIPLE_CHOICE: 'multiple_choice',
    PRONUNCIATION: 'pronunciation',
    READING_MCQ: 'reading_mcq',
    READING_FILL_MCQ: 'reading_fill_mcq',
    READING_FILL_ESSAY: 'reading_fill_essay'
};

export const FIREBASE_COLLECTIONS = {
    STUDENTS: 'students',
    QUIZZES: 'quizzes',
    RESULTS: 'results',
    FLASHCARD_SETS: 'flashcardSets'
};

export const QUIZ_VISIBILITY = {
    MY_STUDENTS: 'my_students',
    ALL: 'all',
    SPECIFIC: 'specific',
    HIDDEN: 'hidden'
};

export const EXPLANATION_SOURCE = {
    AI: 'ai',
    AI_APPROVED: 'ai_approved',
    TEACHER: 'teacher'
};

export const STORAGE_KEYS = {
    CURRENT_USER: 'currentUser'
};
