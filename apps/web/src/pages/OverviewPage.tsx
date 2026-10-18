import { useEffect, useState } from "react";
import type { Account, Bill, Budget, Forecast, PayCycle, Persona, Subscription, Transaction } from "@mandate/shared";



import { getWishes, type WishList } from "../lib/wishes";
import { Icon, PanelState, formatMoney, formatDate, errorText, type Resource, useResource, type View, BalanceChart, TransactionRow, BillRow, categoryNames } from "./shared";
import { WishCard } from "./WishesPage";

export function Overview({
  persona,
  accounts,
  budget,
  forecast,
  payCycle,
  bills,
  subscriptions,
  transactions,
  accountNames,
  onNavigate,
  onOpenWish,
  pendingApprovals,
  onUpload,
  floorCents,
}: {
  persona: Persona;
  accounts: ReturnType<typeof useResource<Account[]>>;
  budget: ReturnType<typeof useResource<Budget>>;
  forecast: ReturnType<typeof useResource<Forecast>>;
  payCycle: ReturnType<typeof useResource<PayCycle>>;
  bills: ReturnType<typeof useResource<Bill[]>>;
  subscriptions: ReturnType<typeof useResource<Subscription[]>>;
  transactions: ReturnType<typeof useResource<{ total: number; items: Transaction[] }>>;
  accountNames: Map<string, Account>;
  onNavigate: (view: View) => void;
  onOpenWish: (id: string) => void;
  pendingApprovals: number;
  onUpload: () => void;
  /** The checking safety floor from the signed rules, e.g. 20000 = $200 (drawn on the chart). */
  floorCents?: number;
}) {
  const [wishResource, setWishResource] = useState<Resource<WishList>>({ status: "loading" });
  const [wishReload, setWishReload] = useState(0);
  useEffect(() => {
    if (payCycle.status !== "success") return;
    const controller = new AbortController();
    setWishResource({ status: "loading" });
    getWishes(persona.id, payCycle.data, controller.signal).then(
      (result) => setWishResource({ status: "success", data: result.data, key: persona.id }),
      (error: unknown) => {
        if (!controller.signal.aborted) setWishResource({ status: "error", message: errorText(error, "Couldn't load wishes.") });
      },
    );
    return () => controller.abort();
  }, [persona.id, payCycle.status, payCycle.status === "success" ? payCycle.data : null, wishReload]);
  const cashBalance = accounts.status === "success"
    ? accounts.data.filter((account) => account.type !== "credit").reduce((sum, account) => sum + account.balanceCents, 0)
    : 0;
  const unusedSubscriptions = subscriptions.status === "success"
    ? subscriptions.data.filter((subscription) => subscription.status === "active" && subscription.unusedDays !== null && subscription.unusedDays >= 30)
    : [];
  const upcomingBills = bills.status === "success" ? bills.data.slice(0, 3) : [];
  const topCategories = budget.status === "success"
    ? [...budget.data.categories].sort((a, b) => b.spentCents / Math.max(b.budgetCents, 1) - a.spentCents / Math.max(a.budgetCents, 1)).slice(0, 5)
    : [];

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div><span className="eyebrow">PERSONAL FINANCE OVERVIEW</span><h1>Good to see you, {persona.name.split(" ")[0]}<span className="title-dot">.</span></h1><p>A clear picture of your money, all in one place.</p></div>
        <div className="today-pill"><span className="today-pulse" /> Your finances at a glance</div>
      </section>

      <section className="hero-grid">
        <article className="safe-card">
          <div className="safe-card-top"><span className="safe-icon"><Icon name="spark" size={19} /></span><span className="safe-label">SAFE TO SPEND TODAY</span><span className="info-mark" title="Calculated from your balance, upcoming bills, and typical spending">i</span></div>
          <PanelState resource={budget} onRetry={budget.retry} label="Spending plan" />
          {budget.status === "success" && <><div className="safe-amount">{formatMoney(budget.data.safeToSpendTodayCents, persona.currency)}</div><p className="safe-caption">After your regular spending and upcoming commitments</p></>}
          <div className="safe-card-foot">
            <span className="safe-foot-icon"><Icon name="calendar" size={16} /></span>
            <span>{payCycle.status === "success" ? <>Next payday <strong>{formatDate(payCycle.data.nextPayday, { weekday: "short", month: "short", day: "numeric" })}</strong></> : <PanelState resource={payCycle} onRetry={payCycle.retry} label="Payday" />}</span>
            {payCycle.status === "success" && <span className="payday-cadence">{payCycle.data.payday}</span>}
          </div>
        </article>
        <article className="total-card">
          <div className="card-heading"><span className="card-icon mint"><Icon name="wallet" size={18} /></span><span className="eyebrow">CASH ACROSS ACCOUNTS</span></div>
          <PanelState resource={accounts} onRetry={accounts.retry} label="Accounts" />
          {accounts.status === "success" && <><strong className="total-amount">{formatMoney(cashBalance, persona.currency)}</strong><span className="subtle-line">Across {accounts.data.filter((account) => account.type !== "credit").length} cash accounts</span><div className="account-chips">{accounts.data.filter((account) => account.type !== "credit").map((account) => <div className="account-chip" key={account.id}><span className={`account-dot ${account.type}`} /><span>{account.name}</span><strong>{formatMoney(account.balanceCents, persona.currency)}</strong></div>)}</div>{accounts.data.filter((account) => account.type === "credit").map((account) => <div className="account-credit" key={account.id}><span className="account-dot credit" /><span>{account.name} balance</span><strong>{formatMoney(account.balanceCents, persona.currency)}</strong></div>)}</>}
        </article>
      </section>

      <section className="insight-strip">
        <div className="insight-badge"><Icon name="shield" size={18} /></div>
        <div><strong>AI suggests. Your rules decide.</strong><span>Your balances and insights come directly from your account activity.</span></div>
        <span className="verified-label"><Icon name="check" size={14} /> API connected</span>
      </section>

      <section className="content-grid overview-grid">
        <article className="surface forecast-panel">
          <div className="section-heading"><div><span className="eyebrow">LOOKING AHEAD</span><h2>Balance forecast</h2></div><span className="period-tag">NEXT 30 DAYS</span></div>
          <PanelState resource={forecast} onRetry={forecast.retry} label="Balance forecast" />
          {forecast.status === "success" && <BalanceChart forecast={forecast.data} currency={persona.currency} floorCents={floorCents} bills={bills.status === "success" ? bills.data : []} />}
          {forecast.status === "success" && forecast.data.warnings.length > 0 && <div className="warning-box"><span className="warning-dot" /><div><strong>Heads up</strong>{forecast.data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
          {forecast.status === "success" && forecast.data.warnings.length === 0 && <div className="good-news"><span><Icon name="check" size={15} /></span> Your projected balance stays above your safety buffer.</div>}
        </article>

        <article className="surface budget-panel">
          <div className="section-heading"><div><span className="eyebrow">SPENDING PLAN</span><h2>This month's budget</h2></div>{budget.status === "success" && <span className="month-tag">{formatDate(`${budget.data.month}-01`, { month: "short", year: "numeric" })}</span>}</div>
          <PanelState resource={budget} onRetry={budget.retry} label="Budget" />
          {budget.status === "success" && (topCategories.length ? (
            <>
              <div className="budget-list">{topCategories.map((item) => {
                const percentage = item.budgetCents > 0 ? Math.min((item.spentCents / item.budgetCents) * 100, 100) : 0;
                const exceeded = item.spentCents > item.budgetCents;
                return <div className="budget-row" key={item.category}><div className="budget-row-top"><span>{categoryNames[item.category]}</span><strong>{formatMoney(item.spentCents, persona.currency)}<small> / {formatMoney(item.budgetCents, persona.currency)}</small></strong></div><div className={`progress-track ${exceeded ? "exceeded" : ""}`}><span style={{ width: `${percentage}%` }} /></div></div>;
              })}</div>
              <div className="budget-insight"><Icon name="spark" size={15} /><span>{budget.data.insights[0] ?? "You're all caught up. Keep an eye on your spending as the month goes on."}</span></div>
            </>
          ) : <div className="empty-note">No budget categories to show yet.</div>)}
        </article>
      </section>

      <section className="content-grid overview-grid">
        <article className="surface compact-panel">
          <div className="section-heading"><div><span className="eyebrow">SAVING FOR WHAT MATTERS</span><h2>Your wishes</h2></div><button className="link-button" onClick={() => onNavigate("wishes")}>View all <Icon name="arrow" size={15} /></button></div>
          {wishResource.status === "loading" && <div className="panel-state"><span className="spinner" />Loading wishes…</div>}
          {wishResource.status === "error" && <div className="panel-state panel-error" role="alert">{wishResource.message}<button className="text-button" onClick={() => setWishReload((value) => value + 1)}>Try again</button></div>}
          {wishResource.status === "success" && (wishResource.data.wishes.length
            ? <div className="dashboard-wishes">{wishResource.data.wishes.slice(0, 2).map((wish) => <WishCard key={wish.id} wish={wish} currency={persona.currency} payday={payCycle.status === "success" ? payCycle.data.payday : "payday"} onClick={() => onOpenWish(wish.id)} />)}</div>
            : <div className="empty-note">Add a wish and build a plan around your paydays.</div>)}
        </article>
        <article className="surface compact-panel approval-summary">
          <div className="section-heading"><div><span className="eyebrow">NEEDS YOUR ATTENTION</span><h2>{pendingApprovals} {pendingApprovals === 1 ? "action" : "actions"} need approval</h2></div></div>
          <p>{pendingApprovals ? "Review each proposal, the agent's reason, and the rule that applies before deciding." : "Nothing is waiting. The agent is working within your rules."}</p>
          <button className="button button-primary" onClick={() => onNavigate("approvals")}>{pendingApprovals ? "Review approvals" : "Open approvals"} <Icon name="arrow" size={15} /></button>
        </article>
      </section>

      <section className="content-grid lower-grid">
        <article className="surface list-panel">
          <div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Latest transactions</h2></div><button className="link-button" onClick={() => onNavigate("transactions")}>View all <Icon name="arrow" size={15} /></button></div>
          <PanelState resource={transactions} onRetry={transactions.retry} label="Transactions" />
          {transactions.status === "success" && (transactions.data.items.length ? <div className="transaction-list">{transactions.data.items.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={persona.currency} account={accountNames.get(transaction.accountId)} />)}</div> : <div className="empty-note">Your transactions will appear here.</div>)}
        </article>
        <div className="side-stack">
          <article className="surface compact-panel">
            <div className="section-heading"><div><span className="eyebrow">COMING UP</span><h2>Upcoming bills</h2></div><button className="icon-link" aria-label="See all bills" onClick={() => onNavigate("bills")}><Icon name="arrow" size={17} /></button></div>
            <PanelState resource={bills} onRetry={bills.retry} label="Bills" />
            {bills.status === "success" && (upcomingBills.length ? <div className="upcoming-list">{upcomingBills.map((bill) => <BillRow key={bill.id} bill={bill} currency={persona.currency} referenceDate={forecast.status === "success" ? forecast.data.days.at(0)?.date : undefined} />)}</div> : <div className="empty-note">No upcoming bills found.</div>)}
            <button className="subtle-link" onClick={onUpload}>Upload a bill <Icon name="arrow" size={14} /></button>
            {bills.status === "success" && bills.data.length > 3 && <button className="subtle-link" onClick={() => onNavigate("bills")}>See all {bills.data.length} bills <Icon name="arrow" size={14} /></button>}
          </article>
          <article className="subscription-callout">
            <div className="subscription-callout-icon"><Icon name="subscriptions" size={18} /></div>
            <div className="subscription-callout-content"><span className="eyebrow">RECURRING PAYMENTS</span><h3>{subscriptions.status === "success" ? `${subscriptions.data.length} subscriptions` : "Your subscriptions"}</h3><p>{unusedSubscriptions.length ? `${unusedSubscriptions.length} may be worth a second look.` : "Keep track of the services charging you."}</p><PanelState resource={subscriptions} onRetry={subscriptions.retry} label="Subscriptions" /></div>
            <button className="icon-link" aria-label="View subscriptions" onClick={() => onNavigate("subscriptions")}><Icon name="arrow" size={17} /></button>
          </article>
        </div>
      </section>
    </div>
  );
}
