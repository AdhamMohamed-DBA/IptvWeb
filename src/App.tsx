import { useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import CredentialsGate from "./components/CredentialsGate";
import { AppProvider, useAppContext } from "./context/AppContext";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import HomePage from "./pages/HomePage";
import CatalogPage from "./pages/CatalogPage";
import FavoritesPage from "./pages/FavoritesPage";
import PlayerPage from "./pages/PlayerPage";
import SeriesDetailsPage from "./pages/SeriesDetailsPage";

function AppShell() {
  const { uid, loadingAuth, authError, retryAuth, library } = useAppContext();
  const [search, setSearch] = useState("");
  const [showPlaylistManager, setShowPlaylistManager] = useState(true);

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

  const hasCredentials = normalizedPlaylists.length > 0 || hasLegacyPlaylist;

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
