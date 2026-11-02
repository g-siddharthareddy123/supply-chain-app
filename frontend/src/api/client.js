import axios from "axios";
import {
  clearAccessToken,
  getAccessToken,
  notifySessionExpired,
} from "../auth/session";

const baseURL = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
const apiKey = (import.meta.env.VITE_API_KEY || "").trim();

export const client = axios.create({
  baseURL,
  headers: { Accept: "application/json", "Content-Type": "application/json" },
});

client.interceptors.request.use((config) => {
  const isLoginRequest = config.url?.includes("/auth/login");
  const token = isLoginRequest ? null : getAccessToken();
  if (!isLoginRequest) {
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      delete config.headers.Authorization;
    }
  }
  if (apiKey && token) {
    config.headers["X-API-Key"] = apiKey;
  } else {
    delete config.headers["X-API-Key"];
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error?.config?.url || "";
    if (
      error?.response?.status === 401 &&
      !requestUrl.includes("/auth/login") &&
      getAccessToken()
    ) {
      clearAccessToken();
      notifySessionExpired();
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      const location = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
      return location ? `${location}: ${item.msg}` : item.msg;
    }).join("; ");
  }
  if (typeof detail === "string") return detail;
  if (error?.response?.status === 401) return "Your session is invalid or has expired. Sign in again.";
  if (error?.response?.status === 403) return "You do not have permission to perform this action.";
  if (error?.response?.status === 404) return "The requested record was not found.";
  if (error?.response?.status === 409) return "This action conflicts with the current record state.";
  if (error?.response?.status === 422) return "Some submitted fields are invalid. Review the form and try again.";
  if (error?.request) return "The backend could not be reached. Check that the API is running and the URL is correct.";
  return error?.message || "The request failed.";
}

export async function checkHealth() {
  const healthURL = new URL(baseURL, window.location.origin);
  healthURL.pathname = `${healthURL.pathname.replace(/\/api\/v1\/?$/, "").replace(/\/+$/, "")}/health`;
  healthURL.search = "";
  const response = await axios.get(healthURL.toString(), { timeout: 5000 });
  return response.data;
}

export { baseURL };
