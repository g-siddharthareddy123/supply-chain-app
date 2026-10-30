import { lazy, Suspense, useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout, Toasts } from "./components/index.js";
import { ToastContext } from "./contexts";

const loadPage = (name) =>
  lazy(() =>
    import("./pages/index.js").then((pages) => ({ default: pages[name] })),
  );
const Dashboard = loadPage("Dashboard");
const Products = loadPage("Products");
const Locations = loadPage("Locations");
const Inventory = loadPage("Inventory");
const Receipts = loadPage("Receipts");
const ATPPlanning = loadPage("ATPPlanning");
const Orders = loadPage("Orders");
const OrderDetails = loadPage("OrderDetails");
const Exceptions = loadPage("Exceptions");
const PlannerWorkspace = loadPage("PlannerWorkspace");
const Shipments = loadPage("Shipments");
const AIAssistant = loadPage("AIAssistant");

export default function App() {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(
      () => setToasts((items) => items.filter((item) => item.id !== id)),
      5000,
    );
  }, []);
  const dismiss = (id) =>
    setToasts((items) => items.filter((item) => item.id !== id));

  return (
    <ToastContext.Provider value={notify}>
      <Suspense
        fallback={
          <div className="loading app-loading">
            <span className="spinner" />
            Loading workspace…
          </div>
        }
      >
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="locations" element={<Locations />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="receipts" element={<Receipts />} />
            <Route path="atp" element={<ATPPlanning />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:orderId" element={<OrderDetails />} />
            <Route path="exceptions" element={<Exceptions />} />
            <Route path="planner" element={<PlannerWorkspace />} />
            <Route path="shipments" element={<Shipments />} />
            <Route path="assistant" element={<AIAssistant />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      <Toasts items={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}
