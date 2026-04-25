import { useEffect, useMemo, useState } from "react";
import { getCategories, getStreams } from "../lib/api";
import { saveItemsToCache } from "../lib/cache";
import type { CatalogType, Category, ContentItem } from "../types";

interface UseCatalogResult {
  categories: Category[];
  selectedCategoryId: string;
  setSelectedCategoryId: (value: string) => void;
  items: ContentItem[];
  loading: boolean;
  error?: string;
}

interface UseCatalogOptions {
  initialSelection?: "all" | "firstCategory";
}

export function useCatalog(type: CatalogType, options?: UseCatalogOptions): UseCatalogResult {
  const initialSelection = options?.initialSelection === "firstCategory" ? "firstCategory" : "all";

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    initialSelection === "firstCategory" ? "" : "all",
  );
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSelectedCategoryId(initialSelection === "firstCategory" ? "" : "all");
    setCategories([]);
    setItems([]);
    setError(undefined);
    setLoading(true);
  }, [type, initialSelection]);

  useEffect(() => {
    let ignore = false;

    async function loadCategories() {
      try {
        const categoryList = await getCategories(type);
        if (ignore) return;

        const nextCategories = [{ id: "all", name: "All", type }, ...categoryList];
        setCategories(nextCategories);
        setSelectedCategoryId((current) => {
          if (current && nextCategories.some((category) => category.id === current)) {
            return current;
          }

          if (initialSelection === "all") {
            return "all";
          }

          const firstRealCategory = categoryList[0]?.id;
          return firstRealCategory || "all";
        });
      } catch (err: any) {
        if (ignore) return;
        setError(err?.message || "Failed to load categories");
        setLoading(false);
      }
    }

    loadCategories();
    return () => {
      ignore = true;
    };
  }, [type, initialSelection]);

  useEffect(() => {
    if (!selectedCategoryId) {
      return;
    }

    let ignore = false;

    async function loadStreams() {
      setLoading(true);
      setError(undefined);

      try {
        const selected = selectedCategoryId === "all" ? undefined : selectedCategoryId;
        const streamItems = await getStreams(type, selected);

        if (ignore) return;

        saveItemsToCache(streamItems);
        setItems(streamItems);
      } catch (err: any) {
        if (ignore) return;
        setError(err?.message || "Failed to load streams");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadStreams();

    return () => {
      ignore = true;
    };
  }, [type, selectedCategoryId]);

  const result = useMemo(
    () => ({
      categories,
      selectedCategoryId,
      setSelectedCategoryId,
      items,
      loading,
      error,
    }),
    [categories, selectedCategoryId, items, loading, error],
  );

  return result;
}
