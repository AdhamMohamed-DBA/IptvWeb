export type CatalogType = "live" | "movie" | "series";
export type StreamType = CatalogType | "episode";

export interface PlaylistCredentials {
  server: string;
  username: string;
  password: string;
}

export interface UserSettings {
  playlist?: PlaylistCredentials;
}

export interface Category {
  id: string;
  name: string;
  type: CatalogType;
}

export interface ContentItem {
  id: string;
  sourceId?: string;
  type: StreamType;
  title: string;
  poster?: string;
  streamUrl?: string;
  epgChannelId?: string;
  categoryId?: string;
  categoryName?: string;
  added?: number;
  plot?: string;
  containerExtension?: string;
  parentSeriesId?: string;
  season?: number;
  episodeNum?: number;
}

export interface EpgProgram {
  id: string;
  title: string;
  description?: string;
  start: number;
  end: number;
}

export interface UserStampedItem extends ContentItem {
  updatedAt: number;
}

export interface ContinueWatchingItem extends ContentItem {
  position: number;
  duration: number;
  progress: number;
  updatedAt: number;
}

export interface UserLibrary {
  favorites: Record<string, UserStampedItem | undefined>;
  recentlyWatched: Record<string, UserStampedItem | undefined>;
  continueWatching: Record<string, ContinueWatchingItem | undefined>;
  settings?: UserSettings;
}

export interface SeriesInfo {
  series: ContentItem;
  episodes: ContentItem[];
}
