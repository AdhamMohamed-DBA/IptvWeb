import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ContentItem, UserLibrary } from "../types";
import { ensureAnonymousAuth } from "../lib/auth";
import {
  addRecentlyWatched,
  subscribeUserLibrary,
  toggleFavorite,
  touchUser,
  updateContinueWatching,
} from "../lib/userDb";

const emptyLibrary: UserLibrary = {
  favorites: {},
  recentlyWatched: {},
  continueWatching: {},
  settings: {},
};

interface AppContextValue {
  uid?: string;
  loadingAuth: boolean;
  library: UserLibrary;
  isFavorite: (itemId: string) => boolean;
  toggleFavoriteItem: (item: ContentItem) => Promise<void>;
  markRecentlyWatched: (item: ContentItem) => Promise<void>;
  saveContinueWatching: (
    item: ContentItem,
    position: number,
    duration: number,
  ) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [uid, setUid] = useState<string>();
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [library, setLibrary] = useState<UserLibrary>(emptyLibrary);

  useEffect(() => {
    let unsubscribeDb = () => {};
    let mounted = true;

    ensureAnonymousAuth()
      .then(async (user) => {
        if (!mounted) return;

        setUid(user.uid);
        await touchUser(user.uid);
        unsubscribeDb = subscribeUserLibrary(user.uid, (newLibrary) => {
          setLibrary(newLibrary);
        });
      })
      .catch((error) => {
        console.error("Auth init failed", error);
      })
      .finally(() => {
        if (mounted) setLoadingAuth(false);
      });

    return () => {
      mounted = false;
      unsubscribeDb();
    };
  }, []);

  const isFavorite = useCallback(
    (itemId: string) => {
      return Boolean(library.favorites[itemId]);
    },
    [library.favorites],
  );

  const toggleFavoriteItem = useCallback(
    async (item: ContentItem) => {
      if (!uid) return;
      await toggleFavorite(uid, item, Boolean(library.favorites[item.id]));
    },
    [uid, library.favorites],
  );

  const markRecentlyWatched = useCallback(
    async (item: ContentItem) => {
      if (!uid) return;
      await addRecentlyWatched(uid, item);
    },
    [uid],
  );

  const saveContinueWatching = useCallback(
    async (item: ContentItem, position: number, duration: number) => {
      if (!uid) return;
      await updateContinueWatching(uid, item, position, duration);
    },
    [uid],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      uid,
      loadingAuth,
      library,
      isFavorite,
      toggleFavoriteItem,
      markRecentlyWatched,
      saveContinueWatching,
    }),
    [
      uid,
      loadingAuth,
      library,
      isFavorite,
      toggleFavoriteItem,
      markRecentlyWatched,
      saveContinueWatching,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used inside AppProvider");
  }

  return context;
}
