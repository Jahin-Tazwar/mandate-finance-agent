
import type { Bill, Persona } from "@mandate/shared";




import { Icon, PanelState, formatMoney, formatDate, formatRelativeDate, useResource } from "./shared";

export function BillsView({ persona, resource, asOfDate, onUpload }: { persona: Persona; resource: ReturnType<typeof useResource<Bill[]>>; asOfDate?: string; onUpload: () => void }) {
  const unpaid = resource.status === "success" ? resource.data.filter((bill) => bill.status !== "paid") : [];
  const total = unpaid.reduce((sum, bill) => sum + bill.amountCents, 0);
  return (
    <div className="page-stack">
      <section className="welcome-row page-title-row"><div><span className="eyebrow">PLAN AHEAD</span><h1>Upcoming bills<span className="title-dot">.</span></h1><p>Predicted from your recent account activity for the next 30 days.</p></div></section>
      <section className="stat-grid bill-stats">
        <article className="surface stat-card"><span className="stat-label">BILLS TO PLAN FOR</span><strong>{resource.status === "success" ? unpaid.length : "—"}</strong><span className="subtle-line">Due in the next 30 days</span></article>
        <article className="surface stat-card"><span className="stat-label">ESTIMATED TOTAL</span><strong>{resource.status === "success" ? formatMoney(total, persona.currency) : "—"}</strong><span className="subtle-line">Across upcoming unpaid bills</span></article>
      </section>
      <section className="surface data-page-panel">
        <div className="section-heading"><div><span className="eyebrow">NEXT 30 DAYS</span><h2>Bill schedule</h2></div><button className="button button-primary" onClick={onUpload}>Upload bill</button></div>
        <PanelState resource={resource} onRetry={resource.retry} label="Upcoming bills" />
        {resource.status === "success" && (resource.data.length ? <div className="bill-list-page">{resource.data.map((bill) => <div className="bill-page-row" key={bill.id}>
          <div className="bill-date large"><strong>{formatDate(bill.dueDate, { day: "2-digit" })}</strong><span>{formatDate(bill.dueDate, { month: "short" })}</span></div>
          <div className="bill-page-main"><strong>{bill.payee}</strong><span>{formatRelativeDate(bill.dueDate, asOfDate)}<span className={`source-label ${bill.source}`}>{bill.source === "document" ? "From document" : "Bank activity"}</span></span></div>
          <span className={`status-pill ${bill.status === "overdue" ? "status-review" : bill.status === "paid" ? "status-ok" : "status-due"}`}>{bill.status === "due" ? "Upcoming" : bill.status}</span>
          <strong className="bill-page-amount">{formatMoney(bill.amountCents, persona.currency)}</strong>
        </div>)}</div> : <div className="empty-state"><span className="empty-icon"><Icon name="bills" size={21} /></span><strong>No upcoming bills</strong><span>Predicted recurring payments will show here.</span></div>)}
      </section>
      <div className="notice-card"><span className="notice-icon"><Icon name="shield" size={17} /></span><span><strong>Plan with confidence.</strong> Bill amounts and due dates are estimates based on your transaction history.</span></div>
    </div>
  );
}
