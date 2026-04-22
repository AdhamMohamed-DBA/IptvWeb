import { useMemo } from "react";
import MediaCard from "../components/MediaCard";
import { useAppContext } from "../context/AppContext";
import { formatDate } from "../lib/format";
import type { UserStampedItem } from "../types";

interface FavoritesPageProps {
  searchQuery: string;
}

function isFavoriteItem(value: UserStampedItem | undefined): value is UserStampedItem {
  return Boolean(value);
}

export default function FavoritesPage({ searchQuery }: FavoritesPageProps) {
  const { library, toggleFavoriteItem } = useAppContext();

  const items = useMemo(() => {
    const list = Object.values(library.favorites)
      .filter(isFavoriteItem)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => item.title.toLowerCase().includes(q));
  }, [library.favorites, searchQuery]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Favorites</h1>
          <p>Your starred channels, movies and series.</p>
        </div>
      </div>

      {!items.length ? (
        <div className="empty-state">No favorites yet. Add from any page using ☆.</div>
      ) : (
        <div className="media-grid">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              to={item.type === "series" ? `/series/${item.id}` : `/player/${item.id}`}
              subtitle={`Saved ${formatDate(item.updatedAt)}`}
              isFavorite
              onToggleFavorite={toggleFavoriteItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
