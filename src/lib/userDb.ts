import {
  get,
  onValue,
  ref,
  remove,
  set,
  serverTimestamp,
  update,
} from "firebase/database";
import { db } from "./firebase";
import type {
  ContentItem,
  ContinueWatchingItem,
  PlaylistCredentials,
  UserLibrary,
} from "../types";

function userRoot(uid: string) {
  return ref(db, `users/${uid}`);
}

function itemPath(uid: string, collection: string, itemId: string) {
  return ref(db, `users/${uid}/${collection}/${itemId}`);
}

export function subscribeUserLibrary(
  uid: string,
  callback: (library: UserLibrary) => void,
) {
  const node = userRoot(uid);

  return onValue(node, (snapshot) => {
    const data = snapshot.val() || {};
    callback({
      favorites: data.favorites || {},
      recentlyWatched: data.recentlyWatched || {},
      continueWatching: data.continueWatching || {},
      settings: data.settings || {},
    });
  });
}

export async function toggleFavorite(uid: string, item: ContentItem, isFav: boolean) {
  const node = itemPath(uid, "favorites", item.id);
  if (isFav) {
    await remove(node);
    return;
  }

  await set(node, {
    ...item,
    updatedAt: Date.now(),
  });
}

export async function addRecentlyWatched(uid: string, item: ContentItem) {
  const node = itemPath(uid, "recentlyWatched", item.id);
  await set(node, {
    ...item,
    updatedAt: Date.now(),
  });
}

export async function updateContinueWatching(
  uid: string,
  item: ContentItem,
  position: number,
  duration: number,
) {
  const node = itemPath(uid, "continueWatching", item.id);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const payload: ContinueWatchingItem = {
    ...item,
    position,
    duration,
    progress,
    updatedAt: Date.now(),
  };

  if (progress >= 0.98) {
    await remove(node);
    await addRecentlyWatched(uid, item);
    return;
  }

  await set(node, payload);
}

export async function touchUser(uid: string) {
  await update(userRoot(uid), {
    lastSeen: serverTimestamp(),
  });
}

export async function savePlaylistCredentials(
  uid: string,
  credentials: PlaylistCredentials,
) {
  const node = ref(db, `users/${uid}/settings/playlist`);
  await set(node, {
    ...credentials,
    updatedAt: Date.now(),
  });
}

export async function getPlaylistCredentials(
  uid: string,
): Promise<PlaylistCredentials | null> {
  const node = ref(db, `users/${uid}/settings/playlist`);
  const snapshot = await get(node);
  if (!snapshot.exists()) return null;

  const value = snapshot.val();
  if (!value?.server || !value?.username || !value?.password) {
    return null;
  }

  return {
    server: value.server,
    username: value.username,
    password: value.password,
  };
}


