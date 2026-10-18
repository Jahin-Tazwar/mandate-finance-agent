import { useEffect, useState, type FormEvent } from "react";
import { type DemoAccount } from "@mandate/shared";
import { ApiError, getDemoAccounts } from "../lib/api";


import { errorText } from "./shared";

export function SignInPage({ onSignIn }: { onSignIn: (username: string, password: string) => Promise<void> }) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingInAs, setSigningInAs] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    getDemoAccounts()
      .then(setAccounts, (caught: unknown) => { if (!controller.signal.aborted) setError(errorText(caught, "Couldn't load demo accounts.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const signIn = async (name: string, secret: string, displayName = "") => {
    setBusy(true); setError("");
    setSigningInAs(displayName);
    try { await onSignIn(name, secret); }
    catch (caught) {
      const failure = caught instanceof ApiError ? caught : null;
      setError(failure?.retryAfterSeconds
        ? `Too many attempts. Try again in ${Math.ceil(failure.retryAfterSeconds / 60)} minutes.`
        : `${errorText(caught, "Couldn't sign in.")}${typeof failure?.attemptsLeft === "number" ? ` ${failure.attemptsLeft} attempts left.` : ""}`);
    } finally { setBusy(false); setSigningInAs(""); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void signIn(username, password); };
  return <main className="signin-screen">
    <div className="signin-layout">
      <section className="signin-story">
        <a className="brand signin-brand" href="/"><span className="brand-mark">◈</span><span>MoneyWise<span className="brand-period">.</span><small>YOUR FINANCES, YOUR TERMS</small></span></a>
        <h1>Your money,<br />on your terms.</h1>
      </section>

      <section className="signin-card" aria-labelledby="signin-title">
        <div className="signin-intro">
          <h2 id="signin-title">Choose a demo profile</h2>
        </div>
        <div className="demo-account-list" aria-label="Demo profiles">
          {loading ? <div className="panel-state"><span className="spinner" />Loading demo accounts…</div> : accounts.map((account, index) => (
            <article className={`demo-account demo-account-${index % 3}`} key={account.personaId}>
              <div className="demo-account-copy"><strong>{account.name}</strong></div>
              <button className="demo-account-action" disabled={busy} onClick={() => void signIn(account.username, account.password, account.name)} aria-label={`Login as ${account.name}`}>
                <span>{busy && signingInAs === account.name ? "Logging in…" : "Login"}</span>
              </button>
            </article>
          ))}
          {!loading && !accounts.length && !error && <div className="empty-state"><strong>No demo profiles are available.</strong><span>Please try again later.</span></div>}
        </div>

        <div className="signin-divider"><span>OR SIGN IN</span></div>
        <section className="manual-signin" aria-labelledby="manual-signin-title">
          <h3 id="manual-signin-title">Sign in with your details</h3>
          <form onSubmit={submit}>
            <label className="form-field"><span>Username</span><input autoComplete="username" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="form-field"><span>Password</span><input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button className="button button-primary manual-signin-button" disabled={busy || !username || !password}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
        </section>
        <p className="demo-pins"><strong>Demo approval PINs</strong><span>Maya 1111 <i>·</i> Daniel 2222 <i>·</i> Aisha 3333</span></p>
        {error && <div className="inline-error" role="alert">{error}</div>}
      </section>
    </div>
  </main>;
}
