import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Badge,
  Button,
  DataTable,
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
  TableCard,
  dateLabel,
  dateInput,
  number,
  asArray,
} from "./shared";

export function Receipts() {
  const notify = useToast();
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const loader = useCallback(
    () =>
      Promise.all([
        api.receipts.list(),
        api.products.list(),
        api.locations.list(),
      ]),
    [],
  );
  const { data, loading, error, refresh } = useLoad(loader);
  const [receipts, products, locations] = data || [[], [], []];
  const productMap = Object.fromEntries(
    asArray(products).map((x) => [x.id, x]),
  );
  const locationMap = Object.fromEntries(
    asArray(locations).map((x) => [x.id, x]),
  );
  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      receipt_code: String(form.get("receipt_code")).trim(),
      product_id: Number(form.get("product_id")),
      location_id: Number(form.get("location_id")),
      quantity: Number(form.get("quantity")),
      expected_arrival: String(form.get("expected_arrival")),
    };
    setSaving(true);
    try {
      await api.receipts.create(body);
      notify("Receipt created.");
      setModal(null);
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  async function updateReceipt(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason")).trim();
    if (!reason)
      return notify("A reason is required to update a receipt.", "error");
    setSaving(true);
    try {
      await api.receipts.update(
        modal.id,
        {
          quantity: Number(form.get("quantity")),
          expected_arrival: String(form.get("expected_arrival")),
        },
        reason,
      );
      notify("Receipt updated.");
      setModal(null);
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  async function openReceipt(receipt) {
    try {
      setModal(await api.receipts.get(receipt.id));
    } catch (err) {
      notify(getErrorMessage(err), "error");
    }
  }
  async function mutate(action, receipt) {
    const reason = window.prompt(
      `Reason to ${action} receipt ${receipt.receipt_code}:`,
    );
    if (reason == null) return;
    if (!reason.trim())
      return notify("A non-empty reason is required.", "error");
    if (!window.confirm(`Confirm ${action} for ${receipt.receipt_code}?`))
      return;
    try {
      const result =
        action === "receive"
          ? await api.receipts.receive(receipt.id, reason)
          : await api.receipts.cancel(receipt.id, reason);
      notify(
        result.already_received
          ? "This receipt was already received; no inventory was added again."
          : result.already_canceled
            ? "This receipt was already canceled."
            : `Receipt ${action === "receive" ? "received" : "canceled"}.`,
      );
      refresh();
    } catch (err) {
      notify(getErrorMessage(err), "error");
    }
  }
  const sorted = asArray(receipts)
    .slice()
    .sort(
      (a, b) => new Date(a.expected_arrival) - new Date(b.expected_arrival),
    );
  return (
    <>
      <PageHeader
        title="Incoming receipts"
        description="Track planned inbound supply, receive stock, and manage expected arrivals."
        actions={
          <>
            <RefreshAction onClick={refresh} loading={loading} />
            <Button icon={Plus} onClick={() => setModal("create")}>
              Create receipt
            </Button>
          </>
        }
      />
      <TableCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <DataTable
            rows={sorted}
            columns={[
              {
                key: "receipt_code",
                label: "Receipt",
                render: (row) => (
                  <strong className="primary-cell">{row.receipt_code}</strong>
                ),
              },
              {
                key: "product_id",
                label: "Product",
                render: (row) =>
                  productMap[row.product_id]?.sku ||
                  `Product ${row.product_id}`,
              },
              {
                key: "location_id",
                label: "Location",
                render: (row) =>
                  locationMap[row.location_id]?.code ||
                  `Location ${row.location_id}`,
              },
              {
                key: "quantity",
                label: "Quantity",
                render: (row) => number(row.quantity),
              },
              {
                key: "expected_arrival",
                label: "Expected arrival",
                render: (row) => dateLabel(row.expected_arrival),
              },
              {
                key: "status",
                label: "Status",
                render: (row) => <Badge>{row.status}</Badge>,
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => openReceipt(row)}
                    >
                      Details
                    </button>
                    {["PLANNED", "IN_TRANSIT"].includes(row.status) && (
                      <>
                        <button
                          className="text-button"
                          onClick={() => mutate("receive", row)}
                        >
                          Receive
                        </button>
                        <button
                          className="text-button danger-text"
                          onClick={() => mutate("cancel", row)}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            emptyText="No incoming receipts"
          />
        )}
      </TableCard>
      {modal === "create" && (
        <Modal title="Create incoming receipt" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={create}>
            <FormField label="Receipt code">
              <input name="receipt_code" required />
            </FormField>
            <FormField label="Product">
              <select name="product_id" required>
                {asArray(products).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Location">
              <select name="location_id" required>
                {asArray(locations).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Quantity">
              <input
                name="quantity"
                type="number"
                min="0.001"
                step="0.001"
                required
              />
            </FormField>
            <FormField label="Expected arrival">
              <input name="expected_arrival" type="datetime-local" required />
            </FormField>
            <SubmitRow
              busy={saving}
              onCancel={() => setModal(null)}
              label="Create receipt"
            />
          </form>
        </Modal>
      )}
      {modal && modal !== "create" && (
        <Modal
          title={`Receipt ${modal.receipt_code}`}
          onClose={() => setModal(null)}
        >
          <form className="form-grid" onSubmit={updateReceipt}>
            <div className="detail-pair">
              <span>Status</span>
              <Badge>{modal.status}</Badge>
            </div>
            <div className="detail-pair">
              <span>Product</span>
              <b>{productMap[modal.product_id]?.sku || modal.product_id}</b>
            </div>
            <div className="detail-pair">
              <span>Location</span>
              <b>{locationMap[modal.location_id]?.code || modal.location_id}</b>
            </div>
            {["PLANNED", "IN_TRANSIT"].includes(modal.status) ? (
              <>
                <FormField label="Quantity">
                  <input
                    name="quantity"
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                    defaultValue={modal.quantity}
                  />
                </FormField>
                <FormField label="Expected arrival">
                  <input
                    name="expected_arrival"
                    type="datetime-local"
                    required
                    defaultValue={dateInput(modal.expected_arrival)}
                  />
                </FormField>
                <FormField label="Reason for change">
                  <input name="reason" required />
                </FormField>
                <SubmitRow
                  busy={saving}
                  onCancel={() => setModal(null)}
                  label="Save receipt changes"
                />
              </>
            ) : (
              <div className="notice info">
                Received or canceled receipts are read-only.
              </div>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
