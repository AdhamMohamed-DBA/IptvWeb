import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  deletePlaylist,
  savePlaylistCredentials,
  setActivePlaylist,
} from "../lib/userDb";
import type { PlaylistCredentials, StoredPlaylist, UserSettings } from "../types";

interface CredentialsGateProps {
  uid?: string;
  settings?: UserSettings;
  loadingAuth: boolean;
  authError?: string;
  onRetryAuth?: () => Promise<void> | void;
  canClose?: boolean;
  onClose?: () => void;
  onPlaylistChanged?: () => void;
}

interface PlaylistOption {
  id: string;
  playlist: StoredPlaylist;
  isActive: boolean;
  isLegacy?: boolean;
}

const defaults: PlaylistCredentials = {
  nickname: "",
  server: "",
  username: "",
  password: "",
};

function toStoredPlaylist(value: any): StoredPlaylist | null {
  if (!value?.server || !value?.username || !value?.password) return null;

  return {
    nickname: typeof value.nickname === "string" ? value.nickname : undefined,
    server: String(value.server).trim().replace(/\/$/, ""),
    username: String(value.username).trim(),
    password: String(value.password).trim(),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  };
}

function displayName(playlist: StoredPlaylist, fallbackIndex: number) {
  const nickname = playlist.nickname?.trim();
  if (nickname) return nickname;
  return `Playlist ${fallbackIndex + 1}`;
}

export default function CredentialsGate({
  uid,
  settings,
  loadingAuth,
  authError,
  onRetryAuth,
  canClose,
  onClose,
  onPlaylistChanged,
}: CredentialsGateProps) {
  const playlists = useMemo<PlaylistOption[]>(() => {
    const raw = settings?.playlists || {};
    const list = Object.entries(raw)
      .map(([id, value]) => ({ id, playlist: toStoredPlaylist(value) }))
      .filter((item): item is { id: string; playlist: StoredPlaylist } => Boolean(item.playlist))
      .map<PlaylistOption>((item) => ({
        id: item.id,
        playlist: item.playlist,
        isActive: settings?.activePlaylistId === item.id,
      }))
      .sort((a, b) => (b.playlist.updatedAt || 0) - (a.playlist.updatedAt || 0));

    const legacy = toStoredPlaylist(settings?.playlist);
    if (list.length === 0 && legacy) {
      list.push({
        id: "legacy",
        playlist: legacy,
        isActive: true,
        isLegacy: true,
      });
    }

    if (!list.some((item) => item.isActive) && list.length > 0) {
      list[0].isActive = true;
    }

    return list;
  }, [settings?.activePlaylistId, settings?.playlists, settings?.playlist]);

  const [mode, setMode] = useState<"list" | "add">(
    playlists.length ? "list" : "add",
  );
  const [nickname, setNickname] = useState(defaults.nickname || "");
  const [server, setServer] = useState(defaults.server);
  const [username, setUsername] = useState(defaults.username);
  const [password, setPassword] = useState(defaults.password);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [retryingAuth, setRetryingAuth] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (playlists.length === 0) {
      setMode("add");
      setEditingPlaylistId(undefined);
      return;
    }

    setMode((current) => (current === "add" ? "add" : "list"));
  }, [playlists.length]);

  const mustStayOpen = !canClose && playlists.length === 0;
  const showAddForm = mode === "add" || playlists.length === 0;
  const disableActions = saving || loadingAuth;
  const isEditMode = Boolean(editingPlaylistId);

  function fillFormFromPlaylist(playlist: StoredPlaylist) {
    setNickname(playlist.nickname || "");
    setServer(playlist.server || "");
    setUsername(playlist.username || "");
    setPassword(playlist.password || "");
  }

  function resetForm() {
    setEditingPlaylistId(undefined);
    setNickname("");
    setServer("");
    setUsername("");
    setPassword("");
  }

  function startAddMode() {
    resetForm();
    setMode("add");
  }

  function startEditMode(option: PlaylistOption) {
    setError(undefined);
    setEditingPlaylistId(option.id);
    fillFormFromPlaylist(option.playlist);
    setMode("add");
  }

  function backToListMode() {
    resetForm();
    setMode("list");
  }

  function closeIfAllowed() {
    if (mustStayOpen) return;
    onClose?.();
  }

  async function ensureReadySession() {
    if (loadingAuth) {
      throw new Error("Preparing your session... please wait a moment.");
    }

    if (!uid) {
      throw new Error(authError || "Unable to start session now. Please retry session.");
    }

    return uid;
  }

  async function handleUsePlaylist(option: PlaylistOption) {
    setError(undefined);

    try {
      const readyUid = await ensureReadySession();
      setSaving(true);

      if (option.id === "legacy") {
        await savePlaylistCredentials(readyUid, option.playlist);
      } else {
        await setActivePlaylist(readyUid, option.id);
      }

      onPlaylistChanged?.();
      closeIfAllowed();
    } catch (err: any) {
      setError(err?.message || "Failed to switch playlist.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist(option: PlaylistOption) {
    setError(undefined);

    const label = option.playlist.nickname?.trim() || option.playlist.server;
    const confirmed = window.confirm(`Delete "${label}" playlist?`);
    if (!confirmed) return;

    try {
      const readyUid = await ensureReadySession();
      setSaving(true);
      await deletePlaylist(readyUid, option.id);

      if (editingPlaylistId === option.id) {
        resetForm();
      }

      onPlaylistChanged?.();
    } catch (err: any) {
      setError(err?.message || "Failed to delete playlist.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    const credentials: PlaylistCredentials = {
      nickname: nickname.trim() || undefined,
      server: server.trim().replace(/\/$/, ""),
      username: username.trim(),
      password: password.trim(),
    };

    if (!credentials.server || !credentials.username || !credentials.password) {
      setError("Please fill server, username and password.");
      return;
    }

    try {
      const readyUid = await ensureReadySession();
      setSaving(true);
      await savePlaylistCredentials(readyUid, credentials, editingPlaylistId);

      resetForm();
      setMode("list");

      onPlaylistChanged?.();
      closeIfAllowed();
    } catch (err: any) {
      setError(err?.message || "Failed to save playlist credentials.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRetryAuth() {
    if (!onRetryAuth || retryingAuth) return;

    setError(undefined);
    try {
      setRetryingAuth(true);
      await onRetryAuth();
    } catch (err: any) {
      setError(err?.message || "Failed to retry session.");
    } finally {
      setRetryingAuth(false);
    }
  }

  return (
    <div className="gate-wrapper">
      <div className="gate-card">
        <h1>Choose IPTV Playlist</h1>
        <p>
          Pick saved playlist, or add a new one. This helps you quickly retry another
          server when one link is not working.
        </p>

        {playlists.length > 0 ? (
          <div className="playlist-list">
            {playlists.map((item, index) => (
              <article className="playlist-item" key={item.id}>
                <div className="playlist-item-head">
                  <h3>{displayName(item.playlist, index)}</h3>
                  {item.isActive ? <span className="playlist-pill">Active</span> : null}
                </div>

                <div className="playlist-meta">
                  <span>{item.playlist.server}</span>
                  <span>Username: {item.playlist.username}</span>
                  {item.isLegacy ? <span>Legacy saved playlist</span> : null}
                </div>

                <div className="playlist-actions">
                  <button
                    type="button"
                    className="gate-secondary"
                    disabled={disableActions}
                    onClick={() => handleUsePlaylist(item)}
                  >
                    {item.isActive ? "Continue" : "Use this playlist"}
                  </button>

                  <button
                    type="button"
                    className="gate-secondary"
                    disabled={disableActions}
                    onClick={() => startEditMode(item)}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="gate-danger"
                    disabled={disableActions}
                    onClick={() => handleDeletePlaylist(item)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="gate-actions">
          {showAddForm ? (
            <form className="gate-form" onSubmit={handleSubmit}>
              <label>
                Playlist Nickname (optional)
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="Ex: Home / Living Room"
                />
              </label>

              <label>
                Server URL
                <input
                  value={server}
                  onChange={(event) => setServer(event.target.value)}
                  placeholder="Enter server URL"
                />
              </label>

              <label>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter username"
                />
              </label>

              <label>
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  type="password"
                />
              </label>

              <button type="submit" disabled={disableActions}>
                {saving
                  ? "Saving..."
                  : loadingAuth
                    ? "Preparing session..."
                    : isEditMode
                      ? "Update Playlist"
                      : "Save and Use Playlist"}
              </button>
            </form>
          ) : null}

          <div className="gate-row-actions">
            {!showAddForm ? (
              <button
                type="button"
                className="gate-secondary"
                disabled={disableActions}
                onClick={startAddMode}
              >
                + Add New Playlist
              </button>
            ) : playlists.length > 0 ? (
              <>
                <button
                  type="button"
                  className="gate-secondary"
                  disabled={disableActions}
                  onClick={backToListMode}
                >
                  Back to Playlists
                </button>

                {isEditMode ? (
                  <button
                    type="button"
                    className="gate-secondary"
                    disabled={disableActions}
                    onClick={startAddMode}
                  >
                    + New Instead
                  </button>
                ) : null}
              </>
            ) : null}

            {canClose ? (
              <button
                type="button"
                className="gate-secondary"
                disabled={disableActions}
                onClick={closeIfAllowed}
              >
                Back to App
              </button>
            ) : null}

            {!uid && !loadingAuth ? (
              <button
                type="button"
                className="gate-retry"
                onClick={handleRetryAuth}
                disabled={retryingAuth}
              >
                {retryingAuth ? "Retrying..." : "Retry Session"}
              </button>
            ) : null}
          </div>
        </div>

        {error || authError ? <div className="error-box">{error || authError}</div> : null}
      </div>
    </div>
  );
}
