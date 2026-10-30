import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Activity, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight,
  CircleAlert, Plus, RefreshCw, Search, Send, Sparkles, Truck, X,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, allOrders } from "./api";
import { getErrorMessage } from "./api/client";
import { ToastContext } from "./contexts";
import {
  Badge, Button, Card, DataTable, Empty, ErrorState, IconButton, Loading, Modal, PageHeader,
} from "./components";

const dateLabel = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const dateInput = (value) => value ? new Date(value).toISOString().slice(0, 16) : "";
const number = (value) => value == null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const asArray = (value) => Array.isArray(value) ? value : [];

function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loader().then((result) => active && setData(result))
      .catch((err) => active && setError(getErrorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  // loader is stabilized by page callbacks or dependency keys.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, loading, error, refresh, setData };
}

function useToast() { return useContext(ToastContext); }

function FormField({ label, children, hint }) {
  return <label className="form-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function SubmitRow({ busy, onCancel, label = "Save changes" }) {
  return <div className="form-actions"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : label}</Button></div>;
}

function RefreshAction({ onClick, loading }) {
  return <Button variant="secondary" icon={RefreshCw} onClick={onClick} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button>;
}

function Metric({ label, value, caption, icon: Icon, tone }) {
  return <Card className="metric-card"><div className={`metric-icon ${tone || ""}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value ?? "—"}</div><div className="metric-caption">{caption}</div></Card>;
}

function TableCard({ children, className = "" }) {
  return <Card className={`table-card ${className}`}>{children}</Card>;
}

function SearchBox({ value, onChange, placeholder = "Search..." }) {
  return <div className="search-box"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

function CatalogPage({ type }) {
  const product = type === "products";
  const resource = product ? api.products : api.locations;
  const { data, loading, error, refresh } = useLoad(resource.list, [type]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const notify = useToast();
  const rows = asArray(data).filter((row) => `${row.sku || row.code} ${row.name}`.toLowerCase().includes(search.toLowerCase()));
  const title = product ? "Products" : "Locations";
  const fields = product
    ? [["sku", "SKU", "text"], ["name", "Product name", "text"], ["unit_of_measure", "Unit of measure", "text"], ["lead_time_days", "Lead time (days)", "number"]]
    : [["code", "Location code", "text"], ["name", "Location name", "text"], ["timezone", "Timezone (optional)", "text"]];

  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = product
      ? { sku: form.sku.trim(), name: form.name.trim(), unit_of_measure: form.unit_of_measure.trim() || "EA", lead_time_days: form.lead_time_days === "" ? null : Number(form.lead_time_days) }
      : { code: form.code.trim(), name: form.name.trim(), timezone: form.timezone.trim() || null };
    if (product && payload.lead_time_days != null && (!Number.isInteger(payload.lead_time_days) || payload.lead_time_days < 0)) return notify("Lead time must be a non-negative whole number.", "error");
    setSaving(true);
    try {
      if (modal?.id) await resource.update(modal.id, payload);
      else await resource.create(payload);
      notify(`${title.slice(0, -1)} ${modal?.id ? "updated" : "created"} successfully.`);
      setModal(null);
      refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }

  async function remove(row) {
    if (!window.confirm(`Delete ${product ? row.sku : row.code}? This cannot be undone.`)) return;
    try { await resource.delete(row.id); notify(`${title.slice(0, -1)} deleted.`); refresh(); }
    catch (err) { notify(getErrorMessage(err), "error"); }
  }
  async function editRecord(row) {
    try { setModal(await resource.get(row.id)); }
    catch (err) { notify(getErrorMessage(err), "error"); }
  }
  async function viewRecord(row) {
    try { setViewing(await resource.get(row.id)); }
    catch (err) { notify(getErrorMessage(err), "error"); }
  }

  return <>
    <PageHeader title={title} description={product ? "Manage the product catalog used across planning and fulfillment." : "Manage warehouses and fulfillment locations."}
      actions={<><RefreshAction onClick={refresh} loading={loading} /><Button icon={Plus} onClick={() => setModal({})}>Add {product ? "product" : "location"}</Button></>} />
    <TableCard>
      <div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder={`Search ${title.toLowerCase()}...`} /><span className="record-count">{rows.length} records</span></div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <DataTable rows={rows} columns={[
        { key: product ? "sku" : "code", label: product ? "SKU" : "Code", render: (row) => <strong className="primary-cell">{product ? row.sku : row.code}</strong> },
        { key: "name", label: product ? "Product name" : "Location name" },
        ...(product ? [{ key: "unit_of_measure", label: "UOM" }, { key: "lead_time_days", label: "Lead time", render: (row) => row.lead_time_days == null ? "Not set" : `${row.lead_time_days} days` }] : [{ key: "timezone", label: "Timezone", render: (row) => row.timezone || "Not set" }]),
        { key: "actions", label: "", render: (row) => <div className="row-actions"><button className="text-button" onClick={() => viewRecord(row)}>View</button><button className="text-button" onClick={() => editRecord(row)}>Edit</button><button className="text-button danger-text" onClick={() => remove(row)}>Delete</button></div> },
      ]} emptyText={`No ${title.toLowerCase()} match this search`} />}
    </TableCard>
    {modal && <Modal title={`${modal.id ? "Edit" : "Add"} ${product ? "product" : "location"}`} onClose={() => setModal(null)}>
      <form className="form-grid" onSubmit={submit}>{fields.map(([key, label, kind]) => <FormField key={key} label={label}>
        <input name={key} type={kind} min={kind === "number" ? 0 : undefined} step={kind === "number" ? 1 : undefined} required={key !== "timezone" && key !== "lead_time_days"} defaultValue={modal[key] ?? ""} />
      </FormField>)}<SubmitRow busy={saving} onCancel={() => setModal(null)} /></form>
    </Modal>}
    {viewing && <Modal title={`${product ? viewing.sku : viewing.code} details`} onClose={() => setViewing(null)}>
      <div className="details-list">{Object.entries(viewing).map(([key, value]) => <div className="detail-pair" key={key}><span>{key.replaceAll("_", " ")}</span><b>{value == null ? "Not set" : String(value)}</b></div>)}</div>
    </Modal>}
  </>;
}

export function Products() { return <CatalogPage type="products" />; }
export function Locations() { return <CatalogPage type="locations" />; }

export function Dashboard() {
  const notify = useToast();
  const loader = useCallback(async () => Promise.all([
    allOrders(), api.inventory.list(), api.receipts.list(), api.exceptions({ exception_status: "OPEN" }),
  ]), []);
  const { data, loading, error, refresh } = useLoad(loader);
  const [orders, inventory, receipts, exceptions] = data || [[], [], [], []];
  const orderStatus = useMemo(() => {
    const counts = {};
    asArray(orders).forEach((order) => { counts[order.status] = (counts[order.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [orders]);
  const priorities = useMemo(() => {
    const counts = { HIGH: 0, MED: 0, LOW: 0 };
    asArray(orders).forEach((order) => { counts[order.priority] = (counts[order.priority] || 0) + 1; });
    return Object.entries(counts).filter(([, value]) => value).map(([name, value]) => ({ name, value }));
  }, [orders]);
  const exceptionTypes = useMemo(() => {
    const counts = {};
    asArray(exceptions).forEach((item) => { counts[item.exception_type] = (counts[item.exception_type] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [exceptions]);
  const recentOrders = asArray(orders).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  const backorders = asArray(orders).filter((o) => asArray(o.lines).some((line) => Number(line.backordered_quantity) > 0)).length;
  return <>
    <PageHeader title="Good morning, operations team" description="Here’s the latest view of your supply chain performance."
      actions={<><span className="live-tag"><i /> LIVE DATA</span><RefreshAction onClick={refresh} loading={loading} /></>} />
    {error ? <ErrorState message={error} onRetry={refresh} /> : loading ? <Loading /> : <>
      <div className="metrics-grid">
        <Metric label="Total orders" value={orders.length} caption="Across all order pages" icon={ClipboardIcon} />
        <Metric label="Draft orders" value={orders.filter((o) => o.status === "DRAFT").length} caption="Awaiting confirmation" icon={Activity} tone="violet" />
        <Metric label="Confirmed / fulfilling" value={orders.filter((o) => ["CONFIRMED", "FULFILLING"].includes(o.status)).length} caption="In active fulfillment" icon={Truck} tone="blue" />
        <Metric label="Open exceptions" value={asArray(exceptions).length} caption={`${backorders} orders with backorders`} icon={CircleAlert} tone="red" />
        <Metric label="Units on hand" value={number(asArray(inventory).reduce((sum, item) => sum + Number(item.quantity || 0), 0))} caption={`${asArray(inventory).length} product/location records`} icon={BoxesIcon} tone="blue" />
      </div>
      <div className="dashboard-grid">
        <Card className="chart-card"><div className="card-title-row"><div><h3>Order status</h3><span>Distribution across all orders</span></div><Badge>LIVE</Badge></div>
          {orderStatus.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={orderStatus} dataKey="value" nameKey="name" innerRadius={66} outerRadius={94} paddingAngle={4}>{orderStatus.map((entry, index) => <Cell key={entry.name} fill={["#3866e8", "#3dbb92", "#f0ac51", "#8796b7", "#e36a71"][index % 5]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="chart-legend">{orderStatus.map((entry, index) => <div key={entry.name}><i style={{ background: ["#3866e8", "#3dbb92", "#f0ac51", "#8796b7", "#e36a71"][index % 5] }} />{entry.name}<b>{entry.value}</b></div>)}</div></div> : <Empty title="No orders yet" detail="Order status data will appear when orders exist." />}
        </Card>
        <Card className="chart-card"><div className="card-title-row"><div><h3>Order priority</h3><span>Current prioritization</span></div></div>
          {priorities.length ? <div className="bar-list">{priorities.map((item, index) => <div className="bar-row" key={item.name}><div><span>{item.name}</span><b>{item.value}</b></div><div className="bar-track"><i style={{ width: `${orders.length ? (item.value / orders.length) * 100 : 0}%`, background: ["#e36a71", "#f0ac51", "#3dbb92"][index] }} /></div></div>)}</div> : <Empty title="No priority data" />}
          <div className="supply-mini"><div><span>Inventory records</span><b>{asArray(inventory).length}</b></div><div><span>Incoming receipts</span><b>{asArray(receipts).filter((r) => !["RECEIVED", "CANCELED"].includes(r.status)).length}</b></div></div>
        </Card>
        <Card className="chart-card exception-chart"><div className="card-title-row"><div><h3>Exception categories</h3><span>Open exceptions returned by the backend</span></div><Link className="inline-link" to="/exceptions">Review <ArrowUpRight size={14} /></Link></div>
          {exceptionTypes.length ? <div className="bar-list">{exceptionTypes.map((item, index) => <div className="bar-row" key={item.name}><div><span>{item.name.replaceAll("_", " ")}</span><b>{item.value}</b></div><div className="bar-track"><i style={{ width: `${(item.value / exceptionTypes[0].value) * 100}%`, background: ["#e36a71", "#f0ac51", "#3866e8"][index % 3] }} /></div></div>)}</div> : <Empty title="No open exceptions" detail="Exception categories will appear when the API reports open records." />}
        </Card>
        <TableCard className="dashboard-orders"><div className="card-title-row"><div><h3>Recent orders</h3><span>Recently created order activity</span></div><Link className="inline-link" to="/orders">View all <ArrowUpRight size={14} /></Link></div>
          <DataTable rows={recentOrders} columns={[
            { key: "order_number", label: "Order", render: (row) => <Link className="primary-cell" to={`/orders/${row.id}`}>{row.order_number}</Link> },
            { key: "customer_name", label: "Customer" },
            { key: "priority", label: "Priority", render: (row) => <Badge>{row.priority}</Badge> },
            { key: "status", label: "Status", render: (row) => <Badge>{row.status}</Badge> },
            { key: "created_at", label: "Created", render: (row) => dateLabel(row.created_at) },
          ]} emptyText="No orders available" />
        </TableCard>
      </div>
    </>}
  </>;
}

function ClipboardIcon(props) { return <Activity {...props} />; }
function BoxesIcon(props) { return <Activity {...props} />; }

export function Inventory() {
  const notify = useToast();
  const [filters, setFilters] = useState({ sku: "", product_id: "", location_id: "" });
  const [applied, setApplied] = useState({});
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const loader = useCallback(async () => {
    const [inventoryRows, productRows, locationRows, orderRows] = await Promise.all([
      api.inventory.list(applied), api.products.list(), api.locations.list(), allOrders(),
    ]);
    const allocationRows = await Promise.all(orderRows.map((order) => api.orders.allocations(order.id)));
    const productForLine = new Map(orderRows.flatMap((order) => order.lines.map((line) => [line.id, line.product_id])));
    const reserved = new Map();
    allocationRows.flat().filter((allocation) => allocation.status === "ACTIVE").forEach((allocation) => {
      const productId = productForLine.get(allocation.line_id);
      if (productId == null) return;
      const key = `${productId}:${allocation.location_id}`;
      reserved.set(key, (reserved.get(key) || 0) + Number(allocation.quantity));
    });
    return [inventoryRows, productRows, locationRows, reserved];
  }, [applied]);
  const { data, loading, error, refresh } = useLoad(loader, [applied]);
  const [rows, products, locations, reserved] = data || [[], [], [], new Map()];
  const productById = Object.fromEntries(asArray(products).map((x) => [x.id, x]));
  const locationById = Object.fromEntries(asArray(locations).map((x) => [x.id, x]));
  async function adjust(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const delta = Number(form.get("delta"));
    const reason = String(form.get("reason")).trim();
    if (!delta || !Number.isFinite(delta) || !reason) return notify("Enter a non-zero quantity and a reason.", "error");
    setSaving(true);
    try { const result = await api.inventory.adjust({ product_id: Number(form.get("product_id")), location_id: Number(form.get("location_id")), delta, reason }); notify(`Inventory updated. New on-hand quantity: ${number(result.quantity)}.`); setModal(false); refresh(); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeader title="Inventory" description="Review on-hand inventory and make audited quantity adjustments." actions={<><RefreshAction onClick={refresh} loading={loading} /><Button icon={Plus} onClick={() => setModal(true)}>Adjust inventory</Button></>} />
    <TableCard><div className="table-toolbar filter-toolbar">
      <SearchBox value={filters.sku} onChange={(sku) => setFilters({ ...filters, sku })} placeholder="Filter by SKU..." />
      <select aria-label="Filter product" value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}><option value="">All products</option>{asArray(products).map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select>
      <select aria-label="Filter location" value={filters.location_id} onChange={(e) => setFilters({ ...filters, location_id: e.target.value })}><option value="">All locations</option>{asArray(locations).map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select>
      <Button variant="secondary" onClick={() => setApplied(filters)}>Apply filters</Button>
      <Button variant="ghost" onClick={() => { setFilters({ sku: "", product_id: "", location_id: "" }); setApplied({}); }}>Clear</Button>
    </div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <DataTable rows={rows} columns={[
        { key: "product_id", label: "Product", render: (row) => <><strong>{productById[row.product_id]?.sku || `Product ${row.product_id}`}</strong><span className="cell-sub">{productById[row.product_id]?.name || "Catalog details unavailable"}</span></> },
        { key: "location_id", label: "Location", render: (row) => locationById[row.location_id]?.name || `Location ${row.location_id}` },
        { key: "quantity", label: "Quantity on hand", render: (row) => <strong>{number(row.quantity)}</strong> },
        { key: "reserved", label: "Quantity reserved", render: (row) => number(reserved.get(`${row.product_id}:${row.location_id}`) || 0) },
        { key: "available", label: "Unreserved on hand", render: (row) => number(Number(row.quantity) - (reserved.get(`${row.product_id}:${row.location_id}`) || 0)) },
        { key: "updated_at", label: "Last updated", render: (row) => dateLabel(row.updated_at) },
      ]} emptyText="No inventory matches the selected filters" />}
    </TableCard>
    {modal && <Modal title="Adjust inventory" onClose={() => setModal(false)}>
      {(!products.length || !locations.length) ? <Empty title="Products or locations are unavailable" detail="Create catalog records before adjusting inventory." /> :
        <form className="form-grid" onSubmit={adjust}>
          <FormField label="Product"><select name="product_id" required>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></FormField>
          <FormField label="Location"><select name="location_id" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField>
          <FormField label="Quantity change (delta)" hint="Use a positive value to add stock, negative to remove."><input name="delta" type="number" step="0.001" required /></FormField>
          <FormField label="Reason"><textarea name="reason" rows="3" required minLength="1" placeholder="Explain the inventory adjustment" /></FormField>
          <SubmitRow busy={saving} onCancel={() => setModal(false)} label="Apply adjustment" />
        </form>}
    </Modal>}
  </>;
}

export function Receipts() {
  const notify = useToast();
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const loader = useCallback(() => Promise.all([api.receipts.list(), api.products.list(), api.locations.list()]), []);
  const { data, loading, error, refresh } = useLoad(loader);
  const [receipts, products, locations] = data || [[], [], []];
  const productMap = Object.fromEntries(asArray(products).map((x) => [x.id, x]));
  const locationMap = Object.fromEntries(asArray(locations).map((x) => [x.id, x]));
  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { receipt_code: String(form.get("receipt_code")).trim(), product_id: Number(form.get("product_id")), location_id: Number(form.get("location_id")), quantity: Number(form.get("quantity")), expected_arrival: String(form.get("expected_arrival")) };
    setSaving(true);
    try { await api.receipts.create(body); notify("Receipt created."); setModal(null); refresh(); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  async function updateReceipt(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason")).trim();
    if (!reason) return notify("A reason is required to update a receipt.", "error");
    setSaving(true);
    try {
      await api.receipts.update(modal.id, {
        quantity: Number(form.get("quantity")),
        expected_arrival: String(form.get("expected_arrival")),
      }, reason);
      notify("Receipt updated.");
      setModal(null);
      refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  async function openReceipt(receipt) {
    try { setModal(await api.receipts.get(receipt.id)); }
    catch (err) { notify(getErrorMessage(err), "error"); }
  }
  async function mutate(action, receipt) {
    const reason = window.prompt(`Reason to ${action} receipt ${receipt.receipt_code}:`);
    if (reason == null) return;
    if (!reason.trim()) return notify("A non-empty reason is required.", "error");
    if (!window.confirm(`Confirm ${action} for ${receipt.receipt_code}?`)) return;
    try {
      const result = action === "receive" ? await api.receipts.receive(receipt.id, reason) : await api.receipts.cancel(receipt.id, reason);
      notify(result.already_received ? "This receipt was already received; no inventory was added again." : result.already_canceled ? "This receipt was already canceled." : `Receipt ${action === "receive" ? "received" : "canceled"}.`);
      refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
  }
  const sorted = asArray(receipts).slice().sort((a, b) => new Date(a.expected_arrival) - new Date(b.expected_arrival));
  return <>
    <PageHeader title="Incoming receipts" description="Track planned inbound supply, receive stock, and manage expected arrivals."     actions={<><RefreshAction onClick={refresh} loading={loading} /><Button icon={Plus} onClick={() => setModal("create")}>Create receipt</Button></>} />
    <TableCard>{loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <DataTable rows={sorted} columns={[
      { key: "receipt_code", label: "Receipt", render: (row) => <strong className="primary-cell">{row.receipt_code}</strong> },
      { key: "product_id", label: "Product", render: (row) => productMap[row.product_id]?.sku || `Product ${row.product_id}` },
      { key: "location_id", label: "Location", render: (row) => locationMap[row.location_id]?.code || `Location ${row.location_id}` },
      { key: "quantity", label: "Quantity", render: (row) => number(row.quantity) },
      { key: "expected_arrival", label: "Expected arrival", render: (row) => dateLabel(row.expected_arrival) },
      { key: "status", label: "Status", render: (row) => <Badge>{row.status}</Badge> },
      { key: "actions", label: "Actions", render: (row) => <div className="row-actions"><button className="text-button" onClick={() => openReceipt(row)}>Details</button>{["PLANNED", "IN_TRANSIT"].includes(row.status) && <><button className="text-button" onClick={() => mutate("receive", row)}>Receive</button><button className="text-button danger-text" onClick={() => mutate("cancel", row)}>Cancel</button></>}</div> },
    ]} emptyText="No incoming receipts" />}</TableCard>
    {modal === "create" && <Modal title="Create incoming receipt" onClose={() => setModal(null)}>
      <form className="form-grid" onSubmit={create}>
        <FormField label="Receipt code"><input name="receipt_code" required /></FormField>
        <FormField label="Product"><select name="product_id" required>{asArray(products).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></FormField>
        <FormField label="Location"><select name="location_id" required>{asArray(locations).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField>
        <FormField label="Quantity"><input name="quantity" type="number" min="0.001" step="0.001" required /></FormField>
        <FormField label="Expected arrival"><input name="expected_arrival" type="datetime-local" required /></FormField>
        <SubmitRow busy={saving} onCancel={() => setModal(null)} label="Create receipt" />
      </form>
    </Modal>}
    {modal && modal !== "create" && <Modal title={`Receipt ${modal.receipt_code}`} onClose={() => setModal(null)}>
      <form className="form-grid" onSubmit={updateReceipt}>
        <div className="detail-pair"><span>Status</span><Badge>{modal.status}</Badge></div>
        <div className="detail-pair"><span>Product</span><b>{productMap[modal.product_id]?.sku || modal.product_id}</b></div>
        <div className="detail-pair"><span>Location</span><b>{locationMap[modal.location_id]?.code || modal.location_id}</b></div>
        {["PLANNED", "IN_TRANSIT"].includes(modal.status) ? <>
          <FormField label="Quantity"><input name="quantity" type="number" min="0.001" step="0.001" required defaultValue={modal.quantity} /></FormField>
          <FormField label="Expected arrival"><input name="expected_arrival" type="datetime-local" required defaultValue={dateInput(modal.expected_arrival)} /></FormField>
          <FormField label="Reason for change"><input name="reason" required /></FormField>
          <SubmitRow busy={saving} onCancel={() => setModal(null)} label="Save receipt changes" />
        </> : <div className="notice info">Received or canceled receipts are read-only.</div>}
      </form>
    </Modal>}
  </>;
}

export function ATPPlanning() {
  const notify = useToast();
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 16));
  const [end, setEnd] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16));
  const [mode, setMode] = useState("location");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { Promise.all([api.products.list(), api.locations.list()]).then(([p, l]) => { setProducts(p); setLocations(l); }).catch((err) => setError(getErrorMessage(err))); }, []);
  async function load() {
    if (!selectedProduct) return notify("Select a product to view ATP.", "error");
    setLoading(true); setError("");
    try {
      const value = mode === "location"
        ? selectedLocation ? await api.atp.byLocation(selectedProduct, selectedLocation) : null
        : await api.atp.projection(selectedProduct, start, end);
      if (!value) return notify("Select a location to view location-level ATP.", "error");
      setResult(value);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }
  const events = useMemo(() => {
    if (!result) return [];
    if (Array.isArray(result.events)) return result.events;
    return asArray(result.locations).flatMap((location) => asArray(location.projection?.events).map((event) => ({ ...event, location_id: location.location_id })));
  }, [result]);
  return <>
    <PageHeader title="ATP planning" description="Review available-to-promise projections calculated by the backend." actions={<Button icon={RefreshCw} onClick={load} disabled={loading}>{loading ? "Calculating…" : "Run projection"}</Button>} />
    <Card className="filter-card">
      <div className="form-grid atp-controls">
        <FormField label="Projection view"><select value={mode} onChange={(e) => { setMode(e.target.value); setResult(null); }}><option value="location">Product + location</option><option value="date">Product date range</option></select></FormField>
        <FormField label="Product"><select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></FormField>
        {mode === "location" ? <FormField label="Location"><select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}><option value="">Select location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField> : <>
          <FormField label="Start"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="End"><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
        </>}
      </div>
    </Card>
    {error && <ErrorState message={error} />}
    {loading ? <Loading label="Loading backend ATP projection…" /> : result && <>
      <Card className="chart-card"><div className="card-title-row"><div><h3>Projected availability</h3><span>Source: backend ATP calculation · no frontend recalculation</span></div></div>
        {events.length ? <div className="projection-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={events}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString()} /><YAxis /><Tooltip labelFormatter={(v) => dateLabel(v)} /><Area type="stepAfter" dataKey="atp" stroke="#3866e8" fill="#dbe6ff" /></AreaChart></ResponsiveContainer></div> : <Empty title="No ATP events returned" detail="The backend returned no projection events for this selection." />}
      </Card>
      <TableCard><DataTable rows={events} columns={[
        { key: "date", label: "Event date", render: (row) => dateLabel(row.date) },
        { key: "location_id", label: "Location", render: (row) => row.location_id ? locations.find((l) => l.id === row.location_id)?.code || row.location_id : selectedLocation ? locations.find((l) => String(l.id) === String(selectedLocation))?.code : "All locations" },
        { key: "event", label: "Event", render: (row) => <Badge>{row.event}</Badge> },
        { key: "quantity", label: "Quantity change", render: (row) => number(row.quantity) },
        { key: "atp", label: "ATP after event", render: (row) => <strong>{number(row.atp)}</strong> },
      ]} /></TableCard>
    </>}
  </>;
}

export function Orders() {
  const notify = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", order_status: "", priority: "", exception_type: "", requested_from: "", requested_to: "", sort: "oldest" });
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({});
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const loader = useCallback(() => api.orders.list({ ...applied, page, page_size: 20 }), [applied, page]);
  const { data, loading, error, refresh } = useLoad(loader, [applied, page]);
  const { data: catalogs } = useLoad(() => Promise.all([api.products.list(), api.locations.list()]), []);
  const [products, locations] = catalogs || [[], []];
  const items = data?.items || [];
  function applyFilters() { setPage(1); setApplied(filters); }
  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lineRows = [...event.currentTarget.querySelectorAll(".order-line-form")];
    const lines = lineRows.map((line) => ({
      product_id: Number(line.querySelector('[name="product_id"]').value),
      requested_quantity: Number(line.querySelector('[name="requested_quantity"]').value),
      preferred_location_id: line.querySelector('[name="preferred_location_id"]').value ? Number(line.querySelector('[name="preferred_location_id"]').value) : null,
    }));
    const body = { order_number: String(form.get("order_number")).trim(), customer_name: String(form.get("customer_name")).trim(), priority: String(form.get("priority")), requested_ship_date: String(form.get("requested_ship_date")), lines };
    setSaving(true);
    try { const result = await api.orders.create(body); notify("Draft order created."); setModal(false); navigate(`/orders/${result.id}`); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeader title="Customer orders" description="Search, prioritize, and manage customer order fulfillment." actions={<><RefreshAction onClick={refresh} loading={loading} /><Button icon={Plus} onClick={() => setModal(true)}>Create order</Button></>} />
    <Card className="filter-card">
      <div className="order-filter-grid">
        <SearchBox value={filters.search} onChange={(search) => setFilters({ ...filters, search })} placeholder="Order number or customer" />
        <select aria-label="Order status" value={filters.order_status} onChange={(e) => setFilters({ ...filters, order_status: e.target.value })}><option value="">All statuses</option>{["DRAFT", "CONFIRMED", "FULFILLING", "SHIPPED", "CANCELED"].map((x) => <option key={x}>{x}</option>)}</select>
        <select aria-label="Order priority" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option value="">All priorities</option>{["HIGH", "MED", "LOW"].map((x) => <option key={x}>{x}</option>)}</select>
        <input aria-label="Exception type filter" value={filters.exception_type} placeholder="Exception type" onChange={(e) => setFilters({ ...filters, exception_type: e.target.value })} />
        <input type="datetime-local" aria-label="Requested date from" value={filters.requested_from} onChange={(e) => setFilters({ ...filters, requested_from: e.target.value })} />
        <input type="datetime-local" aria-label="Requested date to" value={filters.requested_to} onChange={(e) => setFilters({ ...filters, requested_to: e.target.value })} />
        <select aria-label="Sort orders" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="oldest">Oldest</option><option value="earliest_promise">Earliest promise</option><option value="highest_risk">Highest risk</option></select>
        <Button variant="secondary" onClick={applyFilters}>Apply</Button>
      </div>
    </Card>
    <TableCard>{loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <>
      <DataTable rows={items} columns={[
        { key: "order_number", label: "Order", render: (row) => <Link to={`/orders/${row.id}`} className="primary-cell">{row.order_number}</Link> },
        { key: "customer_name", label: "Customer" },
        { key: "priority", label: "Priority", render: (row) => <Badge>{row.priority}</Badge> },
        { key: "status", label: "Status", render: (row) => <Badge>{row.status}</Badge> },
        { key: "requested_ship_date", label: "Requested ship", render: (row) => dateLabel(row.requested_ship_date) },
        { key: "promise", label: "Promise / risk", render: (row) => {
          const lines = asArray(row.lines); const promised = lines.map((l) => l.promised_ship_date).filter(Boolean).sort()[0];
          const risk = lines.reduce((sum, line) => sum + Number(line.backordered_quantity || 0), 0);
          return <span>{promised ? dateLabel(promised) : "Not determined"}{risk > 0 && <span className="risk-note"> · {number(risk)} at risk</span>}</span>;
        } },
      ]} emptyText="No orders match the selected filters" />
      <div className="pagination"><span>{data?.total ?? items.length} total orders · Page {data?.page ?? page} of {data?.pages ?? 1}</span><div><IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={17} /></IconButton><IconButton label="Next page" disabled={page >= (data?.pages || 1)} onClick={() => setPage((p) => p + 1)}><ChevronRight size={17} /></IconButton></div></div>
    </>}</TableCard>
    {modal && <Modal title="Create draft order" wide onClose={() => setModal(false)}>
      {!products.length ? <Empty title="No products available" detail="Add a product before creating an order." /> : <form className="form-grid" onSubmit={create}>
        <FormField label="Order number"><input name="order_number" required /></FormField>
        <FormField label="Customer name"><input name="customer_name" required /></FormField>
        <FormField label="Priority"><select name="priority"><option>MED</option><option>HIGH</option><option>LOW</option></select></FormField>
        <FormField label="Requested ship date"><input name="requested_ship_date" type="datetime-local" required /></FormField>
        <div className="line-form-list"><div className="line-form-head"><b>Order lines</b><Button variant="secondary" icon={Plus} onClick={(event) => { event.preventDefault(); const parent = event.currentTarget.closest("form").querySelector(".line-form-list"); const node = parent.querySelector(".order-line-form").cloneNode(true); node.querySelectorAll("input").forEach((input) => { if (input.type === "number") input.value = ""; }); parent.appendChild(node); }}>Add line</Button></div>
          <div className="order-line-form">
            <FormField label="Product"><select name="product_id" required>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></FormField>
            <FormField label="Quantity"><input name="requested_quantity" type="number" min="0.001" step="0.001" required /></FormField>
            <FormField label="Preferred location (optional)"><select name="preferred_location_id"><option value="">No preference</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField>
          </div>
        </div>
        <SubmitRow busy={saving} onCancel={() => setModal(false)} label="Create draft order" />
      </form>}
    </Modal>}
  </>;
}

export function OrderDetails() {
  const { orderId } = useParams();
  const notify = useToast();
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [saving, setSaving] = useState(false);
  const loader = useCallback(async () => Promise.all([
    api.orders.get(orderId), api.orders.allocations(orderId), api.orders.timeline(orderId), api.orders.shipments(orderId),
    api.products.list(), api.locations.list(), api.ai.exceptionSummary(orderId),
  ]), [orderId]);
  const { data, loading, error, refresh } = useLoad(loader, [orderId]);
  const [order, allocations, timeline, shipments, products, locations, summary] = data || [];
  const productMap = Object.fromEntries(asArray(products).map((p) => [p.id, p]));
  const locationMap = Object.fromEntries(asArray(locations).map((l) => [l.id, l]));
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!order) return <Empty title="Order unavailable" />;
  async function mutate(action, line) {
    if (action === "confirm" && !window.confirm(`Confirm order ${order.order_number}? This triggers backend allocation.`)) return;
    const reason = action === "confirm" ? "" : window.prompt(`Reason to ${action} ${line ? `line ${line.id}` : `order ${order.order_number}`}:`);
    if (action !== "confirm" && reason == null) return;
    if (action !== "confirm" && !reason.trim()) return notify("A non-empty reason is required.", "error");
    if (action !== "confirm" && !window.confirm(`Confirm ${action === "cancel" ? "cancellation" : "removal"}? This change cannot be undone.`)) return;
    setSaving(true);
    try {
      if (action === "confirm") await api.orders.confirm(order.id);
      if (action === "cancel") await api.orders.cancel(order.id, reason);
      if (action === "delete-line") await api.orders.deleteLine(order.id, line.id, reason);
      notify(action === "confirm" ? "Order confirmed and allocation refreshed." : action === "cancel" ? "Order canceled." : "Order line removed.");
      refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  async function saveOrder(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setSaving(true);
    try { await api.orders.update(order.id, { customer_name: String(form.get("customer_name")).trim(), priority: String(form.get("priority")), requested_ship_date: String(form.get("requested_ship_date")) }); notify("Order details updated."); setModal(""); refresh(); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  async function addLine(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setSaving(true);
    try { await api.orders.addLine(order.id, { product_id: Number(form.get("product_id")), requested_quantity: Number(form.get("requested_quantity")), preferred_location_id: form.get("preferred_location_id") ? Number(form.get("preferred_location_id")) : null }); notify("Order line added."); setModal(""); refresh(); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  async function updateLine(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const lineId = Number(form.get("line_id"));
    setSaving(true);
    try {
      await api.orders.updateLine(order.id, lineId, {
        product_id: Number(form.get("product_id")),
        requested_quantity: Number(form.get("requested_quantity")),
        preferred_location_id: form.get("preferred_location_id") ? Number(form.get("preferred_location_id")) : null,
      });
      notify("Order line updated.");
      setModal("");
      refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  const navTabs = ["overview", "lines", "allocations", "timeline", "shipments"];
  return <>
    <div className="breadcrumbs"><Link to="/orders">Customer orders</Link><ChevronRight size={14} /><span>{order.order_number}</span></div>
    <PageHeader title={order.order_number} description={`${order.customer_name} · Created ${dateLabel(order.created_at)}`} actions={<>
      <Badge>{order.status}</Badge>
      {order.status === "DRAFT" && <Button onClick={() => mutate("confirm")} disabled={saving}>Confirm order</Button>}
      {!["SHIPPED", "CANCELED"].includes(order.status) && <Button variant="secondary" onClick={() => setModal("edit")}>Edit order</Button>}
      {!["SHIPPED", "CANCELED"].includes(order.status) && <Button variant="danger" onClick={() => mutate("cancel")} disabled={saving}>Cancel order</Button>}
      <RefreshAction onClick={refresh} loading={saving} />
    </>} />
    <div className="tabs">{navTabs.map((name) => <button key={name} className={tab === name ? "selected" : ""} onClick={() => setTab(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
    {tab === "overview" && <>
      <div className="metrics-grid detail-metrics">
        <Metric label="Priority" value={order.priority} caption="Current order priority" icon={Activity} />
        <Metric label="Requested ship" value={new Date(order.requested_ship_date).toLocaleDateString()} caption="Customer request" icon={CalendarDays} tone="blue" />
        <Metric label="Order lines" value={order.lines.length} caption="Products in this order" icon={ClipboardIcon} tone="violet" />
        <Metric label="Backordered units" value={number(order.lines.reduce((sum, line) => sum + Number(line.backordered_quantity || 0), 0))} caption="Backend allocation result" icon={CircleAlert} tone="red" />
      </div>
      <Card className="advisory-card"><div className="card-title-row"><div><h3><Sparkles size={16} /> Backend fulfillment advisory</h3><span>Informational summary from the existing deterministic backend rules</span></div></div>
        <p>Order status: <b>{summary.status}</b></p><div className="advisory-columns"><div><b>Risks</b>{asArray(summary.risks).length ? <ul>{summary.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul> : <p>No risks returned.</p>}</div><div><b>Recommendations</b><ul>{asArray(summary.recommendations).map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
      </Card>
    </>}
    {tab === "lines" && <TableCard><div className="table-toolbar"><h3>Order lines</h3>{!["SHIPPED", "CANCELED"].includes(order.status) && <Button icon={Plus} onClick={() => setModal("line")}>Add line</Button>}</div><DataTable rows={order.lines} columns={[
      { key: "product_id", label: "Product", render: (line) => productMap[line.product_id]?.sku || `Product ${line.product_id}` },
      { key: "requested_quantity", label: "Requested", render: (line) => number(line.requested_quantity) },
      { key: "allocated_quantity", label: "Allocated", render: (line) => number(line.allocated_quantity) },
      { key: "shipped_quantity", label: "Shipped", render: (line) => number(line.shipped_quantity) },
      { key: "backordered_quantity", label: "Backordered", render: (line) => <span className={Number(line.backordered_quantity) > 0 ? "risk-note" : ""}>{number(line.backordered_quantity)}</span> },
      { key: "promised_ship_date", label: "Promise", render: (line) => dateLabel(line.promised_ship_date) },
      { key: "preferred_location_id", label: "Preferred location", render: (line) => line.preferred_location_id ? locationMap[line.preferred_location_id]?.code : "Auto" },
      { key: "actions", label: "", render: (line) => !["SHIPPED", "CANCELED"].includes(order.status) ? <div className="row-actions">{<button className="text-button" onClick={() => setModal(`edit-line-${line.id}`)}>Edit</button>}{Number(line.shipped_quantity) === 0 && <button className="text-button danger-text" onClick={() => mutate("delete-line", line)}>Remove</button>}</div> : null },
    ]} /></TableCard>}
    {tab === "allocations" && <TableCard><h3>Allocation history</h3><DataTable rows={asArray(allocations)} columns={[
      { key: "line_id", label: "Line" }, { key: "location_id", label: "Location", render: (row) => locationMap[row.location_id]?.code || row.location_id },
      { key: "source_type", label: "Source", render: (row) => <Badge>{row.source_type}</Badge> }, { key: "source_id", label: "Source ID" },
      { key: "quantity", label: "Quantity", render: (row) => number(row.quantity) }, { key: "status", label: "Status", render: (row) => <Badge>{row.status}</Badge> },
    ]} emptyText="No allocation records; drafts are not allocated." /></TableCard>}
    {tab === "timeline" && <TableCard><h3>Order timeline</h3><DataTable rows={asArray(timeline).slice().reverse()} columns={[
      { key: "date", label: "Date", render: (row) => dateLabel(row.date) },
      { key: "type", label: "Event", render: (row) => <Badge>{row.type}</Badge> },
      { key: "quantity", label: "Quantity", render: (row) => row.quantity == null ? "—" : number(row.quantity) },
      { key: "reason", label: "Reason / source", render: (row) => row.reason || row.source || row.receipt_code || row.shipment_code || "—" },
    ]} emptyText="No timeline events returned" /></TableCard>}
    {tab === "shipments" && <TableCard><h3>Shipment history</h3><DataTable rows={asArray(shipments)} columns={[
      { key: "shipment_code", label: "Shipment" }, { key: "shipped_at", label: "Shipped at", render: (row) => dateLabel(row.shipped_at) },
      { key: "lines", label: "Lines", render: (row) => asArray(row.lines).map((line) => `${line.order_line_id}: ${number(line.quantity)}`).join(", ") },
    ]} emptyText="No shipments for this order" /></TableCard>}
    {modal === "edit" && <Modal title="Edit order" onClose={() => setModal("")}><form className="form-grid" onSubmit={saveOrder}>
      <FormField label="Customer name"><input name="customer_name" defaultValue={order.customer_name} required /></FormField>
      <FormField label="Priority"><select name="priority" defaultValue={order.priority}>{["HIGH", "MED", "LOW"].map((x) => <option key={x}>{x}</option>)}</select></FormField>
      <FormField label="Requested ship date"><input name="requested_ship_date" type="datetime-local" defaultValue={dateInput(order.requested_ship_date)} required /></FormField>
      <SubmitRow busy={saving} onCancel={() => setModal("")} />
    </form></Modal>}
    {modal === "line" && <Modal title="Add order line" onClose={() => setModal("")}><form className="form-grid" onSubmit={addLine}>
      <FormField label="Product"><select name="product_id" required>{asArray(products).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></FormField>
      <FormField label="Requested quantity"><input name="requested_quantity" type="number" min="0.001" step="0.001" required /></FormField>
      <FormField label="Preferred location"><select name="preferred_location_id"><option value="">No preference</option>{asArray(locations).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField>
      <SubmitRow busy={saving} onCancel={() => setModal("")} label="Add line" />
    </form></Modal>}
    {typeof modal === "string" && modal.startsWith("edit-line-") && (() => {
      const line = order.lines.find((item) => item.id === Number(modal.slice("edit-line-".length)));
      return line ? <Modal title={`Edit order line ${line.id}`} onClose={() => setModal("")}><form className="form-grid" onSubmit={updateLine}>
        <input type="hidden" name="line_id" value={line.id} />
        <FormField label="Product"><select name="product_id" defaultValue={line.product_id} required>{asArray(products).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></FormField>
        <FormField label="Requested quantity"><input name="requested_quantity" type="number" min={line.shipped_quantity} step="0.001" defaultValue={line.requested_quantity} required /></FormField>
        <FormField label="Preferred location"><select name="preferred_location_id" defaultValue={line.preferred_location_id ?? ""}><option value="">No preference</option>{asArray(locations).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField>
        <SubmitRow busy={saving} onCancel={() => setModal("")} label="Update line" />
      </form></Modal> : null;
    })()}
  </>;
}

export function Exceptions() {
  const [filters, setFilters] = useState({ exception_status: "OPEN", exception_type: "", sort: "oldest" });
  const [applied, setApplied] = useState(filters);
  const loader = useCallback(() => api.exceptions(applied), [applied]);
  const { data, loading, error, refresh } = useLoad(loader, [applied]);
  const { data: ordersData } = useLoad(() => allOrders(), []);
  const orderMap = Object.fromEntries(asArray(ordersData).map((order) => [order.id, order]));
  return <>
    <PageHeader title="Exceptions" description="Monitor backend-reported fulfillment risks and backorders." actions={<RefreshAction onClick={refresh} loading={loading} />} />
    <Card className="filter-card"><div className="filter-toolbar">
      <select aria-label="Exception status" value={filters.exception_status} onChange={(e) => setFilters({ ...filters, exception_status: e.target.value })}><option>OPEN</option><option>RESOLVED</option></select>
      <input aria-label="Exception type" placeholder="Exception type (e.g. BACKORDER)" value={filters.exception_type} onChange={(e) => setFilters({ ...filters, exception_type: e.target.value })} />
      <select aria-label="Sort exceptions" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select>
      <Button variant="secondary" onClick={() => setApplied(filters)}>Apply filters</Button>
    </div></Card>
    <TableCard>{loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <DataTable rows={asArray(data)} columns={[
      { key: "exception_type", label: "Type", render: (row) => <Badge tone={row.status === "OPEN" ? "red" : "green"}>{row.exception_type}</Badge> },
      { key: "order_id", label: "Order", render: (row) => orderMap[row.order_id] ? <Link className="primary-cell" to={`/orders/${row.order_id}`}>{orderMap[row.order_id].order_number}</Link> : `Order ${row.order_id}` },
      { key: "details", label: "Details" },
      { key: "status", label: "Status", render: (row) => <Badge>{row.status}</Badge> },
      { key: "created_at", label: "Reported", render: (row) => dateLabel(row.created_at) },
      { key: "actions", label: "", render: (row) => <Link className="text-button" to="/planner" state={{ orderId: row.order_id }}>Plan action</Link> },
    ]} emptyText={`No ${filters.exception_status.toLowerCase()} exceptions`} />}</TableCard>
  </>;
}

export function PlannerWorkspace() {
  const notify = useToast();
  const [formMode, setFormMode] = useState("expedite");
  const [saving, setSaving] = useState(false);
  const loader = useCallback(async () => Promise.all([api.receipts.list(), allOrders(), api.locations.list()]), []);
  const { data, loading, error, refresh } = useLoad(loader);
  const [receipts, orders, locations] = data || [[], [], []];
  const lines = asArray(orders).filter((o) => ["CONFIRMED", "FULFILLING"].includes(o.status)).flatMap((order) => asArray(order.lines).map((line) => ({ ...line, order })));
  async function submit(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const id = Number(form.get("target"));
    const reason = String(form.get("reason")).trim();
    if (!reason) return notify("A reason is required.", "error");
    const action = formMode === "expedite" ? "expedite receipt" : formMode === "reassign" ? "reassign order line" : "override promise date";
    if (!window.confirm(`Confirm planner action: ${action}? This will update allocations and may affect promises.`)) return;
    const body = { reason };
    if (formMode === "expedite") body.expected_arrival = String(form.get("expected_arrival"));
    if (formMode === "reassign") body.location_id = Number(form.get("location_id"));
    if (formMode === "promise") body.promised_ship_date = String(form.get("promised_ship_date"));
    setSaving(true);
    try {
      if (formMode === "expedite") await api.planner.expedite(id, body);
      else if (formMode === "reassign") await api.planner.reassign(id, body);
      else await api.planner.overridePromise(id, body);
      notify("Planner action completed. Related backend projections were rebuilt.");
      refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  const availableReceipts = asArray(receipts).filter((r) => ["PLANNED", "IN_TRANSIT"].includes(r.status));
  return <>
    <PageHeader title="Planner workspace" description="Use audited backend actions to expedite supply or adjust confirmed fulfillment plans." actions={<RefreshAction onClick={refresh} loading={loading} />} />
    {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <>
      <Card className="filter-card"><div className="mode-tabs">{[["expedite", "Expedite receipt"], ["reassign", "Reassign order line"], ["promise", "Override promise"]].map(([value, label]) => <button key={value} className={formMode === value ? "selected" : ""} onClick={() => setFormMode(value)}>{label}</button>)}</div>
        <form className="form-grid planner-form" onSubmit={submit}>
          {formMode === "expedite" ? <>
            <FormField label="Receipt"><select name="target" required>{availableReceipts.map((r) => <option value={r.id} key={r.id}>{r.receipt_code} · current {dateLabel(r.expected_arrival)}</option>)}</select></FormField>
            <FormField label="Earlier expected arrival"><input name="expected_arrival" type="datetime-local" required /></FormField>
          </> : <>
            <FormField label="Order line"><select name="target" required>{lines.map((line) => <option key={line.id} value={line.id}>{line.order.order_number} · line {line.id} · product {line.product_id} · {number(line.backordered_quantity)} backordered</option>)}</select></FormField>
            {formMode === "reassign" ? <FormField label="New fulfillment location"><select name="location_id" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></FormField> : <FormField label="New promised ship date"><input name="promised_ship_date" type="datetime-local" required /></FormField>}
          </>}
          <FormField label="Reason"><textarea name="reason" required minLength="1" rows="3" /></FormField>
          <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? "Submitting…" : "Review & submit action"}</Button></div>
        </form>
      </Card>
      <div className="notice info"><Activity size={17} /><span>Each change is sent to the backend for validation. A successful planner action triggers the backend allocation rebuild; the page refreshes its current inputs after success.</span></div>
    </>}
  </>;
}

export function Shipments() {
  const notify = useToast();
  const [saving, setSaving] = useState(false);
  const [lineItems, setLineItems] = useState([{ lineId: "", locationId: "", quantity: "" }]);
  const loader = useCallback(async () => {
    const [orderRows, locationRows, productRows] = await Promise.all([allOrders(), api.locations.list(), api.products.list()]);
    const shipmentGroups = await Promise.all(orderRows.map(async (order) => ({
      order,
      shipments: await api.orders.shipments(order.id),
    })));
    return [orderRows, locationRows, productRows, shipmentGroups.flatMap(({ order, shipments }) =>
      asArray(shipments).map((shipment) => ({ ...shipment, order_number: order.order_number, order_id: order.id })))];
  }, []);
  const { data, loading, error, refresh } = useLoad(loader);
  const [orders, locations, products, shipmentHistory] = data || [[], [], [], []];
  const eligible = asArray(orders).filter((order) => ["CONFIRMED", "FULFILLING"].includes(order.status));
  const lines = eligible.flatMap((order) => order.lines.filter((line) => Number(line.requested_quantity) > Number(line.shipped_quantity)).map((line) => ({ ...line, order })));
  function changeLine(index, field, value) { setLineItems((items) => items.map((item, i) => i === index ? { ...item, [field]: value } : item)); }
  async function submit(event) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason")).trim();
    const shipmentLines = lineItems.filter((line) => line.lineId && line.quantity).map((line) => ({ order_line_id: Number(line.lineId), location_id: Number(line.locationId), quantity: Number(line.quantity) }));
    if (!reason || !shipmentLines.length || shipmentLines.some((line) => !line.location_id || line.quantity <= 0)) return notify("Enter a reason and valid shipment lines.", "error");
    if (new Set(shipmentLines.map((line) => lines.find((l) => l.id === line.order_line_id)?.order.id)).size > 1) return notify("A shipment can only include lines from one order.", "error");
    if (!window.confirm(`Create shipment with ${shipmentLines.length} line(s)? The backend will verify active allocations and physical stock.`)) return;
    setSaving(true);
    try {
      const result = await api.shipments({ reason, lines: shipmentLines });
      notify(`Shipment ${result.shipment_code} created. Order status: ${result.status}.`);
      setLineItems([{ lineId: "", locationId: "", quantity: "" }]); refresh();
    } catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setSaving(false); }
  }
  return <>
    <PageHeader title="Shipments" description="Create partial or complete shipments from active on-hand allocations." actions={<RefreshAction onClick={refresh} loading={loading} />} />
    {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={refresh} /> : <>
      <div className="shipment-layout">
      <Card className="shipment-form-card"><div className="card-title-row"><div><h3>Create shipment</h3><span>Backend verifies allocation coverage and on-hand stock</span></div><Truck size={19} /></div>
        <form className="form-grid" onSubmit={submit}>
          <FormField label="Shipment reason"><textarea name="reason" rows="2" required /></FormField>
          {lineItems.map((item, index) => <div className="shipment-line" key={index}>
            <FormField label="Order line"><select value={item.lineId} required onChange={(e) => { const selected = lines.find((line) => String(line.id) === e.target.value); changeLine(index, "lineId", e.target.value); if (selected?.preferred_location_id) changeLine(index, "locationId", String(selected.preferred_location_id)); }}>
              <option value="">Choose eligible line</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.order.order_number} · line {line.id} · {products.find((p) => p.id === line.product_id)?.sku || `Product ${line.product_id}`} · allocated {number(line.allocated_quantity)} · backordered {number(line.backordered_quantity)} · remaining {number(Number(line.requested_quantity) - Number(line.shipped_quantity))}</option>)}
            </select></FormField>
            <FormField label="Location"><select value={item.locationId} required onChange={(e) => changeLine(index, "locationId", e.target.value)}><option value="">Select location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code} — {location.name}</option>)}</select></FormField>
            <FormField label="Quantity"><input type="number" min="0.001" step="0.001" value={item.quantity} required onChange={(e) => changeLine(index, "quantity", e.target.value)} /></FormField>
            {lineItems.length > 1 && <IconButton label="Remove line" onClick={() => setLineItems((items) => items.filter((_, i) => i !== index))}><X size={16} /></IconButton>}
          </div>)}
          <Button variant="secondary" icon={Plus} onClick={() => setLineItems((items) => [...items, { lineId: "", locationId: "", quantity: "" }])}>Add shipment line</Button>
          <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create shipment"}</Button>
        </form>
      </Card>
      <Card className="shipment-help"><div className="help-icon"><Truck size={20} /></div><h3>Shipment guardrails</h3><ul><li>Only confirmed or fulfilling orders can be shipped.</li><li>Ship quantity cannot exceed outstanding order quantity.</li><li>Each shipment must be covered by active ON_HAND allocation and physical inventory.</li><li>Partial shipment quantities are supported.</li></ul></Card>
      </div>
      <TableCard className="shipment-history"><h3>Shipment history</h3><DataTable rows={asArray(shipmentHistory)} columns={[
        { key: "shipment_code", label: "Shipment" }, { key: "order_number", label: "Order", render: (row) => <Link className="primary-cell" to={`/orders/${row.order_id}`}>{row.order_number}</Link> },
        { key: "shipped_at", label: "Shipped at", render: (row) => dateLabel(row.shipped_at) },
        { key: "lines", label: "Lines", render: (row) => asArray(row.lines).map((line) => `${line.order_line_id}: ${number(line.quantity)}`).join(", ") },
      ]} emptyText="No shipments recorded" /></TableCard>
    </>}
  </>;
}

export function AIAssistant() {
  const notify = useToast();
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState(null);
  const [summary, setSummary] = useState(null);
  const [working, setWorking] = useState(false);
  const loader = useCallback(() => allOrders(), []);
  const { data: orders, loading, error, refresh } = useLoad(loader);
  async function propose(event) {
    event.preventDefault(); if (!note.trim()) return;
    setWorking(true);
    try { const result = await api.ai.propose(note.trim()); setProposal(result); notify(result.proposed_actions?.length ? "Proposal generated for review. No changes were applied." : "No supported action was identified."); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setWorking(false); }
  }
  async function applyProposal() {
    const reason = window.prompt("Reason for approving this planner proposal:");
    if (reason == null) return;
    if (!reason.trim()) return notify("A reason is required to apply the proposal.", "error");
    if (!window.confirm("Apply the proposed backend changes?")) return;
    setWorking(true);
    try { await api.ai.apply(proposal.interaction_id, reason); notify("Proposal applied successfully."); setProposal(null); refresh(); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setWorking(false); }
  }
  async function getMessage() {
    if (!orderId) return notify("Select an order.", "error");
    setWorking(true);
    try { const value = await api.ai.customerMessage(orderId); setMessage(value); notify("Customer message draft generated."); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setWorking(false); }
  }
  async function saveMessage() {
    if (!message?.message?.trim()) return notify("The message cannot be empty.", "error");
    setWorking(true);
    try { const result = await api.ai.updateMessage(message.id, message.message); setMessage(result); notify("Draft saved."); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setWorking(false); }
  }
  async function markSent() {
    if (!window.confirm("Mark this message as sent? This only updates local status; it will not send an email.")) return;
    setWorking(true);
    try { const result = await api.ai.markSent(message.id); setMessage({ ...message, status: result.status }); notify("Message marked as sent locally. No email was sent."); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setWorking(false); }
  }
  async function loadSummary() {
    if (!orderId) return notify("Select an order.", "error");
    setWorking(true);
    try { setSummary(await api.ai.exceptionSummary(orderId)); }
    catch (err) { notify(getErrorMessage(err), "error"); }
    finally { setWorking(false); }
  }
  return <>
    <PageHeader title="AI assistant" description="Rule-based planning helpers that propose changes for explicit review. No external AI service is used." />
    {error && <ErrorState message={error} />}
    {loading ? <Loading /> : <div className="ai-grid">
      <Card className="ai-card"><div className="ai-card-heading"><div className="ai-icon"><Sparkles size={19} /></div><div><h3>Planner notes</h3><span>Generate a proposal from supported receipt/order references</span></div></div>
        <form className="form-grid" onSubmit={propose}><FormField label="Describe an operational action"><textarea rows="4" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Example: Expedite receipt RCP-123 to 2026-11-02" required /></FormField><Button type="submit" disabled={working}>{working ? "Analyzing…" : "Generate proposal"}</Button></form>
        {proposal && <div className="proposal-box"><div className="proposal-status"><Badge>{proposal.application_status}</Badge><span>Confidence {number(proposal.confidence)}</span></div><p>{proposal.preview}</p>
          {asArray(proposal.proposed_actions).length > 0 && <DataTable rows={proposal.proposed_actions} columns={[{ key: "action", label: "Action" }, { key: "receipt_code", label: "Receipt" }, { key: "order_number", label: "Order" }, { key: "expected_arrival", label: "Date" }, { key: "location_code", label: "Location" }]} />}
          {asArray(proposal.proposed_actions).length > 0 && <Button disabled={working} onClick={applyProposal}>Review and apply proposal</Button>}
        </div>}
      </Card>
      <Card className="ai-card"><div className="ai-card-heading"><div className="ai-icon blue"><Send size={18} /></div><div><h3>Customer message</h3><span>Generate and edit an order update draft</span></div></div>
        <div className="form-grid"><FormField label="Order"><select value={orderId} onChange={(e) => { setOrderId(e.target.value); setSummary(null); }}><option value="">Select order</option>{asArray(orders).map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>)}</select></FormField>
          <Button variant="secondary" onClick={getMessage} disabled={working}>Generate message draft</Button>
          {message && <><FormField label={`Message draft · ${message.status}`}><textarea rows="6" value={message.message} disabled={message.status === "SENT"} onChange={(e) => setMessage({ ...message, message: e.target.value })} /></FormField><div className="row-actions"><Button variant="secondary" onClick={saveMessage} disabled={working || message.status === "SENT"}>Save draft</Button>{message.status !== "SENT" && <Button onClick={markSent} disabled={working}>Mark as sent</Button>}</div><div className="notice warning"><CircleAlert size={16} />Marking sent only changes backend status. It does not send an email.</div></>}
        </div>
        <div className="separator" />
        <div className="card-title-row"><div><h3>Order exception summary</h3><span>Backend-generated advisory information</span></div><Button variant="secondary" onClick={loadSummary} disabled={working || !orderId}>Load summary</Button></div>
        {summary && <div className="summary-box"><b>{summary.order_number} · {summary.status}</b><h4>Risks</h4>{summary.risks?.length ? <ul>{summary.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul> : <p>No current risks reported.</p>}<h4>Recommendations</h4><ul>{asArray(summary.recommendations).map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      </Card>
    </div>}
  </>;
}
