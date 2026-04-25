export function isProxyStreamUrl(url: string) {
  return /^\/api\/stream\?/i.test(String(url || ""));
}

export function buildStreamProxyUrl(rawUrl: string) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (isProxyStreamUrl(clean)) return clean;
  return `/api/stream?url=${encodeURIComponent(clean)}`;
}

export function ensurePlayableStreamUrl(rawUrl: string) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";

  if (isProxyStreamUrl(clean)) {
    return clean;
  }

  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    if (/^http:\/\//i.test(clean) || /^https?:\/\//i.test(clean)) {
      return buildStreamProxyUrl(clean);
    }
  }

  return clean;
}
