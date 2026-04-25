import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import MediaCard from "../components/MediaCard";
import { useAppContext } from "../context/AppContext";
import { getSeriesInfo } from "../lib/api";
import { saveItemToCache, saveItemsToCache } from "../lib/cache";
import type { ContentItem, SeriesInfo } from "../types";

interface SeriesDetailsPageProps {
  searchQuery: string;
}

function routeForEpisode(item: ContentItem) {
  return `/player/${item.id}`;
}

export default function SeriesDetailsPage({ searchQuery }: SeriesDetailsPageProps) {
  const { seriesId } = useParams();
  const { isFavorite, toggleFavoriteItem } = useAppContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [data, setData] = useState<SeriesInfo>();

  useEffect(() => {
    if (!seriesId) return;

    let ignore = false;

    async function load() {
      setLoading(true);
      setError(undefined);

      try {
        const info = await getSeriesInfo(seriesId);
        if (ignore) return;

        setData(info);
        saveItemToCache(info.series);
        saveItemsToCache(info.episodes);
      } catch (err: any) {
        if (ignore) return;
        setError(err?.message || "Failed to load series info.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [seriesId]);

  const filteredEpisodes = useMemo(() => {
    const episodes = data?.episodes || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return episodes;

    const seriesMatches = Boolean(data?.series.title?.toLowerCase().includes(q));
    if (seriesMatches) return episodes;

    return episodes.filter((item) => item.title.toLowerCase().includes(q));
  }, [data?.episodes, data?.series.title, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<number, ContentItem[]>();
    filteredEpisodes.forEach((ep) => {
      const season = ep.season || 0;
      const list = map.get(season) || [];
      list.push(ep);
      map.set(season, list);
    });

    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [filteredEpisodes]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{data?.series.title || "Series"}</h1>
          <p>{data?.series.plot || "Browse episodes and continue watching instantly."}</p>
        </div>
      </div>

      {loading ? <div className="info-box">Loading series episodes...</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {!loading && !grouped.length ? (
        <div className="empty-state">No episodes found for this search.</div>
      ) : (
        grouped.map(([season, episodes]) => (
          <section className="section" key={`season_${season}`}>
            <div className="section-head">
              <h2>Season {season}</h2>
            </div>

            <div className="media-grid">
              {episodes.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  to={routeForEpisode(item)}
                  subtitle={`Episode ${item.episodeNum || "-"}`}
                  isFavorite={isFavorite(item.id)}
                  onToggleFavorite={toggleFavoriteItem}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
