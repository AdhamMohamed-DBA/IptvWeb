import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

function envValue(name: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[name];
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const firebaseApiKey = envValue("VITE_FIREBASE_API_KEY");

if (!firebaseApiKey) {
  console.warn(
    "[Firebase] VITE_FIREBASE_API_KEY is missing. Set it in .env (local) or CI/CD environment variables.",
  );
}

const firebaseConfig = {
  apiKey: firebaseApiKey || "MISSING_FIREBASE_API_KEY",
  authDomain:
    envValue("VITE_FIREBASE_AUTH_DOMAIN") ||
    "iptvweb-f0745.firebaseapp.com",
  projectId: envValue("VITE_FIREBASE_PROJECT_ID") || "iptvweb-f0745",
  storageBucket:
    envValue("VITE_FIREBASE_STORAGE_BUCKET") ||
    "iptvweb-f0745.firebasestorage.app",
  messagingSenderId:
    envValue("VITE_FIREBASE_MESSAGING_SENDER_ID") || "302217116078",
  appId:
    envValue("VITE_FIREBASE_APP_ID") ||
    "1:302217116078:web:4f39755161c5849afaf03f",
  databaseURL:
    envValue("VITE_FIREBASE_DATABASE_URL") ||
    "https://iptvweb-f0745-default-rtdb.europe-west1.firebasedatabase.app/",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
