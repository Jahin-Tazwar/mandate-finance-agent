import { useEffect, useState } from "react";
import type { Tier } from "@mandate/shared";

type Status = { state: "loading" } | { state: "ok"; tiers: Tier[] } | { state: "error" };

// Placeholder screen: confirms the web app can reach the API.
// The real dashboard replaces this on Day 5.
export function App() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { tiers: Tier[] }) => setStatus({ state: "ok", tiers: data.tiers }))
      .catch(() => setStatus({ state: "error" }));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "48px auto", padding: "0 16px" }}>
      <h1>Mandate</h1>
      <p>Your money, managed inside rules you sign.</p>
      {status.state === "loading" && <p>Connecting to the API…</p>}
      {status.state === "error" && <p style={{ color: "crimson" }}>Can't reach the API. Is `npm run dev` running?</p>}
      {status.state === "ok" && <p style={{ color: "green" }}>API connected. Permission tiers: {status.tiers.join(", ")}</p>}
    </main>
  );
}
