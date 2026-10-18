import { useEffect, useState } from "react";

import { anchorAudit, getAnchors, getAnchorsStatus, getAudit, verifyAudit, type Anchor, type AuditEntry, type VerifyAuditResult } from "../lib/api";

import { formatShortDate, truncateHash } from "../lib/money";
import { errorText, FeatureHeader, EmptyFeature } from "./shared";

type AuditData = { entries: AuditEntry[]; verification: VerifyAuditResult; anchors: Anchor[]; anchorStatus: { enabled: boolean; chain: string } };

export function AuditPage({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [working, setWorking] = useState(false);
  const load = (signal?: AbortSignal) => Promise.all([
    getAudit(undefined, 100, signal),
    verifyAudit(signal),
    getAnchors(signal),
    getAnchorsStatus(signal),
  ]).then(([entries, verification, anchors, anchorStatus]) => ({ entries, verification, anchors, anchorStatus }));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load(controller.signal).then((result) => { setData(result); setError(""); }, (caught: unknown) => {
      if (!controller.signal.aborted) setError(errorText(caught, "Couldn't load the audit log."));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey]);
  const refresh = async () => {
    setWorking(true);
    setError("");
    try { setData(await load()); }
    catch (caught) { setError(errorText(caught, "Couldn't verify the audit log.")); }
    finally { setWorking(false); }
  };
  const anchor = async () => {
    setWorking(true);
    setError("");
    try {
      await anchorAudit();
      setData(await load());
    } catch (caught) { setError(errorText(caught, "Couldn't publish the audit anchor.")); }
    finally { setWorking(false); }
  };
  const copyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(hash);
      window.setTimeout(() => setCopied(""), 1800);
    } catch (caught) { setError(errorText(caught, "Couldn't copy the hash. Select and copy it manually.")); }
  };
  return <div className="page-stack feature-page">
    <FeatureHeader eyebrow="TRANSPARENT BY DESIGN" title="Audit log" subtitle="A verifiable record of decisions, rule checks, and signed changes." />
    {error && <div className="inline-error" role="alert">{error}</div>}
    <section className="surface audit-panel">
      <div className="section-heading"><div><span className="eyebrow">HASH-CHAIN INTEGRITY</span><h2>Chain status</h2></div><div className="audit-actions"><button className="button button-secondary" disabled={working} onClick={() => void refresh()}>{working ? "Checking…" : "Verify again"}</button>{data?.anchorStatus.enabled && <button className="button button-primary" disabled={working} onClick={() => void anchor()}>Anchor now</button>}</div></div>
      {loading ? <div className="panel-state"><span className="spinner" />Verifying the audit chain…</div> : data && <div className={`verify-status ${data.verification.valid ? "verified" : "broken"}`}>
        <strong>{data.verification.valid ? "Verified" : `Chain broken at entry #${data.verification.brokenAt ?? "?"}`}</strong><span>{data.verification.entries} entries</span>
      </div>}
      {data && <div className="audit-entries">{data.entries.length ? data.entries.map((entry) => <article className="audit-entry" key={`${entry.seq}-${entry.hash}`}>
        <div className="audit-entry-head"><strong>#{entry.seq}</strong><time dateTime={entry.ts}>{new Date(entry.ts).toLocaleString()}</time><span>{entry.eventType.replaceAll("_", " ")}</span></div>
        <p>{entry.summary}</p>
        <div className="hash-row"><span>hash</span><button className="hash-button" onClick={() => void copyHash(entry.hash)} title="Copy full hash">{copied === entry.hash ? "Copied" : truncateHash(entry.hash)} ⧉</button><span>prev</span><button className="hash-button" onClick={() => void copyHash(entry.prevHash)} title="Copy previous hash">{copied === entry.prevHash ? "Copied" : truncateHash(entry.prevHash)} ⧉</button></div>
      </article>) : <EmptyFeature title="No audit entries yet." detail="Your actions and policy decisions will be recorded here." />}</div>}
    </section>
    <section className="surface audit-panel">
      <div className="section-heading"><div><span className="eyebrow">PUBLIC TEST-CHAIN FINGERPRINTS</span><h2>On-chain anchors</h2></div><span className="period-tag">{data?.anchorStatus.chain ?? "Loading…"}</span></div>
      {data?.anchors.length ? data.anchors.map((item) => <article className="anchor-row" key={item.txHash}><div><strong>Entry #{item.seq}</strong><span>{formatShortDate(item.anchoredAt, { month: "short", day: "numeric", year: "numeric" })} · {item.chain}</span><small>{truncateHash(item.hash, 8, 6)} · {item.matchesLog ? "Matches log" : "Does not match log"}</small></div><a href={item.explorerUrl} target="_blank" rel="noreferrer">View transaction ↗</a></article>) : <EmptyFeature title={data?.anchorStatus.enabled ? "No anchors published yet." : "Anchoring isn't configured."} detail={data?.anchorStatus.enabled ? "Publish an anchor after the log has new entries." : "The audit hash chain is still available for verification."} />}
    </section>
  </div>;
}
