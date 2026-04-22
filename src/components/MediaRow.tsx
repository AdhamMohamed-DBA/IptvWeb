import MediaCard from "./MediaCard";
import type { ContentItem } from "../types";

interface MediaRowProps {
  items: ContentItem[];
  favoritesMap: Record<string, unknown>;
  onToggleFavorite: (item: ContentItem) => void;
  subtitle?: (item: ContentItem) => string;
}

export default function MediaRow({
  items,
  favoritesMap,
  onToggleFavorite,
  subtitle,
}: MediaRowProps) {
  return (
    <div className="media-grid">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          subtitle={subtitle?.(item)}
          isFavorite={Boolean(favoritesMap[item.id])}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}
