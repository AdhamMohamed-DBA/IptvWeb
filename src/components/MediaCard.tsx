import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { ContentItem } from "../types";

interface MediaCardProps {
  item: ContentItem;
  isFavorite?: boolean;
  onToggleFavorite?: (item: ContentItem) => void | Promise<void>;
  subtitle?: string;
  onOpen?: () => void;
  to?: string;
  state?: unknown;
  progress?: number;
}

const placeholder =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
      <rect width='320' height='180' fill='#1f2937'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#9ca3af' font-family='Arial' font-size='18'>No Poster</text>
    </svg>`,
  );

export default function MediaCard({
  item,
  isFavorite,
  onToggleFavorite,
  subtitle,
  onOpen,
  to,
  state,
  progress,
}: MediaCardProps) {
  const destination = to || `/player/${item.id}`;

  const handleFavoriteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onToggleFavorite) return;

    void Promise.resolve(onToggleFavorite(item)).catch((error) => {
      console.error("Failed to toggle favorite", error);
    });
  };

  return (
    <div className="media-card">
      {onOpen ? (
        <button type="button" className="media-card-link media-card-btn" onClick={onOpen}>
          <img
            src={item.poster || placeholder}
            alt={item.title}
            loading="lazy"
            onError={(event) => {
              const target = event.currentTarget;
              target.src = placeholder;
            }}
          />

          <div className="media-card-body">
            <h4 title={item.title}>{item.title}</h4>
            <p>{subtitle || item.type.toUpperCase()}</p>
          </div>
        </button>
      ) : (
        <Link to={destination} state={state || { item }} className="media-card-link">
          <img
            src={item.poster || placeholder}
            alt={item.title}
            loading="lazy"
            onError={(event) => {
              const target = event.currentTarget;
              target.src = placeholder;
            }}
          />

          <div className="media-card-body">
            <h4 title={item.title}>{item.title}</h4>
            <p>{subtitle || item.type.toUpperCase()}</p>

            {typeof progress === "number" ? (
              <div className="progress-wrap">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                />
              </div>
            ) : null}
          </div>
        </Link>
      )}

      {onToggleFavorite ? (
        <button
          type="button"
          className={`fav-btn ${isFavorite ? "fav-btn--active" : ""}`}
          onClick={handleFavoriteClick}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      ) : null}
    </div>
  );
}
