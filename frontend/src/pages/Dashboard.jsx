import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, CircleAlert, Truck } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { api, allOrders } from "../api";
import {
  Badge,
  Card,
  DataTable,
  Empty,
  ErrorState,
  Loading,
  PageHeader,
} from "../components";
import {
  useLoad,
  useToast,
  RefreshAction,
  Metric,
  TableCard,
  ClipboardIcon,
  BoxesIcon,
  dateLabel,
  number,
  asArray,
} from "./shared";

export function Dashboard() {
  const notify = useToast();
  const loader = useCallback(
    async () =>
      Promise.all([
        allOrders(),
        api.inventory.list(),
        api.receipts.list(),
        api.exceptions({ exception_status: "OPEN" }),
      ]),
    [],
  );
  const { data, loading, error, refresh } = useLoad(loader);
  const [orders, inventory, receipts, exceptions] = data || [[], [], [], []];
  const orderStatus = useMemo(() => {
    const counts = {};
    asArray(orders).forEach((order) => {
      counts[order.status] = (counts[order.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [orders]);
  const priorities = useMemo(() => {
    const counts = { HIGH: 0, MED: 0, LOW: 0 };
    asArray(orders).forEach((order) => {
      counts[order.priority] = (counts[order.priority] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([, value]) => value)
      .map(([name, value]) => ({ name, value }));
  }, [orders]);
  const exceptionTypes = useMemo(() => {
    const counts = {};
    asArray(exceptions).forEach((item) => {
      counts[item.exception_type] = (counts[item.exception_type] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [exceptions]);
  const recentOrders = asArray(orders)
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);
  const backorders = asArray(orders).filter((o) =>
    asArray(o.lines).some((line) => Number(line.backordered_quantity) > 0),
  ).length;
  return (
    <>
      <PageHeader
        title="Good morning, operations team"
        description="Here’s the latest view of your supply chain performance."
        actions={
          <>
            <span className="live-tag">
              <i /> LIVE DATA
            </span>
            <RefreshAction onClick={refresh} loading={loading} />
          </>
        }
      />
      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          <div className="metrics-grid">
            <Metric
              label="Total orders"
              value={orders.length}
              caption="Across all order pages"
              icon={ClipboardIcon}
            />
            <Metric
              label="Draft orders"
              value={orders.filter((o) => o.status === "DRAFT").length}
              caption="Awaiting confirmation"
              icon={Activity}
              tone="violet"
            />
            <Metric
              label="Confirmed / fulfilling"
              value={
                orders.filter((o) =>
                  ["CONFIRMED", "FULFILLING"].includes(o.status),
                ).length
              }
              caption="In active fulfillment"
              icon={Truck}
              tone="blue"
            />
            <Metric
              label="Open exceptions"
              value={asArray(exceptions).length}
              caption={`${backorders} orders with backorders`}
              icon={CircleAlert}
              tone="red"
            />
            <Metric
              label="Units on hand"
              value={number(
                asArray(inventory).reduce(
                  (sum, item) => sum + Number(item.quantity || 0),
                  0,
                ),
              )}
              caption={`${asArray(inventory).length} product/location records`}
              icon={BoxesIcon}
              tone="blue"
            />
          </div>
          <div className="dashboard-grid">
            <Card className="chart-card">
              <div className="card-title-row">
                <div>
                  <h3>Order status</h3>
                  <span>Distribution across all orders</span>
                </div>
                <Badge>LIVE</Badge>
              </div>
              {orderStatus.length ? (
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={orderStatus}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={66}
                        outerRadius={94}
                        paddingAngle={4}
                      >
                        {orderStatus.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={
                              [
                                "#3866e8",
                                "#3dbb92",
                                "#f0ac51",
                                "#8796b7",
                                "#e36a71",
                              ][index % 5]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="chart-legend">
                    {orderStatus.map((entry, index) => (
                      <div key={entry.name}>
                        <i
                          style={{
                            background: [
                              "#3866e8",
                              "#3dbb92",
                              "#f0ac51",
                              "#8796b7",
                              "#e36a71",
                            ][index % 5],
                          }}
                        />
                        {entry.name}
                        <b>{entry.value}</b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Empty
                  title="No orders yet"
                  detail="Order status data will appear when orders exist."
                />
              )}
            </Card>
            <Card className="chart-card">
              <div className="card-title-row">
                <div>
                  <h3>Order priority</h3>
                  <span>Current prioritization</span>
                </div>
              </div>
              {priorities.length ? (
                <div className="bar-list">
                  {priorities.map((item, index) => (
                    <div className="bar-row" key={item.name}>
                      <div>
                        <span>{item.name}</span>
                        <b>{item.value}</b>
                      </div>
                      <div className="bar-track">
                        <i
                          style={{
                            width: `${orders.length ? (item.value / orders.length) * 100 : 0}%`,
                            background: ["#e36a71", "#f0ac51", "#3dbb92"][
                              index
                            ],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No priority data" />
              )}
              <div className="supply-mini">
                <div>
                  <span>Inventory records</span>
                  <b>{asArray(inventory).length}</b>
                </div>
                <div>
                  <span>Incoming receipts</span>
                  <b>
                    {
                      asArray(receipts).filter(
                        (r) => !["RECEIVED", "CANCELED"].includes(r.status),
                      ).length
                    }
                  </b>
                </div>
              </div>
            </Card>
            <Card className="chart-card exception-chart">
              <div className="card-title-row">
                <div>
                  <h3>Exception categories</h3>
                  <span>Open exceptions returned by the backend</span>
                </div>
                <Link className="inline-link" to="/exceptions">
                  Review <ArrowUpRight size={14} />
                </Link>
              </div>
              {exceptionTypes.length ? (
                <div className="bar-list">
                  {exceptionTypes.map((item, index) => (
                    <div className="bar-row" key={item.name}>
                      <div>
                        <span>{item.name.replaceAll("_", " ")}</span>
                        <b>{item.value}</b>
                      </div>
                      <div className="bar-track">
                        <i
                          style={{
                            width: `${(item.value / exceptionTypes[0].value) * 100}%`,
                            background: ["#e36a71", "#f0ac51", "#3866e8"][
                              index % 3
                            ],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No open exceptions"
                  detail="Exception categories will appear when the API reports open records."
                />
              )}
            </Card>
            <TableCard className="dashboard-orders">
              <div className="card-title-row">
                <div>
                  <h3>Recent orders</h3>
                  <span>Recently created order activity</span>
                </div>
                <Link className="inline-link" to="/orders">
                  View all <ArrowUpRight size={14} />
                </Link>
              </div>
              <DataTable
                rows={recentOrders}
                columns={[
                  {
                    key: "order_number",
                    label: "Order",
                    render: (row) => (
                      <Link className="primary-cell" to={`/orders/${row.id}`}>
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
                    key: "created_at",
                    label: "Created",
                    render: (row) => dateLabel(row.created_at),
                  },
                ]}
                emptyText="No orders available"
              />
            </TableCard>
          </div>
        </>
      )}
    </>
  );
}
