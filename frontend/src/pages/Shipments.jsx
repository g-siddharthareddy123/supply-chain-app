import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Truck, X } from "lucide-react";
import { api, allOrders } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Button,
  Card,
  DataTable,
  ErrorState,
  IconButton,
  Loading,
  PageHeader,
} from "../components";
import {
  useLoad,
  useToast,
  FormField,
  RefreshAction,
  TableCard,
  dateLabel,
  number,
  asArray,
} from "./shared";

export function Shipments() {
  const notify = useToast();
  const [saving, setSaving] = useState(false);
  const [lineItems, setLineItems] = useState([
    { lineId: "", locationId: "", quantity: "" },
  ]);
  const loader = useCallback(async () => {
    const [orderRows, locationRows, productRows] = await Promise.all([
      allOrders(),
      api.locations.list(),
      api.products.list(),
    ]);
    const shipmentGroups = await Promise.all(
      orderRows.map(async (order) => ({
        order,
        shipments: await api.orders.shipments(order.id),
      })),
    );
    return [
      orderRows,
      locationRows,
      productRows,
      shipmentGroups.flatMap(({ order, shipments }) =>
        asArray(shipments).map((shipment) => ({
          ...shipment,
          order_number: order.order_number,
          order_id: order.id,
        })),
      ),
    ];
  }, []);
  const { data, loading, error, refresh } = useLoad(loader);
  const [orders, locations, products, shipmentHistory] = data || [
    [],
    [],
    [],
    [],
  ];
  const eligible = asArray(orders).filter((order) =>
    ["CONFIRMED", "FULFILLING"].includes(order.status),
  );
  const lines = eligible.flatMap((order) =>
    order.lines
      .filter(
        (line) =>
          Number(line.requested_quantity) > Number(line.shipped_quantity),
      )
      .map((line) => ({ ...line, order })),
  );
  function changeLine(index, field, value) {
    setLineItems((items) =>
      items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  }
  async function submit(event) {
    event.preventDefault();
    const reason = String(
      new FormData(event.currentTarget).get("reason"),
    ).trim();
    const shipmentLines = lineItems
      .filter((line) => line.lineId && line.quantity)
      .map((line) => ({
        order_line_id: Number(line.lineId),
        location_id: Number(line.locationId),
        quantity: Number(line.quantity),
      }));
    if (
      !reason ||
      !shipmentLines.length ||
      shipmentLines.some((line) => !line.location_id || line.quantity <= 0)
    )
      return notify("Enter a reason and valid shipment lines.", "error");
    if (
      new Set(
        shipmentLines.map(
          (line) => lines.find((l) => l.id === line.order_line_id)?.order.id,
        ),
      ).size > 1
    )
      return notify(
        "A shipment can only include lines from one order.",
        "error",
      );
    if (
      !window.confirm(
        `Create shipment with ${shipmentLines.length} line(s)? The backend will verify active allocations and physical stock.`,
      )
    )
      return;
    setSaving(true);
    try {
      const result = await api.shipments({ reason, lines: shipmentLines });
      notify(
        `Shipment ${result.shipment_code} created. Order status: ${result.status}.`,
      );
      setLineItems([{ lineId: "", locationId: "", quantity: "" }]);
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Shipments"
        description="Create partial or complete shipments from active on-hand allocations."
        actions={<RefreshAction onClick={refresh} loading={loading} />}
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <>
          <div className="shipment-layout">
            <Card className="shipment-form-card">
              <div className="card-title-row">
                <div>
                  <h3>Create shipment</h3>
                  <span>
                    Backend verifies allocation coverage and on-hand stock
                  </span>
                </div>
                <Truck size={19} />
              </div>
              <form className="form-grid" onSubmit={submit}>
                <FormField label="Shipment reason">
                  <textarea name="reason" rows="2" required />
                </FormField>
                {lineItems.map((item, index) => (
                  <div className="shipment-line" key={index}>
                    <FormField label="Order line">
                      <select
                        value={item.lineId}
                        required
                        onChange={(e) => {
                          const selected = lines.find(
                            (line) => String(line.id) === e.target.value,
                          );
                          changeLine(index, "lineId", e.target.value);
                          if (selected?.preferred_location_id)
                            changeLine(
                              index,
                              "locationId",
                              String(selected.preferred_location_id),
                            );
                        }}
                      >
                        <option value="">Choose eligible line</option>
                        {lines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.order.order_number} · line {line.id} ·{" "}
                            {products.find((p) => p.id === line.product_id)
                              ?.sku || `Product ${line.product_id}`}{" "}
                            · allocated {number(line.allocated_quantity)} ·
                            backordered {number(line.backordered_quantity)} ·
                            remaining{" "}
                            {number(
                              Number(line.requested_quantity) -
                                Number(line.shipped_quantity),
                            )}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Location">
                      <select
                        value={item.locationId}
                        required
                        onChange={(e) =>
                          changeLine(index, "locationId", e.target.value)
                        }
                      >
                        <option value="">Select location</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.code} — {location.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Quantity">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.quantity}
                        required
                        onChange={(e) =>
                          changeLine(index, "quantity", e.target.value)
                        }
                      />
                    </FormField>
                    {lineItems.length > 1 && (
                      <IconButton
                        label="Remove line"
                        onClick={() =>
                          setLineItems((items) =>
                            items.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={16} />
                      </IconButton>
                    )}
                  </div>
                ))}
                <Button
                  variant="secondary"
                  icon={Plus}
                  onClick={() =>
                    setLineItems((items) => [
                      ...items,
                      { lineId: "", locationId: "", quantity: "" },
                    ])
                  }
                >
                  Add shipment line
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Creating…" : "Create shipment"}
                </Button>
              </form>
            </Card>
            <Card className="shipment-help">
              <div className="help-icon">
                <Truck size={20} />
              </div>
              <h3>Shipment guardrails</h3>
              <ul>
                <li>Only confirmed or fulfilling orders can be shipped.</li>
                <li>Ship quantity cannot exceed outstanding order quantity.</li>
                <li>
                  Each shipment must be covered by active ON_HAND allocation and
                  physical inventory.
                </li>
                <li>Partial shipment quantities are supported.</li>
              </ul>
            </Card>
          </div>
          <TableCard className="shipment-history">
            <h3>Shipment history</h3>
            <DataTable
              rows={asArray(shipmentHistory)}
              columns={[
                { key: "shipment_code", label: "Shipment" },
                {
                  key: "order_number",
                  label: "Order",
                  render: (row) => (
                    <Link
                      className="primary-cell"
                      to={`/orders/${row.order_id}`}
                    >
                      {row.order_number}
                    </Link>
                  ),
                },
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
              emptyText="No shipments recorded"
            />
          </TableCard>
        </>
      )}
    </>
  );
}
