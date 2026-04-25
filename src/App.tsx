import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import MediaCard from "./components/MediaCard";
import Section from "./components/Section";
import CredentialsGate from "./components/CredentialsGate";
import { AppProvider, useAppContext } from "./context/AppContext";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import {
  clearCatalogCache,
  getStreams,
  syncAllCatalogs,
  type CatalogSyncProgressEvent,
} from "./lib/api";
import { markCatalogRefreshRun } from "./lib/userDb";
import HomePage from "./pages/HomePage";
import CatalogPage from "./pages/CatalogPage";
import FavoritesPage from "./pages/FavoritesPage";
import PlayerPage from "./pages/PlayerPage";
import SeriesDetailsPage from "./pages/SeriesDetailsPage";
import type { CatalogType, ContentItem } from "./types";

interface CatalogSyncUiState {
  progress: number;
  stage: "idle" | CatalogSyncProgressEvent["stage"];
  loading: boolean;
  done: boolean;
  error?: string;
  categoriesCount?: number;
  itemsCount?: number;
}

const CATALOG_TYPES: CatalogType[] = ["live", "movie", "series"];

const CATALOG_LABELS: Record<CatalogType, string> = {
  live: "Live TV",
  movie: "Movies",
  series: "Series",
};

function createInitialCatalogSyncState(): Record<CatalogType, CatalogSyncUiState> {
  return {
    live: { progress: 0, stage: "idle", loading: false, done: false },
    movie: { progress: 0, stage: "idle", loading: false, done: false },
    series: { progress: 0, stage: "idle", loading: false, done: false },
  };
}

function stageLabel(stage: CatalogSyncUiState["stage"], done: boolean) {
  if (done) return "Ready";
  if (stage === "categories") return "Loading categories...";
  if (stage === "streams") return "Loading streams...";
  if (stage === "start") return "Starting...";
  return "Waiting";
}

function routeForSearchItem(item: ContentItem) {
  if (item.type === "series") return `/series/${item.id}`;
  return `/player/${item.id}`;
}

function subtitleForSearchItem(item: ContentItem) {
  if (item.type === "live") return "Live Channel";
  if (item.type === "movie") return "Movie";
  if (item.type === "episode") return `Episode ${item.episodeNum || "-"}`;
  return "Series";
}

function AppShell() {
  const { uid, loadingAuth, authError, retryAuth, library } = useAppContext();
  const [search, setSearch] = useState("");
  const [showPlaylistManager, setShowPlaylistManager] = useState(true);
  const [syncState, setSyncState] = useState<Record<CatalogType, CatalogSyncUiState>>(
    createInitialCatalogSyncState,
  );
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [lastSyncedAtOverride, setLastSyncedAtOverride] = useState<number>();
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string>();
  const [globalSearchResults, setGlobalSearchResults] = useState<Record<CatalogType, ContentItem[]>>({
    live: [],
    movie: [],
    series: [],
  });

  const syncAbortRef = useRef<AbortController | null>(null);
  const startupSyncKeyRef = useRef<string>();
  const debouncedSearch = useDebouncedValue(search, 250);

  const normalizedPlaylists = useMemo(() => {
    const entries = Object.entries(library.settings?.playlists || {});
    return entries.filter(([, value]) => {
      return Boolean(value?.server && value?.username && value?.password);
    });
  }, [library.settings?.playlists]);

  const hasLegacyPlaylist = useMemo(() => {
    const legacy = library.settings?.playlist;
    return Boolean(legacy?.server && legacy?.username && legacy?.password);
  }, [library.settings?.playlist]);

  const lastCatalogRefreshAt = useMemo(() => {
    const fromSettings = Number(library.settings?.catalogLastRefreshAt || 0);
    const fromLocal = Number(lastSyncedAtOverride || 0);
    const value = Math.max(fromSettings, fromLocal);
    return value > 0 ? value : undefined;
  }, [library.settings?.catalogLastRefreshAt, lastSyncedAtOverride]);

  useEffect(() => {
    clearCatalogCache();
    setSyncState(createInitialCatalogSyncState());
  }, [uid, library.settings?.activePlaylistId]);

  useEffect(() => {
    return () => {
      syncAbortRef.current?.abort();
    };
  }, []);

  const runCatalogSync = useCallback(
    async (reason: "startup" | "manual") => {
      if (!uid) return;
      if (syncAbortRef.current) return;

      const controller = new AbortController();
      syncAbortRef.current = controller;

      clearCatalogCache();
      setSyncingCatalog(true);
      setSyncError(undefined);
      setSyncState(createInitialCatalogSyncState());

      try {
        await syncAllCatalogs({
          signal: controller.signal,
          onProgress: (event) => {
            setSyncState((current) => {
              const prev = current[event.type];
              const done = event.stage === "done";

              return {
                ...current,
                [event.type]: {
                  ...prev,
                  progress: event.progress,
                  stage: event.stage,
                  loading: !done,
                  done,
                  error: undefined,
                  categoriesCount: event.categoriesCount ?? prev.categoriesCount,
                  itemsCount: event.itemsCount ?? prev.itemsCount,
                },
              };
            });
          },
        });

        const finishedAt = Date.now();
        setLastSyncedAtOverride(finishedAt);
        await markCatalogRefreshRun(uid, finishedAt);
      } catch (error: any) {
        if (controller.signal.aborted) {
          return;
        }

        const message = error?.message || "Failed to update catalogs.";
        setSyncError(message);
        setSyncState((current) => {
          const next = { ...current };
          CATALOG_TYPES.forEach((type) => {
            const entry = next[type];
            if (!entry.done) {
              next[type] = {
                ...entry,
                loading: false,
                error: message,
              };
            }
          });
          return next;
        });
      } finally {
        if (syncAbortRef.current === controller) {
          syncAbortRef.current = null;
        }
        setSyncingCatalog(false);
      }
    },
    [uid],
  );

  const hasCredentials = normalizedPlaylists.length > 0 || hasLegacyPlaylist;
  const playlistKey = `${uid || "guest"}:${library.settings?.activePlaylistId || "legacy"}`;
  const activeSearchQuery = debouncedSearch.trim();

  const globalSearchTotal = useMemo(() => {
    return CATALOG_TYPES.reduce((sum, type) => sum + globalSearchResults[type].length, 0);
  }, [globalSearchResults]);

  useEffect(() => {
    if (!uid || !hasCredentials || showPlaylistManager) return;
    if (startupSyncKeyRef.current === playlistKey) return;

    startupSyncKeyRef.current = playlistKey;
    void runCatalogSync("startup");
  }, [uid, hasCredentials, showPlaylistManager, playlistKey, runCatalogSync]);

  useEffect(() => {
    const query = activeSearchQuery.toLowerCase();

    if (!uid || !hasCredentials || showPlaylistManager || !query) {
      setGlobalSearchLoading(false);
      setGlobalSearchError(undefined);
      setGlobalSearchResults({
        live: [],
        movie: [],
        series: [],
      });
      return;
    }

    let ignore = false;

    async function loadGlobalSearch() {
      setGlobalSearchLoading(true);
      setGlobalSearchError(undefined);

      try {
        const [liveItems, movieItems, seriesItems] = await Promise.all([
          getStreams("live"),
          getStreams("movie"),
          getStreams("series"),
        ]);

        if (ignore) return;

        const filterItems = (items: ContentItem[]) => {
          return items
            .filter((item) => item.title.toLowerCase().includes(query))
            .slice(0, 24);
        };

        setGlobalSearchResults({
          live: filterItems(liveItems),
          movie: filterItems(movieItems),
          series: filterItems(seriesItems),
        });
      } catch (error: any) {
        if (ignore) return;
        setGlobalSearchResults({
          live: [],
          movie: [],
          series: [],
        });
        setGlobalSearchError(error?.message || "Failed to search across catalogs.");
      } finally {
        if (!ignore) {
          setGlobalSearchLoading(false);
        }
      }
    }

    loadGlobalSearch();

    return () => {
      ignore = true;
    };
  }, [uid, hasCredentials, showPlaylistManager, playlistKey, activeSearchQuery]);

  const handleManualSync = useCallback(() => {
    void runCatalogSync("manual");
  }, [runCatalogSync]);

  const topbarAction = hasCredentials
    ? {
        label: "Playlists",
        onClick: () => setShowPlaylistManager(true),
      }
    : undefined;

  const gateElement = (
    <CredentialsGate
      uid={uid}
      settings={library.settings}
      loadingAuth={loadingAuth}
      authError={authError}
      onRetryAuth={retryAuth}
      canClose={hasCredentials}
      onClose={() => setShowPlaylistManager(false)}
      onPlaylistChanged={() => {
        startupSyncKeyRef.current = undefined;
        clearCatalogCache();
        setShowPlaylistManager(false);
      }}
    />
  );

  if (!hasCredentials) {
    return gateElement;
  }

  if (showPlaylistManager) {
    return gateElement;
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="app-main">
        <Topbar
          uid={uid}
          value={search}
          onSearch={setSearch}
          action={topbarAction}
        />

        <div className="content-scroll">
          <section className="catalog-sync-panel">
            <div className="catalog-sync-head">
              <div>
                <h3>Catalog Sync</h3>
                <p>
                  {lastCatalogRefreshAt
                    ? `Last update: ${new Date(lastCatalogRefreshAt).toLocaleString()}`
                    : "No update yet for this playlist."}
                </p>
              </div>

              <div className="catalog-sync-controls">
                <button
                  type="button"
                  className="catalog-sync-btn"
                  onClick={handleManualSync}
                  disabled={syncingCatalog || !uid}
                >
                  {syncingCatalog ? "Updating..." : "Update Now"}
                </button>
              </div>
            </div>

            <div className="catalog-sync-grid">
              {CATALOG_TYPES.map((type) => {
                const status = syncState[type];
                const progressValue = Math.max(0, Math.min(100, status.progress || 0));

                return (
                  <article className="catalog-sync-card" key={type}>
                    <div className="catalog-sync-card-head">
                      <h4>{CATALOG_LABELS[type]}</h4>
                      <span>{Math.round(progressValue)}%</span>
                    </div>

                    <div className="catalog-sync-bar">
                      <div
                        className="catalog-sync-fill"
                        style={{ width: `${progressValue}%` }}
                      />
                    </div>

                    <p className="catalog-sync-stage">{stageLabel(status.stage, status.done)}</p>

                    {status.categoriesCount || status.itemsCount ? (
                      <p className="catalog-sync-meta">
                        Categories: {status.categoriesCount || 0} • Items: {status.itemsCount || 0}
                      </p>
                    ) : null}

                    {status.error ? <p className="catalog-sync-error">{status.error}</p> : null}
                  </article>
                );
              })}
            </div>

            {syncError ? <div className="error-box">{syncError}</div> : null}
          </section>

          {activeSearchQuery ? (
            <section className="global-search-panel">
              <div className="global-search-head">
                <h3>Global Search</h3>
                <p>Showing matches for “{activeSearchQuery}” across live, movies, and series.</p>
              </div>

              {globalSearchLoading ? (
                <div className="info-box">Searching all catalogs...</div>
              ) : null}

              {globalSearchError ? <div className="error-box">{globalSearchError}</div> : null}

              {!globalSearchLoading && !globalSearchError && globalSearchTotal === 0 ? (
                <div className="empty-state">No results found across all catalogs.</div>
              ) : null}

              {CATALOG_TYPES.map((type) => {
                const items = globalSearchResults[type];
                if (!items.length) return null;

                return (
                  <Section
                    key={`global_search_${type}`}
                    title={`${CATALOG_LABELS[type]} (${items.length})`}
                  >
                    <div className="media-grid">
                      {items.map((item) => (
                        <MediaCard
                          key={`search_${type}_${item.id}`}
                          item={item}
                          to={routeForSearchItem(item)}
                          subtitle={subtitleForSearchItem(item)}
                        />
                      ))}
                    </div>
                  </Section>
                );
              })}
            </section>
          ) : null}

          <Routes>
            <Route path="/" element={<HomePage searchQuery={debouncedSearch} />} />
            <Route
              path="/live"
              element={<CatalogPage type="live" searchQuery={debouncedSearch} />}
            />
            <Route
              path="/movies"
              element={<CatalogPage type="movie" searchQuery={debouncedSearch} />}
            />
            <Route
              path="/series"
              element={<CatalogPage type="series" searchQuery={debouncedSearch} />}
            />
            <Route
              path="/favorites"
              element={<FavoritesPage searchQuery={debouncedSearch} />}
            />
            <Route
              path="/series/:seriesId"
              element={<SeriesDetailsPage searchQuery={debouncedSearch} />}
            />
            <Route path="/player/:itemId" element={<PlayerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
