import type { ContentItem } from "../types";

const STORAGE_KEY = "iptv_item_cache_v1";
const MAX_ITEMS = 800;

type CacheMap = Record<string, ContentItem>;

let memoryCache: CacheMap = {};

function loadCache(): CacheMap {
  if (Object.keys(memoryCache).length) {
    return memoryCache;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    memoryCache = JSON.parse(raw) as CacheMap;
    return memoryCache;
  } catch {
    return {};
  }
}

function persist(cache: CacheMap) {
  memoryCache = cache;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage quota/runtime errors.
  }
}

export function saveItemToCache(item: ContentItem) {
  const cache = loadCache();
  cache[item.id] = item;

  const keys = Object.keys(cache);
  if (keys.length > MAX_ITEMS) {
    const toDelete = keys.slice(0, keys.length - MAX_ITEMS);
    toDelete.forEach((key) => {
      delete cache[key];
    });
  }

  persist(cache);
}

export function saveItemsToCache(items: ContentItem[]) {
  if (!items.length) return;
  const cache = loadCache();

  items.forEach((item) => {
    cache[item.id] = item;
  });

  const keys = Object.keys(cache);
  if (keys.length > MAX_ITEMS) {
    const toDelete = keys.slice(0, keys.length - MAX_ITEMS);
    toDelete.forEach((key) => {
      delete cache[key];
    });
  }

  persist(cache);
}

export function getCachedItem(itemId?: string): ContentItem | null {
  if (!itemId) return null;
  const cache = loadCache();
  return cache[itemId] || null;
}
