import type { CatalogType, Category, ContentItem, EpgProgram, SeriesInfo } from "../types";
import { auth } from "./firebase";
import { ensureAnonymousAuth } from "./auth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_RETRIES_PER_BASE = 2;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isGithubPagesHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("github.io");
}

function inferCloudFunctionBase(): string | undefined {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return undefined;
  return `https://europe-west1-${projectId}.cloudfunctions.net/api`;
}

const REQUEST_BASES = (() => {
  const configured = trimTrailingSlash(API_BASE);
  const cloud = inferCloudFunctionBase();
  const isRelativeConfigured = configured.startsWith("/");

  if (isGithubPagesHost() && isRelativeConfigured && cloud) {
    return [cloud];
  }

  if (cloud && isGithubPagesHost() && configured !== cloud) {
    return [cloud, configured];
  }

  if (!cloud || configured === cloud) {
    return [configured];
  }

  return [configured, cloud];
})();

function readableBase(base: string): string {
  if (base.startsWith("http")) return base;
  if (typeof window === "undefined") return base;
  return `${window.location.origin}${base}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  const url = `${base}${path}`;

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
          `Failed to reach API at ${readableBase(base)} (${reason}). Check Cloud Functions deployment and CORS.`,
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

  const failures: string[] = [];
  for (const base of REQUEST_BASES) {
    try {
      return await requestFromBase<T>(base, path, headers);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
    }
  }

  if (failures.length === 0) {
    throw new Error(`Failed requesting ${path}`);
  }

  throw new Error(failures[failures.length - 1]);
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

export async function getCategories(type: CatalogType): Promise<Category[]> {
  const data = await request<any[]>(`/categories?type=${type}`);
  return data.map((item) => ({
    id: String(item.category_id),
    name: item.category_name,
    type,
  }));
}

export async function getStreams(type: CatalogType, categoryId?: string): Promise<ContentItem[]> {
  const query = new URLSearchParams({ type });
  if (categoryId) query.set("category_id", categoryId);

  const data = await request<any[]>(`/streams?${query.toString()}`);

  if (type === "live") return data.map(mapLive);
  if (type === "movie") return data.map(mapMovie);
  return data.map(mapSeries);
}

export async function getSeriesInfo(seriesId: string): Promise<SeriesInfo> {
  const cleanSeriesId = seriesId.replace("series_", "");
  const data = await request<any>(`/series/${cleanSeriesId}`);

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
