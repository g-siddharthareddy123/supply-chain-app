import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  Menu,
  Package,
  Truck,
  X,
} from "lucide-react";
import { checkHealth } from "../../api/client";

const navigation = [
  ["/", "Dashboard", LayoutDashboard],
  ["/products", "Products", Package],
  ["/locations", "Locations", MapPin],
  ["/inventory", "Inventory", Boxes],
  ["/receipts", "Incoming Receipts", ArrowDownToLine],
  ["/atp", "ATP Planning", CalendarClock],
  ["/orders", "Customer Orders", ClipboardList],
  ["/exceptions", "Exceptions", AlertTriangle],
  ["/planner", "Planner Workspace", Activity],
  ["/shipments", "Shipments", Truck],
  ["/assistant", "AI Assistant", BrainCircuit],
];

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [health, setHealth] = useState("checking");
  const location = useLocation();
  const title =
    navigation.find(([path]) => path === location.pathname)?.[1] ||
    (location.pathname.startsWith("/orders/")
      ? "Order details"
      : "Supply chain");

  useEffect(() => {
    let active = true;
    const refresh = () =>
      checkHealth()
        .then(() => active && setHealth("online"))
        .catch(() => active && setHealth("offline"));
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Boxes size={21} />
          </div>
          <div>
            <strong>Supply Chain</strong>
            <span>CONTROL TOWER</span>
          </div>
          <button
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Exceptions" && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <div className="support-icon">
              <CircleHelp size={17} />
            </div>
            <div>
              <b>Need a hand?</b>
              <span>Visit the operations guide</span>
            </div>
            <ChevronRight size={15} />
          </div>
          <div className="profile">
            <div className="avatar">SC</div>
            <div>
              <b>Supply Chain Ops</b>
              <span>Control tower</span>
            </div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="page-heading">
            <div className="eyebrow">OPERATIONS / CONTROL TOWER</div>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            <div className={`connection-pill ${health}`}>
              <i />
              {health === "checking"
                ? "Checking backend"
                : health === "online"
                  ? "Backend connected"
                  : "Backend unavailable"}
            </div>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
        <footer className="footer">
          Supply Chain Control Tower <span>·</span> Live operational data
        </footer>
      </main>
    </div>
  );
}
