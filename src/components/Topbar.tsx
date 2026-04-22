interface TopbarProps {
  uid?: string;
  value?: string;
  onSearch: (value: string) => void;
}

export default function Topbar({ uid, value, onSearch }: TopbarProps) {
  return (
    <header className="topbar">
      <input
        className="search"
        placeholder="Search live, movies, series..."
        value={value}
        onChange={(event) => onSearch(event.target.value)}
      />

      <div className="topbar-user">
        <span className="dot" />
        {uid ? `UID: ${uid.slice(0, 8)}...` : "Connecting..."}
      </div>
    </header>
  );
}
