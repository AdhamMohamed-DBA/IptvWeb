import { useMemo } from "react";
import CategoryTabs from "../components/CategoryTabs";
import MediaCard from "../components/MediaCard";
import { useAppContext } from "../context/AppContext";
import { useCatalog } from "../hooks/useCatalog";
import { formatDate } from "../lib/format";
import type { CatalogType, ContentItem } from "../types";

interface CatalogPageProps {
  type: CatalogType;
  searchQuery: string;
}

const pageMeta: Record<CatalogType, { title: string; description: string }> = {
  live: {
    title: "Live TV",
    description: "Browse live channels with categories and EPG support.",
  },
  movie: {
    title: "Movies",
    description: "Watch movie library with posters and recently added dates.",
  },
  series: {
    title: "Series",
    description: "Explore series then open seasons and episodes.",
  },
};

function routeFor(item: ContentItem) {
  if (item.type === "series") {
    return `/series/${item.id}`;
  }

  return `/player/${item.id}`;
}

export default function CatalogPage({ type, searchQuery }: CatalogPageProps) {
  const { isFavorite, toggleFavoriteItem } = useAppContext();
  const { categories, selectedCategoryId, setSelectedCategoryId, items, loading, error } =
    useCatalog(type, { initialSelection: "firstCategory" });

  const filteredCategoryItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.title.toLowerCase().includes(q));
  }, [items, searchQuery]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{pageMeta[type].title}</h1>
          <p>{pageMeta[type].description}</p>
        </div>
      </div>

      <CategoryTabs
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
      />

      {loading ? <div className="info-box">Loading {pageMeta[type].title}...</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {!loading && !filteredCategoryItems.length ? (
        <div className="empty-state">No items found for this category/search.</div>
      ) : (
        <div className="media-grid">
          {filteredCategoryItems.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              to={routeFor(item)}
              subtitle={
                type === "movie" && item.added
                  ? `Added ${formatDate(item.added)}`
                  : type === "live"
                    ? "Live Channel"
                    : item.type.toUpperCase()
              }
              isFavorite={isFavorite(item.id)}
              onToggleFavorite={toggleFavoriteItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
