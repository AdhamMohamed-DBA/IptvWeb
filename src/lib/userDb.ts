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
  StoredPlaylist,
  UserLibrary,
} from "../types";

function userRoot(uid: string) {
  return ref(db, `users/${uid}`);
}

function itemPath(uid: string, collection: string, itemId: string) {
  return ref(db, `users/${uid}/${collection}/${itemId}`);
}

function settingsPath(uid: string) {
  return ref(db, `users/${uid}/settings`);
}

function sanitizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function sanitizeContentItem(item: ContentItem): ContentItem {
  const payload: Partial<ContentItem> = {
    id: String(item.id),
    type: item.type,
    title: item.title || "Untitled",
  };

  const optionalStringKeys: Array<keyof ContentItem> = [
    "sourceId",
    "poster",
    "streamUrl",
    "epgChannelId",
    "categoryId",
    "categoryName",
    "plot",
    "containerExtension",
    "parentSeriesId",
  ];

  optionalStringKeys.forEach((key) => {
    const value = item[key];
    if (typeof value === "string" && value.length > 0) {
      (payload as any)[key] = value;
    }
  });

  const added = sanitizeFiniteNumber(item.added);
  if (added !== undefined) payload.added = added;

  const season = sanitizeFiniteNumber(item.season);
  if (season !== undefined) payload.season = season;

  const episodeNum = sanitizeFiniteNumber(item.episodeNum);
  if (episodeNum !== undefined) payload.episodeNum = episodeNum;

  return payload as ContentItem;
}

function normalizeCredentials(credentials: PlaylistCredentials): PlaylistCredentials {
  const nickname = credentials.nickname?.trim();
  return {
    nickname: nickname || undefined,
    server: credentials.server.trim().replace(/\/$/, ""),
    username: credentials.username.trim(),
    password: credentials.password.trim(),
  };
}

function isValidCredentials(value: any): boolean {
  return Boolean(value?.server && value?.username && value?.password);
}

function toStoredPlaylist(value: any): StoredPlaylist | null {
  if (!isValidCredentials(value)) return null;

  const raw = value as any;

  return {
    nickname: typeof raw.nickname === "string" ? raw.nickname : undefined,
    server: String(raw.server).trim().replace(/\/$/, ""),
    username: String(raw.username).trim(),
    password: String(raw.password).trim(),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
  };
}

function toLegacyPlaylistPayload(credentials: PlaylistCredentials, updatedAt: number) {
  const nickname = credentials.nickname?.trim();
  return {
    server: credentials.server,
    username: credentials.username,
    password: credentials.password,
    nickname: nickname || null,
    updatedAt,
  };
}

function playlistId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    ...sanitizeContentItem(item),
    updatedAt: Date.now(),
  });
}

export async function addRecentlyWatched(uid: string, item: ContentItem) {
  const node = itemPath(uid, "recentlyWatched", item.id);
  await set(node, {
    ...sanitizeContentItem(item),
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
  const safePosition = Number.isFinite(position) && position > 0 ? position : 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progress = safeDuration > 0 ? Math.min(1, safePosition / safeDuration) : 0;

  const payload: ContinueWatchingItem = {
    ...sanitizeContentItem(item),
    position: safePosition,
    duration: safeDuration,
    progress,
    updatedAt: Date.now(),
  } as ContinueWatchingItem;

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
  existingPlaylistId?: string,
): Promise<string> {
  const clean = normalizeCredentials(credentials);
  if (!clean.server || !clean.username || !clean.password) {
    throw new Error("Please fill server, username and password.");
  }

  const id = existingPlaylistId || playlistId();
  const settings = settingsPath(uid);
  const existingSnap = await get(ref(db, `users/${uid}/settings/playlists/${id}`));
  const existing = toStoredPlaylist(existingSnap.val());
  const now = Date.now();

  await set(ref(db, `users/${uid}/settings/playlists/${id}`), {
    server: clean.server,
    username: clean.username,
    password: clean.password,
    nickname: clean.nickname || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  await update(settings, {
    activePlaylistId: id,
    playlist: toLegacyPlaylistPayload(clean, now),
  });

  return id;
}

export async function setActivePlaylist(uid: string, playlistIdValue: string) {
  const playlistSnap = await get(ref(db, `users/${uid}/settings/playlists/${playlistIdValue}`));
  const playlist = toStoredPlaylist(playlistSnap.val());
  if (!playlist) {
    throw new Error("Playlist not found.");
  }

  await update(settingsPath(uid), {
    activePlaylistId: playlistIdValue,
    playlist: toLegacyPlaylistPayload(playlist, Date.now()),
  });
}

export async function deletePlaylist(uid: string, playlistIdValue: string) {
  const settingsRef = settingsPath(uid);
  const snapshot = await get(settingsRef);
  const settings = snapshot.val() || {};

  if (playlistIdValue === "legacy") {
    await update(settingsRef, {
      playlist: null,
      activePlaylistId: null,
    });
    return;
  }

  const rawPlaylists = settings.playlists || {};
  const remaining = Object.entries(rawPlaylists)
    .filter(([id]) => id !== playlistIdValue)
    .map(([id, value]) => ({ id, playlist: toStoredPlaylist(value) }))
    .filter((item): item is { id: string; playlist: StoredPlaylist } => Boolean(item.playlist))
    .sort((a, b) => (b.playlist.updatedAt || 0) - (a.playlist.updatedAt || 0));

  const updates: Record<string, unknown> = {
    [`playlists/${playlistIdValue}`]: null,
  };

  const wasActive = settings.activePlaylistId === playlistIdValue;
  if (wasActive) {
    if (remaining.length > 0) {
      const next = remaining[0];
      updates.activePlaylistId = next.id;
      updates.playlist = toLegacyPlaylistPayload(next.playlist, Date.now());
    } else {
      updates.activePlaylistId = null;
      updates.playlist = null;
    }
  }

  await update(settingsRef, updates);
}

export async function getPlaylistCredentials(
  uid: string,
): Promise<PlaylistCredentials | null> {
  const settingsSnapshot = await get(settingsPath(uid));
  if (!settingsSnapshot.exists()) return null;

  const settings = settingsSnapshot.val() || {};
  const rawPlaylists = settings.playlists || {};
  const activeId = typeof settings.activePlaylistId === "string"
    ? settings.activePlaylistId
    : undefined;

  const candidates: any[] = [];
  if (activeId) {
    candidates.push(rawPlaylists[activeId]);
  }

  Object.values(rawPlaylists).forEach((value) => {
    candidates.push(value);
  });
  candidates.push(settings.playlist);

  const selected = candidates
    .map((value) => toStoredPlaylist(value))
    .find((value): value is StoredPlaylist => Boolean(value));

  if (!selected) return null;

  return {
    nickname: selected.nickname,
    server: selected.server,
    username: selected.username,
    password: selected.password,
  };
}

export async function saveCatalogRefreshSettings(
  uid: string,
  autoRefreshDays: number,
) {
  const days = Number.isFinite(autoRefreshDays)
    ? Math.max(0, Math.floor(autoRefreshDays))
    : 0;

  await update(settingsPath(uid), {
    catalogAutoRefreshDays: days,
  });
}

export async function markCatalogRefreshRun(uid: string, timestamp = Date.now()) {
  await update(settingsPath(uid), {
    catalogLastRefreshAt: timestamp,
  });
}







