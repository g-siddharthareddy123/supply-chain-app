import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Plus,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
} from "../components";
import {
  useLoad,
  useToast,
  FormField,
  SubmitRow,
  RefreshAction,
  Metric,
  TableCard,
  ClipboardIcon,
  dateLabel,
  dateInput,
  number,
  asArray,
} from "./shared";

export function OrderDetails() {
  const { orderId } = useParams();
  const notify = useToast();
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState("");
  const [saving, setSaving] = useState(false);
  const loader = useCallback(
    async () =>
      Promise.all([
        api.orders.get(orderId),
        api.orders.allocations(orderId),
        api.orders.timeline(orderId),
        api.orders.shipments(orderId),
        api.products.list(),
        api.locations.list(),
        api.ai.exceptionSummary(orderId),
      ]),
    [orderId],
  );
  const { data, loading, error, refresh } = useLoad(loader, [orderId]);
  const [
    order,
    allocations,
    timeline,
    shipments,
    products,
    locations,
    summary,
  ] = data || [];
  const productMap = Object.fromEntries(
    asArray(products).map((p) => [p.id, p]),
  );
  const locationMap = Object.fromEntries(
    asArray(locations).map((l) => [l.id, l]),
  );
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!order) return <Empty title="Order unavailable" />;
  async function mutate(action, line) {
    if (
      action === "confirm" &&
      !window.confirm(
        `Confirm order ${order.order_number}? This triggers backend allocation.`,
      )
    )
      return;
    const reason =
      action === "confirm"
        ? ""
        : window.prompt(
            `Reason to ${action} ${line ? `line ${line.id}` : `order ${order.order_number}`}:`,
          );
    if (action !== "confirm" && reason == null) return;
    if (action !== "confirm" && !reason.trim())
      return notify("A non-empty reason is required.", "error");
    if (
      action !== "confirm" &&
      !window.confirm(
        `Confirm ${action === "cancel" ? "cancellation" : "removal"}? This change cannot be undone.`,
      )
    )
      return;
    setSaving(true);
    try {
      if (action === "confirm") await api.orders.confirm(order.id);
      if (action === "cancel") await api.orders.cancel(order.id, reason);
      if (action === "delete-line")
        await api.orders.deleteLine(order.id, line.id, reason);
      notify(
        action === "confirm"
          ? "Order confirmed and allocation refreshed."
          : action === "cancel"
            ? "Order canceled."
            : "Order line removed.",
      );
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  async function saveOrder(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await api.orders.update(order.id, {
        customer_name: String(form.get("customer_name")).trim(),
        priority: String(form.get("priority")),
        requested_ship_date: String(form.get("requested_ship_date")),
      });
      notify("Order details updated.");
      setModal("");
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  async function addLine(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await api.orders.addLine(order.id, {
        product_id: Number(form.get("product_id")),
        requested_quantity: Number(form.get("requested_quantity")),
        preferred_location_id: form.get("preferred_location_id")
          ? Number(form.get("preferred_location_id"))
          : null,
      });
      notify("Order line added.");
      setModal("");
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  async function updateLine(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lineId = Number(form.get("line_id"));
    setSaving(true);
    try {
      await api.orders.updateLine(order.id, lineId, {
        product_id: Number(form.get("product_id")),
        requested_quantity: Number(form.get("requested_quantity")),
        preferred_location_id: form.get("preferred_location_id")
          ? Number(form.get("preferred_location_id"))
          : null,
      });
      notify("Order line updated.");
      setModal("");
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  const navTabs = ["overview", "lines", "allocations", "timeline", "shipments"];
  return (
    <>
      <div className="breadcrumbs">
        <Link to="/orders">Customer orders</Link>
        <ChevronRight size={14} />
        <span>{order.order_number}</span>
      </div>
      <PageHeader
        title={order.order_number}
        description={`${order.customer_name} · Created ${dateLabel(order.created_at)}`}
        actions={
          <>
            <Badge>{order.status}</Badge>
            {order.status === "DRAFT" && (
              <Button onClick={() => mutate("confirm")} disabled={saving}>
                Confirm order
              </Button>
            )}
            {!["SHIPPED", "CANCELED"].includes(order.status) && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                Edit order
              </Button>
            )}
            {!["SHIPPED", "CANCELED"].includes(order.status) && (
              <Button
                variant="danger"
                onClick={() => mutate("cancel")}
                disabled={saving}
              >
                Cancel order
              </Button>
            )}
            <RefreshAction onClick={refresh} loading={saving} />
          </>
        }
      />
      <div className="tabs">
        {navTabs.map((name) => (
          <button
            key={name}
            className={tab === name ? "selected" : ""}
            onClick={() => setTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <>
          <div className="metrics-grid detail-metrics">
            <Metric
              label="Priority"
              value={order.priority}
              caption="Current order priority"
              icon={Activity}
            />
            <Metric
              label="Requested ship"
              value={new Date(order.requested_ship_date).toLocaleDateString()}
              caption="Customer request"
              icon={CalendarDays}
              tone="blue"
            />
            <Metric
              label="Order lines"
              value={order.lines.length}
              caption="Products in this order"
              icon={ClipboardIcon}
              tone="violet"
            />
            <Metric
              label="Backordered units"
              value={number(
                order.lines.reduce(
                  (sum, line) => sum + Number(line.backordered_quantity || 0),
                  0,
                ),
              )}
              caption="Backend allocation result"
              icon={CircleAlert}
              tone="red"
            />
          </div>
          <Card className="advisory-card">
            <div className="card-title-row">
              <div>
                <h3>
                  <Sparkles size={16} /> Backend fulfillment advisory
                </h3>
                <span>
                  Informational summary from the existing deterministic backend
                  rules
                </span>
              </div>
            </div>
            <p>
              Order status: <b>{summary.status}</b>
            </p>
            <div className="advisory-columns">
              <div>
                <b>Risks</b>
                {asArray(summary.risks).length ? (
                  <ul>
                    {summary.risks.map((risk, i) => (
                      <li key={i}>{risk}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No risks returned.</p>
                )}
              </div>
              <div>
                <b>Recommendations</b>
                <ul>
                  {asArray(summary.recommendations).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </>
      )}
      {tab === "lines" && (
        <TableCard>
          <div className="table-toolbar">
            <h3>Order lines</h3>
            {!["SHIPPED", "CANCELED"].includes(order.status) && (
              <Button icon={Plus} onClick={() => setModal("line")}>
                Add line
              </Button>
            )}
          </div>
          <DataTable
            rows={order.lines}
            columns={[
              {
                key: "product_id",
                label: "Product",
                render: (line) =>
                  productMap[line.product_id]?.sku ||
                  `Product ${line.product_id}`,
              },
              {
                key: "requested_quantity",
                label: "Requested",
                render: (line) => number(line.requested_quantity),
              },
              {
                key: "allocated_quantity",
                label: "Allocated",
                render: (line) => number(line.allocated_quantity),
              },
              {
                key: "shipped_quantity",
                label: "Shipped",
                render: (line) => number(line.shipped_quantity),
              },
              {
                key: "backordered_quantity",
                label: "Backordered",
                render: (line) => (
                  <span
                    className={
                      Number(line.backordered_quantity) > 0 ? "risk-note" : ""
                    }
                  >
                    {number(line.backordered_quantity)}
                  </span>
                ),
              },
              {
                key: "promised_ship_date",
                label: "Promise",
                render: (line) => dateLabel(line.promised_ship_date),
              },
              {
                key: "preferred_location_id",
                label: "Preferred location",
                render: (line) =>
                  line.preferred_location_id
                    ? locationMap[line.preferred_location_id]?.code
                    : "Auto",
              },
              {
                key: "actions",
                label: "",
                render: (line) =>
                  !["SHIPPED", "CANCELED"].includes(order.status) ? (
                    <div className="row-actions">
                      {
                        <button
                          className="text-button"
                          onClick={() => setModal(`edit-line-${line.id}`)}
                        >
                          Edit
                        </button>
                      }
                      {Number(line.shipped_quantity) === 0 && (
                        <button
                          className="text-button danger-text"
                          onClick={() => mutate("delete-line", line)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ) : null,
              },
            ]}
          />
        </TableCard>
      )}
      {tab === "allocations" && (
        <TableCard>
          <h3>Allocation history</h3>
          <DataTable
            rows={asArray(allocations)}
            columns={[
              { key: "line_id", label: "Line" },
              {
                key: "location_id",
                label: "Location",
                render: (row) =>
                  locationMap[row.location_id]?.code || row.location_id,
              },
              {
                key: "source_type",
                label: "Source",
                render: (row) => <Badge>{row.source_type}</Badge>,
              },
              { key: "source_id", label: "Source ID" },
              {
                key: "quantity",
                label: "Quantity",
                render: (row) => number(row.quantity),
              },
              {
                key: "status",
                label: "Status",
                render: (row) => <Badge>{row.status}</Badge>,
              },
            ]}
            emptyText="No allocation records; drafts are not allocated."
          />
        </TableCard>
      )}
      {tab === "timeline" && (
        <TableCard>
          <h3>Order timeline</h3>
          <DataTable
            rows={asArray(timeline).slice().reverse()}
            columns={[
              {
                key: "date",
                label: "Date",
                render: (row) => dateLabel(row.date),
              },
              {
                key: "type",
                label: "Event",
                render: (row) => <Badge>{row.type}</Badge>,
              },
              {
                key: "quantity",
                label: "Quantity",
                render: (row) =>
                  row.quantity == null ? "—" : number(row.quantity),
              },
              {
                key: "reason",
                label: "Reason / source",
                render: (row) =>
                  row.reason ||
                  row.source ||
                  row.receipt_code ||
                  row.shipment_code ||
                  "—",
              },
            ]}
            emptyText="No timeline events returned"
          />
        </TableCard>
      )}
      {tab === "shipments" && (
        <TableCard>
          <h3>Shipment history</h3>
          <DataTable
            rows={asArray(shipments)}
            columns={[
              { key: "shipment_code", label: "Shipment" },
              {
                key: "shipped_at",
                label: "Shipped at",
                render: (row) => dateLabel(row.shipped_at),
              },
              {
                key: "lines",
                label: "Lines",
                render: (row) =>
                  asArray(row.lines)
                    .map(
                      (line) =>
                        `${line.order_line_id}: ${number(line.quantity)}`,
                    )
                    .join(", "),
              },
            ]}
            emptyText="No shipments for this order"
          />
        </TableCard>
      )}
      {modal === "edit" && (
        <Modal title="Edit order" onClose={() => setModal("")}>
          <form className="form-grid" onSubmit={saveOrder}>
            <FormField label="Customer name">
              <input
                name="customer_name"
                defaultValue={order.customer_name}
                required
              />
            </FormField>
            <FormField label="Priority">
              <select name="priority" defaultValue={order.priority}>
                {["HIGH", "MED", "LOW"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Requested ship date">
              <input
                name="requested_ship_date"
                type="datetime-local"
                defaultValue={dateInput(order.requested_ship_date)}
                required
              />
            </FormField>
            <SubmitRow busy={saving} onCancel={() => setModal("")} />
          </form>
        </Modal>
      )}
      {modal === "line" && (
        <Modal title="Add order line" onClose={() => setModal("")}>
          <form className="form-grid" onSubmit={addLine}>
            <FormField label="Product">
              <select name="product_id" required>
                {asArray(products).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Requested quantity">
              <input
                name="requested_quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </FormField>
            <FormField label="Preferred location">
              <select name="preferred_location_id">
                <option value="">No preference</option>
                {asArray(locations).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </FormField>
            <SubmitRow
              busy={saving}
              onCancel={() => setModal("")}
              label="Add line"
            />
          </form>
        </Modal>
      )}
      {typeof modal === "string" &&
        modal.startsWith("edit-line-") &&
        (() => {
          const line = order.lines.find(
            (item) => item.id === Number(modal.slice("edit-line-".length)),
          );
          return line ? (
            <Modal
              title={`Edit order line ${line.id}`}
              onClose={() => setModal("")}
            >
              <form className="form-grid" onSubmit={updateLine}>
                <input type="hidden" name="line_id" value={line.id} />
                <FormField label="Product">
                  <select
                    name="product_id"
                    defaultValue={line.product_id}
                    required
                  >
                    {asArray(products).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Requested quantity">
                  <input
                    name="requested_quantity"
                    type="number"
                    min={line.shipped_quantity}
                    step="0.001"
                    defaultValue={line.requested_quantity}
                    required
                  />
                </FormField>
                <FormField label="Preferred location">
                  <select
                    name="preferred_location_id"
                    defaultValue={line.preferred_location_id ?? ""}
                  >
                    <option value="">No preference</option>
                    {asArray(locations).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <SubmitRow
                  busy={saving}
                  onCancel={() => setModal("")}
                  label="Update line"
                />
              </form>
            </Modal>
          ) : null;
        })()}
    </>
  );
}
