import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowDownToLine, Boxes, BrainCircuit, CalendarClock, ChevronRight,
  CircleHelp, ClipboardList, LayoutDashboard, MapPin, Menu, Package, RefreshCw, Truck, X,
} from "lucide-react";
import { checkHealth } from "./api/client";

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
  const title = navigation.find(([path]) => path === location.pathname)?.[1] ||
    (location.pathname.startsWith("/orders/") ? "Order details" : "Supply chain");

  useEffect(() => {
    let active = true;
    const refresh = () => checkHealth().then(() => active && setHealth("online")).catch(() => active && setHealth("offline"));
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Boxes size={21} /></div>
          <div><strong>Supply Chain</strong><span>CONTROL TOWER</span></div>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map(([path, label, Icon]) => (
            <NavLink key={path} to={path} end={path === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setMobileOpen(false)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {label === "Exceptions" && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card"><div className="support-icon"><CircleHelp size={17} /></div><div><b>Need a hand?</b><span>Visit the operations guide</span></div><ChevronRight size={15} /></div>
          <div className="profile"><div className="avatar">SC</div><div><b>Supply Chain Ops</b><span>Control tower</span></div><span className="profile-menu">···</span></div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="page-heading"><div className="eyebrow">OPERATIONS / CONTROL TOWER</div><h1>{title}</h1></div>
          <div className="topbar-actions"><div className={`connection-pill ${health}`}><i />{health === "checking" ? "Checking backend" : health === "online" ? "Backend connected" : "Backend unavailable"}</div></div>
        </header>
        <div className="content"><Outlet /></div>
        <footer className="footer">Supply Chain Control Tower <span>·</span> Live operational data</footer>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return <div className="content-heading"><div><p className="section-kicker">OPERATIONS OVERVIEW</p><h2>{title}</h2><p className="muted">{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

export function Button({ children, variant = "primary", icon: Icon, type = "button", ...props }) {
  return <button type={type} className={`button ${variant}`} {...props}>{Icon && <Icon size={16} />}{children}</button>;
}

export function IconButton({ label, children, ...props }) {
  return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Card({ children, className = "" }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Loading({ label = "Loading live data..." }) {
  return <div className="loading"><span className="spinner" />{label}</div>;
}

export function Empty({ title = "No records found", detail = "Data will appear here when available." }) {
  return <div className="empty-state"><div className="empty-icon"><Boxes size={20} /></div><b>{title}</b><span>{detail}</span></div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="error-state"><AlertTriangle size={18} /><div><b>Could not load data</b><span>{message}</span></div>{onRetry && <Button variant="secondary" icon={RefreshCw} onClick={onRetry}>Retry</Button>}</div>;
}

export function Badge({ children, tone }) {
  const value = String(children ?? "UNKNOWN").toLowerCase();
  const color = tone || (["confirmed", "fulfilling", "received", "resolved", "active", "sent"].includes(value) ? "green" :
    ["high", "open", "backorder", "canceled", "cancelled", "critical"].some((part) => value.includes(part)) ? "red" :
    ["planned", "in_transit", "draft", "med", "warning"].includes(value) ? "amber" : "gray");
  return <span className={`badge ${color}`}>{String(children ?? "Unknown").replaceAll("_", " ")}</span>;
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header className="modal-header"><h3 id="modal-title">{title}</h3><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

export function DataTable({ columns, rows, emptyText = "No records to display" }) {
  if (!rows?.length) return <Empty title={emptyText} />;
  return <div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={row.id ?? row.order_id ?? row.receipt_id ?? row.line_id ?? index}>
      {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : (row[column.key] ?? "—")}</td>)}
    </tr>)}
  </tbody></table></div>;
}

export function Toasts({ items, dismiss }) {
  return <div className="toast-stack" aria-live="polite">{items.map((toast) => <div key={toast.id} className={`toast ${toast.type}`} role="status"><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>×</button></div>)}</div>;
}
