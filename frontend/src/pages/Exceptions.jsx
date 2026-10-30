import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, allOrders } from "../api";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Loading,
  PageHeader,
} from "../components";
import {
  useLoad,
  RefreshAction,
  TableCard,
  dateLabel,
  asArray,
} from "./shared";

export function Exceptions() {
  const [filters, setFilters] = useState({
    exception_status: "OPEN",
    exception_type: "",
    sort: "oldest",
  });
  const [applied, setApplied] = useState(filters);
  const loader = useCallback(() => api.exceptions(applied), [applied]);
  const { data, loading, error, refresh } = useLoad(loader, [applied]);
  const { data: ordersData } = useLoad(() => allOrders(), []);
  const orderMap = Object.fromEntries(
    asArray(ordersData).map((order) => [order.id, order]),
  );
  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Monitor backend-reported fulfillment risks and backorders."
        actions={<RefreshAction onClick={refresh} loading={loading} />}
      />
      <Card className="filter-card">
        <div className="filter-toolbar">
          <select
            aria-label="Exception status"
            value={filters.exception_status}
            onChange={(e) =>
              setFilters({ ...filters, exception_status: e.target.value })
            }
          >
            <option>OPEN</option>
            <option>RESOLVED</option>
          </select>
          <input
            aria-label="Exception type"
            placeholder="Exception type (e.g. BACKORDER)"
            value={filters.exception_type}
            onChange={(e) =>
              setFilters({ ...filters, exception_type: e.target.value })
            }
          />
          <select
            aria-label="Sort exceptions"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
          <Button variant="secondary" onClick={() => setApplied(filters)}>
            Apply filters
          </Button>
        </div>
      </Card>
      <TableCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <DataTable
            rows={asArray(data)}
            columns={[
              {
                key: "exception_type",
                label: "Type",
                render: (row) => (
                  <Badge tone={row.status === "OPEN" ? "red" : "green"}>
                    {row.exception_type}
                  </Badge>
                ),
              },
              {
                key: "order_id",
                label: "Order",
                render: (row) =>
                  orderMap[row.order_id] ? (
                    <Link
                      className="primary-cell"
                      to={`/orders/${row.order_id}`}
                    >
                      {orderMap[row.order_id].order_number}
                    </Link>
                  ) : (
                    `Order ${row.order_id}`
                  ),
              },
              { key: "details", label: "Details" },
              {
                key: "status",
                label: "Status",
                render: (row) => <Badge>{row.status}</Badge>,
              },
              {
                key: "created_at",
                label: "Reported",
                render: (row) => dateLabel(row.created_at),
              },
              {
                key: "actions",
                label: "",
                render: (row) => (
                  <Link
                    className="text-button"
                    to="/planner"
                    state={{ orderId: row.order_id }}
                  >
                    Plan action
                  </Link>
                ),
              },
            ]}
            emptyText={`No ${filters.exception_status.toLowerCase()} exceptions`}
          />
        )}
      </TableCard>
    </>
  );
}
