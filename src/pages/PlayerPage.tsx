import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import Hls from "hls.js";
import MediaCard from "../components/MediaCard";
import Section from "../components/Section";
import { useAppContext } from "../context/AppContext";
import { getEpg, getSeriesInfo, getStreams } from "../lib/api";
import { getCachedItem } from "../lib/cache";
import { formatDuration, formatEpgTime } from "../lib/format";
import { ensurePlayableStreamUrl } from "../lib/stream";
import type { ContentItem, EpgProgram } from "../types";

interface PlayerLocationState {
  item?: ContentItem;
  resumePosition?: number;
}

function pickCurrentProgram(epg: EpgProgram[], now: number) {
  return epg.find((entry) => now >= entry.start && now <= entry.end);
}

function isLikelyHlsUrl(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

function mediaErrorMessage(video: HTMLVideoElement) {
  const mediaError = video.error;
  if (!mediaError) {
    return "Video playback failed.";
  }

  const reasonByCode: Record<number, string> = {
    [MediaError.MEDIA_ERR_ABORTED]: "Playback aborted",
    [MediaError.MEDIA_ERR_NETWORK]: "Network error while loading stream",
    [MediaError.MEDIA_ERR_DECODE]: "Video decode error",
    [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: "Stream format not supported",
  };

  return reasonByCode[mediaError.code] || "Video playback failed";
}

function maybeMixedContentMessage(streamUrl: string) {
  if (typeof window === "undefined") return "";
  if (window.location.protocol !== "https:") return "";
  if (!/^http:\/\//i.test(streamUrl)) return "";

  return " The stream is HTTP while app is HTTPS (mixed-content blocked by browser).";
}

function routeForPlayerItem(item: ContentItem) {
  if (item.type === "series") return `/series/${item.id}`;
  return `/player/${item.id}`;
}

export default function PlayerPage() {
  const { itemId } = useParams();
  const location = useLocation();
  const { library, markRecentlyWatched, saveContinueWatching } = useAppContext();

  const state = (location.state as PlayerLocationState | null) || undefined;
  const fallbackFromCache = getCachedItem(itemId);
  const fallbackFromContinue = itemId ? library.continueWatching[itemId] : undefined;

  const item = useMemo(
    () => state?.item || fallbackFromCache || fallbackFromContinue,
    [state?.item, fallbackFromCache, fallbackFromContinue],
  );

  const initialResumePosition =
    state?.resumePosition || fallbackFromContinue?.position || 0;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string>();
  const [epg, setEpg] = useState<EpgProgram[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string>();
  const [relatedItems, setRelatedItems] = useState<ContentItem[]>([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item?.streamUrl) return;

    const streamUrl = ensurePlayableStreamUrl(item.streamUrl);
    if (!streamUrl) {
      setError("Missing stream URL for this item.");
      return;
    }

    setError(undefined);
    let hls: Hls | null = null;
    const shouldUseHlsJs = isLikelyHlsUrl(streamUrl) && Hls.isSupported();

    const tryPlay = () => {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {
          // Autoplay can fail due to browser policy. Keep controls available.
        });
      }
    };

    const setNativeSource = () => {
      video.src = streamUrl;
      video.load();
      tryPlay();
    };

    if (video.canPlayType("application/vnd.apple.mpegurl") && isLikelyHlsUrl(streamUrl)) {
      setNativeSource();
    } else if (shouldUseHlsJs) {
      hls = new Hls({
        maxBufferLength: 30,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        tryPlay();
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(
            `Playback error: ${data.details}. If this stream is HTTP-only, it will be blocked on secure pages unless routed through proxy.${maybeMixedContentMessage(
              streamUrl,
            )}`,
          );

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              hls?.recoverMediaError();
              return;
            } catch {
              // Fall through to full fallback.
            }
          }

          hls.destroy();
          hls = null;
          setNativeSource();
        }
      });
    } else {
      setNativeSource();
    }

    const onLoadedMetadata = () => {
      if (initialResumePosition > 0 && !Number.isNaN(initialResumePosition)) {
        video.currentTime = initialResumePosition;
      }

      tryPlay();
    };

    const onCanPlay = () => {
      setError(undefined);
    };

    const onVideoError = () => {
      setError(
        `${mediaErrorMessage(video)}. If this stream is HTTP-only, it may require proxy playback.${maybeMixedContentMessage(
          streamUrl,
        )}`,
      );
    };

    const onTimeUpdate = () => {
      if (!item || item.type === "live") return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration) return;
      void saveContinueWatching(item, video.currentTime, duration);
    };

    const onEnded = () => {
      if (!item) return;
      void markRecentlyWatched(item);
      if (item.type !== "live") {
        void saveContinueWatching(item, 0, 1);
      }
    };

    const onPause = () => {
      if (!item || item.type === "live") return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration) return;
      void saveContinueWatching(item, video.currentTime, duration);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onVideoError);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("pause", onPause);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [item, initialResumePosition, markRecentlyWatched, saveContinueWatching]);

  useEffect(() => {
    if (!item || item.type !== "live" || !item.sourceId) {
      setEpg([]);
      return;
    }

    let ignore = false;
    async function loadEpg() {
      try {
        const epgData = await getEpg(item.sourceId as string, 8);
        if (!ignore) {
          setEpg(epgData);
        }
      } catch {
        if (!ignore) {
          setEpg([]);
        }
      }
    }

    loadEpg();
    return () => {
      ignore = true;
    };
  }, [item]);

  useEffect(() => {
    if (!item) {
      setRelatedItems([]);
      setRelatedError(undefined);
      setRelatedLoading(false);
      return;
    }

    let ignore = false;

    async function loadRelated() {
      setRelatedLoading(true);
      setRelatedError(undefined);

      try {
        if (item.type === "live") {
          const categoryId = item.categoryId || undefined;
          const channels = await getStreams("live", categoryId);
          if (ignore) return;

          const picked = channels
            .filter((channel) => channel.id !== item.id)
            .slice(0, 18);
          setRelatedItems(picked);
          return;
        }

        if (item.type === "episode" && item.parentSeriesId) {
          const seriesId = item.parentSeriesId.replace(/^series_/, "");
          const info = await getSeriesInfo(seriesId);
          if (ignore) return;

          const episodes = info.episodes
            .filter((episode) => episode.id !== item.id)
            .slice(0, 24);
          setRelatedItems(episodes);
          return;
        }

        setRelatedItems([]);
      } catch (err: any) {
        if (ignore) return;
        setRelatedItems([]);
        setRelatedError(err?.message || "Failed to load related items.");
      } finally {
        if (!ignore) {
          setRelatedLoading(false);
        }
      }
    }

    loadRelated();

    return () => {
      ignore = true;
    };
  }, [item]);

  if (!item) {
    return (
      <div className="page">
        <div className="error-box">
          Item not found in navigation state/cache. Go back to home and open it again.
        </div>
        <Link to="/" className="text-link">
          ← Back to Home
        </Link>
      </div>
    );
  }

  const now = Date.now();
  const currentProgram = pickCurrentProgram(epg, now);

  return (
    <div className="page">
      <div className="player-header">
        <div>
          <h1>{item.title}</h1>
          <p>
            {item.type.toUpperCase()}
            {item.type !== "live" && fallbackFromContinue
              ? ` • Resume ${formatDuration(fallbackFromContinue.position || 0)}`
              : ""}
          </p>
        </div>

        <Link to="/" className="text-link">
          ← Back
        </Link>
      </div>

      <div className="player-wrap">
        <video ref={videoRef} controls autoPlay playsInline className="video-player" />
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {item.type === "live" ? (
        <section className="section">
          <div className="section-head">
            <h2>EPG</h2>
          </div>

          {!epg.length ? (
            <div className="empty-state">No EPG data available for this channel.</div>
          ) : (
            <div className="epg-list">
              {epg.map((program) => {
                const active = currentProgram?.id === program.id;
                return (
                  <article
                    key={program.id}
                    className={`epg-item ${active ? "epg-item--active" : ""}`}
                  >
                    <h4>{program.title}</h4>
                    <p>
                      {formatEpgTime(program.start)} - {formatEpgTime(program.end)}
                    </p>
                    {program.description ? <span>{program.description}</span> : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {(item.type === "live" || item.type === "episode") ? (
        <Section title={item.type === "live" ? "More channels" : "More episodes"}>
          {relatedLoading ? <div className="info-box">Loading suggestions...</div> : null}
          {relatedError ? <div className="error-box">{relatedError}</div> : null}

          {!relatedLoading && !relatedItems.length ? (
            <div className="empty-state">No related items found.</div>
          ) : (
            <div className="media-grid media-grid--compact">
              {relatedItems.map((related) => (
                <MediaCard
                  key={related.id}
                  item={related}
                  to={routeForPlayerItem(related)}
                  subtitle={
                    related.type === "live"
                      ? "Live Channel"
                      : related.type === "episode"
                        ? `Episode ${related.episodeNum || "-"}`
                        : related.type.toUpperCase()
                  }
                />
              ))}
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
