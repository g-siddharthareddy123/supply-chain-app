import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Boxes, Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getErrorMessage } from "../api/client";

export default function Login() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(location.state?.registeredEmail || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (loading) {
    return (
      <div className="loading app-loading" role="status">
        <span className="spinner" />
        Checking your session…
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    if (!email.trim() || !password) {
      setErrorMessage("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      const destination = location.state?.from;
      navigate(
        destination
          ? `${destination.pathname}${destination.search || ""}${destination.hash || ""}`
          : "/",
        { replace: true },
      );
    } catch (error) {
      setErrorMessage(
        error?.response?.status === 401
          ? "Invalid email or password."
          : getErrorMessage(error),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="brand-mark">
            <Boxes size={22} />
          </div>
          <div>
            <strong>Supply Chain</strong>
            <span>CONTROL TOWER</span>
          </div>
        </div>
        <div className="login-heading">
          <p className="section-kicker">OPERATIONS WORKSPACE</p>
          <h1 id="login-title">Sign in to your control tower</h1>
          <p className="muted">Use your planner account to continue.</p>
        </div>
        {location.state?.registrationSuccess && (
          <p className="login-success" role="status">
            {location.state.registrationSuccess}
          </p>
        )}
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="login-email">
            <span>Email</span>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
            />
          </label>
          <label className="form-field" htmlFor="login-password">
            <span>Password</span>
            <span className="password-field">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="password-toggle"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {errorMessage && (
            <p className="login-error" role="alert">
              {errorMessage}
            </p>
          )}
          <button className="button primary login-submit" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner login-spinner" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign in
              </>
            )}
          </button>
        </form>
        <p className="login-footnote">
          Your session is stored only for this browser tab and ends when the tab closes.
        </p>
        <p className="login-switch">
          Need a development account? <Link to="/signup">Create one</Link>
        </p>
      </section>
    </main>
  );
}
