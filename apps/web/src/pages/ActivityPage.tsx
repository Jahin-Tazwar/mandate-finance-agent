import { useState } from "react";
import { type Action, type Persona } from "@mandate/shared";
import { decideAction } from "../lib/api";


import { errorText, FeatureHeader, EmptyFeature } from "./shared";
import { ActionCard } from "./ActionCard";
import { useActionFeed } from "./actionFeed";

export function ActivityPage({ persona, refreshKey, onApprove, onRefresh }: {
  persona: Persona;
  refreshKey: number;
  onApprove: (action: Action) => void;
  onRefresh: () => void;
}) {
  const feed = useActionFeed(persona.id, false, refreshKey);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const reject = async (action: Action) => {
    try {
      await decideAction(action.id, "reject");
      feed.setActions((items) => items.map((item) => item.id === action.id ? { ...item, status: "rejected" } : item));
      onRefresh();
    } catch (caught) { setError(errorText(caught, "Couldn't decline this action.")); }
  };
  const visible = feed.actions.filter((action) => filter === "all"
    || filter === "automatic" && action.status === "executed"
    || filter === "waiting" && action.status === "pending_approval"
    || filter === "blocked" && action.status === "denied");
  return <div className="page-stack feature-page">
    <FeatureHeader eyebrow="A CLEAR RECORD" title="Activity" subtitle="See what the agent proposed, what your rules allowed, and what you decided." />
    {feed.error && <div className="inline-error" role="alert">{feed.error}</div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    <section className="surface action-list-panel">
      <div className="section-heading"><div><span className="eyebrow">ACTION TIMELINE</span><h2>Recent actions</h2></div><label className="filter-select"><span className="sr-only">Filter activity</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All activity</option><option value="automatic">Automatic</option><option value="waiting">Waiting</option><option value="blocked">Blocked</option></select></label></div>
      {feed.loading ? <div className="panel-state"><span className="spinner" />Loading activity…</div> : visible.length
        ? <div className="action-list">{visible.map((action) => <ActionCard key={action.id} action={action} onApprove={onApprove} onReject={reject} />)}</div>
        : <EmptyFeature title="No actions to show." detail="Agent and user actions will appear here as they happen." />}
    </section>
  </div>;
}
