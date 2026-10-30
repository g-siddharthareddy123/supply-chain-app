import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { api, allOrders } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Button,
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
  TableCard,
  SearchBox,
  dateLabel,
  number,
  asArray,
} from "./shared";

export function Inventory() {
  const notify = useToast();
  const [filters, setFilters] = useState({
    sku: "",
    product_id: "",
    location_id: "",
  });
  const [applied, setApplied] = useState({});
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const loader = useCallback(async () => {
    const [inventoryRows, productRows, locationRows, orderRows] =
      await Promise.all([
        api.inventory.list(applied),
        api.products.list(),
        api.locations.list(),
        allOrders(),
      ]);
    const allocationRows = await Promise.all(
      orderRows.map((order) => api.orders.allocations(order.id)),
    );
    const productForLine = new Map(
      orderRows.flatMap((order) =>
        order.lines.map((line) => [line.id, line.product_id]),
      ),
    );
    const reserved = new Map();
    allocationRows
      .flat()
      .filter((allocation) => allocation.status === "ACTIVE")
      .forEach((allocation) => {
        const productId = productForLine.get(allocation.line_id);
        if (productId == null) return;
        const key = `${productId}:${allocation.location_id}`;
        reserved.set(
          key,
          (reserved.get(key) || 0) + Number(allocation.quantity),
        );
      });
    return [inventoryRows, productRows, locationRows, reserved];
  }, [applied]);
  const { data, loading, error, refresh } = useLoad(loader, [applied]);
  const [rows, products, locations, reserved] = data || [[], [], [], new Map()];
  const productById = Object.fromEntries(
    asArray(products).map((x) => [x.id, x]),
  );
  const locationById = Object.fromEntries(
    asArray(locations).map((x) => [x.id, x]),
  );
  async function adjust(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const delta = Number(form.get("delta"));
    const reason = String(form.get("reason")).trim();
    if (!delta || !Number.isFinite(delta) || !reason)
      return notify("Enter a non-zero quantity and a reason.", "error");
    setSaving(true);
    try {
      const result = await api.inventory.adjust({
        product_id: Number(form.get("product_id")),
        location_id: Number(form.get("location_id")),
        delta,
        reason,
      });
      notify(
        `Inventory updated. New on-hand quantity: ${number(result.quantity)}.`,
      );
      setModal(false);
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
        title="Inventory"
        description="Review on-hand inventory and make audited quantity adjustments."
        actions={
          <>
            <RefreshAction onClick={refresh} loading={loading} />
            <Button icon={Plus} onClick={() => setModal(true)}>
              Adjust inventory
            </Button>
          </>
        }
      />
      <TableCard>
        <div className="table-toolbar filter-toolbar">
          <SearchBox
            value={filters.sku}
            onChange={(sku) => setFilters({ ...filters, sku })}
            placeholder="Filter by SKU..."
          />
          <select
            aria-label="Filter product"
            value={filters.product_id}
            onChange={(e) =>
              setFilters({ ...filters, product_id: e.target.value })
            }
          >
            <option value="">All products</option>
            {asArray(products).map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter location"
            value={filters.location_id}
            onChange={(e) =>
              setFilters({ ...filters, location_id: e.target.value })
            }
          >
            <option value="">All locations</option>
            {asArray(locations).map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => setApplied(filters)}>
            Apply filters
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setFilters({ sku: "", product_id: "", location_id: "" });
              setApplied({});
            }}
          >
            Clear
          </Button>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <DataTable
            rows={rows}
            columns={[
              {
                key: "product_id",
                label: "Product",
                render: (row) => (
                  <>
                    <strong>
                      {productById[row.product_id]?.sku ||
                        `Product ${row.product_id}`}
                    </strong>
                    <span className="cell-sub">
                      {productById[row.product_id]?.name ||
                        "Catalog details unavailable"}
                    </span>
                  </>
                ),
              },
              {
                key: "location_id",
                label: "Location",
                render: (row) =>
                  locationById[row.location_id]?.name ||
                  `Location ${row.location_id}`,
              },
              {
                key: "quantity",
                label: "Quantity on hand",
                render: (row) => <strong>{number(row.quantity)}</strong>,
              },
              {
                key: "reserved",
                label: "Quantity reserved",
                render: (row) =>
                  number(
                    reserved.get(`${row.product_id}:${row.location_id}`) || 0,
                  ),
              },
              {
                key: "available",
                label: "Unreserved on hand",
                render: (row) =>
                  number(
                    Number(row.quantity) -
                      (reserved.get(`${row.product_id}:${row.location_id}`) ||
                        0),
                  ),
              },
              {
                key: "updated_at",
                label: "Last updated",
                render: (row) => dateLabel(row.updated_at),
              },
            ]}
            emptyText="No inventory matches the selected filters"
          />
        )}
      </TableCard>
      {modal && (
        <Modal title="Adjust inventory" onClose={() => setModal(false)}>
          {!products.length || !locations.length ? (
            <Empty
              title="Products or locations are unavailable"
              detail="Create catalog records before adjusting inventory."
            />
          ) : (
            <form className="form-grid" onSubmit={adjust}>
              <FormField label="Product">
                <select name="product_id" required>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Location">
                <select name="location_id" required>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Quantity change (delta)"
                hint="Use a positive value to add stock, negative to remove."
              >
                <input name="delta" type="number" step="0.001" required />
              </FormField>
              <FormField label="Reason">
                <textarea
                  name="reason"
                  rows="3"
                  required
                  minLength="1"
                  placeholder="Explain the inventory adjustment"
                />
              </FormField>
              <SubmitRow
                busy={saving}
                onCancel={() => setModal(false)}
                label="Apply adjustment"
              />
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
