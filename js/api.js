import { db, collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, query, where, Timestamp, setDoc } from './firebase-init.js';
import { QUIZ_VISIBILITY, FIREBASE_COLLECTIONS } from './constants.js';

function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
}

export function isQuizVisibleToStudent(quiz, username, studentTeacherUid = null) {
    const visibility = quiz.visibility || QUIZ_VISIBILITY.ALL;
    const normalizedUser = normalizeUsername(username);

    if (visibility === QUIZ_VISIBILITY.HIDDEN) return false;
    if (visibility === QUIZ_VISIBILITY.ALL) return true;
    if (visibility === QUIZ_VISIBILITY.MY_STUDENTS) {
        return !!studentTeacherUid
            && !!quiz.createdByUid
            && studentTeacherUid === quiz.createdByUid;
    }
    if (visibility === QUIZ_VISIBILITY.SPECIFIC) {
        const assigned = (quiz.assignedStudents || []).map(normalizeUsername);
        return assigned.includes(normalizedUser);
    }
    return true;
}

/** Student dashboard — quizzes from the student's teacher, not shared globally. */
export function isMyQuizForStudent(quiz, studentTeacherUid) {
    const visibility = quiz.visibility || QUIZ_VISIBILITY.ALL;
    if (visibility === QUIZ_VISIBILITY.ALL) return false;
    if (!studentTeacherUid || !quiz.createdByUid) return false;
    return studentTeacherUid === quiz.createdByUid;
}

/** Student dashboard — quizzes visible to every student (all teachers). */
export function isSharedQuizForStudent(quiz) {
    return (quiz.visibility || QUIZ_VISIBILITY.ALL) === QUIZ_VISIBILITY.ALL;
}

const API = {
    async login(username) {
        if (!db) return false;
        try {
            const q = query(collection(db, "students"), where("username", "==", normalizeUsername(username)));
            const querySnapshot = await getDocs(q);
            return !querySnapshot.empty;
        } catch (e) {
            console.error("Error logging in:", e);
            alert("Firebase Error: " + e.message);
            return false;
        }
    },

    async getStudentProfile(username) {
        if (!db) return null;
        try {
            const q = query(collection(db, "students"), where("username", "==", normalizeUsername(username)));
            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) return null;
            const docSnap = querySnapshot.docs[0];
            return { id: docSnap.id, ...docSnap.data() };
        } catch (e) {
            console.error("Error fetching student profile:", e);
            throw e;
        }
    },

    async getAssignments(username, profile = null) {
        if (!db) return [];
        try {
            if (!profile) {
                profile = await this.getStudentProfile(username);
            }
            const studentTeacherUid = profile?.createdByUid || null;

            const querySnapshot = await getDocs(collection(db, "quizzes"));
            const quizzes = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                if (isQuizVisibleToStudent(data, username, studentTeacherUid)) {
                    quizzes.push(data);
                }
            });
            return quizzes;
        } catch (e) {
            console.error("Error fetching assignments:", e);
            throw e;
        }
    },

    async getStudentResults(username) {
        if (!db) return [];
        try {
            const q = query(collection(db, "results"), where("username", "==", normalizeUsername(username)));
            const querySnapshot = await getDocs(q);
            const results = [];
            querySnapshot.forEach((docSnap) => {
                results.push({ id: docSnap.id, ...docSnap.data() });
            });
            return results;
        } catch (e) {
            console.error("Error fetching results:", e);
            throw e;
        }
    },

    summarizeResultsByQuiz(results) {
        const byQuiz = {};
        results.forEach((r) => {
            const quizId = r.quizId;
            if (!quizId) return;
            const total = r.total ?? 0;
            const score = r.score ?? 0;
            const pct = total > 0 ? score / total : 0;

            if (!byQuiz[quizId]) {
                byQuiz[quizId] = {
                    completed: true,
                    bestScore: score,
                    bestTotal: total,
                    bestPct: pct,
                    attempts: 1,
                    latestResultId: r.id,
                    latestTimestamp: r.timestamp?.seconds ?? 0
                };
            } else {
                byQuiz[quizId].attempts++;
                if (pct > byQuiz[quizId].bestPct) {
                    byQuiz[quizId].bestScore = score;
                    byQuiz[quizId].bestTotal = total;
                    byQuiz[quizId].bestPct = pct;
                }
            }
            const prevTs = byQuiz[quizId].latestTimestamp ?? 0;
            const ts = r.timestamp?.seconds ?? 0;
            if (ts >= prevTs) {
                byQuiz[quizId].latestResultId = r.id;
                byQuiz[quizId].latestTimestamp = ts;
            }
        });
        return byQuiz;
    },

    getAttemptsForQuiz(results, quizId) {
        return results
            .filter((r) => r.quizId === quizId)
            .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));
    },

    async getQuizById(quizId) {
        if (!db || !quizId) return null;
        try {
            const snap = await getDoc(doc(db, 'quizzes', quizId));
            if (!snap.exists()) return null;
            return { id: snap.id, ...snap.data() };
        } catch (e) {
            console.error('Error fetching quiz:', e);
            return null;
        }
    },

    async submitResult(username, quizId, result) {
        if (!db) return { success: false };
        try {
            await addDoc(collection(db, "results"), {
                username: normalizeUsername(username),
                quizId,
                quizTitle: result.quizTitle || '',
                score: result.score,
                total: result.total,
                timeSpent: result.timeSpent,
                answers: result.answers || {},
                timestamp: Timestamp.now()
            });
            return { success: true };
        } catch (e) {
            console.error("Error submitting result:", e);
            return { success: false, error: e.message };
        }
    },

    // ── Flashcard Sets ───────────────────────────────────────────
    async getTeacherFlashcardSets(teacherUid) {
        if (!db || !teacherUid) return [];
        try {
            const q = query(
                collection(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS),
                where("createdByUid", "==", teacherUid),
                where("creatorType", "==", "teacher")
            );
            const snapshot = await getDocs(q);
            const sets = [];
            snapshot.forEach((docSnap) => sets.push({ id: docSnap.id, ...docSnap.data() }));
            sets.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
            return sets;
        } catch (e) {
            console.error("Error fetching teacher flashcard sets:", e);
            return [];
        }
    },

    async getStudentFlashcardSets(username) {
        if (!db || !username) return { assigned: [], personal: [] };
        try {
            const normalized = normalizeUsername(username);
            const profile = await this.getStudentProfile(normalized);
            const studentTeacherUid = profile?.createdByUid || null;

            const [teacherSnap, personalSnap] = await Promise.all([
                getDocs(query(
                    collection(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS),
                    where("creatorType", "==", "teacher")
                )),
                getDocs(query(
                    collection(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS),
                    where("createdByUsername", "==", normalized),
                    where("creatorType", "==", "student")
                ))
            ]);
            
            const assigned = [];
            teacherSnap.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id;
                if (isQuizVisibleToStudent(data, normalized, studentTeacherUid)) {
                    assigned.push(data);
                }
            });
            const personal = [];
            personalSnap.forEach((docSnap) => personal.push({ id: docSnap.id, ...docSnap.data() }));
            const sortFn = (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
            assigned.sort(sortFn);
            personal.sort(sortFn);
            return { assigned, personal };
        } catch (e) {
            console.error("Error fetching student flashcard sets:", e);
            return { assigned: [], personal: [] };
        }
    },

    async getFlashcardSetById(setId) {
        if (!db || !setId) return null;
        try {
            const snap = await getDoc(doc(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS, setId));
            if (!snap.exists()) return null;
            return { id: snap.id, ...snap.data() };
        } catch (e) {
            console.error("Error fetching flashcard set:", e);
            return null;
        }
    },

    async createFlashcardSet(data) {
        if (!db) return { success: false, error: 'No database' };
        try {
            const docRef = await addDoc(collection(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS), {
                ...data,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            return { success: true, id: docRef.id };
        } catch (e) {
            console.error("Error creating flashcard set:", e);
            return { success: false, error: e.message };
        }
    },

    async updateFlashcardSet(setId, data) {
        if (!db) return { success: false, error: 'No database' };
        try {
            await updateDoc(doc(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS, setId), {
                ...data,
                updatedAt: Timestamp.now()
            });
            return { success: true };
        } catch (e) {
            console.error("Error updating flashcard set:", e);
            return { success: false, error: e.message };
        }
    },

    async deleteFlashcardSet(setId) {
        if (!db) return { success: false, error: 'No database' };
        try {
            await deleteDoc(doc(db, FIREBASE_COLLECTIONS.FLASHCARD_SETS, setId));
            return { success: true };
        } catch (e) {
            console.error("Error deleting flashcard set:", e);
            return { success: false, error: e.message };
        }
    },

    // ── Flashcard Progress (Stars) ────────────────────────────────
    async getFlashcardStars(username, setId) {
        if (!db || !username || !setId) return [];
        try {
            const normalized = normalizeUsername(username);
            const docId = `${normalized}_${setId}`;
            const snap = await getDoc(doc(db, "flashcardProgress", docId));
            if (snap.exists()) {
                return snap.data().starredCards || [];
            }
            return [];
        } catch (e) {
            console.error("Error fetching flashcard stars:", e);
            return [];
        }
    },

    async updateFlashcardStars(username, setId, starredCards) {
        if (!db || !username || !setId) return { success: false };
        try {
            const normalized = normalizeUsername(username);
            const docId = `${normalized}_${setId}`;
            await setDoc(doc(db, "flashcardProgress", docId), {
                username: normalized,
                setId,
                starredCards
            }, { merge: true });
            return { success: true };
        } catch (e) {
            console.error("Error updating flashcard stars:", e);
            return { success: false, error: e.message };
        }
    },

    isMyQuizForStudent,
    isSharedQuizForStudent
};

export default API;
