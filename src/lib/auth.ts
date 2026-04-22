import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

export function ensureAnonymousAuth(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          unsubscribe();
          resolve(user);
          return;
        }

        const cred = await signInAnonymously(auth);
        unsubscribe();
        resolve(cred.user);
      } catch (error) {
        unsubscribe();
        reject(error);
      }
    });
  });
}
