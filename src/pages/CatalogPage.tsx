import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CategoryTabs from "../components/CategoryTabs";
import MediaCard from "../components/MediaCard";
import Section from "../components/Section";
import { useAppContext } from "../context/AppContext";
import { useCatalog } from "../hooks/useCatalog";
import { getStreams } from "../lib/api";
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
  const [globalItems, setGlobalItems] = useState<ContentItem[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string>();

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setGlobalLoading(false);
      setGlobalError(undefined);
      return;
    }

    let ignore = false;

    async function loadGlobalItems() {
      setGlobalLoading(true);
      setGlobalError(undefined);

      try {
        const all = await getStreams(type);
        if (!ignore) {
          setGlobalItems(all);
        }
      } catch (err: any) {
        if (!ignore) {
          setGlobalItems([]);
          setGlobalError(err?.message || "Failed to load all catalog items.");
        }
      } finally {
        if (!ignore) {
          setGlobalLoading(false);
        }
      }
    }

    loadGlobalItems();

    return () => {
      ignore = true;
    };
  }, [type, searchQuery]);

  const filteredCategoryItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.title.toLowerCase().includes(q));
  }, [items, searchQuery]);

  const filteredGlobalItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    return globalItems.filter((item) => item.title.toLowerCase().includes(q));
  }, [globalItems, searchQuery]);

  const showingGlobalSearch = Boolean(searchQuery.trim());
  const activeLoading = showingGlobalSearch ? globalLoading : loading;
  const activeError = showingGlobalSearch ? globalError : error;
  const displayItems = showingGlobalSearch ? filteredGlobalItems : filteredCategoryItems;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{pageMeta[type].title}</h1>
          <p>
            {showingGlobalSearch
              ? `Search results across all ${pageMeta[type].title.toLowerCase()} categories.`
              : pageMeta[type].description}
          </p>
        </div>
      </div>

      <CategoryTabs
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
      />

      {showingGlobalSearch ? (
        <Section
          title="Global search"
          right={
            <Link className="text-link" to={`/${type === "live" ? "live" : type === "movie" ? "movies" : "series"}`}>
              Keep browsing by category
            </Link>
          }
        >
          <div className="info-box">
            Searching for <strong>{searchQuery.trim()}</strong> across all {pageMeta[type].title}.
          </div>
        </Section>
      ) : null}

      {activeLoading ? <div className="info-box">Loading {pageMeta[type].title}...</div> : null}
      {activeError ? <div className="error-box">{activeError}</div> : null}

      {!activeLoading && !displayItems.length ? (
        <div className="empty-state">No items found for this category/search.</div>
      ) : (
        <div className="media-grid">
          {displayItems.map((item) => (
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
