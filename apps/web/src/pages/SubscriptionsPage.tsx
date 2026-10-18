
import type { Persona, Subscription } from "@mandate/shared";




import { Icon, PanelState, formatMoney, formatDate, useResource } from "./shared";

export function SubscriptionsView({ persona, resource }: { persona: Persona; resource: ReturnType<typeof useResource<Subscription[]>> }) {
  const active = resource.status === "success" ? resource.data.filter((subscription) => subscription.status === "active") : [];
  const monthlyTotal = active.reduce((sum, subscription) => sum + subscription.amountCents * (subscription.cadence === "weekly" ? 52 / 12 : 1), 0);
  return (
    <div className="page-stack">
      <section className="welcome-row page-title-row"><div><span className="eyebrow">RECURRING PAYMENTS</span><h1>Subscriptions<span className="title-dot">.</span></h1><p>Know what renews, and when it charges.</p></div></section>
      <section className="stat-grid">
        <article className="surface stat-card"><span className="stat-label">ACTIVE SERVICES</span><strong>{resource.status === "success" ? active.length : "—"}</strong><span className="subtle-line">Recurring subscriptions</span></article>
        <article className="surface stat-card"><span className="stat-label">ESTIMATED MONTHLY TOTAL</span><strong>{resource.status === "success" ? formatMoney(monthlyTotal, persona.currency) : "—"}</strong><span className="subtle-line">Based on each service's billing cadence</span></article>
        <article className="surface stat-card"><span className="stat-label">WORTH A SECOND LOOK</span><strong>{resource.status === "success" ? active.filter((item) => item.unusedDays !== null && item.unusedDays >= 30).length : "—"}</strong><span className="subtle-line">Unused for at least 30 days</span></article>
      </section>
      <section className="surface data-page-panel">
        <div className="section-heading"><div><span className="eyebrow">DETECTED FROM YOUR ACTIVITY</span><h2>Your recurring services</h2></div><span className="period-tag">LIVE DATA</span></div>
        <PanelState resource={resource} onRetry={resource.retry} label="Subscriptions" />
        {resource.status === "success" && (active.length ? <div className="subscription-list">{active.map((subscription) => {
          const needsReview = subscription.unusedDays !== null && subscription.unusedDays >= 30;
          return <article className="subscription-row" key={subscription.id}>
            <div className={`service-mark ${needsReview ? "review" : ""}`}>{subscription.merchant.trim().slice(0, 1).toUpperCase()}</div>
            <div className="service-name"><strong>{subscription.merchant}</strong><span>{subscription.cadence === "weekly" ? "Billed weekly" : "Billed monthly"}<i className="dot-separator">·</i>Next charge {formatDate(subscription.nextCharge, { month: "short", day: "numeric" })}</span></div>
            <div className="service-usage">{needsReview ? <><span className="status-pill status-review">Review usage</span><small>{subscription.lastUsed ? `Last used ${formatDate(subscription.lastUsed)}` : `No usage in ${subscription.unusedDays} days`}</small></> : <><span className="status-pill status-ok">Recently used</span><small>{subscription.lastUsed ? `Last used ${formatDate(subscription.lastUsed)}` : "Usage data unavailable"}</small></>}</div>
            <strong className="service-amount">{formatMoney(subscription.amountCents, persona.currency)}<small> / {subscription.cadence === "weekly" ? "week" : "month"}</small></strong>
          </article>;
        })}</div> : <div className="empty-state"><span className="empty-icon"><Icon name="subscriptions" size={21} /></span><strong>No subscriptions detected yet</strong><span>Recurring services will appear here as they are found in your activity.</span></div>)}
      </section>
      <div className="notice-card"><span className="notice-icon"><Icon name="spark" size={17} /></span><span><strong>You're in control.</strong> MoneyWise highlights subscriptions you may want to review. It won't cancel anything for you.</span></div>
    </div>
  );
}
