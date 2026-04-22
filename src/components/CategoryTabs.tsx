import type { Category } from "../types";

interface CategoryTabsProps {
  categories: Category[];
  selectedCategoryId: string;
  onSelect: (id: string) => void;
}

export default function CategoryTabs({
  categories,
  selectedCategoryId,
  onSelect,
}: CategoryTabsProps) {
  return (
    <div className="category-tabs">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={`tab ${selectedCategoryId === category.id ? "tab--active" : ""}`}
          onClick={() => onSelect(category.id)}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}
