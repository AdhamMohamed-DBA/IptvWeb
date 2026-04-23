import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

export function ensureAnonymousAuth(timeoutMs = 15000): Promise<User> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    const resolveOnce = (user: User) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(user);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      reject(
        error instanceof Error
          ? error
          : new Error("Failed to initialize authentication session."),
      );
    };

    timer = setTimeout(() => {
      rejectOnce(
        new Error(
          "Authentication session timed out. Check internet/Firebase config and retry.",
        ),
      );
    }, timeoutMs);

    unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        try {
          if (user) {
            resolveOnce(user);
            return;
          }

          const cred = await signInAnonymously(auth);
          resolveOnce(cred.user);
        } catch (error) {
          rejectOnce(error);
        }
      },
      (error) => {
        rejectOnce(error);
      },
    );
  });
}
