import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Account, Bill, Budget, Category, Forecast, PayCycle, Persona, Subscription, Transaction } from "@mandate/shared";
import {
  apiGet,
  apiLogout,
  fetchAuthMe,
  parseAccounts,
  parseBills,
  parseBudget,
  parseForecast,
  parsePayCycle,
  parsePersonas,
  parseSubscriptions,
  parseTransactions,
  type Parser,
} from "./lib/api";
import { LoginScreen } from "./LoginScreen";
import { PersonaSwitcherModal } from "./PersonaSwitcherModal";
import {
  categoryLabel,
  createWish,
  describeCadence,
  getWishes,
  previewWish,
  statusLabel,
  updateWish,
  type Wish,
  type WishDraft,
  type WishList,
  type WishPreview,
} from "./lib/wishes";
import "./styles.css";

type Resource<T> =
  | { status: "loading" }
  | { status: "success"; data: T; key: string }
  | { status: "error"; message: string };

type View = "overview" | "wishes" | "wishNew" | "wishDetail" | "wishEdit" | "transactions" | "subscriptions" | "bills";

const navigationViews: View[] = ["overview", "wishes", "transactions", "subscriptions", "bills"];

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
  return { view: "overview", wishId: null };
}

function pathForView(view: View) {
  if (view === "wishNew") return "/wishes/new";
  if (view === "wishes" || view === "wishDetail" || view === "wishEdit") return "/wishes";
  if (view === "transactions") return "/transactions";
  if (view === "subscriptions") return "/subscriptions";
  if (view === "bills") return "/bills";
  return "/";
}

const categoryNames: Record<Category, string> = {
  income: "Income",
  housing: "Housing",
  utilities: "Utilities",
  groceries: "Groceries",
  dining: "Dining",
  transport: "Transport",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  education: "Education",
  health: "Health",
  entertainment: "Entertainment",
  transfer: "Transfer",
  fees: "Fees",
  other: "Other",
};

const categoryIcons: Record<Category, string> = {
  income: "↗",
  housing: "⌂",
  utilities: "ϟ",
  groceries: "▤",
  dining: "♨",
  transport: "↔",
  subscriptions: "◉",
  shopping: "◇",
  education: "▧",
  health: "+",
  entertainment: "♫",
  transfer: "⇄",
  fees: "≋",
  other: "·",
};

const viewLabels: Record<View, string> = {
  overview: "Overview",
  wishes: "Wishes",
  wishNew: "New wish",
  wishDetail: "Wish details",
  wishEdit: "Edit wish",
  transactions: "Transactions",
  subscriptions: "Subscriptions",
  bills: "Upcoming bills",
};

function useResource<T>(path: string | null, parser: Parser<T>, refreshKey: number) {
  const [resource, setResource] = useState<Resource<T>>({ status: "loading" });
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    if (!path) {
      setResource({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    setResource({ status: "loading" });
    apiGet(path, parser, controller.signal).then(
      (data) => setResource({ status: "success", data, key: path }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResource({
            status: "error",
            message: error instanceof Error ? error.message : "Couldn't load this information.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [path, parser, refreshKey, localRefresh]);

  const retry = useCallback(() => setLocalRefresh((value) => value + 1), []);
  return { ...resource, retry };
}

function formatMoney(cents: number, currency = "USD") {
  try {
    return (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", options ?? { month: "short", day: "numeric" });
}

function formatRelativeDate(value: string, referenceDate?: string) {
  const date = new Date(`${value}T12:00:00`);
  const today = referenceDate ? new Date(`${referenceDate}T12:00:00`) : new Date();
  if (!referenceDate) today.setHours(12, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "overview":
      return <svg {...common}><rect x="3" y="3" width="7" height="8" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="15" width="7" height="6" rx="1.5" /></svg>;
    case "wishes":
      return <svg {...common}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
    case "transactions":
      return <svg {...common}><path d="M4 7h15M15 3l4 4-4 4M20 17H5m4-4-4 4 4 4" /></svg>;
    case "subscriptions":
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h4" /></svg>;
    case "bills":
      return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case "search":
      return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
    case "refresh":
      return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 17 6l3 6M4 12l3 6a7 7 0 0 0 11.5-3" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
    case "wallet":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M16 15h.01" /><path d="M6 5V3h12v2" /></svg>;
    case "shield":
      return <svg {...common}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "chevron":
      return <svg {...common}><path d="m7 10 5 5 5-5" /></svg>;
    case "spark":
      return <svg {...common}><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "logout":
      return <svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
    case "users":
      return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    default:
      return null;
  }
}

function PanelState({ resource, onRetry, label }: { resource: Resource<unknown>; onRetry: () => void; label: string }) {
  if (resource.status === "loading") {
    return <div className="panel-state" aria-label={`Loading ${label}`}><span className="spinner" />Loading {label.toLowerCase()}…</div>;
  }
  if (resource.status === "error") {
    return (
      <div className="panel-state panel-error" role="alert">
        <span>{resource.message}</span>
        <button className="text-button" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  return null;
}

function BalanceChart({ forecast, currency }: { forecast: Forecast; currency: string }) {
  const days = forecast.days;
  if (!days.length) return <div className="empty-note">There is no forecast data yet.</div>;
  const values = days.map((day) => day.balanceCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = days.map((day, index) => {
    const x = 6 + (index / Math.max(days.length - 1, 1)) * 588;
    const y = 142 - ((day.balanceCents - min) / range) * 116;
    return `${x},${y}`;
  }).join(" ");
  const lowestIndex = days.findIndex((day) => day.date === forecast.lowestPoint.date);
  const lowestX = 6 + (Math.max(lowestIndex, 0) / Math.max(days.length - 1, 1)) * 588;
  const lowestY = 142 - ((forecast.lowestPoint.balanceCents - min) / range) * 116;

  return (
    <div className="chart-wrap">
      <div className="chart-summary">
        <div><span className="eyebrow">LOWEST PROJECTED BALANCE</span><strong>{formatMoney(forecast.lowestPoint.balanceCents, currency)}</strong></div>
        <span className="chart-date">{formatDate(forecast.lowestPoint.date, { month: "short", day: "numeric" })}</span>
      </div>
      <svg className="balance-chart" viewBox="0 0 600 170" role="img" aria-label={`Projected balance over ${days.length} days, lowest ${formatMoney(forecast.lowestPoint.balanceCents, currency)}`}>
        <defs><linearGradient id="balance-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6974e8" stopOpacity=".2" /><stop offset="100%" stopColor="#6974e8" stopOpacity="0" /></linearGradient></defs>
        <path d={`M ${points.replaceAll(" ", " L ")} L 594,158 L 6,158 Z`} fill="url(#balance-area)" />
        <polyline points={points} fill="none" stroke="#6872e6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="6" x2="594" y1="142" y2="142" stroke="#e7e8f1" strokeDasharray="4 6" />
        <circle cx={lowestX} cy={lowestY} r="5" fill="#fff" stroke="#6872e6" strokeWidth="3" />
      </svg>
      <div className="chart-axis"><span>Today · {formatDate(days.at(0)?.date ?? forecast.lowestPoint.date)}</span><span>Next 30 days</span><span>{formatDate(days.at(-1)?.date ?? forecast.lowestPoint.date)}</span></div>
    </div>
  );
}

function TransactionRow({ transaction, currency, account }: { transaction: Transaction; currency: string; account?: Account }) {
  const category = transaction.category;
  return (
    <div className="transaction-row">
      <div className={`category-icon category-${category}`} aria-hidden="true">{categoryIcons[category] ?? "·"}</div>
      <div className="transaction-main">
        <strong>{transaction.merchant || transaction.description}</strong>
        <span>{transaction.description !== transaction.merchant ? transaction.description : categoryNames[category] ?? category}<span className="dot-separator">·</span>{account?.name ?? "Account"}</span>
      </div>
      <time className="transaction-date" dateTime={transaction.date}>{formatDate(transaction.date, { month: "short", day: "numeric" })}</time>
      <strong className={`transaction-amount ${transaction.amountCents >= 0 ? "positive" : ""}`}>{transaction.amountCents > 0 ? "+" : ""}{formatMoney(transaction.amountCents, currency)}</strong>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(() => viewFromPath(window.location.pathname));
  const { view, wishId } = route;
  const [currentUser, setCurrentUser] = useState<Persona | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [personaId, setPersonaId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [transactionItems, setTransactionItems] = useState<Transaction[]>([]);

  // Check auth on startup via GET /api/auth/me
  useEffect(() => {
    let active = true;
    fetchAuthMe().then((persona) => {
      if (active) {
        if (persona) {
          setCurrentUser(persona);
          setPersonaId(persona.id);
        }
        setAuthLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSignOut = async () => {
    await apiLogout();
    setCurrentUser(null);
    setPersonaId("");
    setRoute({ view: "overview", wishId: null });
  };

  const handlePersonaSwitched = (newPersona: Persona) => {
    setCurrentUser(newPersona);
    setPersonaId(newPersona.id);
    setTransactionOffset(0);
    setTransactionItems([]);
    setRefreshKey((v) => v + 1);
  };

  const root = personaId ? `/api/personas/${encodeURIComponent(personaId)}` : null;
  const accounts = useResource(root ? `${root}/accounts` : null, parseAccounts, refreshKey);
  const budget = useResource(root ? `${root}/budget` : null, parseBudget, refreshKey);
  const forecast = useResource(root ? `${root}/forecast` : null, parseForecast, refreshKey);
  const payCycle = useResource(root ? `${root}/pay-cycle` : null, parsePayCycle, refreshKey);
  const bills = useResource(root ? `${root}/bills` : null, parseBills, refreshKey);
  const subscriptions = useResource(root ? `${root}/subscriptions` : null, parseSubscriptions, refreshKey);
  const recentTransactions = useResource(root ? `${root}/transactions?limit=6` : null, parseTransactions, refreshKey);
  const transactionPath = root ? `${root}/transactions?limit=100&offset=${transactionOffset}` : null;
  const allTransactions = useResource(transactionPath, parseTransactions, refreshKey);
  const transactionPage = allTransactions.status === "success" && allTransactions.key === transactionPath ? allTransactions.data : null;
  const currency = currentUser?.currency ?? "USD";
  const accountList = accounts.status === "success" ? accounts.data : [];
  const accountNames = useMemo(() => new Map(accountList.map((account) => [account.id, account])), [accountList]);

  useEffect(() => {
    const onPopState = () => setRoute(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setTransactionOffset(0);
    setTransactionItems([]);
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

  if (authLoading) {
    return (
      <div className="login-page">
        <div className="login-container" style={{ textAlign: "center", padding: "100px 20px" }}>
          <span className="spinner" style={{ width: 36, height: 36, margin: "0 auto 18px" }} />
          <p style={{ fontSize: 16, color: "var(--ink)", fontWeight: 700 }}>Connecting to MoneyWise…</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={(persona) => {
          setCurrentUser(persona);
          setPersonaId(persona.id);
          setRefreshKey((v) => v + 1);
        }}
      />
    );
  }

  const selectedPersona: Persona = currentUser;

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
            <button key={item} className={`nav-item ${navView === item ? "active" : ""}`} onClick={() => navigate(item)} aria-current={navView === item ? "page" : undefined}>
              <Icon name={item} size={19} /><span>{viewLabels[item]}</span>{item === "bills" && <span className="nav-count">{bills.status === "success" ? bills.data.length : ""}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-note" onClick={() => setSwitcherOpen(true)} style={{ cursor: "pointer" }} title="Switch persona">
            <span className="avatar" style={{ flexShrink: 0 }}>{selectedPersona.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>
            <div style={{ minWidth: 0, overflow: "hidden" }}>
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPersona.name}</strong>
              <small style={{ color: "var(--purple)", fontWeight: 700 }}>Switch account ↗</small>
            </div>
          </div>
          <div className="sidebar-footer">MONEYWISE FINANCE <span>·</span> DEMO</div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><Icon name="shield" size={18} /></span><strong>MoneyWise<span className="brand-period">.</span></strong></div>
          <div className="topbar-context"><span className="context-label">YOUR FINANCES</span><span className="context-divider">/</span><span>{viewLabels[view]}</span></div>
          <div className="topbar-actions">
            <span className="live-indicator"><i /> Live data</span>
            <div className="persona-profile-badge" onClick={() => setSwitcherOpen(true)} title="Click to switch persona">
              <span className="avatar">{selectedPersona.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
              <div className="persona-info-badge">
                <span className="persona-badge-name">{selectedPersona.name}</span>
                <span className="persona-badge-role">Demo Account</span>
              </div>
              <button type="button" className="switch-demo-btn" onClick={(e) => { e.stopPropagation(); setSwitcherOpen(true); }}>
                Switch
              </button>
            </div>
            <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={handleSignOut}>
              <Icon name="logout" size={18} />
            </button>
            <button className="icon-button refresh-button" aria-label="Refresh dashboard data" title="Refresh data" onClick={() => { setTransactionOffset(0); setTransactionItems([]); setRefreshKey((value) => value + 1); }}>
              <Icon name="refresh" size={18} />
            </button>
          </div>
        </header>

        <main className="page-content">
          {view === "overview" && <Overview persona={selectedPersona} accounts={accounts} budget={budget} forecast={forecast} payCycle={payCycle} bills={bills} subscriptions={subscriptions} transactions={recentTransactions} accountNames={accountNames} onNavigate={navigate} />}
          {(view === "wishes" || view === "wishNew" || view === "wishDetail" || view === "wishEdit") && <WishesPage persona={selectedPersona} payCycle={payCycle} view={view} wishId={wishId} onNavigate={navigate} onOpenWish={openWish} onEditWish={editWish} />}
          {view === "transactions" && <TransactionsView persona={selectedPersona} resource={transactionResource} items={visibleTransactions} loadedCount={transactionItems.length} onLoadMore={() => setTransactionOffset(transactionItems.length)} accountNames={accountNames} search={search} onSearch={setSearch} category={categoryFilter} onCategory={setCategoryFilter} />}
          {view === "subscriptions" && <SubscriptionsView persona={selectedPersona} resource={subscriptions} />}
          {view === "bills" && <BillsView persona={selectedPersona} resource={bills} asOfDate={forecast.status === "success" ? forecast.data.days.at(0)?.date : undefined} />}
        </main>
        <footer className="page-footer"><span>AI can help organize. <strong>Your rules stay in control.</strong></span><span>MoneyWise <i>·</i> Personal finance, on your terms</span></footer>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigationViews.map((item) => (
          <button key={item} className={`mobile-nav-item ${navView === item ? "active" : ""}`} onClick={() => navigate(item)} aria-current={navView === item ? "page" : undefined}>
            <Icon name={item} size={19} /><span>{item === "overview" ? "Home" : item === "wishes" ? "Wishes" : item === "subscriptions" ? "Recurring" : item === "bills" ? "Bills" : "Activity"}</span>
          </button>
        ))}
      </nav>

      <PersonaSwitcherModal
        isOpen={switcherOpen}
        currentPersona={selectedPersona}
        onClose={() => setSwitcherOpen(false)}
        onPersonaSwitched={handlePersonaSwitched}
        onSignOut={handleSignOut}
      />
    </div>
  );
}

function Overview({
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
}) {
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
          {forecast.status === "success" && <BalanceChart forecast={forecast.data} currency={persona.currency} />}
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

function BillRow({ bill, currency, referenceDate }: { bill: Bill; currency: string; referenceDate?: string }) {
  return (
    <div className="bill-row">
      <div className="bill-date"><strong>{formatDate(bill.dueDate, { day: "2-digit" })}</strong><span>{formatDate(bill.dueDate, { month: "short" })}</span></div>
      <div className="bill-main"><strong>{bill.payee}</strong><span>{formatRelativeDate(bill.dueDate, referenceDate)}<i className={`bill-source ${bill.source}`} title={bill.source === "document" ? "From an uploaded document" : "Estimated from bank activity"} /></span></div>
      <strong className="bill-amount">{formatMoney(bill.amountCents, currency)}</strong>
    </div>
  );
}

function TransactionsView({
  persona,
  resource,
  items,
  loadedCount,
  onLoadMore,
  accountNames,
  search,
  onSearch,
  category,
  onCategory,
}: {
  persona: Persona;
  resource: Resource<{ total: number; items: Transaction[] }> & { retry: () => void };
  items: Transaction[];
  loadedCount: number;
  onLoadMore: () => void;
  accountNames: Map<string, Account>;
  search: string;
  onSearch: (value: string) => void;
  category: Category | "all";
  onCategory: (value: Category | "all") => void;
}) {
  return (
    <div className="page-stack">
      <section className="welcome-row page-title-row"><div><span className="eyebrow">YOUR MONEY, IN MOTION</span><h1>Transactions<span className="title-dot">.</span></h1><p>Every deposit and purchase, all in one place.</p></div></section>
      <section className="surface transactions-page">
        <div className="transaction-toolbar">
          <div className="search-box"><Icon name="search" size={18} /><input type="search" placeholder="Search merchant, category…" value={search} onChange={(event) => onSearch(event.target.value)} aria-label="Search transactions" /></div>
          <label className="filter-select"><span className="sr-only">Filter by category</span><select value={category} onChange={(event) => onCategory(event.target.value as Category | "all")}><option value="all">All categories</option>{Object.entries(categoryNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Icon name="chevron" size={15} /></label>
        </div>
        <PanelState resource={resource} onRetry={resource.retry} label="Transactions" />
        {resource.status === "success" && (items.length ? <>
          <div className="transaction-table-head"><span>TRANSACTION</span><span>DATE</span><span>AMOUNT</span></div>
          <div className="transaction-list full-transaction-list">{items.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={persona.currency} account={accountNames.get(transaction.accountId)} />)}</div>
          <div className="results-note">Showing {loadedCount} of {resource.data.total} transactions</div>
          {loadedCount < resource.data.total && <button className="load-more-button" onClick={onLoadMore}>Load more transactions <Icon name="arrow" size={15} /></button>}
        </> : <div className="empty-state"><span className="empty-icon"><Icon name="search" size={21} /></span><strong>No transactions match</strong><span>Try a different search or category.</span></div>)}
      </section>
    </div>
  );
}

function SubscriptionsView({ persona, resource }: { persona: Persona; resource: ReturnType<typeof useResource<Subscription[]>> }) {
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

function BillsView({ persona, resource, asOfDate }: { persona: Persona; resource: ReturnType<typeof useResource<Bill[]>>; asOfDate?: string }) {
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
        <div className="section-heading"><div><span className="eyebrow">NEXT 30 DAYS</span><h2>Bill schedule</h2></div><span className="period-tag">ESTIMATED</span></div>
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

function localDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sanitizeMoneyInput(value: string) {
  const digits = value.replace(/[^\d.]/g, "");
  const decimal = digits.indexOf(".");
  if (decimal < 0) return digits;
  return `${digits.slice(0, decimal)}.${digits.slice(decimal + 1).replace(/\./g, "").slice(0, 2)}`;
}

const wishCategoryOptions: Array<{ value: WishDraft["category"]; label: string }> = [
  { value: "gadget", label: "Gadget" },
  { value: "vehicle", label: "Vehicle" },
  { value: "property", label: "Property" },
  { value: "travel", label: "Travel" },
  { value: "education", label: "Education" },
  { value: "luxury", label: "Luxury" },
  { value: "other", label: "Other" },
];

function WishesPage({
  persona,
  payCycle,
  view,
  wishId,
  onNavigate,
  onOpenWish,
  onEditWish,
}: {
  persona: Persona;
  payCycle: ReturnType<typeof useResource<PayCycle>>;
  view: Extract<View, "wishes" | "wishNew" | "wishDetail" | "wishEdit">;
  wishId: string | null;
  onNavigate: (view: View) => void;
  onOpenWish: (id: string) => void;
  onEditWish: (id: string) => void;
}) {
  const [reload, setReload] = useState(0);
  const [wishResource, setWishResource] = useState<Resource<{ data: WishList; localOnly: boolean }>>({ status: "loading" });

  useEffect(() => {
    if (payCycle.status !== "success") return;
    const controller = new AbortController();
    setWishResource({ status: "loading" });
    getWishes(persona.id, payCycle.data, controller.signal).then(
      (data) => setWishResource({ status: "success", data, key: persona.id }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setWishResource({
            status: "error",
            message: error instanceof Error ? error.message : "Couldn't load your wishes.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [persona.id, payCycle.status, payCycle.status === "success" ? payCycle.data : null, reload]);

  const reloadWishes = () => setReload((value) => value + 1);
  const wishes = wishResource.status === "success" && wishResource.key === persona.id ? wishResource.data.data.wishes : [];
  const selectedWish = wishes.find((wish) => wish.id === wishId);

  if (payCycle.status === "loading") {
    return <div className="page-stack"><section className="welcome-row page-title-row"><div><span className="eyebrow">YOUR SAVINGS GOALS</span><h1>Your wishes<span className="title-dot">.</span></h1></div></section><div className="surface data-page-panel"><PanelState resource={payCycle} onRetry={payCycle.retry} label="Pay schedule" /></div></div>;
  }
  if (payCycle.status === "error") {
    return <div className="page-stack"><section className="welcome-row page-title-row"><div><span className="eyebrow">YOUR SAVINGS GOALS</span><h1>Your wishes<span className="title-dot">.</span></h1></div></section><div className="surface data-page-panel"><PanelState resource={payCycle} onRetry={payCycle.retry} label="Pay schedule" /></div></div>;
  }

  if (view === "wishNew") {
    const nextPriority = wishes.reduce((priority, wish) => Math.max(priority, wish.priority), 0) + 1;
    return <WishForm persona={persona} payCycle={payCycle.data} priority={nextPriority} onCancel={() => onNavigate("wishes")} onCreated={(wish) => { reloadWishes(); onOpenWish(wish.id); }} />;
  }

  if (view === "wishDetail" || view === "wishEdit") {
    if (wishResource.status === "loading") return <div className="surface data-page-panel"><PanelState resource={wishResource} onRetry={reloadWishes} label="Wish" /></div>;
    if (wishResource.status === "error") return <div className="surface data-page-panel"><PanelState resource={wishResource} onRetry={reloadWishes} label="Wishes" /></div>;
    if (!selectedWish) {
      return <div className="page-stack"><button className="back-link" onClick={() => onNavigate("wishes")}>← Back to wishes</button><div className="empty-state surface"><strong>This wish isn't available</strong><span>It may have been removed or belong to another profile.</span></div></div>;
    }
    if (view === "wishEdit") {
      return <WishForm persona={persona} payCycle={payCycle.data} priority={selectedWish.priority} initialWish={selectedWish} onCancel={() => onOpenWish(selectedWish.id)} onCreated={(wish) => { reloadWishes(); onOpenWish(wish.id); }} />;
    }
    return <WishDetail wish={selectedWish} persona={persona} payday={payCycle.data.payday} onBack={() => onNavigate("wishes")} onEdit={() => onEditWish(selectedWish.id)} />;
  }

  if (wishResource.status === "loading") {
    return <div className="page-stack"><section className="welcome-row page-title-row"><div><span className="eyebrow">YOUR SAVINGS GOALS</span><h1>Your wishes<span className="title-dot">.</span></h1></div></section><div className="surface data-page-panel"><PanelState resource={wishResource} onRetry={reloadWishes} label="Wishes" /></div></div>;
  }
  if (wishResource.status === "error") {
    return <div className="page-stack"><section className="welcome-row page-title-row"><div><span className="eyebrow">YOUR SAVINGS GOALS</span><h1>Your wishes<span className="title-dot">.</span></h1></div></section><div className="surface data-page-panel"><PanelState resource={wishResource} onRetry={reloadWishes} label="Wishes" /></div></div>;
  }

  const summary = wishResource.data.data;
  const planUse = summary.surplusPerPaydayCents > 0
    ? Math.min((summary.totalPerPaydayCents / summary.surplusPerPaydayCents) * 100, 100)
    : summary.totalPerPaydayCents > 0 ? 100 : 0;
  return (
    <div className="page-stack wishes-page">
      <section className="welcome-row page-title-row">
        <div><span className="eyebrow">YOUR SAVINGS GOALS</span><h1>Your wishes<span className="title-dot">.</span></h1><p>Make room for what matters, one payday at a time.</p></div>
        <button className="button button-primary new-wish-button" onClick={() => onNavigate("wishNew")}><span>+</span> New wish</button>
      </section>
      <section className={`wish-commitment surface ${summary.overCommitted ? "over-committed" : ""}`}>
        <div className="commitment-copy"><span className="commitment-icon"><Icon name="wallet" size={18} /></span><div><span className="eyebrow">YOUR PAYDAY PLAN</span><strong>You're paid {payCycle.data.cadence === "weekly" ? "weekly" : payCycle.data.cadence === "biweekly" ? "every two weeks" : payCycle.data.cadence === "monthly" ? "monthly" : payCycle.data.cadence === "daily" ? "daily" : "on an irregular schedule"}{payCycle.data.cadence === "weekly" ? ` (${payCycle.data.payday})` : ""}.</strong></div></div>
        <div className="commitment-amounts"><span>Your wishes use <strong>{formatMoney(summary.totalPerPaydayCents, persona.currency)}</strong> of your usual <strong>{formatMoney(summary.surplusPerPaydayCents, persona.currency)}</strong> left each payday.</span><strong className="commitment-percent">{summary.surplusPerPaydayCents > 0 ? Math.round(summary.totalPerPaydayCents / summary.surplusPerPaydayCents * 100) : 0}%</strong></div>
        <div className="commitment-track"><span style={{ width: `${planUse}%` }} /></div>
        {summary.overCommitted && <div className="commitment-warning"><span>!</span>Your wishes need more than you usually have left. Lower a target or move a date.</div>}
      </section>
      {wishes.length ? <section className="wish-card-grid">{wishes.map((wish) => <WishCard key={wish.id} wish={wish} currency={persona.currency} payday={payCycle.data.payday} onClick={() => onOpenWish(wish.id)} />)}</section> : (
        <section className="empty-wishes surface"><span className="empty-wish-art"><Icon name="wishes" size={25} /></span><span className="eyebrow">A LITTLE AT A TIME ADDS UP</span><h2>What are you saving for?</h2><p>A phone, a car, a trip, a place of your own. Add your first wish and we'll help plan it around your paydays.</p><button className="button button-primary" onClick={() => onNavigate("wishNew")}>Create your first wish</button></section>
      )}
    </div>
  );
}

function WishCard({ wish, currency, payday, onClick }: { wish: Wish; currency: string; payday: string; onClick: () => void }) {
  const percentage = Math.min(Math.max(wish.progressPct, 0), 100);
  const etaText = wish.eta?.daysVsTarget === null || !wish.eta
    ? "ETA unavailable"
    : wish.eta.daysVsTarget === 0
      ? "On target date"
      : `${Math.abs(wish.eta.daysVsTarget)}d ${wish.eta.daysVsTarget < 0 ? "early" : "late"}`;
  return (
    <button className="wish-card surface" onClick={onClick}>
      <div className={`wish-art wish-art-${wish.category}`}><span>{wish.category === "travel" ? "↗" : wish.category === "vehicle" ? "⌁" : wish.category === "property" ? "⌂" : wish.category === "education" ? "▤" : wish.category === "gadget" ? "▣" : wish.category === "luxury" ? "✦" : "◌"}</span><span className="wish-category">{categoryLabel(wish.category)}</span></div>
      <div className="wish-card-content">
        <div className="wish-card-progress"><strong>{Math.round(percentage)}<small>%</small></strong><span className={`wish-status wish-status-${wish.status}`}>{statusLabel(wish.status)}</span></div>
        <h2>{wish.title}</h2>
        <p className="wish-saved">{formatMoney(wish.savedCents, currency)} <span>of {formatMoney(wish.targetCents, currency)}</span></p>
        <div className="wish-progress-track"><span style={{ width: `${percentage}%` }} /></div>
        <div className="wish-cadence">{wish.status === "achieved" ? "Goal reached" : describeCadence(wish.plan.cadence, payday, wish.plan.perPaydayCents)}</div>
        <div className="wish-card-meta"><span>Target {formatDate(wish.targetDate, { month: "short", day: "numeric", year: "numeric" })}</span>{wish.status !== "achieved" && <strong>{etaText}</strong>}</div>
        {wish.autoSave && <span className="auto-save-tag"><Icon name="check" size={12} /> Auto-save on</span>}
      </div>
      <span className="wish-card-arrow"><Icon name="arrow" size={16} /></span>
    </button>
  );
}

function WishForm({ persona, payCycle, priority, initialWish, onCancel, onCreated }: {
  persona: Persona;
  payCycle: PayCycle;
  priority: number;
  initialWish?: Wish;
  onCancel: () => void;
  onCreated: (wish: Wish) => void;
}) {
  const initialTarget = new Date();
  initialTarget.setMonth(initialTarget.getMonth() + 6);
  const [title, setTitle] = useState(initialWish?.title ?? "");
  const [category, setCategory] = useState<WishDraft["category"]>(initialWish?.category ?? "gadget");
  const [targetAmount, setTargetAmount] = useState(initialWish ? (initialWish.targetCents / 100).toFixed(2) : "");
  const [savedAmount, setSavedAmount] = useState(initialWish ? (initialWish.savedCents / 100).toFixed(2) : "0");
  const [targetDate, setTargetDate] = useState(initialWish?.targetDate ?? localDateInputValue(initialTarget));
  const [autoSave, setAutoSave] = useState(initialWish?.autoSave ?? true);
  const [preview, setPreview] = useState<{ status: "loading" } | { status: "success"; data: WishPreview; localOnly: boolean } | { status: "error"; message: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const targetCents = Math.round((Number.parseFloat(targetAmount) || 0) * 100);
  const savedCents = Math.round((Number.parseFloat(savedAmount) || 0) * 100);
  const draft: WishDraft = { title: title.trim(), category, targetCents, savedCents, targetDate };
  const validation = validateWishDraft(draft);
  const valid = Object.keys(validation).length === 0;

  useEffect(() => {
    if (!valid) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setPreview({ status: "loading" });
      previewWish(persona.id, draft, payCycle, controller.signal).then(
        (result) => setPreview({ status: "success", ...result }),
        (error: unknown) => {
          if (!controller.signal.aborted) setPreview({ status: "error", message: error instanceof Error ? error.message : "Couldn't calculate the savings plan." });
        },
      );
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [persona.id, title, category, targetCents, savedCents, targetDate, payCycle, valid]);

  const setQuickDate = (months: number) => {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    setTargetDate(localDateInputValue(date));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setShowErrors(true);
    if (!valid) {
      setFormError("Please fix the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const result = initialWish
        ? await updateWish(initialWish, draft, payCycle, autoSave)
        : await createWish(persona.id, draft, payCycle, priority, autoSave);
      onCreated(result.data);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn't save this wish.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack wish-form-page">
      <button className="back-link" onClick={onCancel}>← Back to wishes</button>
      <section className="welcome-row page-title-row"><div><span className="eyebrow">{initialWish ? "UPDATE YOUR SAVINGS GOAL" : "A PLAN FOR SOMETHING THAT MATTERS"}</span><h1>{initialWish ? "Edit your wish" : "Make a wish"}<span className="title-dot">.</span></h1><p>{initialWish ? "Adjust your target, date, or payday saving preference." : "Tell us what you're saving for. We'll map out a plan around your paydays."}</p></div></section>
      <form className="wish-form-layout" onSubmit={submit} noValidate>
        <section className="surface wish-form-panel">
          <div className="section-heading"><div><span className="eyebrow">YOUR SAVINGS GOAL</span><h2>{initialWish ? initialWish.title : "What's your wish?"}</h2></div><span className="wish-step">{initialWish ? "EDIT" : "01 / 02"}</span></div>
          <label className="form-field"><span>Wish name</span><input autoFocus maxLength={80} placeholder="e.g. A weekend in Kyoto" value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(showErrors && validation.title)} />{showErrors && validation.title && <small className="field-error">{validation.title}</small>}</label>
          <fieldset className="form-field category-field"><legend>Category</legend><div className="category-options">{wishCategoryOptions.map((option) => <button type="button" key={option.value} className={`category-option ${category === option.value ? "selected" : ""}`} aria-pressed={category === option.value} disabled={Boolean(initialWish)} onClick={() => setCategory(option.value)}>{option.label}</button>)}</div></fieldset>
          <div className="amount-fields">
            <label className="form-field"><span>How much do you need?</span><span className="money-input"><span>$</span><input inputMode="decimal" placeholder="1,200.00" value={targetAmount} onChange={(event) => setTargetAmount(sanitizeMoneyInput(event.target.value))} aria-invalid={Boolean(showErrors && validation.targetCents)} /></span>{showErrors && validation.targetCents && <small className="field-error">{validation.targetCents}</small>}{(category === "property" || category === "vehicle") && <small className="field-hint">For big purchases, use your down payment as the target.</small>}</label>
            <label className="form-field"><span>Already saved</span><span className="money-input"><span>$</span><input inputMode="decimal" value={savedAmount} readOnly={Boolean(initialWish)} onChange={(event) => setSavedAmount(sanitizeMoneyInput(event.target.value))} aria-invalid={Boolean(showErrors && validation.savedCents)} /></span>{showErrors && validation.savedCents && <small className="field-error">{validation.savedCents}</small>}{initialWish && <small className="field-hint">Already-saved money isn't changed from this form.</small>}</label>
          </div>
          <label className="form-field"><span>When would you like to reach it?</span><span className="date-input"><Icon name="calendar" size={16} /><input type="date" value={targetDate} min={localDateInputValue()} onChange={(event) => setTargetDate(event.target.value)} aria-invalid={Boolean(showErrors && validation.targetDate)} /></span>{showErrors && validation.targetDate && <small className="field-error">{validation.targetDate}</small>}<span className="quick-dates">{[{ label: "3 mo", months: 3 }, { label: "6 mo", months: 6 }, { label: "1 yr", months: 12 }, { label: "2 yr", months: 24 }, { label: "5 yr", months: 60 }].map((item) => <button type="button" key={item.months} onClick={() => setQuickDate(item.months)}>{item.label}</button>)}</span></label>
          <label className="auto-save-control"><input type="checkbox" checked={autoSave} onChange={(event) => setAutoSave(event.target.checked)} /><span className="custom-check"><Icon name="check" size={12} /></span><span><strong>Save automatically on payday</strong><small>Only within the limits of your rules.</small></span></label>
          {formError && <div className="form-error-banner" role="alert">{formError}</div>}
          <div className="wish-form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Save wish"} <Icon name="arrow" size={15} /></button></div>
        </section>
        <WishPlanPanel preview={preview} payday={payCycle.payday} surplus={payCycle.avgSurplusPerCycleCents} currency={persona.currency} />
      </form>
    </div>
  );
}

function validateWishDraft(draft: WishDraft): Partial<Record<keyof WishDraft, string>> {
  const errors: Partial<Record<keyof WishDraft, string>> = {};
  if (!draft.title) errors.title = "Add a name for your wish.";
  if (!Number.isFinite(draft.targetCents) || draft.targetCents <= 0) errors.targetCents = "Enter an amount greater than $0.";
  if (!Number.isFinite(draft.savedCents) || draft.savedCents < 0) errors.savedCents = "Already saved can't be less than $0.";
  if (!draft.targetDate || draft.targetDate <= localDateInputValue()) errors.targetDate = "Choose a date in the future.";
  return errors;
}

function WishPlanPanel({ preview, payday, surplus, currency }: {
  preview: { status: "loading" } | { status: "success"; data: WishPreview; localOnly: boolean } | { status: "error"; message: string } | null;
  payday: string;
  surplus: number;
  currency: string;
}) {
  if (!preview) return <aside className="surface wish-plan-panel plan-empty"><span className="plan-orbit"><Icon name="wishes" size={22} /></span><span className="eyebrow">YOUR PLAN</span><h2>Your next goal starts here.</h2><p>Fill in a wish and we'll work out a plan that fits your paydays.</p></aside>;
  if (preview.status === "loading") return <aside className="surface wish-plan-panel"><div className="plan-loading"><span className="spinner" />Building your plan…</div></aside>;
  if (preview.status === "error") return <aside className="surface wish-plan-panel"><div className="panel-state panel-error" role="alert">{preview.message}</div></aside>;
  const wish = preview.data;
  const dateDiff = wish.eta?.daysVsTarget;
  return (
    <aside className={`surface wish-plan-panel plan-${wish.status}`}>
      <div className="plan-header"><span className="plan-orbit"><Icon name="spark" size={20} /></span><span className="eyebrow">YOUR PLAN</span>{preview.localOnly && <span className="local-plan-pill">DEVICE PLAN</span>}</div>
      <h2>{describeCadence(wish.plan.cadence, payday, wish.plan.perPaydayCents)}</h2>
      <p className="plan-duration">for {wish.plan.paydaysLeft} {wish.plan.cadence === "weekly" ? "weeks" : wish.plan.cadence === "monthly" ? "months" : wish.plan.cadence === "daily" ? "days" : "pay cycles"}</p>
      <span className={`wish-status wish-status-${wish.status}`}>{statusLabel(wish.status)}</span>
      <p className="plan-share">Uses {surplus > 0 ? Math.round(wish.plan.perPaydayCents / surplus * 100) : wish.plan.perPaydayCents > 0 ? "more than 100" : 0}% of your usual {formatMoney(surplus, currency)} left each payday.</p>
      <div className="plan-progress"><div><span>Current progress</span><strong>{Math.round(wish.progressPct)}%</strong></div><div className="wish-progress-track"><span style={{ width: `${Math.min(wish.progressPct, 100)}%` }} /></div><small>{formatMoney(wish.savedCents, currency)} saved of {formatMoney(wish.targetCents, currency)}</small></div>
      {wish.advice.length > 0 && <div className="plan-advice"><Icon name="spark" size={15} /><span>{wish.advice.at(-1)}</span></div>}
      <div className="plan-eta"><Icon name="calendar" size={16} /><span>Estimated finish</span><strong>{wish.eta ? formatDate(wish.eta.date, { month: "short", day: "numeric", year: "numeric" }) : "Not yet reachable"}</strong></div>
      {typeof dateDiff === "number" && <span className="plan-date-diff">{dateDiff < 0 ? `${Math.abs(dateDiff)} days ahead of your target` : dateDiff > 0 ? `${dateDiff} days after your target` : "Right on your target date"}</span>}
    </aside>
  );
}

function WishDetail({ wish, persona, payday, onBack, onEdit }: { wish: Wish; persona: Persona; payday: string; onBack: () => void; onEdit: () => void }) {
  const percentage = Math.min(wish.progressPct, 100);
  return (
    <div className="page-stack wish-detail-page">
      <button className="back-link" onClick={onBack}>← Your wishes</button>
      <section className="surface wish-detail-hero">
        <div className={`wish-detail-art wish-art-${wish.category}`}>{wish.category === "travel" ? "↗" : wish.category === "vehicle" ? "⌁" : wish.category === "property" ? "⌂" : wish.category === "gadget" ? "▣" : "✦"}</div>
        <div className="wish-detail-copy"><span className="eyebrow">{categoryLabel(wish.category).toUpperCase()} · SAVINGS GOAL</span><h1>{wish.title}<span className="title-dot">.</span></h1><div className="wish-detail-meta"><span className={`wish-status wish-status-${wish.status}`}>{statusLabel(wish.status)}</span><span>Target {formatDate(wish.targetDate, { month: "short", day: "numeric", year: "numeric" })}</span></div></div>
        <button className="button button-secondary wish-edit-button" onClick={onEdit}>Edit wish</button>
      </section>
      <section className="surface wish-detail-progress">
        <div className="detail-progress-head"><div><span className="eyebrow">SAVED SO FAR</span><strong>{formatMoney(wish.savedCents, persona.currency)} <small>of {formatMoney(wish.targetCents, persona.currency)}</small></strong></div><strong className="detail-percent">{Math.round(percentage)}%</strong></div>
        <div className="wish-progress-track"><span style={{ width: `${percentage}%` }} /></div>
        <div className="detail-progress-foot"><span>{formatMoney(Math.max(wish.targetCents - wish.savedCents, 0), persona.currency)} left to go</span><span>{wish.plan.paydaysLeft} paydays in your plan</span></div>
      </section>
      <section className="content-grid wish-detail-grid">
        <article className="surface detail-plan-card"><span className="eyebrow">YOUR SAVING RHYTHM</span><h2>{wish.status === "achieved" ? "You made it!" : describeCadence(wish.plan.cadence, payday, wish.plan.perPaydayCents)}</h2><p>{wish.autoSave ? "Automatic saving is turned on for this wish." : "Automatic saving is off for this wish."}</p><div className="detail-plan-row"><span>Next planned payday</span><strong>{formatDate(wish.plan.nextContributionDate, { weekday: "short", month: "short", day: "numeric" })}</strong></div><div className="detail-plan-row"><span>Estimated finish</span><strong>{wish.eta ? formatDate(wish.eta.date, { month: "short", day: "numeric", year: "numeric" }) : "Not yet reachable"}</strong></div></article>
        <article className="surface detail-advice-card"><span className="eyebrow">PLAN NOTES</span><h2>A plan that fits your life</h2>{wish.advice.length ? <ul>{wish.advice.map((note) => <li key={note}><span><Icon name="spark" size={14} /></span>{note}</li>)}</ul> : <p>Your wish is on its way. Check back as your savings grow.</p>}</article>
      </section>
      <div className="notice-card"><span className="notice-icon"><Icon name="shield" size={17} /></span><span><strong>Your money stays yours.</strong> Saving {describeCadence(wish.plan.cadence, payday, wish.plan.perPaydayCents)} is a plan—not a transfer. Money moves only when your backend policy allows it.</span></div>
    </div>
  );
}

export { App };
