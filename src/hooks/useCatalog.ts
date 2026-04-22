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

export function useCatalog(type: CatalogType): UseCatalogResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSelectedCategoryId("all");
  }, [type]);

  useEffect(() => {
    let ignore = false;

    async function loadCategories() {
      try {
        const categoryList = await getCategories(type);
        if (ignore) return;
        setCategories([{ id: "all", name: "All", type }, ...categoryList]);
      } catch (err: any) {
        if (ignore) return;
        setError(err?.message || "Failed to load categories");
      }
    }

    loadCategories();
    return () => {
      ignore = true;
    };
  }, [type]);

  useEffect(() => {
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
