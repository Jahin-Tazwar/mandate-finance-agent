import { useEffect, useState, type FormEvent } from "react";
import type { DemoAccount, Persona } from "@mandate/shared";
import { apiLogin, fetchDemoAccounts, ApiError } from "./lib/api";

interface LoginScreenProps {
  onLoginSuccess: (persona: Persona) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [username, setUsername] = useState("maya");
  const [password, setPassword] = useState("maya-demo");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeQuickUser, setActiveQuickUser] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  // Load public demo accounts
  useEffect(() => {
    let active = true;
    fetchDemoAccounts()
      .then((accounts) => {
        if (active) {
          setDemoAccounts(accounts);
          setLoadingAccounts(false);
        }
      })
      .catch(() => {
        if (active) {
          // Fallback defaults from the API contract if network fails temporarily
          setDemoAccounts([
            {
              personaId: "maya",
              name: "Maya Chen",
              profile: "International student, part-time cafe job, rent split with roommates",
              username: "maya",
              password: "maya-demo",
              pin: "1111",
            },
            {
              personaId: "daniel",
              name: "Daniel Okafor",
              profile: "Young professional, monthly salary, many subscriptions, uses a credit card",
              username: "daniel",
              password: "daniel-demo",
              pin: "2222",
            },
            {
              personaId: "aisha",
              name: "Aisha Rahman",
              profile: "Gig worker: daily ride-share payouts + weekly delivery payouts, both change a lot",
              username: "aisha",
              password: "aisha-demo",
              pin: "3333",
            },
          ]);
          setLoadingAccounts(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setErrorMessage("");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleLogin = async (user: string, pass: string) => {
    setErrorMessage("");
    setAttemptsLeft(null);
    setSubmitting(true);

    try {
      const persona = await apiLogin(user, pass);
      onLoginSuccess(persona);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const waitTime = err.retryAfterSeconds ?? 300;
          setLockoutSeconds(waitTime);
          setErrorMessage(`Too many attempts. Account locked for ${waitTime} seconds.`);
        } else if (err.status === 401) {
          setErrorMessage(err.message || "Wrong username or password");
          if (typeof err.attemptsLeft === "number") {
            setAttemptsLeft(err.attemptsLeft);
          }
        } else {
          setErrorMessage(err.message || "Sign in failed. Please try again.");
        }
      } else {
        setErrorMessage("Network error. Please make sure the API is running.");
      }
    } finally {
      setSubmitting(false);
      setActiveQuickUser(null);
    }
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setErrorMessage("Please enter a username.");
      return;
    }
    if (!password) {
      setErrorMessage("Please enter a password.");
      return;
    }
    handleLogin(username.trim(), password);
  };

  const handleQuickSignIn = (account: DemoAccount) => {
    setActiveQuickUser(account.username);
    setUsername(account.username);
    setPassword(account.password);
    handleLogin(account.username, account.password);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Top Branding */}
        <header className="login-header">
          <div className="login-brand">
            <span className="login-brand-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <div className="login-brand-text">
              <span className="login-brand-title">MoneyWise<span className="brand-period">.</span></span>
              <span className="login-brand-tag">MANDATE PROTOCOL · SECURE FINANCE</span>
            </div>
          </div>
          <span className="login-demo-badge">DEMO ACCESS</span>
        </header>

        {/* Hero Section */}
        <div className="login-hero">
          <span className="eyebrow">SIGN IN TO ACCESS YOUR ACCOUNT</span>
          <h1 className="login-title">Welcome to MoneyWise<span className="title-dot">.</span></h1>
          <p className="login-subtitle">
            Autonomous personal finance governed by human-signed mandates. AI proposes actions, your rules decide.
          </p>
        </div>

        {/* Error / Lockout Banner */}
        {errorMessage && (
          <div className={`login-alert ${lockoutSeconds > 0 ? "login-alert-lockout" : "login-alert-error"}`} role="alert">
            <span className="login-alert-icon" aria-hidden="true">
              {lockoutSeconds > 0 ? "⏱" : "⚠"}
            </span>
            <div className="login-alert-body">
              <strong>{errorMessage}</strong>
              {lockoutSeconds > 0 && (
                <div className="login-lockout-timer">
                  Locked for <strong>{lockoutSeconds}s</strong>. Please wait before retrying.
                </div>
              )}
              {attemptsLeft !== null && attemptsLeft > 0 && lockoutSeconds <= 0 && (
                <div className="login-attempts-info">
                  {attemptsLeft} {attemptsLeft === 1 ? "attempt" : "attempts"} remaining before username is temporarily locked.
                </div>
              )}
            </div>
          </div>
        )}

        {/* 1-Click Demo Accounts Section */}
        <section className="login-demo-section">
          <div className="login-section-header">
            <div>
              <span className="eyebrow">ONE-CLICK SIGN-IN</span>
              <h2 className="login-section-title">Select a Demo Profile</h2>
            </div>
            <span className="login-hint-pill">Evaluators & Judges</span>
          </div>

          <div className="demo-accounts-grid">
            {demoAccounts.map((account) => {
              const initials = account.name
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2);
              const isMaya = account.personaId === "maya";
              const isDaniel = account.personaId === "daniel";
              const isAisha = account.personaId === "aisha";
              const isSigningInThis = submitting && activeQuickUser === account.username;

              return (
                <div
                  key={account.personaId}
                  className={`demo-account-card ${isMaya ? "card-maya" : isDaniel ? "card-daniel" : "card-aisha"}`}
                >
                  <div className="demo-card-top">
                    <span className="demo-avatar" aria-hidden="true">{initials}</span>
                    <div className="demo-meta">
                      <strong className="demo-name">{account.name}</strong>
                      <span className="demo-persona-id">@{account.username}</span>
                    </div>
                    <span className="demo-pin-pill" title="4-digit PIN for high-risk approvals">
                      PIN: {account.pin}
                    </span>
                  </div>

                  <p className="demo-profile-text">{account.profile}</p>

                  <div className="demo-card-details">
                    <span className="demo-detail-chip">
                      {isMaya ? "Weekly Payday" : isDaniel ? "Monthly Salary" : "Daily Gig Income"}
                    </span>
                    <span className="demo-detail-chip subtle">USD</span>
                  </div>

                  <button
                    type="button"
                    className="demo-signin-button"
                    disabled={submitting || lockoutSeconds > 0}
                    onClick={() => handleQuickSignIn(account)}
                  >
                    {isSigningInThis ? (
                      <>
                        <span className="spinner" />
                        <span>Signing in…</span>
                      </>
                    ) : (
                      <>
                        <span>Sign in as {account.name.split(" ")[0]}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12h14m-6-6 6 6-6 6" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Divider */}
        <div className="login-divider">
          <span>OR SIGN IN MANUALLY</span>
        </div>

        {/* Manual Credentials Form */}
        <section className="login-form-card">
          <h2 className="login-form-title">Custom Sign-In</h2>
          <p className="login-form-subtitle">Enter your username and password below.</p>

          {errorMessage && (
            <div className={`login-alert ${lockoutSeconds > 0 ? "login-alert-lockout" : "login-alert-error"}`} style={{ marginBottom: 18 }} role="alert">
              <span className="login-alert-icon" aria-hidden="true">
                {lockoutSeconds > 0 ? "⏱" : "⚠"}
              </span>
              <div className="login-alert-body">
                <strong>{errorMessage}</strong>
                {lockoutSeconds > 0 && (
                  <div className="login-lockout-timer">
                    Locked for <strong>{lockoutSeconds}s</strong>. Please wait before retrying.
                  </div>
                )}
                {attemptsLeft !== null && attemptsLeft > 0 && lockoutSeconds <= 0 && (
                  <div className="login-attempts-info">
                    {attemptsLeft} {attemptsLeft === 1 ? "attempt" : "attempts"} remaining before username is temporarily locked.
                  </div>
                )}
              </div>
            </div>
          )}

          <form className="login-form" onSubmit={handleManualSubmit} noValidate>
            <label className="form-field">
              <span>Username</span>
              <div className="login-input-wrap">
                <span className="login-input-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="e.g. maya, daniel, aisha"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting || lockoutSeconds > 0}
                />
              </div>
            </label>

            <label className="form-field">
              <span>Password</span>
              <div className="login-input-wrap">
                <span className="login-input-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting || lockoutSeconds > 0}
                />
                <button
                  type="button"
                  className="login-toggle-pw"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <button
              type="submit"
              className="button button-primary login-submit-btn"
              disabled={submitting || lockoutSeconds > 0}
            >
              {submitting && !activeQuickUser ? (
                <>
                  <span className="spinner" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14m-6-6 6 6-6 6" />
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Reference Helper */}
          <div className="login-credentials-note">
            <span className="login-note-title">Demo Credentials Cheat Sheet</span>
            <div className="login-note-table">
              <div><span>Maya:</span> <code>maya</code> / <code>maya-demo</code> (PIN 1111)</div>
              <div><span>Daniel:</span> <code>daniel</code> / <code>daniel-demo</code> (PIN 2222)</div>
              <div><span>Aisha:</span> <code>aisha</code> / <code>aisha-demo</code> (PIN 3333)</div>
            </div>
          </div>
        </section>

        {/* Security / Architecture Footer Note */}
        <footer className="login-security-footer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span>
            Sessions are protected with 8-hour HttpOnly cookies. Risky actions (mandate signing, approval, agent toggle) require your 4-digit PIN.
          </span>
        </footer>
      </div>
    </div>
  );
}
