import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

function RouteLoading() {
  return (
    <div className="loading app-loading" role="status">
      <span className="spinner" />
      Checking your session…
    </div>
  );
}

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <RouteLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <RouteLoading />;
  return user ? <Navigate to="/" replace /> : children;
}
