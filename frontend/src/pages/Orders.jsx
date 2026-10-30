import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { api } from "../api";
import { getErrorMessage } from "../api/client";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  ErrorState,
  IconButton,
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

export function Orders() {
  const notify = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    search: "",
    order_status: "",
    priority: "",
    exception_type: "",
    requested_from: "",
    requested_to: "",
    sort: "oldest",
  });
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({});
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const loader = useCallback(
    () => api.orders.list({ ...applied, page, page_size: 20 }),
    [applied, page],
  );
  const { data, loading, error, refresh } = useLoad(loader, [applied, page]);
  const { data: catalogs } = useLoad(
    () => Promise.all([api.products.list(), api.locations.list()]),
    [],
  );
  const [products, locations] = catalogs || [[], []];
  const items = data?.items || [];
  function applyFilters() {
    setPage(1);
    setApplied(filters);
  }
  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lineRows = [
      ...event.currentTarget.querySelectorAll(".order-line-form"),
    ];
    const lines = lineRows.map((line) => ({
      product_id: Number(line.querySelector('[name="product_id"]').value),
      requested_quantity: Number(
        line.querySelector('[name="requested_quantity"]').value,
      ),
      preferred_location_id: line.querySelector(
        '[name="preferred_location_id"]',
      ).value
        ? Number(line.querySelector('[name="preferred_location_id"]').value)
        : null,
    }));
    const body = {
      order_number: String(form.get("order_number")).trim(),
      customer_name: String(form.get("customer_name")).trim(),
      priority: String(form.get("priority")),
      requested_ship_date: String(form.get("requested_ship_date")),
      lines,
    };
    setSaving(true);
    try {
      const result = await api.orders.create(body);
      notify("Draft order created.");
      setModal(false);
      navigate(`/orders/${result.id}`);
    } catch (err) {
      notify(getErrorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Customer orders"
        description="Search, prioritize, and manage customer order fulfillment."
        actions={
          <>
            <RefreshAction onClick={refresh} loading={loading} />
            <Button icon={Plus} onClick={() => setModal(true)}>
              Create order
            </Button>
          </>
        }
      />
      <Card className="filter-card">
        <div className="order-filter-grid">
          <SearchBox
            value={filters.search}
            onChange={(search) => setFilters({ ...filters, search })}
            placeholder="Order number or customer"
          />
          <select
            aria-label="Order status"
            value={filters.order_status}
            onChange={(e) =>
              setFilters({ ...filters, order_status: e.target.value })
            }
          >
            <option value="">All statuses</option>
            {["DRAFT", "CONFIRMED", "FULFILLING", "SHIPPED", "CANCELED"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
          <select
            aria-label="Order priority"
            value={filters.priority}
            onChange={(e) =>
              setFilters({ ...filters, priority: e.target.value })
            }
          >
            <option value="">All priorities</option>
            {["HIGH", "MED", "LOW"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input
            aria-label="Exception type filter"
            value={filters.exception_type}
            placeholder="Exception type"
            onChange={(e) =>
              setFilters({ ...filters, exception_type: e.target.value })
            }
          />
          <input
            type="datetime-local"
            aria-label="Requested date from"
            value={filters.requested_from}
            onChange={(e) =>
              setFilters({ ...filters, requested_from: e.target.value })
            }
          />
          <input
            type="datetime-local"
            aria-label="Requested date to"
            value={filters.requested_to}
            onChange={(e) =>
              setFilters({ ...filters, requested_to: e.target.value })
            }
          />
          <select
            aria-label="Sort orders"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
          >
            <option value="oldest">Oldest</option>
            <option value="earliest_promise">Earliest promise</option>
            <option value="highest_risk">Highest risk</option>
          </select>
          <Button variant="secondary" onClick={applyFilters}>
            Apply
          </Button>
        </div>
      </Card>
      <TableCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <>
            <DataTable
              rows={items}
              columns={[
                {
                  key: "order_number",
                  label: "Order",
                  render: (row) => (
                    <Link to={`/orders/${row.id}`} className="primary-cell">
                      {row.order_number}
                    </Link>
                  ),
                },
                { key: "customer_name", label: "Customer" },
                {
                  key: "priority",
                  label: "Priority",
                  render: (row) => <Badge>{row.priority}</Badge>,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => <Badge>{row.status}</Badge>,
                },
                {
                  key: "requested_ship_date",
                  label: "Requested ship",
                  render: (row) => dateLabel(row.requested_ship_date),
                },
                {
                  key: "promise",
                  label: "Promise / risk",
                  render: (row) => {
                    const lines = asArray(row.lines);
                    const promised = lines
                      .map((l) => l.promised_ship_date)
                      .filter(Boolean)
                      .sort()[0];
                    const risk = lines.reduce(
                      (sum, line) =>
                        sum + Number(line.backordered_quantity || 0),
                      0,
                    );
                    return (
                      <span>
                        {promised ? dateLabel(promised) : "Not determined"}
                        {risk > 0 && (
                          <span className="risk-note">
                            {" "}
                            · {number(risk)} at risk
                          </span>
                        )}
                      </span>
                    );
                  },
                },
              ]}
              emptyText="No orders match the selected filters"
            />
            <div className="pagination">
              <span>
                {data?.total ?? items.length} total orders · Page{" "}
                {data?.page ?? page} of {data?.pages ?? 1}
              </span>
              <div>
                <IconButton
                  label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={17} />
                </IconButton>
                <IconButton
                  label="Next page"
                  disabled={page >= (data?.pages || 1)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={17} />
                </IconButton>
              </div>
            </div>
          </>
        )}
      </TableCard>
      {modal && (
        <Modal title="Create draft order" wide onClose={() => setModal(false)}>
          {!products.length ? (
            <Empty
              title="No products available"
              detail="Add a product before creating an order."
            />
          ) : (
            <form className="form-grid" onSubmit={create}>
              <FormField label="Order number">
                <input name="order_number" required />
              </FormField>
              <FormField label="Customer name">
                <input name="customer_name" required />
              </FormField>
              <FormField label="Priority">
                <select name="priority">
                  <option>MED</option>
                  <option>HIGH</option>
                  <option>LOW</option>
                </select>
              </FormField>
              <FormField label="Requested ship date">
                <input
                  name="requested_ship_date"
                  type="datetime-local"
                  required
                />
              </FormField>
              <div className="line-form-list">
                <div className="line-form-head">
                  <b>Order lines</b>
                  <Button
                    variant="secondary"
                    icon={Plus}
                    onClick={(event) => {
                      event.preventDefault();
                      const parent = event.currentTarget
                        .closest("form")
                        .querySelector(".line-form-list");
                      const node = parent
                        .querySelector(".order-line-form")
                        .cloneNode(true);
                      node.querySelectorAll("input").forEach((input) => {
                        if (input.type === "number") input.value = "";
                      });
                      parent.appendChild(node);
                    }}
                  >
                    Add line
                  </Button>
                </div>
                <div className="order-line-form">
                  <FormField label="Product">
                    <select name="product_id" required>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Quantity">
                    <input
                      name="requested_quantity"
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                    />
                  </FormField>
                  <FormField label="Preferred location (optional)">
                    <select name="preferred_location_id">
                      <option value="">No preference</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} — {l.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </div>
              <SubmitRow
                busy={saving}
                onCancel={() => setModal(false)}
                label="Create draft order"
              />
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
