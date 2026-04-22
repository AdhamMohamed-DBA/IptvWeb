import { useMemo, useState, type FormEvent } from "react";
import { savePlaylistCredentials } from "../lib/userDb";
import type { PlaylistCredentials } from "../types";

interface CredentialsGateProps {
  uid?: string;
  initialCredentials?: PlaylistCredentials;
  loadingAuth: boolean;
  onSaved: (credentials: PlaylistCredentials) => void;
}

const defaults: PlaylistCredentials = {
  server: "http://xtvip.net",
  username: "",
  password: "",
};

export default function CredentialsGate({
  uid,
  initialCredentials,
  loadingAuth,
  onSaved,
}: CredentialsGateProps) {
  const initial = useMemo(
    () => initialCredentials || defaults,
    [initialCredentials],
  );

  const [server, setServer] = useState(initial.server);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState(initial.password);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (!uid) {
      setError("Waiting for auth session. Please try again.");
      return;
    }

    const credentials: PlaylistCredentials = {
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
            Server URL
            <input
              value={server}
              onChange={(event) => setServer(event.target.value)}
              placeholder="http://xtvip.net"
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

          <button type="submit" disabled={saving || loadingAuth || !uid}>
            {saving ? "Saving..." : "Save and Load App"}
          </button>
        </form>

        {error ? <div className="error-box">{error}</div> : null}
      </div>
    </div>
  );
}
