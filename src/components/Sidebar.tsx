import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Home" },
  { to: "/live", label: "Live TV" },
  { to: "/movies", label: "Movies" },
  { to: "/series", label: "Series" },
  { to: "/favorites", label: "Favorites" },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="logo">IPTV</div>

      <nav className="menu">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `menu-item ${isActive ? "menu-item--active" : ""}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
