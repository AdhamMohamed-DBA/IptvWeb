import admin from "firebase-admin";

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const HAS_EXPLICIT_SERVICE_ACCOUNT = Boolean(FIREBASE_SERVICE_ACCOUNT_JSON?.trim());

const XTREAM_TIMEOUT_MS = 25000;
let initError = null;

function parseServiceAccount(rawValue) {
  const trimmed = rawValue.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const unwrapped = trimmed.replace(/^'+|'+$/g, "");
    return JSON.parse(unwrapped);
  }
}

function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) return;

  try {
    const options = {};

    if (FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = parseServiceAccount(FIREBASE_SERVICE_ACCOUNT_JSON);
      options.credential = admin.credential.cert(serviceAccount);
    }

    if (FIREBASE_DATABASE_URL) {
      options.databaseURL = FIREBASE_DATABASE_URL;
    }

    admin.initializeApp(options);
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    initError = reason;
    console.error("Firebase Admin initialization failed", reason);
  }
}

initializeFirebaseAdmin();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function getRequestUrl(req) {
  return new URL(req.url || "/", "http://localhost");
}

function getRequestPath(req) {
  const pathname = getRequestUrl(req).pathname || "/";
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) {
    return pathname.slice(4) || "/";
  }

  return pathname;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.replace("Bearer ", "");
}

function ensureBackendReady() {
  if (initError) {
    throw new Error(`Backend misconfigured: ${initError.message}`);
  }

  if (admin.apps.length === 0) {
    throw new Error("Backend misconfigured: Firebase Admin is not initialized.");
  }

  if (!HAS_EXPLICIT_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "Backend misconfigured: FIREBASE_SERVICE_ACCOUNT_JSON is missing.",
    );
  }

  const activeDatabaseUrl = admin.app().options.databaseURL || FIREBASE_DATABASE_URL;
  if (!activeDatabaseUrl) {
    throw new Error("Backend misconfigured: FIREBASE_DATABASE_URL is missing.");
  }
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
  const snapshot = await admin.database().ref(`users/${uid}/settings`).get();
  if (!snapshot.exists()) {
    throw new Error("Playlist credentials are not saved yet");
  }

  const settings = snapshot.val() || {};
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

  const selected = candidates.find((item) => item?.server && item?.username && item?.password);
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

function normalizeContainerExtension(value, fallback = "mp4") {
  const raw = String(value || fallback)
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();

  if (!raw) return fallback;
  const cleaned = raw.replace(/[^a-z0-9]/g, "");
  return cleaned || fallback;
}

function getSeriesIdFromRequest(path, url) {
  const fromQuery = url.searchParams.get("series_id") || url.searchParams.get("id");
  if (fromQuery) {
    return fromQuery;
  }

  if (!path.includes("/series/")) {
    return "";
  }

  const rawSeriesId = path.split("/series/")[1] || "";
  return rawSeriesId.split("/")[0];
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

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, XTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Xtream HTTP ${response.status}: ${text.slice(0, 160)}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function attachStreamUrls(credentials, type, streams) {
  const { server, username, password } = credentials;
  const encodedUsername = encodePathSegment(username);
  const encodedPassword = encodePathSegment(password);

  return (streams || []).map((stream) => {
    const encodedStreamId = encodePathSegment(stream.stream_id);

    if (type === "live") {
      return {
        ...stream,
        stream_url: `${server}/live/${encodedUsername}/${encodedPassword}/${encodedStreamId}.m3u8`,
      };
    }

    if (type === "movie") {
      const ext = normalizeContainerExtension(stream.container_extension, "mp4");
      return {
        ...stream,
        stream_url: `${server}/movie/${encodedUsername}/${encodedPassword}/${encodedStreamId}.${ext}`,
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
      return {
        ...episode,
        stream_url: `${server}/series/${encodedUsername}/${encodedPassword}/${encodedEpisodeId}.${ext}`,
      };
    });
  });

  return {
    ...safeSeriesResponse,
    episodes: episodesBySeason,
  };
}

function getStatusForError(message) {
  const value = String(message || "").toLowerCase();

  if (
    value.includes("missing auth token") ||
    value.includes("verify") ||
    value.includes("id token") ||
    value.includes("unauthorized")
  ) {
    return 401;
  }

  if (
    value.includes("invalid type") ||
    value.includes("missing stream_id") ||
    value.includes("missing series id") ||
    value.includes("playlist")
  ) {
    return 400;
  }

  if (value.includes("misconfigured")) {
    return 500;
  }

  return 500;
}

async function handleApi(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const path = getRequestPath(req);
  if (path === "/healthz") {
    const ready = !initError && admin.apps.length > 0;
    res.status(ready ? 200 : 500).json({
      ok: ready,
      runtime: "vercel",
      databaseConfigured: Boolean(FIREBASE_DATABASE_URL),
    });
    return;
  }

  try {
    ensureBackendReady();

    const url = getRequestUrl(req);
    const type = String(url.searchParams.get("type") || "");
    const categoryId = url.searchParams.get("category_id");
    const seriesId = getSeriesIdFromRequest(path, url);

    const uid = await getUidFromReq(req);
    const credentials = await getPlaylistCredentials(uid);

    if (path.endsWith("/categories")) {
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

    if (seriesId || path.endsWith("/series")) {
      if (!seriesId) {
        res.status(400).json({ error: "Missing series id" });
        return;
      }

      const data = await xtreamRequest(credentials, {
        action: "get_series_info",
        series_id: decodeURIComponent(seriesId),
      });

      res.status(200).json(attachEpisodeUrls(credentials, data));
      return;
    }

    if (path.endsWith("/epg")) {
      const streamId = url.searchParams.get("stream_id");
      const limit = url.searchParams.get("limit") || 8;
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
    const message = error instanceof Error ? error.message : String(error);
    const status = getStatusForError(message);
    console.error("API error", error);
    res.status(status).json({ error: message || "Internal server error" });
  }
}

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

export default async function handler(req, res) {
  return handleApi(req, res);
}
