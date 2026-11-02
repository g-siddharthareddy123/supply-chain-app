import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Boxes, UserPlus } from "lucide-react";
import { api } from "../api";
import { getErrorMessage } from "../api/client";

export default function Signup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    if (password !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const registered = await api.auth.register({
        email: email.trim(),
        password,
      });
      navigate("/login", {
        replace: true,
        state: {
          registeredEmail: registered.email,
          registrationSuccess: "Account created. Sign in with your new credentials.",
        },
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="signup-title">
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
          <p className="section-kicker">DEVELOPMENT ACCOUNT</p>
          <h1 id="signup-title">Create a planner account</h1>
          <p className="muted">Register locally, then sign in to your workspace.</p>
        </div>
        <p className="signup-notice">
          Self-service registration is available only when the backend runs with
          <code> APP_ENV=development</code>. Accounts can access all planner features.
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="signup-email">
            <span>Email</span>
            <input
              id="signup-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
            />
          </label>
          <label className="form-field" htmlFor="signup-password">
            <span>Password</span>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              maxLength={128}
            />
            <small>Use at least 12 characters.</small>
          </label>
          <label className="form-field" htmlFor="signup-confirm-password">
            <span>Confirm password</span>
            <input
              id="signup-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={12}
              maxLength={128}
            />
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
                Creating account…
              </>
            ) : (
              <>
                <UserPlus size={16} />
                Create account
              </>
            )}
          </button>
        </form>
        <p className="login-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
