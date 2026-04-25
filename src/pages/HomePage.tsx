import { useMemo } from "react";
import MediaCard from "../components/MediaCard";
import Section from "../components/Section";
import { useAppContext } from "../context/AppContext";
import { useCatalog } from "../hooks/useCatalog";
import { formatDate, formatDuration } from "../lib/format";
import type { ContentItem } from "../types";

interface HomePageProps {
  searchQuery: string;
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

function filterBySearch<T extends ContentItem>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.title.toLowerCase().includes(q));
}

function routeForItem(item: ContentItem): string {
  if (item.type === "series") return `/series/${item.id}`;
  return `/player/${item.id}`;
}

export default function HomePage({ searchQuery }: HomePageProps) {
  const { library, isFavorite, toggleFavoriteItem } = useAppContext();
  const liveCatalog = useCatalog("live", { initialSelection: "firstCategory" });
  const movieCatalog = useCatalog("movie", { initialSelection: "firstCategory" });
  const seriesCatalog = useCatalog("series", { initialSelection: "firstCategory" });

  const favorites = useMemo(
    () =>
      Object.values(library.favorites)
        .filter(isDefined)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [library.favorites],
  );

  const recentlyWatched = useMemo(
    () =>
      Object.values(library.recentlyWatched)
        .filter(isDefined)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [library.recentlyWatched],
  );

  const continueWatching = useMemo(
    () =>
      Object.values(library.continueWatching)
        .filter(isDefined)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [library.continueWatching],
  );

  const recentlyAdded = useMemo(() => {
    return [...movieCatalog.items, ...seriesCatalog.items]
      .sort((a, b) => (b.added || 0) - (a.added || 0))
      .slice(0, 40);
  }, [movieCatalog.items, seriesCatalog.items]);

  const liveNow = useMemo(() => liveCatalog.items.slice(0, 36), [liveCatalog.items]);

  const filteredFavorites = useMemo(
    () => filterBySearch(favorites, searchQuery).slice(0, 18),
    [favorites, searchQuery],
  );
  const filteredRecentlyWatched = useMemo(
    () => filterBySearch(recentlyWatched, searchQuery).slice(0, 18),
    [recentlyWatched, searchQuery],
  );
  const filteredContinueWatching = useMemo(
    () => filterBySearch(continueWatching, searchQuery).slice(0, 18),
    [continueWatching, searchQuery],
  );
  const filteredRecentlyAdded = useMemo(
    () => filterBySearch(recentlyAdded, searchQuery).slice(0, 24),
    [recentlyAdded, searchQuery],
  );
  const filteredLiveNow = useMemo(
    () => filterBySearch(liveNow, searchQuery).slice(0, 20),
    [liveNow, searchQuery],
  );

  const loadingContent = liveCatalog.loading || movieCatalog.loading || seriesCatalog.loading;
  const loadingError = liveCatalog.error || movieCatalog.error || seriesCatalog.error;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <p>Your personalized IPTV dashboard.</p>
        </div>
      </div>

      {loadingContent ? <div className="info-box">Loading content...</div> : null}
      {loadingError ? <div className="error-box">{loadingError}</div> : null}

      <Section title="Continue Watching">
        {filteredContinueWatching.length ? (
          <div className="media-grid">
            {filteredContinueWatching.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                progress={item.progress}
                subtitle={`Resume at ${formatDuration(item.position)} / ${formatDuration(
                  item.duration,
                )}`}
                to={`/player/${item.id}`}
                state={{ item, resumePosition: item.position }}
                isFavorite={isFavorite(item.id)}
                onToggleFavorite={toggleFavoriteItem}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">No continue-watching items yet.</div>
        )}
      </Section>

      <Section title="Live Now">
        {filteredLiveNow.length ? (
          <div className="media-grid">
            {filteredLiveNow.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                to={routeForItem(item)}
                subtitle="Live channel"
                isFavorite={isFavorite(item.id)}
                onToggleFavorite={toggleFavoriteItem}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">No live channels found for this search.</div>
        )}
      </Section>

      <Section title="Recently Added">
        {filteredRecentlyAdded.length ? (
          <div className="media-grid">
            {filteredRecentlyAdded.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                to={routeForItem(item)}
                subtitle={item.added ? `Added ${formatDate(item.added)}` : "Recently added"}
                isFavorite={isFavorite(item.id)}
                onToggleFavorite={toggleFavoriteItem}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">No recently added titles yet.</div>
        )}
      </Section>

      <Section title="Recently Watched">
        {filteredRecentlyWatched.length ? (
          <div className="media-grid">
            {filteredRecentlyWatched.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                to={routeForItem(item)}
                subtitle={item.updatedAt ? `Watched ${formatDate(item.updatedAt)}` : "Watched"}
                isFavorite={isFavorite(item.id)}
                onToggleFavorite={toggleFavoriteItem}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">Watch anything and it will appear here.</div>
        )}
      </Section>

      <Section title="Favorites">
        {filteredFavorites.length ? (
          <div className="media-grid">
            {filteredFavorites.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                to={routeForItem(item)}
                subtitle={item.type.toUpperCase()}
                isFavorite={isFavorite(item.id)}
                onToggleFavorite={toggleFavoriteItem}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">No favorites yet. Tap ☆ on any title.</div>
        )}
      </Section>
    </div>
  );
}
