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
  number,
  asArray,
} from "./shared";

export function Exceptions() {
  const [filters, setFilters] = useState({
    exception_status: "OPEN",
    exception_type: "",
    sort: "oldest",
  });
  const [applied, setApplied] = useState(filters);

  const contextLoader = useCallback(
    () =>
      Promise.all([allOrders(), api.products.list(), api.locations.list()]),
    [],
  );
  const {
    data: contextData,
    loading: contextLoading,
    error: contextError,
    refresh: refreshContext,
  } = useLoad(contextLoader);
  const [orders, products, locations] = contextData || [[], [], []];
  const orderMap = Object.fromEntries(asArray(orders).map((order) => [order.id, order]));
  const productMap = Object.fromEntries(asArray(products).map((product) => [product.id, product]));
  const locationMap = Object.fromEntries(asArray(locations).map((location) => [location.id, location]));

  const exceptionsLoader = useCallback(() => api.exceptions(applied), [applied]);
  const {
    data: exceptions,
    loading: exceptionsLoading,
    error: exceptionsError,
    refresh: refreshExceptions,
  } = useLoad(exceptionsLoader, [applied]);
  const rows = asArray(exceptions);
  const lineByExceptionId = Object.fromEntries(
    rows.map((exception) => {
      const order = orderMap[exception.order_id];
      const line =
        asArray(order?.lines).length === 1 ? order.lines[0] : null;
      return [exception.id, { order, line }];
    }),
  );
  const allocationOrderKey = [
    ...new Set(
      rows
        .filter((exception) => lineByExceptionId[exception.id]?.line)
        .map((exception) => exception.order_id),
    ),
  ].join(",");
  const allocationOrderIds = allocationOrderKey
    ? allocationOrderKey.split(",").map(Number)
    : [];
  const allocationsLoader = useCallback(
    async () =>
      Object.fromEntries(
        await Promise.all(
          allocationOrderIds.map(async (orderId) => [
            orderId,
            await api.orders.allocations(orderId),
          ]),
        ),
      ),
    [allocationOrderKey],
  );
  const {
    data: allocationsByOrder,
    loading: allocationsLoading,
    error: allocationsError,
    refresh: refreshAllocations,
  } = useLoad(allocationsLoader, [allocationOrderKey]);

  const loading = contextLoading || exceptionsLoading || allocationsLoading;
  const error = contextError || exceptionsError || allocationsError;
  const refresh = () => {
    refreshContext();
    refreshExceptions();
    refreshAllocations();
  };

  function lineAllocations(exception) {
    const line = lineByExceptionId[exception.id]?.line;
    if (!line) return [];
    return asArray(allocationsByOrder?.[exception.order_id]).filter(
      (allocation) =>
        Number(allocation.line_id) === Number(line.id) &&
        String(allocation.status).toUpperCase() === "ACTIVE",
    );
  }

  function locationIdsFor(exception) {
    return [
      ...new Set(lineAllocations(exception).map((allocation) => allocation.location_id)),
    ];
  }

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
      <TableCard className="exceptions-table">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <>
            <p className="exceptions-guidance">
              Exception records identify an order, not a specific line. A line
              is shown only when the order has exactly one; otherwise inspect
              the order before choosing an action.
            </p>
            <DataTable
              rows={rows}
              columns={[
                {
                  key: "exception_type",
                  label: "Exception type",
                  render: (row) => (
                    <Badge tone={row.status === "OPEN" ? "red" : "green"}>
                      {row.exception_type}
                    </Badge>
                  ),
                },
                {
                  key: "order_id",
                  label: "Order number",
                  render: (row) => (
                    <Link
                      className="primary-cell"
                      to={`/orders/${row.order_id}`}
                      state={{
                        exceptionReview: {
                          exceptionType: row.exception_type,
                          lineId: lineByExceptionId[row.id]?.line?.id ?? null,
                        },
                      }}
                    >
                      {orderMap[row.order_id]?.order_number ||
                        `Order ${row.order_id}`}
                    </Link>
                  ),
                },
                {
                  key: "line_id",
                  label: "Order line",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    return line ? (
                      <Link
                        className="primary-cell"
                        to={`/orders/${row.order_id}`}
                        state={{
                          exceptionReview: {
                            exceptionType: row.exception_type,
                            lineId: line.id,
                          },
                        }}
                      >
                        Line {line.id}
                      </Link>
                    ) : (
                      "Needs investigation"
                    );
                  },
                },
                {
                  key: "product",
                  label: "Product",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    const product = line && productMap[line.product_id];
                    return product ? (
                      <>
                        <strong>{product.sku}</strong>
                        <span className="cell-sub">{product.name}</span>
                      </>
                    ) : line ? (
                      "Not available"
                    ) : (
                      "Needs investigation"
                    );
                  },
                },
                {
                  key: "location",
                  label: "Affected warehouse / location",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    if (!line) return "Needs investigation";
                    const ids = locationIdsFor(row);
                    if (!ids.length) {
                      const preferred = locationMap[line.preferred_location_id];
                      return (
                        <>
                          Not available
                          <span className="cell-sub">
                            No active allocation
                            {preferred
                              ? ` · Preferred: ${preferred.code} — ${preferred.name}`
                              : ""}
                          </span>
                        </>
                      );
                    }
                    return ids.map((id) => {
                      const location = locationMap[id];
                      return (
                        <span className="exception-location" key={id}>
                          {location
                            ? `${location.code} — ${location.name}`
                            : "Not available"}
                          {!location && (
                            <span className="cell-sub">Location ID {id}</span>
                          )}
                        </span>
                      );
                    });
                  },
                },
                {
                  key: "requested_quantity",
                  label: "Requested",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    return line ? number(line.requested_quantity) : "Needs investigation";
                  },
                },
                {
                  key: "allocated_quantity",
                  label: "Allocated",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    return line ? number(line.allocated_quantity) : "Needs investigation";
                  },
                },
                {
                  key: "backordered_quantity",
                  label: "Backordered",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    return line ? number(line.backordered_quantity) : "Needs investigation";
                  },
                },
                {
                  key: "promised_ship_date",
                  label: "Promised ship",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    return line ? dateLabel(line.promised_ship_date) : "Needs investigation";
                  },
                },
                {
                  key: "details",
                  label: "Description",
                  render: (row) => row.details || "Not available",
                },
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
                  label: "Actions",
                  render: (row) => {
                    const line = lineByExceptionId[row.id]?.line;
                    const locationsForLine = locationIdsFor(row);
                    const locationId =
                      locationsForLine.length === 1 ? locationsForLine[0] : null;
                    return (
                      <div className="exception-actions">
                        <Link
                          className="text-button"
                          to={`/orders/${row.order_id}`}
                          state={{
                            exceptionReview: {
                              exceptionType: row.exception_type,
                              lineId: line?.id ?? null,
                            },
                          }}
                        >
                          Inspect order
                        </Link>
                        {line ? (
                          <Link
                            className="text-button"
                            to="/planner"
                            state={{
                              source: "exceptions",
                              orderId: row.order_id,
                              orderLineId: line.id,
                              productId: line.product_id,
                              ...(locationId != null ? { locationId } : {}),
                            }}
                          >
                            Plan action
                          </Link>
                        ) : (
                          <Link
                            className="text-button"
                            to={`/orders/${row.order_id}`}
                            state={{
                              exceptionReview: {
                                exceptionType: row.exception_type,
                                lineId: null,
                              },
                            }}
                          >
                            Plan action
                          </Link>
                        )}
                      </div>
                    );
                  },
                },
              ]}
              emptyText={`No ${filters.exception_status.toLowerCase()} exceptions`}
            />
          </>
        )}
      </TableCard>
    </>
  );
}
