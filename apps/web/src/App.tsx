import { useEffect, useMemo, useState } from "react";
import type { Action, Category, Persona, Transaction } from "@mandate/shared";
import { ApiError, decideAction, getDemoAccounts, getHealth, getMe, parseAccounts, parseActions, parseBills, parseBudget, parseForecast, parseMandate, parsePayCycle, parseSubscriptions, parseTransactions, login, logout, runPayday, setKillSwitch, type Parser } from "./lib/api";
import { ActivityPage } from "./pages/ActivityPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { AuditPage } from "./pages/AuditPage";
import { BillUploadDialog, PinPrompt } from "./pages/Dialogs";
import { ChatPage } from "./pages/ChatPage";
import { RulesPage } from "./pages/RulesPage";
import { SignInPage } from "./pages/SignInPage";
import { BillsView } from "./pages/BillsPage";
import { Overview } from "./pages/OverviewPage";
import { SubscriptionsView } from "./pages/SubscriptionsPage";
import { TransactionsView } from "./pages/TransactionsPage";
import { WishesPage } from "./pages/WishesPage";
import { Icon, categoryNames, formatMoney, useResource, type View } from "./pages/shared";
import { connectTimeline } from "./lib/sse";


import "./styles.css";



const parseKillSwitch: Parser<{ enabled: boolean }> = (value) => {
  if (typeof value !== "object" || value === null || !("enabled" in value) || typeof value.enabled !== "boolean") {
    throw new Error("The server returned an invalid agent status.");
  }
  return { enabled: value.enabled };
};



const navigationViews: View[] = ["overview", "wishes", "chat", "approvals", "activity", "transactions", "subscriptions", "bills", "rules", "audit"];
const mobilePrimaryViews: View[] = ["overview", "wishes", "chat", "approvals"];
const mobileMoreViews: View[] = ["activity", "transactions", "subscriptions", "bills", "rules", "audit"];

function viewFromPath(pathname: string): { view: View; wishId: string | null } {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/wishes") return { view: "wishes", wishId: null };
  if (path === "/wishes/new") return { view: "wishNew", wishId: null };
  if (path.startsWith("/wishes/")) {
    const wishPath = path.slice("/wishes/".length);
    if (wishPath.endsWith("/edit")) return { view: "wishEdit", wishId: decodeURIComponent(wishPath.slice(0, -"/edit".length)) };
    return { view: "wishDetail", wishId: decodeURIComponent(wishPath) };
  }
  if (path === "/transactions") return { view: "transactions", wishId: null };
  if (path === "/subscriptions") return { view: "subscriptions", wishId: null };
  if (path === "/bills") return { view: "bills", wishId: null };
  if (path === "/chat") return { view: "chat", wishId: null };
  if (path === "/approvals") return { view: "approvals", wishId: null };
  if (path === "/activity") return { view: "activity", wishId: null };
  if (path === "/rules") return { view: "rules", wishId: null };
  if (path === "/audit") return { view: "audit", wishId: null };
  return { view: "overview", wishId: null };
}

function pathForView(view: View) {
  if (view === "wishNew") return "/wishes/new";
  if (view === "wishes" || view === "wishDetail" || view === "wishEdit") return "/wishes";
  if (view === "transactions") return "/transactions";
  if (view === "subscriptions") return "/subscriptions";
  if (view === "bills") return "/bills";
  if (view === "chat") return "/chat";
  if (view === "approvals") return "/approvals";
  if (view === "activity") return "/activity";
  if (view === "rules") return "/rules";
  if (view === "audit") return "/audit";
  return "/";
}





const viewLabels: Record<View, string> = {
  overview: "Overview",
  wishes: "Wishes",
  wishNew: "New wish",
  wishDetail: "Wish details",
  wishEdit: "Edit wish",
  transactions: "Transactions",
  subscriptions: "Subscriptions",
  bills: "Upcoming bills",
  chat: "Chat",
  approvals: "Approvals",
  activity: "Activity",
  rules: "Rules",
  audit: "Audit log",
};

















function App() {
  type AuthState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; persona: Persona } | { status: "error"; message: string };
  const [route, setRoute] = useState(() => viewFromPath(window.location.pathname));
  const { view, wishId } = route;
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [bootstrapKey, setBootstrapKey] = useState(0);
  const [wakingUp, setWakingUp] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<Awaited<ReturnType<typeof getDemoAccounts>>>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [transactionItems, setTransactionItems] = useState<Transaction[]>([]);
  const [pinRequest, setPinRequest] = useState<{ title: string; submit: (pin: string) => Promise<void> } | null>(null);
  const [notification, setNotification] = useState("");
  const [untrustedWarning, setUntrustedWarning] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const selectedPersona = auth.status === "signed-in" ? auth.persona : undefined;
  const personaId = selectedPersona?.id ?? "";
  const root = personaId ? `/api/personas/${encodeURIComponent(personaId)}` : null;
  const accounts = useResource(root ? `${root}/accounts` : null, parseAccounts, refreshKey);
  const budget = useResource(root ? `${root}/budget` : null, parseBudget, refreshKey);
  const forecast = useResource(root ? `${root}/forecast` : null, parseForecast, refreshKey);
  const payCycle = useResource(root ? `${root}/pay-cycle` : null, parsePayCycle, refreshKey);
  const bills = useResource(root ? `${root}/bills` : null, parseBills, refreshKey);
  // The signed rules, for the chart's safety-floor line (e.g. "Checking never goes below $200")
  const mandate = useResource(root ? `${root}/mandate` : null, parseMandate, refreshKey);
  const floorRule = mandate.status === "success" ? mandate.data.policy.rules.find((rule) => rule.type === "balance_floor" && rule.account === "checking") : undefined;
  const checkingFloorCents = floorRule?.type === "balance_floor" ? floorRule.minCents : undefined;
  const subscriptions = useResource(root ? `${root}/subscriptions` : null, parseSubscriptions, refreshKey);
  const approvals = useResource(root ? `${root}/approvals` : null, parseActions, refreshKey);
  const killSwitch = useResource(root ? `${root}/killswitch` : null, parseKillSwitch, refreshKey);
  const recentTransactions = useResource(root ? `${root}/transactions?limit=6` : null, parseTransactions, refreshKey);
  const transactionPath = root ? `${root}/transactions?limit=100&offset=${transactionOffset}` : null;
  const allTransactions = useResource(transactionPath, parseTransactions, refreshKey);
  const transactionPage = allTransactions.status === "success" && allTransactions.key === transactionPath ? allTransactions.data : null;
  const accountList = accounts.status === "success" ? accounts.data : [];
  const accountNames = useMemo(() => new Map(accountList.map((account) => [account.id, account])), [accountList]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuth({ status: "signed-out" });
      setUntrustedWarning(false);
      setPinRequest(null);
      setRoute({ view: "overview", wishId: null });
      window.history.replaceState(null, "", "/");
    };
    const onUntrusted = () => setUntrustedWarning(true);
    window.addEventListener("moneywise:unauthorized", onUnauthorized);
    window.addEventListener("moneywise:untrusted", onUntrusted);
    return () => {
      window.removeEventListener("moneywise:unauthorized", onUnauthorized);
      window.removeEventListener("moneywise:untrusted", onUntrusted);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let delayed = false;
    const wakeTimer = window.setTimeout(() => { delayed = true; if (active) setWakingUp(true); }, 3000);
    setAuth({ status: "loading" });
    getHealth().then(() => getMe()).then(({ persona }) => {
      if (active) setAuth({ status: "signed-in", persona });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) setAuth({ status: "signed-out" });
      else setAuth({ status: "error", message: error instanceof Error ? error.message : "Couldn't connect to the MoneyWise server." });
    }).finally(() => {
      window.clearTimeout(wakeTimer);
      if (active && delayed) setWakingUp(false);
    });
    return () => { active = false; window.clearTimeout(wakeTimer); };
  }, [bootstrapKey]);

  useEffect(() => {
    if (!selectedPersona) return;
    const controller = new AbortController();
    getDemoAccounts().then(setDemoAccounts, (error: unknown) => {
      if (!controller.signal.aborted) setNotification(error instanceof Error ? error.message : "Couldn't load demo account options.");
    });
    return () => controller.abort();
  }, [selectedPersona?.id]);

  useEffect(() => {
    if (!personaId) return;
    const close = connectTimeline(personaId, () => setRefreshKey((value) => value + 1));
    return close;
  }, [personaId]);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  useEffect(() => {
    const onPopState = () => setRoute(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setTransactionOffset(0);
    setTransactionItems([]);
    setRefreshKey((value) => value + 1);
  }, [personaId]);

  useEffect(() => {
    if (transactionPage) {
      setTransactionItems((current) => transactionOffset === 0 ? transactionPage.items : [...current, ...transactionPage.items]);
    }
  }, [transactionPage, transactionOffset]);

  const visibleTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactionItems.filter((transaction) => {
      const matchesCategory = categoryFilter === "all" || transaction.category === categoryFilter;
      const matchesSearch = !query || [
        transaction.merchant,
        transaction.description,
        categoryNames[transaction.category],
        accountNames.get(transaction.accountId)?.name ?? "",
      ].some((value) => value.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [transactionItems, search, categoryFilter, accountNames]);

  const navigatePath = (path: string) => {
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setRoute(viewFromPath(path));
    setSearch("");
    setCategoryFilter("all");
  };
  const navigate = (nextView: View) => navigatePath(pathForView(nextView));
  const openWish = (id: string) => navigatePath(`/wishes/${encodeURIComponent(id)}`);
  const editWish = (id: string) => navigatePath(`/wishes/${encodeURIComponent(id)}/edit`);
  const navView = view === "wishNew" || view === "wishDetail" || view === "wishEdit" ? "wishes" : view;
  const transactionResource = allTransactions.status === "success" && allTransactions.key !== transactionPath
    ? { status: "loading" as const, retry: allTransactions.retry }
    : allTransactions;
  const requestPin = (title: string, submit: (pin: string) => Promise<void>) => setPinRequest({ title, submit });
  const authenticate = async (username: string, password: string) => {
    const persona = await login(username, password);
    setAuth({ status: "signed-in", persona });
    setUntrustedWarning(false);
    setRefreshKey((value) => value + 1);
    navigatePath("/");
  };
  const signOut = async () => {
    try {
      await logout();
      setAuth({ status: "signed-out" });
      setPinRequest(null);
      setUntrustedWarning(false);
      setMoreOpen(false);
      navigatePath("/");
    } catch (error) {
      setNotification(error instanceof Error ? error.message : "Couldn't sign out.");
    }
  };
  const switchDemoAccount = async (nextPersonaId: string) => {
    const account = demoAccounts.find((item) => item.personaId === nextPersonaId);
    if (!account || account.personaId === personaId) return;
    try {
      await logout();
      await authenticate(account.username, account.password);
      setNotification(`Signed in as ${account.name}.`);
    } catch (error) {
      setAuth({ status: "signed-out" });
      setNotification(error instanceof Error ? error.message : "Couldn't switch demo account.");
    }
  };
  const approveAction = (action: Action) => requestPin(action.summary, async (pin) => {
    const updated = await decideAction(action.id, "approve", pin);
    window.dispatchEvent(new CustomEvent("moneywise:action-updated", { detail: updated }));
    setPinRequest(null);
    setRefreshKey((value) => value + 1);
    setNotification(updated.status === "denied"
      ? `Blocked: ${updated.reasons[0] ?? "the current rules do not allow this action."}`
      : `Done: ${updated.summary}`);
  });
  const runPaydayNow = async () => {
    if (!personaId) return;
    try {
      const result = await runPayday(personaId);
      setRefreshKey((value) => value + 1);
      setNotification(result.actions.length || result.paycheck ? paydaySummary(result.paycheck, result.actions, selectedPersona?.currency) : "Payday already ran. Nothing was repeated.");
      navigate("activity");
    } catch (error) { setNotification(error instanceof Error ? error.message : "Couldn't run payday."); }
  };
  const toggleAgent = () => {
    if (!personaId || killSwitch.status !== "success") return;
    if (killSwitch.data.enabled) {
      requestPin("Turn the agent on", async (pin) => {
        await setKillSwitch(personaId, false, pin);
        setPinRequest(null);
        setRefreshKey((value) => value + 1);
        setNotification("Agent is on. It can act within your rules.");
      });
    } else {
      void setKillSwitch(personaId, true).then(() => {
        setRefreshKey((value) => value + 1);
        setNotification("Agent is off. It will observe only.");
      }, (error: unknown) => setNotification(error instanceof Error ? error.message : "Couldn't stop the agent."));
    }
  };

  if (auth.status === "loading") return <div className="startup-screen"><span className="brand-mark"><Icon name="shield" size={22} /></span><h1>{wakingUp ? "Waking up the demo server…" : "Connecting to MoneyWise…"}</h1><p>{wakingUp ? "This can take up to a minute. Your data will appear as soon as the server is ready." : "Loading your secure session."}</p><span className="spinner" /></div>;
  if (auth.status === "error") return <div className="startup-screen"><span className="brand-mark"><Icon name="shield" size={22} /></span><h1>Couldn't connect to MoneyWise.</h1><p>{auth.message} Start the API with <code>npm run dev:api</code>, then retry.</p><button className="button button-primary" onClick={() => setBootstrapKey((value) => value + 1)}>Retry connection</button></div>;
  if (auth.status === "signed-out") return <SignInPage onSignIn={authenticate} />;
  if (!selectedPersona) return <SignInPage onSignIn={authenticate} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("overview"); }}>
          <span className="brand-mark"><Icon name="shield" size={20} /></span>
          <span>MoneyWise<span className="brand-period">.</span><small>PERSONAL FINANCE</small></span>
        </a>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigationViews.map((item) => (
            <button key={item} className={`nav-item ${navView === item ? "active" : ""}`} onClick={() => navigate(item)} aria-current={navView === item ? "page" : undefined} aria-label={viewLabels[item]} title={viewLabels[item]}>
              <Icon name={item} size={19} /><span>{viewLabels[item]}</span>{item === "approvals" && <span className="nav-count">{approvals.status === "success" ? approvals.data.length : ""}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-logout" onClick={() => void signOut()} title="Log out" aria-label="Log out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></svg>
            <span>Log out</span>
          </button>
          <div className="sidebar-footer">MONEYWISE FINANCE <span>·</span> DEMO</div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><Icon name="shield" size={18} /></span><strong>MoneyWise<span className="brand-period">.</span></strong></div>
          <div className="topbar-context"><span className="context-label">YOUR FINANCES</span><span className="context-divider">/</span><span>{viewLabels[view]}</span></div>
          <div className="topbar-actions">
            <button className="button button-secondary payday-button" onClick={() => void runPaydayNow()}>Run payday</button>
            <button className={`agent-switch ${killSwitch.status === "success" && !killSwitch.data.enabled ? "agent-on" : "agent-off"}`} onClick={toggleAgent} disabled={killSwitch.status !== "success"} aria-pressed={killSwitch.status === "success" && !killSwitch.data.enabled} title="Turn the agent off instantly; turning it back on requires your PIN">
              Agent: {killSwitch.status === "success" && !killSwitch.data.enabled ? "ON" : "OFF"}
            </button>
            <label className="persona-select-wrap" title="Switch demo profile: signs in again with that person's public demo account">
              <span className="avatar">{selectedPersona?.name.split(" ").map((part) => part[0]).join("").slice(0, 2) ?? "…"}</span>
              <select aria-label="Switch demo profile" value={personaId} onChange={(event) => void switchDemoAccount(event.target.value)} disabled={!demoAccounts.length}>
                {demoAccounts.map((account) => <option key={account.personaId} value={account.personaId}>{account.name}</option>)}
              </select>
              <Icon name="chevron" size={15} />
            </label>
            <button className="icon-button refresh-button" aria-label="Refresh data" title="Refresh data" onClick={() => { setTransactionOffset(0); setTransactionItems([]); setRefreshKey((value) => value + 1); }}><Icon name="refresh" size={18} /></button>
          </div>
        </header>

        <main className="page-content">
          {untrustedWarning && <div className="global-injection-warning" role="alert"><strong>Security warning: a document tried to make a payment.</strong><span>It was treated as untrusted and the policy engine blocked the unsafe request. Nothing moved.</span><button className="text-button" onClick={() => setUntrustedWarning(false)} aria-label="Dismiss security warning">Dismiss</button></div>}
          {view === "overview" && <Overview persona={selectedPersona} accounts={accounts} budget={budget} forecast={forecast} payCycle={payCycle} bills={bills} floorCents={checkingFloorCents} subscriptions={subscriptions} transactions={recentTransactions} accountNames={accountNames} onNavigate={navigate} onOpenWish={openWish} pendingApprovals={approvals.status === "success" ? approvals.data.length : 0} onUpload={() => setUploadOpen(true)} />}
          {(view === "wishes" || view === "wishNew" || view === "wishDetail" || view === "wishEdit") && <WishesPage persona={selectedPersona} payCycle={payCycle} view={view} wishId={wishId} onNavigate={navigate} onOpenWish={openWish} onEditWish={editWish} />}
          {view === "transactions" && <TransactionsView persona={selectedPersona} resource={transactionResource} items={visibleTransactions} loadedCount={transactionItems.length} onLoadMore={() => setTransactionOffset(transactionItems.length)} accountNames={accountNames} search={search} onSearch={setSearch} category={categoryFilter} onCategory={setCategoryFilter} />}
          {view === "subscriptions" && <SubscriptionsView persona={selectedPersona} resource={subscriptions} />}
          {view === "bills" && <BillsView persona={selectedPersona} resource={bills} asOfDate={forecast.status === "success" ? forecast.data.days.at(0)?.date : undefined} onUpload={() => setUploadOpen(true)} />}
          {view === "chat" && <ChatPage persona={selectedPersona} onApprove={approveAction} onRefresh={() => setRefreshKey((value) => value + 1)} />}
          {view === "approvals" && <ApprovalsPage persona={selectedPersona} refreshKey={refreshKey} onApprove={approveAction} onRefresh={() => setRefreshKey((value) => value + 1)} />}
          {view === "activity" && <ActivityPage persona={selectedPersona} refreshKey={refreshKey} onApprove={approveAction} onRefresh={() => setRefreshKey((value) => value + 1)} />}
          {view === "rules" && <RulesPage persona={selectedPersona} requestPin={requestPin} />}
          {view === "audit" && <AuditPage refreshKey={refreshKey} />}
        </main>
        <footer className="page-footer"><span>AI can help organize. <strong>Your rules stay in control.</strong></span><span>MoneyWise <i>·</i> Personal finance, on your terms</span></footer>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobilePrimaryViews.map((item) => (
          <button key={item} className={`mobile-nav-item ${navView === item ? "active" : ""}`} onClick={() => navigate(item)} aria-current={navView === item ? "page" : undefined}>
            <Icon name={item} size={19} /><span>{item === "overview" ? "Home" : item === "approvals" ? `Approvals${approvals.status === "success" && approvals.data.length ? ` ${approvals.data.length}` : ""}` : viewLabels[item]}</span>
          </button>
        ))}
        <button className={`mobile-nav-item ${mobileMoreViews.includes(view) ? "active" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><span className="more-dots">•••</span><span>More</span></button>
        {moreOpen && <div className="mobile-more-menu">{mobileMoreViews.map((item) => <button key={item} onClick={() => { setMoreOpen(false); navigate(item); }}>{viewLabels[item]}</button>)}<button className="mobile-more-logout" onClick={() => void signOut()}>Log out</button></div>}
      </nav>
      {notification && <div className="toast-message" role="status">{notification}<button onClick={() => setNotification("")} aria-label="Dismiss notification">×</button></div>}
      {pinRequest && <PinPrompt title={pinRequest.title} submit={pinRequest.submit} onCancel={() => setPinRequest(null)} />}
      {uploadOpen && <BillUploadDialog persona={selectedPersona} onClose={() => setUploadOpen(false)} onUntrusted={() => setUntrustedWarning(true)} onRefresh={() => setRefreshKey((value) => value + 1)} />}
    </div>
  );
}





























export { App };

/**
 * The Run payday toast, e.g. "Payday: +$284.75 landed. 4 actions: 3 done automatically, 1 waiting for you."
 */
function paydaySummary(paycheck: Transaction | null, actions: Action[], currency = "USD"): string {
  const done = actions.filter((action) => action.status === "executed").length;
  const waiting = actions.filter((action) => action.status === "pending_approval").length;
  const blocked = actions.filter((action) => action.status === "denied").length;

  const parts: string[] = [];
  if (done) parts.push(`${done} done automatically`);
  if (waiting) parts.push(`${waiting} waiting for you`);
  if (blocked) parts.push(`${blocked} blocked`);

  const pay = paycheck ? `Payday: +${formatMoney(paycheck.amountCents, currency)} landed.` : "Payday:";
  const count = `${actions.length} action${actions.length === 1 ? "" : "s"}`;
  return parts.length ? `${pay} ${count}: ${parts.join(", ")}.` : `${pay} no actions needed.`;
}
