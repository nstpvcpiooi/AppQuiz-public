import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, enableIndexedDbPersistence,
    collection, getDocs, getDoc, doc, addDoc, query, where, Timestamp,
    setDoc, updateDoc, deleteDoc, onSnapshot, orderBy, limit, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
    updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
};

let app, db, auth;

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);

    enableIndexedDbPersistence(db).catch((err) => {
        console.warn("Firebase offline persistence could not be enabled:", err.code);
    });

    console.log("Firebase initialized");
} catch (error) {
    console.error("Firebase init error (likely missing config):", error);
}

export {
    db, auth,
    collection, getDocs, getDoc, doc, addDoc, query, where, Timestamp,
    setDoc, updateDoc, deleteDoc, onSnapshot, orderBy, limit, writeBatch, increment,
    onAuthStateChanged, signInWithEmailAndPassword, signOut,
    updatePassword, reauthenticateWithCredential, EmailAuthProvider
};
