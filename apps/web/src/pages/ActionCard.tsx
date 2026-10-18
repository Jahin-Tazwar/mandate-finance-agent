import { useState } from "react";
import { type Action } from "@mandate/shared";




/** The permission tiers in words, e.g. "L2" → "asks you first". */
const TIER_WORDS: Record<Action["tier"], string> = { L0: "not allowed", L1: "suggestion only", L2: "asks you first", L3: "allowed on its own" };
const TIER_HELP = "Permission tiers, set by your rules: L3 = done on its own · L2 = asks you first · L1 = suggestion only · L0 = not allowed.";

export function ActionCard({
  action,
  onApprove,
  onReject,
}: {
  action: Action;
  onApprove?: (action: Action) => void;
  onReject?: (action: Action) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusLabels: Record<Action["status"], string> = {
    executed: "Done",
    pending_approval: "Waiting for you",
    denied: "Blocked by your rules",
    rejected: "Declined by you",
  };
  return (
    <article className={`action-card action-${action.status} ${action.source === "untrusted" ? "action-untrusted" : ""}`}>
      {action.source === "untrusted" && <div className="untrusted-warning">This came from a document. Check it carefully.</div>}
      <div className="action-card-heading">
        <div><span className={`status-pill status-${action.status}`}>{statusLabels[action.status]}</span><span className="action-tier" title={TIER_HELP}>{action.tier} · {TIER_WORDS[action.tier]} · {action.source === "agent" ? "Agent" : action.source === "user" ? "You" : "Untrusted document"}</span></div>
        <button type="button" className="text-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Less detail" : "Why?"}</button>
      </div>
      <h3>{action.summary}</h3>
      {action.agentRationale && <p className="action-explanation"><strong>Agent suggests</strong>{action.agentRationale}</p>}
      {action.reasons[0] && <p className="action-explanation"><strong>Your rules</strong>{action.reasons[0]}</p>}
      {action.wishImpact?.map((impact) => <p className="wish-impact" key={impact.wishId}>This delays {impact.title} by {impact.delayDays} days.</p>)}
      {expanded && <div className="action-extra">
        <p><strong>Decision:</strong> {action.decision.replaceAll("_", " ")}</p>
        {action.reasons.slice(1).map((reason) => <p key={reason}>{reason}</p>)}
        <time dateTime={action.createdAt}>{new Date(action.createdAt).toLocaleString()}</time>
      </div>}
      {action.status === "pending_approval" && <div className="action-buttons">
        {onReject && <button className="button button-secondary" onClick={() => onReject(action)}>Decline</button>}
        {onApprove && <button className="button button-primary" onClick={() => onApprove(action)}>Approve</button>}
      </div>}
    </article>
  );
}
