const admin = require("firebase-admin");
const { Readable } = require("node:stream");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.database();
const STREAM_PROXY_ENDPOINT = "/api/stream";

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Range");
  res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.replace("Bearer ", "");
}

async function getUidFromReq(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("Missing auth token");
  }
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded.uid;
}

async function getPlaylistCredentials(uid) {
  const settingsSnap = await db.ref(`users/${uid}/settings`).get();
  if (!settingsSnap.exists()) {
    throw new Error("Playlist credentials are not saved yet");
  }

  const settings = settingsSnap.val() || {};
  const playlists = settings.playlists || {};

  const candidates = [];
  if (settings.activePlaylistId && playlists[settings.activePlaylistId]) {
    candidates.push(playlists[settings.activePlaylistId]);
  }

  Object.values(playlists).forEach((playlist) => {
    candidates.push(playlist);
  });

  if (settings.playlist) {
    candidates.push(settings.playlist);
  }

  const selected = candidates.find((item) => {
    return item && item.server && item.username && item.password;
  });

  if (!selected) {
    throw new Error("Playlist credentials are incomplete");
  }

  return {
    server: String(selected.server).replace(/\/$/, ""),
    username: String(selected.username),
    password: String(selected.password),
  };
}

function actionFromType(type, target) {
  if (target === "categories") {
    if (type === "live") return "get_live_categories";
    if (type === "movie") return "get_vod_categories";
    if (type === "series") return "get_series_categories";
  }

  if (target === "streams") {
    if (type === "live") return "get_live_streams";
    if (type === "movie") return "get_vod_streams";
    if (type === "series") return "get_series";
  }

  return null;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value ?? ""));
}

function proxyStreamUrl(targetUrl) {
  return `${STREAM_PROXY_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`;
}

function parseStreamTarget(rawValue) {
  if (!rawValue) {
    throw new Error("Missing stream url");
  }

  let decoded = String(rawValue);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = String(rawValue);
  }

  let parsed;
  try {
    parsed = new URL(decoded);
  } catch {
    throw new Error("Invalid stream url");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Invalid stream url protocol");
  }

  return parsed;
}

function isPlaylistResponse(contentType, streamUrl) {
  const lowerType = String(contentType || "").toLowerCase();
  if (
    lowerType.includes("application/vnd.apple.mpegurl") ||
    lowerType.includes("application/x-mpegurl")
  ) {
    return true;
  }

  return /\.m3u8?(\?|$)/i.test(streamUrl);
}

function resolveManifestUrl(manifestUrl, value) {
  if (!value) return "";

  try {
    return new URL(value, manifestUrl).toString();
  } catch {
    return "";
  }
}

function rewriteManifestUriAttributes(line, manifestUrl) {
  const withDoubleQuotes = line.replace(/URI="([^"]+)"/g, (match, uri) => {
    const resolved = resolveManifestUrl(manifestUrl, uri);
    if (!resolved) return match;
    return `URI="${proxyStreamUrl(resolved)}"`;
  });

  return withDoubleQuotes.replace(/URI='([^']+)'/g, (match, uri) => {
    const resolved = resolveManifestUrl(manifestUrl, uri);
    if (!resolved) return match;
    return `URI='${proxyStreamUrl(resolved)}'`;
  });
}

function rewriteManifestLine(line, manifestUrl) {
  const trimmed = line.trim();
  if (!trimmed) return line;

  if (trimmed.startsWith("#")) {
    return rewriteManifestUriAttributes(line, manifestUrl);
  }

  const resolved = resolveManifestUrl(manifestUrl, trimmed);
  if (!resolved) return line;
  return proxyStreamUrl(resolved);
}

function rewriteHlsManifest(body, manifestUrl) {
  return body
    .split(/\r?\n/)
    .map((line) => rewriteManifestLine(line, manifestUrl))
    .join("\n");
}

function copyProxyHeaders(upstream, res) {
  [
    "content-type",
    "content-length",
    "accept-ranges",
    "content-range",
    "cache-control",
    "etag",
    "last-modified",
  ].forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) {
      res.set(name, value);
    }
  });
}

async function forwardStreamResponse(req, res, upstream, targetUrl) {
  const contentType = upstream.headers.get("content-type") || "";
  const isPlaylist = isPlaylistResponse(contentType, targetUrl.toString());

  if (isPlaylist) {
    const manifestText = await upstream.text();
    const rewritten = rewriteHlsManifest(manifestText, targetUrl.toString());

    res.status(upstream.status);
    res.set(
      "content-type",
      contentType || "application/vnd.apple.mpegurl; charset=utf-8",
    );
    res.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    res.send(rewritten);
    return;
  }

  copyProxyHeaders(upstream, res);
  res.status(upstream.status);

  if (!upstream.body || req.method === "HEAD") {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

async function handleStreamProxy(req, res) {
  const rawTarget = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  const targetUrl = parseStreamTarget(rawTarget);

  const rawRange = Array.isArray(req.headers.range)
    ? req.headers.range[0]
    : req.headers.range;
  const rawUserAgent = Array.isArray(req.headers["user-agent"])
    ? req.headers["user-agent"][0]
    : req.headers["user-agent"];

  const headers = {};
  if (rawRange) {
    headers.Range = rawRange;
  }
  if (rawUserAgent) {
    headers["User-Agent"] = rawUserAgent;
  }

  const upstream = await fetch(targetUrl.toString(), {
    method: req.method === "HEAD" ? "HEAD" : "GET",
    headers,
    redirect: "follow",
  });

  await forwardStreamResponse(req, res, upstream, targetUrl);
}

function normalizeContainerExtension(value, fallback = "mp4") {
  const raw = String(value || fallback)
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();

  if (!raw) return fallback;
  const cleaned = raw.replace(/[^a-z0-9]/g, "");
  return cleaned || fallback;
}

async function xtreamRequest({ server, username, password }, params) {
  const url = new URL(`${server}/player_api.php`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Xtream HTTP ${response.status}: ${txt.slice(0, 160)}`);
  }

  return response.json();
}

function attachStreamUrls(credentials, type, streams) {
  const { server, username, password } = credentials;
  const encodedUsername = encodePathSegment(username);
  const encodedPassword = encodePathSegment(password);

  return (streams || []).map((stream) => {
    if (type === "live") {
      const encodedStreamId = encodePathSegment(stream.stream_id);
      const target = `${server}/live/${encodedUsername}/${encodedPassword}/${encodedStreamId}.m3u8`;
      return {
        ...stream,
        stream_url: proxyStreamUrl(target),
      };
    }

    if (type === "movie") {
      const encodedStreamId = encodePathSegment(stream.stream_id);
      const ext = normalizeContainerExtension(stream.container_extension, "mp4");
      const target = `${server}/movie/${encodedUsername}/${encodedPassword}/${encodedStreamId}.${ext}`;
      return {
        ...stream,
        stream_url: proxyStreamUrl(target),
      };
    }

    return {
      ...stream,
    };
  });
}

function attachEpisodeUrls(credentials, seriesResponse) {
  const { server, username, password } = credentials;
  const encodedUsername = encodePathSegment(username);
  const encodedPassword = encodePathSegment(password);
  const safeSeriesResponse =
    seriesResponse && typeof seriesResponse === "object" ? seriesResponse : {};
  const episodesBySeason =
    safeSeriesResponse.episodes && typeof safeSeriesResponse.episodes === "object"
      ? safeSeriesResponse.episodes
      : {};

  Object.keys(episodesBySeason).forEach((seasonKey) => {
    episodesBySeason[seasonKey] = (episodesBySeason[seasonKey] || []).map((episode) => {
      const ext = normalizeContainerExtension(episode.container_extension, "mp4");
      const encodedEpisodeId = encodePathSegment(episode.id);
      const target =
        `${server}/series/${encodedUsername}/${encodedPassword}/${encodedEpisodeId}.${ext}`;
      return {
        ...episode,
        stream_url: proxyStreamUrl(target),
      };
    });
  });

  return {
    ...safeSeriesResponse,
    episodes: episodesBySeason,
  };
}

async function handleApi(req, res) {
  cors(res);
  const path = req.path || "/";

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (path.endsWith("/stream")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      await handleStreamProxy(req, res);
    } catch (error) {
      logger.error("Stream proxy error", error);
      res.status(400).json({ error: error.message || "Stream proxy failed" });
    }
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const uid = await getUidFromReq(req);
    const credentials = await getPlaylistCredentials(uid);

    if (path.endsWith("/categories")) {
      const type = String(req.query.type || "");
      const action = actionFromType(type, "categories");
      if (!action) {
        res.status(400).json({ error: "Invalid type" });
        return;
      }

      const data = await xtreamRequest(credentials, { action });
      res.status(200).json(data || []);
      return;
    }

    if (path.endsWith("/streams")) {
      const type = String(req.query.type || "");
      const categoryId = req.query.category_id;
      const action = actionFromType(type, "streams");
      if (!action) {
        res.status(400).json({ error: "Invalid type" });
        return;
      }

      const data = await xtreamRequest(credentials, {
        action,
        category_id: categoryId,
      });

      if (type === "series") {
        res.status(200).json(data || []);
        return;
      }

      res.status(200).json(attachStreamUrls(credentials, type, data));
      return;
    }

    if (path.includes("/series/")) {
      const seriesId = path.split("/series/")[1];
      if (!seriesId) {
        res.status(400).json({ error: "Missing series id" });
        return;
      }

      const data = await xtreamRequest(credentials, {
        action: "get_series_info",
        series_id: seriesId,
      });

      res.status(200).json(attachEpisodeUrls(credentials, data));
      return;
    }

    if (path.endsWith("/epg")) {
      const streamId = req.query.stream_id;
      const limit = req.query.limit || 8;
      if (!streamId) {
        res.status(400).json({ error: "Missing stream_id" });
        return;
      }

      const data = await xtreamRequest(credentials, {
        action: "get_short_epg",
        stream_id: streamId,
        limit,
      });

      res.status(200).json(data || { epg_listings: [] });
      return;
    }

    res.status(404).json({ error: "Route not found" });
  } catch (error) {
    logger.error("API error", error);
    res.status(401).json({ error: error.message || "Unauthorized" });
  }
}

exports.api = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  handleApi,
);
