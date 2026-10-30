import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  PageHeader,
} from "../components";
import {
  useToast,
  FormField,
  TableCard,
  dateLabel,
  number,
  asArray,
} from "./shared";

export function ATPPlanning() {
  const notify = useToast();
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [start, setStart] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [end, setEnd] = useState(() =>
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16),
  );
  const [mode, setMode] = useState("location");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api.products.list(), api.locations.list()])
      .then(([p, l]) => {
        setProducts(p);
        setLocations(l);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, []);
  async function load() {
    if (!selectedProduct)
      return notify("Select a product to view ATP.", "error");
    setLoading(true);
    setError("");
    try {
      const value =
        mode === "location"
          ? selectedLocation
            ? await api.atp.byLocation(selectedProduct, selectedLocation)
            : null
          : await api.atp.projection(selectedProduct, start, end);
      if (!value)
        return notify("Select a location to view location-level ATP.", "error");
      setResult(value);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  const events = useMemo(() => {
    if (!result) return [];
    if (Array.isArray(result.events)) return result.events;
    return asArray(result.locations).flatMap((location) =>
      asArray(location.projection?.events).map((event) => ({
        ...event,
        location_id: location.location_id,
      })),
    );
  }, [result]);
  return (
    <>
      <PageHeader
        title="ATP planning"
        description="Review available-to-promise projections calculated by the backend."
        actions={
          <Button icon={RefreshCw} onClick={load} disabled={loading}>
            {loading ? "Calculating…" : "Run projection"}
          </Button>
        }
      />
      <Card className="filter-card">
        <div className="form-grid atp-controls">
          <FormField label="Projection view">
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setResult(null);
              }}
            >
              <option value="location">Product + location</option>
              <option value="date">Product date range</option>
            </select>
          </FormField>
          <FormField label="Product">
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </FormField>
          {mode === "location" ? (
            <FormField label="Location">
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <>
              <FormField label="Start">
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </FormField>
              <FormField label="End">
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </FormField>
            </>
          )}
        </div>
      </Card>
      {error && <ErrorState message={error} />}
      {loading ? (
        <Loading label="Loading backend ATP projection…" />
      ) : (
        result && (
          <>
            <Card className="chart-card">
              <div className="card-title-row">
                <div>
                  <h3>Projected availability</h3>
                  <span>
                    Source: backend ATP calculation · no frontend recalculation
                  </span>
                </div>
              </div>
              {events.length ? (
                <div className="projection-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={events}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => new Date(v).toLocaleDateString()}
                      />
                      <YAxis />
                      <Tooltip labelFormatter={(v) => dateLabel(v)} />
                      <Area
                        type="stepAfter"
                        dataKey="atp"
                        stroke="#3866e8"
                        fill="#dbe6ff"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty
                  title="No ATP events returned"
                  detail="The backend returned no projection events for this selection."
                />
              )}
            </Card>
            <TableCard>
              <DataTable
                rows={events}
                columns={[
                  {
                    key: "date",
                    label: "Event date",
                    render: (row) => dateLabel(row.date),
                  },
                  {
                    key: "location_id",
                    label: "Location",
                    render: (row) =>
                      row.location_id
                        ? locations.find((l) => l.id === row.location_id)
                            ?.code || row.location_id
                        : selectedLocation
                          ? locations.find(
                              (l) => String(l.id) === String(selectedLocation),
                            )?.code
                          : "All locations",
                  },
                  {
                    key: "event",
                    label: "Event",
                    render: (row) => <Badge>{row.event}</Badge>,
                  },
                  {
                    key: "quantity",
                    label: "Quantity change",
                    render: (row) => number(row.quantity),
                  },
                  {
                    key: "atp",
                    label: "ATP after event",
                    render: (row) => <strong>{number(row.atp)}</strong>,
                  },
                ]}
              />
            </TableCard>
          </>
        )
      )}
    </>
  );
}
