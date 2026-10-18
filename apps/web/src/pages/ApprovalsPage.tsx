import { useState } from "react";
import { type Action, type Persona } from "@mandate/shared";
import { decideAction } from "../lib/api";


import { errorText, FeatureHeader, EmptyFeature } from "./shared";
import { ActionCard } from "./ActionCard";
import { useActionFeed } from "./actionFeed";

export function ApprovalsPage({ persona, refreshKey, onApprove, onRefresh }: {
  persona: Persona;
  refreshKey: number;
  onApprove: (action: Action) => void;
  onRefresh: () => void;
}) {
  const feed = useActionFeed(persona.id, true, refreshKey);
  const [error, setError] = useState("");
  const pending = feed.actions.filter((action) => action.status === "pending_approval");
  const reject = async (action: Action) => {
    try {
      await decideAction(action.id, "reject");
      feed.setActions((current) => current.filter((item) => item.id !== action.id));
      setError("Action declined. Your money hasn't moved.");
      onRefresh();
    } catch (caught) { setError(errorText(caught, "Couldn't decline this action.")); }
  };
  return <div className="page-stack feature-page">
    <FeatureHeader eyebrow="YOUR DECISIONS" title="Approvals" subtitle="Review proposed actions with the agent's reason and the rule that applies." />
    {feed.error && <div className="inline-error" role="alert">{feed.error}</div>}
    {error && <div className="notice-card" role="status">{error}</div>}
    <section className="surface action-list-panel">
      <div className="section-heading"><div><span className="eyebrow">WAITING FOR YOU</span><h2>{pending.length} pending {pending.length === 1 ? "action" : "actions"}</h2></div></div>
      {feed.loading ? <div className="panel-state"><span className="spinner" />Loading approvals…</div> : pending.length
        ? <div className="action-list">{pending.map((action) => <ActionCard key={action.id} action={action} onApprove={onApprove} onReject={reject} />)}</div>
        : <EmptyFeature title="Nothing waiting for you." detail="The agent is working within your rules." />}
    </section>
  </div>;
}
