import { useMemo, useState, type FormEvent } from "react";
import { savePlaylistCredentials } from "../lib/userDb";
import type { PlaylistCredentials } from "../types";

interface CredentialsGateProps {
  uid?: string;
  initialCredentials?: PlaylistCredentials;
  loadingAuth: boolean;
  authError?: string;
  onRetryAuth?: () => Promise<void> | void;
  onSaved: (credentials: PlaylistCredentials) => void;
}

const defaults: PlaylistCredentials = {
  nickname: "",
  server: "",
  username: "",
  password: "",
};

export default function CredentialsGate({
  uid,
  initialCredentials,
  loadingAuth,
  authError,
  onRetryAuth,
  onSaved,
}: CredentialsGateProps) {
  const initial = useMemo(
    () => initialCredentials || defaults,
    [initialCredentials],
  );

  const [nickname, setNickname] = useState(initial.nickname || "");
  const [server, setServer] = useState(initial.server);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState(initial.password);
  const [saving, setSaving] = useState(false);
  const [retryingAuth, setRetryingAuth] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (loadingAuth) {
      setError("Preparing your session... please wait a moment.");
      return;
    }

    if (!uid) {
      setError(authError || "Unable to start session now. Please retry session.");
      return;
    }

    const cleanNickname = nickname.trim();
    const credentials: PlaylistCredentials = {
      nickname: cleanNickname || undefined,
      server: server.trim().replace(/\/$/, ""),
      username: username.trim(),
      password: password.trim(),
    };

    if (!credentials.server || !credentials.username || !credentials.password) {
      setError("Please fill server, username and password.");
      return;
    }

    try {
      setSaving(true);
      await savePlaylistCredentials(uid, credentials);
      onSaved(credentials);
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

  const submitDisabled = saving || loadingAuth;

  return (
    <div className="gate-wrapper">
      <div className="gate-card">
        <h1>Connect IPTV Playlist</h1>
        <p>
          Enter Xtream credentials once. They will be saved in your Firebase user profile
          and used securely by Cloud Functions.
        </p>

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

          <div className="gate-actions">
            <button type="submit" disabled={submitDisabled}>
              {saving
                ? "Saving..."
                : loadingAuth
                  ? "Preparing session..."
                  : "Save and Load App"}
            </button>

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
        </form>

        {error || authError ? <div className="error-box">{error || authError}</div> : null}
      </div>
    </div>
  );
}
