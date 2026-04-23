const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.database();

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
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

  return (streams || []).map((stream) => {
    if (type === "live") {
      return {
        ...stream,
        stream_url: `${server}/live/${username}/${password}/${stream.stream_id}.m3u8`,
      };
    }

    if (type === "movie") {
      const ext = stream.container_extension || "mp4";
      return {
        ...stream,
        stream_url: `${server}/movie/${username}/${password}/${stream.stream_id}.${ext}`,
      };
    }

    return {
      ...stream,
    };
  });
}

function attachEpisodeUrls(credentials, seriesResponse) {
  const { server, username, password } = credentials;
  const episodesBySeason = seriesResponse.episodes || {};

  Object.keys(episodesBySeason).forEach((seasonKey) => {
    episodesBySeason[seasonKey] = (episodesBySeason[seasonKey] || []).map((episode) => {
      const ext = episode.container_extension || "mp4";
      return {
        ...episode,
        stream_url: `${server}/series/${username}/${password}/${episode.id}.${ext}`,
      };
    });
  });

  return {
    ...seriesResponse,
    episodes: episodesBySeason,
  };
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

  try {
    const uid = await getUidFromReq(req);
    const credentials = await getPlaylistCredentials(uid);

    const path = req.path || "/";

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
