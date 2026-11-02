import { useCallback, useState } from "react";
import { Activity } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { api, allOrders } from "../api";
import { getErrorMessage } from "../api/client";
import { Button, Card, ErrorState, Loading, PageHeader } from "../components";
import {
  useLoad,
  useToast,
  FormField,
  RefreshAction,
  dateLabel,
  number,
  asArray,
} from "./shared";

const positiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export function PlannerWorkspace() {
  const location = useLocation();
  const exceptionContext = location.state?.source === "exceptions";
  const contextOrderId = positiveId(location.state?.orderId);
  const contextLineId = positiveId(location.state?.orderLineId);
  const contextProductId = positiveId(location.state?.productId);
  const contextLocationId = positiveId(location.state?.locationId);
  const notify = useToast();
  const [formMode, setFormMode] = useState(() =>
    exceptionContext ? "reassign" : "expedite",
  );
  const [selectedLineId, setSelectedLineId] = useState(
    contextLineId ? String(contextLineId) : "",
  );
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const loader = useCallback(
    async () =>
      Promise.all([api.receipts.list(), allOrders(), api.locations.list()]),
    [],
  );
  const { data, loading, error, refresh } = useLoad(loader);
  const [receipts, orders, locations] = data || [[], [], []];
  const lines = asArray(orders)
    .filter((o) => ["CONFIRMED", "FULFILLING"].includes(o.status))
    .flatMap((order) =>
      asArray(order.lines).map((line) => ({ ...line, order })),
    );
  const lineFromException = lines.find(
    (line) =>
      line.id === contextLineId &&
      line.order.id === contextOrderId &&
      (contextProductId == null || line.product_id === contextProductId),
  );
  const selectedLine = lines.find(
    (line) => line.id === Number(selectedLineId),
  );
  const locationMap = Object.fromEntries(
    asArray(locations).map((item) => [item.id, item]),
  );
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = Number(form.get("target"));
    const reason = String(form.get("reason")).trim();
    if (!reason) return notify("A reason is required.", "error");
    const action =
      formMode === "expedite"
        ? "expedite receipt"
        : formMode === "reassign"
          ? "reassign order line"
          : "override promise date";
    if (
      !window.confirm(
        `Confirm planner action: ${action}? This will update allocations and may affect promises.`,
      )
    )
      return;
    const body = { reason };
    if (formMode === "expedite")
      body.expected_arrival = String(form.get("expected_arrival"));
    if (formMode === "reassign")
      body.location_id = Number(form.get("location_id"));
    if (formMode === "promise")
      body.promised_ship_date = String(form.get("promised_ship_date"));
    setSaving(true);
    try {
      if (formMode === "expedite") await api.planner.expedite(id, body);
      else if (formMode === "reassign") await api.planner.reassign(id, body);
      else await api.planner.overridePromise(id, body);
      notify(
        "Planner action completed. Related backend projections were rebuilt.",
      );
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  const availableReceipts = asArray(receipts).filter((r) =>
    ["PLANNED", "IN_TRANSIT"].includes(r.status),
  );
  return (
    <>
      <PageHeader
        title="Planner workspace"
        description="Use audited backend actions to expedite supply or adjust confirmed fulfillment plans."
        actions={<RefreshAction onClick={refresh} loading={loading} />}
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <>
          <Card className="filter-card">
            <div className="mode-tabs">
              {[
                ["expedite", "Expedite receipt"],
                ["reassign", "Reassign order line"],
                ["promise", "Override promise"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={formMode === value ? "selected" : ""}
                  onClick={() => setFormMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <form className="form-grid planner-form" onSubmit={submit}>
              {formMode === "expedite" ? (
                <>
                  <FormField label="Receipt">
                    <select
                      name="target"
                      required
                      value={exceptionContext ? selectedReceiptId : undefined}
                      onChange={(event) =>
                        setSelectedReceiptId(event.target.value)
                      }
                    >
                      {exceptionContext && (
                        <option value="">Choose a receipt</option>
                      )}
                      {availableReceipts.map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.receipt_code} · current{" "}
                          {dateLabel(r.expected_arrival)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Earlier expected arrival">
                    <input
                      name="expected_arrival"
                      type="datetime-local"
                      required
                    />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label="Order line">
                    <select
                      name="target"
                      required
                      value={
                        exceptionContext
                          ? selectedLine
                            ? selectedLineId
                            : ""
                          : undefined
                      }
                      onChange={(event) => setSelectedLineId(event.target.value)}
                    >
                      {exceptionContext && (
                        <option value="">Choose an order line</option>
                      )}
                      {lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.order.order_number} · line {line.id} · product{" "}
                          {line.product_id} ·{" "}
                          {number(line.backordered_quantity)} backordered
                        </option>
                      ))}
                    </select>
                  </FormField>
                  {formMode === "reassign" ? (
                    <FormField label="New fulfillment location">
                      <select
                        name="location_id"
                        required
                        value={
                          exceptionContext ? selectedLocationId : undefined
                        }
                        onChange={(event) =>
                          setSelectedLocationId(event.target.value)
                        }
                      >
                        {exceptionContext && (
                          <option value="">Choose a new location</option>
                        )}
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} — {l.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  ) : (
                    <FormField label="New promised ship date">
                      <input
                        name="promised_ship_date"
                        type="datetime-local"
                        required
                      />
                    </FormField>
                  )}
                </>
              )}
              <FormField label="Reason">
                <textarea name="reason" required minLength="1" rows="3" />
              </FormField>
              <div className="form-actions">
                <Button type="submit" disabled={saving}>
                  {saving ? "Submitting…" : "Review & submit action"}
                </Button>
              </div>
            </form>
          </Card>
          {exceptionContext && (
            <div className="notice warning">
              <Activity size={17} />
              <span>
                {lineFromException
                  ? `Exception target: order ${lineFromException.order.order_number}, line ${lineFromException.id}, product ${lineFromException.product_id}.`
                  : "The exception target is not available as an active planner line. Select the appropriate line explicitly or review the order details."}
                {contextLocationId && locationMap[contextLocationId]
                  ? ` Current allocation location: ${locationMap[contextLocationId].code} — ${locationMap[contextLocationId].name}.`
                  : ""}
                {formMode === "reassign" &&
                contextLocationId &&
                locationMap[contextLocationId]
                  ? " Choose the new fulfillment location separately; the current location is not preselected."
                  : ""}
                {contextOrderId && (
                  <>
                    {" "}
                    <Link to={`/orders/${contextOrderId}`}>
                      Review order details
                    </Link>
                    .
                  </>
                )}
              </span>
            </div>
          )}
          <div className="notice info">
            <Activity size={17} />
            <span>
              Each change is sent to the backend for validation. A successful
              planner action triggers the backend allocation rebuild; the page
              refreshes its current inputs after success.
            </span>
          </div>
        </>
      )}
    </>
  );
}
