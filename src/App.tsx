import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import CredentialsGate from "./components/CredentialsGate";
import { AppProvider, useAppContext } from "./context/AppContext";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import {
  clearCatalogCache,
  syncAllCatalogs,
  type CatalogSyncProgressEvent,
} from "./lib/api";
import { markCatalogRefreshRun } from "./lib/userDb";
import HomePage from "./pages/HomePage";
import CatalogPage from "./pages/CatalogPage";
import FavoritesPage from "./pages/FavoritesPage";
import PlayerPage from "./pages/PlayerPage";
import SeriesDetailsPage from "./pages/SeriesDetailsPage";
import type { CatalogType } from "./types";

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

  useEffect(() => {
    if (!uid || !hasCredentials || showPlaylistManager) return;
    if (startupSyncKeyRef.current === playlistKey) return;

    startupSyncKeyRef.current = playlistKey;
    void runCatalogSync("startup");
  }, [uid, hasCredentials, showPlaylistManager, playlistKey, runCatalogSync]);

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
