import type { CatalogType, Category, ContentItem, EpgProgram, SeriesInfo } from "../types";
import { auth } from "./firebase";
import { ensureAnonymousAuth } from "./auth";
import { saveItemsToCache } from "./cache";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const REQUEST_TIMEOUT_MS = 25000;
const REQUEST_RETRIES_PER_BASE = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 90 * 1000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const categoriesCache = new Map<CatalogType, CacheEntry<Category[]>>();
const streamsCache = new Map<string, CacheEntry<ContentItem[]>>();
const inflightRequests = new Map<string, Promise<unknown>>();

const CATALOG_SYNC_TYPES: CatalogType[] = ["live", "movie", "series"];

export interface CatalogSyncProgressEvent {
  type: CatalogType;
  progress: number;
  stage: "start" | "categories" | "streams" | "done";
  categoriesCount?: number;
  itemsCount?: number;
}

export interface CatalogSyncSummary {
  type: CatalogType;
  categoriesCount: number;
  itemsCount: number;
}

interface CatalogSyncOptions {
  signal?: AbortSignal;
  onProgress?: (event: CatalogSyncProgressEvent) => void;
}

export function clearCatalogCache() {
  categoriesCache.clear();
  streamsCache.clear();
  inflightRequests.clear();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Catalog sync cancelled");
  }
}

function emitSyncProgress(
  callback: CatalogSyncOptions["onProgress"],
  event: CatalogSyncProgressEvent,
) {
  callback?.(event);
}

export async function syncCatalogType(
  type: CatalogType,
  options: CatalogSyncOptions = {},
): Promise<CatalogSyncSummary> {
  const { signal, onProgress } = options;

  throwIfAborted(signal);
  emitSyncProgress(onProgress, {
    type,
    progress: 0,
    stage: "start",
  });

  const categories = await getCategories(type);
  throwIfAborted(signal);
  emitSyncProgress(onProgress, {
    type,
    progress: 35,
    stage: "categories",
    categoriesCount: categories.length,
  });

  const items = await getStreams(type);
  saveItemsToCache(items);

  throwIfAborted(signal);
  emitSyncProgress(onProgress, {
    type,
    progress: 95,
    stage: "streams",
    categoriesCount: categories.length,
    itemsCount: items.length,
  });

  emitSyncProgress(onProgress, {
    type,
    progress: 100,
    stage: "done",
    categoriesCount: categories.length,
    itemsCount: items.length,
  });

  return {
    type,
    categoriesCount: categories.length,
    itemsCount: items.length,
  };
}

export async function syncAllCatalogs(
  options: CatalogSyncOptions & { types?: CatalogType[] } = {},
): Promise<Record<CatalogType, CatalogSyncSummary>> {
  const { types = CATALOG_SYNC_TYPES, signal, onProgress } = options;

  const entries = await Promise.all(
    types.map(async (type) => {
      const summary = await syncCatalogType(type, { signal, onProgress });
      return [type, summary] as const;
    }),
  );

  const result = {} as Record<CatalogType, CatalogSyncSummary>;
  entries.forEach(([type, summary]) => {
    result[type] = summary;
  });

  return result;
}

function normalizeBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "/api";
  const noTrailing = trimmed.replace(/\/+$/, "");
  return noTrailing || "/";
}

const REQUEST_BASE = normalizeBase(API_BASE);

function joinUrl(base: string, path: string): string {
  if (base.endsWith("/") && path.startsWith("/")) {
    return `${base}${path.slice(1)}`;
  }

  if (!base.endsWith("/") && !path.startsWith("/")) {
    return `${base}/${path}`;
  }

  return `${base}${path}`;
}

function readableBase(base: string): string {
  if (base === "/") {
    if (typeof window === "undefined") return "/";
    return window.location.origin;
  }

  if (base.startsWith("http")) return base;
  if (typeof window === "undefined") return base;
  return `${window.location.origin}${base}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getValidCached<T>(entry?: CacheEntry<T>): T | null {
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry.data;
}

function withRequestDedup<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = factory().finally(() => {
    if (inflightRequests.get(key) === promise) {
      inflightRequests.delete(key);
    }
  });

  inflightRequests.set(key, promise as Promise<unknown>);
  return promise;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function requestFromBase<T>(
  base: string,
  path: string,
  headers: Record<string, string>,
): Promise<T> {
  const url = joinUrl(base, path);

  for (let attempt = 1; attempt <= REQUEST_RETRIES_PER_BASE; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, headers);
      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        if (retryable && attempt < REQUEST_RETRIES_PER_BASE) {
          await sleep(250 * attempt);
          continue;
        }

        throw new Error(
          `API error ${response.status} while requesting ${path} via ${readableBase(base)}`,
        );
      }

      return response.json();
    } catch (error: any) {
      const name = typeof error?.name === "string" ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      const isAbort = name === "AbortError";
      const isNetworkError =
        isAbort || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message);

      if (isNetworkError && attempt < REQUEST_RETRIES_PER_BASE) {
        await sleep(250 * attempt);
        continue;
      }

      if (isNetworkError) {
        const reason = isAbort ? "request timeout" : "network/CORS error";
        throw new Error(
          `Failed to reach API at ${readableBase(base)} (${reason}). Check API deployment and CORS/network settings.`,
        );
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`Failed requesting ${path} via ${readableBase(base)}`);
}

async function request<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  let user = auth.currentUser;
  if (!user) {
    try {
      user = await ensureAnonymousAuth(8000);
    } catch {
      user = auth.currentUser;
    }
  }

  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  return requestFromBase<T>(REQUEST_BASE, path, headers);
}

function normalizeImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http")) return url;
  return undefined;
}

function mapLive(item: any): ContentItem {
  const streamId = String(item.stream_id);
  return {
    id: `live_${streamId}`,
    sourceId: streamId,
    type: "live",
    title: item.name || "Unknown Live",
    poster: normalizeImage(item.stream_icon),
    epgChannelId: item.epg_channel_id,
    categoryId: String(item.category_id || ""),
    added: item.added ? Number(item.added) * 1000 : Date.now(),
    streamUrl: item.stream_url,
    plot: item.epg_channel_id,
  };
}

function mapMovie(item: any): ContentItem {
  const streamId = String(item.stream_id);
  return {
    id: `movie_${streamId}`,
    sourceId: streamId,
    type: "movie",
    title: item.name || "Unknown Movie",
    poster: normalizeImage(item.stream_icon),
    categoryId: String(item.category_id || ""),
    added: item.added ? Number(item.added) * 1000 : Date.now(),
    streamUrl: item.stream_url,
    containerExtension: item.container_extension,
    plot: item.plot,
  };
}

function mapSeries(item: any): ContentItem {
  const seriesId = String(item.series_id);
  return {
    id: `series_${seriesId}`,
    sourceId: seriesId,
    type: "series",
    title: item.name || "Unknown Series",
    poster: normalizeImage(item.cover),
    categoryId: String(item.category_id || ""),
    added: item.last_modified ? Number(item.last_modified) * 1000 : Date.now(),
    plot: item.plot,
  };
}

function mapEpisode(seriesId: string, episode: any): ContentItem {
  const episodeId = String(episode.id);
  return {
    id: `episode_${episodeId}`,
    sourceId: episodeId,
    type: "episode",
    parentSeriesId: `series_${seriesId}`,
    title: episode.title || episode.name || `Episode ${episode.episode_num || ""}`,
    poster: normalizeImage(episode.info?.movie_image || episode.info?.cover_big),
    streamUrl: episode.stream_url,
    plot: episode.info?.plot,
    season: Number(episode.season ?? 0),
    episodeNum: Number(episode.episode_num ?? 0),
    added: episode.added ? Number(episode.added) * 1000 : Date.now(),
    containerExtension: episode.container_extension,
  };
}

function isSeriesRoute404(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /API error 404/i.test(message) && /requesting\s+\/series(\?|\/)/i.test(message);
}

export async function getCategories(type: CatalogType): Promise<Category[]> {
  const cached = getValidCached(categoriesCache.get(type));
  if (cached) {
    return cached;
  }

  return withRequestDedup(`categories:${type}`, async () => {
    const data = await request<any[]>(`/categories?type=${type}`);
    const mapped = data.map((item) => ({
      id: String(item.category_id),
      name: item.category_name,
      type,
    }));

    categoriesCache.set(type, {
      data: mapped,
      expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS,
    });

    return mapped;
  });
}

export async function getStreams(type: CatalogType, categoryId?: string): Promise<ContentItem[]> {
  const cacheKey = `${type}:${categoryId || "all"}`;
  const cached = getValidCached(streamsCache.get(cacheKey));
  if (cached) {
    return cached;
  }

  const query = new URLSearchParams({ type });
  if (categoryId) query.set("category_id", categoryId);

  return withRequestDedup(`streams:${cacheKey}`, async () => {
    const data = await request<any[]>(`/streams?${query.toString()}`);

    let mapped: ContentItem[];
    if (type === "live") {
      mapped = data.map(mapLive);
    } else if (type === "movie") {
      mapped = data.map(mapMovie);
    } else {
      mapped = data.map(mapSeries);
    }

    streamsCache.set(cacheKey, {
      data: mapped,
      expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
    });

    return mapped;
  });
}

export async function getSeriesInfo(seriesId: string): Promise<SeriesInfo> {
  const cleanSeriesId = seriesId.replace("series_", "");
  const encodedSeriesId = encodeURIComponent(cleanSeriesId);

  let data: any;
  try {
    data = await request<any>(`/series/${encodedSeriesId}`);
  } catch (error) {
    if (!isSeriesRoute404(error)) {
      throw error;
    }

    data = await request<any>(`/series?series_id=${encodedSeriesId}`);
  }

  const series: ContentItem = {
    id: `series_${cleanSeriesId}`,
    type: "series",
    title: data.info?.name || "Series",
    poster: normalizeImage(data.info?.cover),
    plot: data.info?.plot,
    added: data.info?.last_modified
      ? Number(data.info.last_modified) * 1000
      : Date.now(),
  };

  const episodes: ContentItem[] = [];
  const rawEpisodes = data.episodes || {};
  Object.keys(rawEpisodes).forEach((seasonKey) => {
    const list = rawEpisodes[seasonKey] || [];
    list.forEach((episode: any) => {
      episodes.push(mapEpisode(cleanSeriesId, episode));
    });
  });

  episodes.sort((a, b) => {
    const s = (a.season || 0) - (b.season || 0);
    if (s !== 0) return s;
    return (a.episodeNum || 0) - (b.episodeNum || 0);
  });

  return { series, episodes };
}

function decodeBase64Utf8(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return atob(value);
  }
}

export async function getEpg(streamId: string, limit = 6): Promise<EpgProgram[]> {
  const encoded = encodeURIComponent(streamId);
  const data = await request<any>(`/epg?stream_id=${encoded}&limit=${limit}`);

  const listings = data.epg_listings || [];
  return listings.map((item: any, idx: number) => {
    const start = Number(item.start_timestamp || 0) * 1000;
    const end = Number(item.stop_timestamp || 0) * 1000;

    return {
      id: `${streamId}_${idx}_${start}`,
      title: item.title ? decodeBase64Utf8(item.title) : "Untitled",
      description: item.description ? decodeBase64Utf8(item.description) : "",
      start,
      end,
    };
  });
}
