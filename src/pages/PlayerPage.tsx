import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import Hls from "hls.js";
import { useAppContext } from "../context/AppContext";
import { getEpg } from "../lib/api";
import { getCachedItem } from "../lib/cache";
import { formatDuration, formatEpgTime } from "../lib/format";
import type { ContentItem, EpgProgram } from "../types";

interface PlayerLocationState {
  item?: ContentItem;
  resumePosition?: number;
}

function pickCurrentProgram(epg: EpgProgram[], now: number) {
  return epg.find((entry) => now >= entry.start && now <= entry.end);
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item?.streamUrl) return;

    setError(undefined);
    let hls: Hls | null = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = item.streamUrl;
    } else if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 30,
      });
      hls.loadSource(item.streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(`Playback error: ${data.details}`);
        }
      });
    } else {
      video.src = item.streamUrl;
    }

    const onLoadedMetadata = () => {
      if (initialResumePosition > 0 && !Number.isNaN(initialResumePosition)) {
        video.currentTime = initialResumePosition;
      }
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
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("pause", onPause);
      hls?.destroy();
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
    </div>
  );
}
