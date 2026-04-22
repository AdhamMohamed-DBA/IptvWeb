import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyDmfKTpI4l1I_KZff-VVSrIywy3_w6-pOo",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "iptvweb-f0745.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "iptvweb-f0745",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "iptvweb-f0745.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "302217116078",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:302217116078:web:4f39755161c5849afaf03f",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    "https://iptvweb-f0745-default-rtdb.europe-west1.firebasedatabase.app/",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
