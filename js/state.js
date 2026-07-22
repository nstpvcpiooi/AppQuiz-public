import { STORAGE_KEYS } from './constants.js';

const state = {
    user: {
        current: sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER),
        isAdmin: false,

        login(username) {
            this.current = username;
            sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER, username);
        },

        logout() {
            this.current = null;
            sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
        },

        setAdminFromAuth(isAdmin) {
            this.isAdmin = !!isAdmin;
        }
    },
    
    quiz: {
        instance: null,
        assignments: [],
        studentResults: [],
        resultsById: {},
        
        setInstance(instance) {
            this.instance = instance;
        },
        
        clearInstance() {
            if (this.instance) {
                if (this.instance.timerInterval) {
                    clearInterval(this.instance.timerInterval);
                }
                if (typeof this.instance.cleanup === 'function') {
                    this.instance.cleanup();
                }
            }
            this.instance = null;
        },
        
        setAssignments(list) {
            this.assignments = list;
        },

        setStudentResults(results) {
            this.studentResults = results || [];
            this.resultsById = Object.fromEntries(this.studentResults.map((r) => [r.id, r]));
        }
    }
};

export default state;
