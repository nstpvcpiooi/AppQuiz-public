export const elements = {
    loginForm: document.getElementById('login-form'),
    usernameInput: document.getElementById('username'),
    loginLoader: document.getElementById('login-loader'),
    loginBtnText: document.getElementById('login-btn-text'),
    displayUsername: document.getElementById('display-username'),
    studentUserBtn: document.getElementById('student-user-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    studentNavTabs: document.querySelectorAll('[data-student-tab]'),
    studentTabPanels: {
        quiz: document.getElementById('student-tab-quiz'),
        dictionary: document.getElementById('student-tab-dictionary'),
        flashcard: document.getElementById('student-tab-flashcard'),
        profile: document.getElementById('student-tab-profile')
    },
    profileAvatar: document.getElementById('profile-avatar'),
    profileUsername: document.getElementById('profile-username'),
    profileMemberSince: document.getElementById('profile-member-since'),
    profileStatQuizzes: document.getElementById('profile-stat-quizzes'),
    profileStatCompleted: document.getElementById('profile-stat-completed'),
    profileStatAttempts: document.getElementById('profile-stat-attempts'),
    profileStatAvg: document.getElementById('profile-stat-avg'),
    profileRecentList: document.getElementById('profile-recent-list'),
    profileRecentEmpty: document.getElementById('profile-recent-empty'),
    dictSearchForm: document.getElementById('student-dict-search-form'),
    dictSearch: document.getElementById('student-dict-search'),
    dictSearchClear: document.getElementById('student-dict-search-clear'),
    dictTypeSelect: document.getElementById('student-dict-type'),
    dictSearchBtn: document.getElementById('student-dict-search-btn'),
    dictSuggestions: document.getElementById('student-dict-suggestions'),
    dictSuggestionsList: document.querySelector('#student-dict-suggestions .student-dict-suggestions-list'),
    dictLoader: document.getElementById('student-dict-loader'),
    dictError: document.getElementById('student-dict-error'),
    dictGuide: document.getElementById('student-dict-guide'),
    dictHistory: document.getElementById('student-dict-history'),
    dictHistoryList: document.getElementById('student-dict-history-list'),
    dictHistoryClear: document.getElementById('student-dict-history-clear'),
    dictResult: document.getElementById('student-dict-result'),
    dictWord: document.getElementById('student-dict-word'),
    dictPhonetic: document.getElementById('student-dict-phonetic'),
    dictSoundUk: document.getElementById('student-dict-sound-uk'),
    dictSoundUs: document.getElementById('student-dict-sound-us'),
    dictSenses: document.getElementById('student-dict-senses'),
    assignmentsLoader: document.getElementById('assignments-loader'),
    assignmentsList: document.getElementById('assignments-list'),
    assignmentsEmpty: document.getElementById('assignments-empty'),
    studentQuizSearch: document.getElementById('student-quiz-search'),
    studentQuizSort: document.getElementById('student-quiz-sort'),
    studentQuizGroup: document.getElementById('student-quiz-group'),
    studentQuizCount: document.getElementById('student-quiz-count'),
    studentTypeFilterChips: document.querySelectorAll('[data-student-type-filter]'),
    studentStatusFilterChips: document.querySelectorAll('[data-student-status-filter]'),
    studentAccessFilterChips: document.querySelectorAll('[data-student-access-filter]'),
    reviewBackBtn: document.getElementById('review-back-btn'),
    reviewQuizTitle: document.getElementById('review-quiz-title'),
    reviewScoreLabel: document.getElementById('review-score-label'),
    reviewTimeLabel: document.getElementById('review-time-label'),
    reviewDateLabel: document.getElementById('review-date-label'),
    reviewAttemptWrap: document.getElementById('review-attempt-wrap'),
    reviewAttemptSelect: document.getElementById('review-attempt-select'),
    reviewWrongFilterBtn: document.getElementById('review-wrong-filter-btn'),
    studentReviewList: document.getElementById('student-review-list'),
    backToDashboardBtn: document.getElementById('back-to-dashboard'),
    quizTitle: document.getElementById('quiz-title'),
    quizModeBadge: document.getElementById('quiz-mode-badge'),
    practiceContainer: document.getElementById('practice-container'),
    examContainer: document.getElementById('exam-container'),
    resultsContainer: document.getElementById('results-container'),
    quizProgress: document.getElementById('quiz-progress'),
    quizTimer: document.getElementById('quiz-timer'),
    examSubmitBtn: document.getElementById('exam-submit-btn'),
    examPartNav: document.getElementById('exam-part-nav'),
    scorePercentage: document.getElementById('score-percentage'),
    scoreCirclePath: document.getElementById('score-circle-path'),
    statCorrect: document.getElementById('stat-correct'),
    statIncorrect: document.getElementById('stat-incorrect'),
    statTime: document.getElementById('stat-time'),
    examReview: document.getElementById('exam-review-container'),
    examReviewList: document.getElementById('exam-review-list'),
    practiceReview: document.getElementById('practice-review-container'),
    practiceReviewList: document.getElementById('practice-review-list'),
    soundToggleBtn: document.getElementById('sound-toggle-btn'),
    practiceHelpBtn: document.getElementById('practice-help-btn'),
    practiceHelpModal: document.getElementById('practice-help-modal'),
    practiceHelpBackdrop: document.getElementById('practice-help-backdrop'),
    practiceHelpClose: document.getElementById('practice-help-close'),
    resultsHomeBtn: document.getElementById('results-home-btn')
};

export const router = { current: null };
export function setRouter(r) { router.current = r; }

export const STUDENT_TAB_IDS = new Set(['quiz', 'dictionary', 'flashcard', 'profile']);
export let activeStudentTab = 'quiz';
export function setActiveStudentTab(tabId) { activeStudentTab = tabId; }

export const STUDENT_QUIZ_LIST_PREFS_KEY = 'appquiz_student_quiz_list_prefs';
export const STUDENT_QUIZ_SORT_VALUES = new Set([
    'date-desc', 'date-asc', 'name-asc', 'name-desc', 'questions-desc', 'questions-asc'
]);
export const STUDENT_QUIZ_GROUP_VALUES = new Set(['none', 'status', 'date', 'name']);
export const STUDENT_QUIZ_TYPE_VALUES = new Set(['all', 'practice', 'exam']);
export const STUDENT_QUIZ_STATUS_VALUES = new Set(['all', 'not-completed', 'completed']);
export const STUDENT_QUIZ_ACCESS_VALUES = new Set(['all', 'only-for-you', 'shared-for-everyone']);

export let studentDashboardCache = {
    allQuizzes: [],
    teacherUid: null,
    resultSummary: {},
    profile: null
};
export function setStudentDashboardCache(cache) { studentDashboardCache = cache; }

export let studentSearchTimer = null;
export function setStudentSearchTimer(timer) { studentSearchTimer = timer; }

export let studentTypeFilter = 'all';
export function setStudentTypeFilter(value) { studentTypeFilter = value; }

export let studentStatusFilter = 'all';
export function setStudentStatusFilter(value) { studentStatusFilter = value; }

export let studentAccessFilter = 'all';
export function setStudentAccessFilter(value) { studentAccessFilter = value; }

export let lastLoadTimestamp = 0;
export function setLastLoadTimestamp(ts) { lastLoadTimestamp = ts; }

export let isLoadingAssignments = false;
export function setIsLoadingAssignments(v) { isLoadingAssignments = v; }

export const ASSIGNMENTS_CACHE_TTL = 30_000;

export let reviewQuizCache = null;
export let reviewIncorrectOnly = false;
export let currentReviewResultId = null;
export function setReviewQuizCache(c) { reviewQuizCache = c; }
export function setReviewIncorrectOnly(v) { reviewIncorrectOnly = v; }
export function setCurrentReviewResultId(id) { currentReviewResultId = id; }

export let dictionaryHandlers = null;
export function setDictionaryHandlers(h) { dictionaryHandlers = h; }
