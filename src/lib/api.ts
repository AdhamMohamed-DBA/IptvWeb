import type { CatalogType, Category, ContentItem, EpgProgram, SeriesInfo } from "../types";
import { auth } from "./firebase";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function inferCloudFunctionBase(): string | undefined {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return undefined;
  return `https://europe-west1-${projectId}.cloudfunctions.net/api`;
}

const REQUEST_BASES = (() => {
  const configured = trimTrailingSlash(API_BASE);
  const cloud = inferCloudFunctionBase();
  if (!cloud || configured === cloud) {
    return [configured];
  }

  return [configured, cloud];
})();

async function request<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError: Error | undefined;
  for (let index = 0; index < REQUEST_BASES.length; index += 1) {
    const base = REQUEST_BASES[index];

    try {
      const response = await fetch(`${base}${path}`, { headers });
      if (!response.ok) {
        const isNotFound = response.status === 404;
        const isLast = index === REQUEST_BASES.length - 1;
        if (isNotFound && !isLast) {
          continue;
        }

        throw new Error(`API error ${response.status} while requesting ${path}`);
      }

      return response.json();
    } catch (error: any) {
      const isLast = index === REQUEST_BASES.length - 1;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isLast) {
        continue;
      }
    }
  }

  throw lastError || new Error(`Failed requesting ${path}`);
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
