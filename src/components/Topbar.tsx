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
  const hasSearchValue = Boolean(value?.trim());

  return (
    <header className="topbar">
      <div className="topbar-search-wrap">
        <input
          className="search"
          placeholder="Search live, movies, series..."
          value={value}
          onChange={(event) => onSearch(event.target.value)}
        />

        {hasSearchValue ? (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => onSearch("")}
            aria-label="Clear search"
            title="Clear search"
          >
            ×
          </button>
        ) : null}
      </div>

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
