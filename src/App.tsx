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
  const { uid, loadingAuth, library } = useAppContext();
  const [search, setSearch] = useState("");
  const [savedLocally, setSavedLocally] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 250);
  const hasCredentials = useMemo(
    () => Boolean(library.settings?.playlist) || savedLocally,
    [library.settings?.playlist, savedLocally],
  );

  if (!hasCredentials) {
    return (
      <CredentialsGate
        uid={uid}
        loadingAuth={loadingAuth}
        initialCredentials={library.settings?.playlist}
        onSaved={() => {
          setSavedLocally(true);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="app-main">
        <Topbar uid={uid} value={search} onSearch={setSearch} />

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
