import { client } from "./client";

const req = async (promise) => (await promise).data;
const query = (params) => ({ params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value != null)) });

export const api = {
  products: {
    list: () => req(client.get("/products")),
    get: (id) => req(client.get(`/products/${id}`)),
    create: (body) => req(client.post("/products", body)),
    update: (id, body) => req(client.put(`/products/${id}`, body)),
    delete: (id) => client.delete(`/products/${id}`),
  },
  locations: {
    list: () => req(client.get("/locations")),
    get: (id) => req(client.get(`/locations/${id}`)),
    create: (body) => req(client.post("/locations", body)),
    update: (id, body) => req(client.put(`/locations/${id}`, body)),
    delete: (id) => client.delete(`/locations/${id}`),
  },
  inventory: {
    list: (params = {}) => req(client.get("/inventory", query(params))),
    adjust: (body) => req(client.post("/inventory/adjust", body)),
  },
  receipts: {
    list: () => req(client.get("/receipts")),
    get: (id) => req(client.get(`/receipts/${id}`)),
    create: (body) => req(client.post("/receipts", body)),
    update: (id, body, reason) => req(client.patch(`/receipts/${id}`, body, query({ reason }))),
    receive: (id, reason) => req(client.post(`/receipts/${id}/receive`, null, query({ reason }))),
    cancel: (id, reason) => req(client.post(`/receipts/${id}/cancel`, null, query({ reason }))),
  },
  atp: {
    byLocation: (productId, locationId) => req(client.get(`/atp/${productId}/${locationId}`)),
    projection: (productId, start, end) => req(client.get(`/atp/${productId}`, query({ start, end }))),
  },
  orders: {
    list: (params = {}) => req(client.get("/orders", query(params))),
    get: (id) => req(client.get(`/orders/${id}`)),
    create: (body) => req(client.post("/orders", body)),
    update: (id, body) => req(client.patch(`/orders/${id}`, body)),
    addLine: (id, body) => req(client.post(`/orders/${id}/lines`, body)),
    updateLine: (id, lineId, body) => req(client.patch(`/orders/${id}/lines/${lineId}`, body)),
    deleteLine: (id, lineId, reason) => client.delete(`/orders/${id}/lines/${lineId}`, query({ reason })),
    confirm: (id) => req(client.post(`/orders/${id}/confirm`)),
    cancel: (id, reason) => req(client.post(`/orders/${id}/cancel`, null, query({ reason }))),
    allocations: (id) => req(client.get(`/orders/${id}/allocations`)),
    timeline: (id) => req(client.get(`/orders/${id}/timeline`)),
    shipments: (id) => req(client.get(`/orders/${id}/shipments`)),
  },
  exceptions: (params = {}) => req(client.get("/exceptions", query(params))),
  planner: {
    expedite: (id, body) => req(client.post(`/planner/receipts/${id}/expedite`, body)),
    reassign: (id, body) => req(client.post(`/planner/order-lines/${id}/reassign`, body)),
    overridePromise: (id, body) => req(client.post(`/planner/order-lines/${id}/promise-override`, body)),
  },
  shipments: (body) => req(client.post("/shipments", body)),
  ai: {
    propose: (text) => req(client.post("/ai/planner-notes", { text })),
    apply: (id, reason) => req(client.post(`/ai/planner-notes/${id}/apply`, null, query({ reason }))),
    customerMessage: (id) => req(client.post(`/ai/orders/${id}/customer-message`)),
    updateMessage: (id, message) => req(client.patch(`/ai/customer-messages/${id}`, { message })),
    markSent: (id) => req(client.post(`/ai/customer-messages/${id}/mark-sent`)),
    exceptionSummary: (id) => req(client.get(`/ai/orders/${id}/exception-summary`)),
  },
};

export async function allOrders(params = {}) {
  const pageSize = 100;
  const first = await api.orders.list({ ...params, page: 1, page_size: pageSize });
  if (!first || !Array.isArray(first.items)) throw new Error("The orders API returned an unexpected response.");
  const pages = Number(first.pages || 1);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
    api.orders.list({ ...params, page: index + 2, page_size: pageSize })));
  return [first, ...rest].flatMap((page) => page.items);
}
