interface TopbarProps {
  uid?: string;
  value?: string;
  onSearch: (value: string) => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function Topbar({ uid, value, onSearch, action }: TopbarProps) {
  return (
    <header className="topbar">
      <input
        className="search"
        placeholder="Search live, movies, series..."
        value={value}
        onChange={(event) => onSearch(event.target.value)}
      />

      <div className="topbar-user">
        {action ? (
          <button type="button" className="topbar-action" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}

        <span className="dot" />
        {uid ? `UID: ${uid.slice(0, 8)}...` : "Connecting..."}
      </div>
    </header>
  );
}
