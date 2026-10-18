import { useCallback, useEffect, useState } from "react";
import type { Account, Bill, Category, Forecast, Transaction } from "@mandate/shared";
import { apiGet, type Parser } from "../lib/api";
import { money } from "../lib/money";

export type Resource<T> =
  | { status: "loading" }
  | { status: "success"; data: T; key: string }
  | { status: "error"; message: string };

export type View = "overview" | "wishes" | "wishNew" | "wishDetail" | "wishEdit" | "transactions" | "subscriptions" | "bills" | "chat" | "approvals" | "activity" | "rules" | "audit";

export function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export const categoryNames: Record<Category, string> = {
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

export const categoryIcons: Record<Category, string> = {
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

export function useResource<T>(path: string | null, parser: Parser<T>, refreshKey: number) {
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

export function formatMoney(cents: number, currency = "USD") {
  return money(cents, currency);
}

/** Ends a message with a full stop, e.g. "Wrong PIN" → "Wrong PIN." (left alone if it has one). */
export function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", options ?? { month: "short", day: "numeric" });
}

export function formatRelativeDate(value: string, referenceDate?: string) {
  const date = new Date(`${value}T12:00:00`);
  const today = referenceDate ? new Date(`${referenceDate}T12:00:00`) : new Date();
  if (!referenceDate) today.setHours(12, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
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
    case "chat":
      return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></svg>;
    case "approvals":
      return <svg {...common}><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></svg>;
    case "activity":
      return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case "rules":
      return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>;
    case "audit":
      return <svg {...common}><path d="M7 3h10l4 4v14H7z" /><path d="M17 3v5h4M10 13h8M10 17h8" /></svg>;
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
    default:
      return null;
  }
}

export function PanelState({ resource, onRetry, label }: { resource: Resource<unknown>; onRetry: () => void; label: string }) {
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

/**
 * Where a point of a chart drawing sits, in % of the chart box, e.g. x 300 → left "50%".
 * Dots and labels are HTML placed on top of the drawing, so text stays readable on phones.
 */
export const chartPosition = (x: number, y: number) => ({ left: `${(x / CHART.width) * 100}%`, top: `${(y / CHART.height) * 100}%` });

/** One day of the forecast, with what happens on it (for the markers and the hover box). */
interface ChartDay {
  date: string;
  balanceCents: number;
  /** The balance went up this day, e.g. Maya's Friday pay. */
  payday: boolean;
  /** Bills due this day, e.g. [CityPower $81.13]. */
  bills: Bill[];
}

// The drawing's own units (the SVG viewBox); labels and dots are placed in % of these
export const CHART = { width: 600, height: 170, left: 6, right: 594, top: 22, bottom: 142 };

/**
 * The 30-day balance forecast: checking balance each day, the safety floor, paydays and bills.
 * Hovering (or tapping, or the arrow keys) shows one day, e.g. "Thu, Oct 15 · $387.56 · Lowest point".
 */
export function BalanceChart({ forecast, currency, floorCents, bills = [] }: { forecast: Forecast; currency: string; floorCents?: number; bills?: Bill[] }) {
  const [active, setActive] = useState<number | null>(null);
  const days: ChartDay[] = forecast.days.map((day, index) => ({
    ...day,
    payday: index > 0 && day.balanceCents > forecast.days[index - 1]!.balanceCents,
    bills: bills.filter((bill) => bill.dueDate === day.date && bill.status !== "paid"),
  }));
  if (!days.length) return <div className="empty-note">There is no forecast data yet.</div>;

  // Scale from the lowest of (balances, floor) to the highest, so the floor line always fits
  const values = days.map((day) => day.balanceCents);
  const low = Math.min(...values, floorCents ?? Number.POSITIVE_INFINITY);
  const high = Math.max(...values);
  const range = Math.max(high - low, 1);
  const xAt = (index: number) => CHART.left + (index / Math.max(days.length - 1, 1)) * (CHART.right - CHART.left);
  const yAt = (cents: number) => CHART.bottom - ((cents - low) / range) * (CHART.bottom - CHART.top);
  const at = chartPosition;

  const points = days.map((day, index) => `${xAt(index)},${yAt(day.balanceCents)}`).join(" ");
  const lowestIndex = Math.max(days.findIndex((day) => day.date === forecast.lowestPoint.date), 0);
  const beforePayday = days[lowestIndex + 1]?.payday ?? false;

  // Skip: payday dots when pay comes almost every day (they'd cover the whole line)
  const showPaydays = days.filter((day) => day.payday).length <= 6;

  // The day under the pointer: its position across the chart → the nearest day
  const pick = (clientX: number, box: DOMRect) => {
    const x = ((clientX - box.left) / box.width) * CHART.width;
    const index = Math.round(((x - CHART.left) / (CHART.right - CHART.left)) * (days.length - 1));
    setActive(Math.min(Math.max(index, 0), days.length - 1));
  };
  // Arrow keys move one day at a time (starting from the lowest point)
  const step = (key: string) => {
    if (key === "ArrowRight") setActive((index) => Math.min((index ?? lowestIndex) + 1, days.length - 1));
    if (key === "ArrowLeft") setActive((index) => Math.max((index ?? lowestIndex) - 1, 0));
  };
  const shown = active === null ? null : days[active]!;

  return (
    <div className="chart-wrap">
      <p className="chart-explainer">Your checking balance each day for the next 30 days, if your usual spending, bills and pay continue.</p>
      <div className="chart-summary">
        <div><span className="eyebrow">LOWEST PROJECTED BALANCE</span><strong>{formatMoney(forecast.lowestPoint.balanceCents, currency)}</strong></div>
        <span className="chart-date">{formatDate(forecast.lowestPoint.date, { month: "short", day: "numeric" })}{beforePayday ? " · the day before payday" : ""}</span>
      </div>
      <div
        className="chart-plot"
        role="img"
        tabIndex={0}
        aria-label={`Projected checking balance over ${days.length} days, lowest ${formatMoney(forecast.lowestPoint.balanceCents, currency)} on ${formatDate(forecast.lowestPoint.date)}. Use the arrow keys to read each day.`}
        onPointerMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
        onPointerDown={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActive(null)}
        onKeyDown={(event) => step(event.key)}
        onFocus={() => setActive(lowestIndex)}
        onBlur={() => setActive(null)}
      >
        <svg className="balance-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="balance-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6974e8" stopOpacity=".2" /><stop offset="100%" stopColor="#6974e8" stopOpacity="0" /></linearGradient></defs>
          <path d={`M ${points.replaceAll(" ", " L ")} L ${CHART.right},${CHART.bottom + 16} L ${CHART.left},${CHART.bottom + 16} Z`} fill="url(#balance-area)" />
          {floorCents !== undefined && <line className="chart-floor-line" x1={CHART.left} x2={CHART.right} y1={yAt(floorCents)} y2={yAt(floorCents)} vectorEffect="non-scaling-stroke" />}
          <polyline points={points} fill="none" stroke="#6872e6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {shown && <line className="chart-guide" x1={xAt(active!)} x2={xAt(active!)} y1={CHART.top - 8} y2={CHART.bottom + 16} vectorEffect="non-scaling-stroke" />}
        </svg>

        {/* Highest balance (top left) and the safety floor (on its line), so the height means something */}
        <span className="chart-label chart-label-high" style={at(CHART.left, CHART.top)}>{formatMoney(high, currency)}</span>
        {floorCents !== undefined && <span className="chart-label chart-label-floor" style={at(CHART.right, yAt(floorCents))}>Safety floor {formatMoney(floorCents, currency)}</span>}

        {/* Why the line jumps: paydays and bills */}
        {days.map((day, index) => (
          <span key={day.date}>
            {showPaydays && day.payday && <span className="chart-marker chart-marker-pay" style={at(xAt(index), yAt(day.balanceCents))} />}
            {day.bills.length > 0 && <span className="chart-marker chart-marker-bill" style={at(xAt(index), yAt(day.balanceCents))} />}
          </span>
        ))}
        <span className="chart-marker chart-marker-lowest" style={at(xAt(lowestIndex), yAt(forecast.lowestPoint.balanceCents))} />
        {shown && <span className="chart-marker chart-marker-active" style={at(xAt(active!), yAt(shown.balanceCents))} />}

        {/* The hover box, e.g. "Thu, Oct 15 · $387.56 · Lowest point · CityPower $81.13 due" */}
        {shown && (
          <div className={`chart-tooltip ${active! > days.length / 2 ? "chart-tooltip-left" : ""}`} style={at(xAt(active!), CHART.top)} role="status">
            <span>{formatDate(shown.date, { weekday: "short", month: "short", day: "numeric" })}</span>
            <strong>{formatMoney(shown.balanceCents, currency)}</strong>
            {active === lowestIndex && <small>Lowest point</small>}
            {shown.payday && <small>Payday</small>}
            {shown.bills.map((bill) => <small key={bill.id}>{bill.payee} {formatMoney(bill.amountCents, currency)} due</small>)}
            {floorCents !== undefined && shown.balanceCents < floorCents && <small className="chart-tooltip-warning">Below your {formatMoney(floorCents, currency)} floor</small>}
          </div>
        )}
      </div>
      <div className="chart-axis"><span>Today · {formatDate(days.at(0)!.date)}</span><span>Next 30 days</span><span>{formatDate(days.at(-1)!.date)}</span></div>
      <div className="chart-legend">
        {showPaydays && <span><i className="chart-marker-pay" /> Payday</span>}
        {days.some((day) => day.bills.length) && <span><i className="chart-marker-bill" /> Bill due</span>}
        <span><i className="chart-marker-lowest" /> Lowest point</span>
        <span className="chart-legend-hint">Hover or tap the chart to see each day</span>
      </div>
    </div>
  );
}

export function TransactionRow({ transaction, currency, account }: { transaction: Transaction; currency: string; account?: Account }) {
  const category = transaction.category;
  return (
    <div className="transaction-row">
      <div className={`category-icon category-${category}`} aria-hidden="true">{categoryIcons[category] ?? "·"}</div>
      <div className="transaction-main">
        <strong>{transactionTitle(transaction)}</strong>
        <span>{transaction.description !== transaction.merchant ? transaction.description : categoryNames[category] ?? category}<span className="dot-separator">·</span>{account?.name ?? "Account"}</span>
      </div>
      <time className="transaction-date" dateTime={transaction.date}>{formatDate(transaction.date, { month: "short", day: "numeric" })}</time>
      <strong className={`transaction-amount ${transaction.amountCents >= 0 ? "positive" : ""}`}>{transaction.amountCents > 0 ? "+" : ""}{formatMoney(transaction.amountCents, currency)}</strong>
    </div>
  );
}

export function BillRow({ bill, currency, referenceDate }: { bill: Bill; currency: string; referenceDate?: string }) {
  return (
    <div className="bill-row">
      <div className="bill-date"><strong>{formatDate(bill.dueDate, { day: "2-digit" })}</strong><span>{formatDate(bill.dueDate, { month: "short" })}</span></div>
      <div className="bill-main"><strong>{bill.payee}</strong><span>{formatRelativeDate(bill.dueDate, referenceDate)}<i className={`bill-source ${bill.source}`} title={bill.source === "document" ? "From an uploaded document" : "Estimated from bank activity"} /></span></div>
      <strong className="bill-amount">{formatMoney(bill.amountCents, currency)}</strong>
    </div>
  );
}

export function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement | null, onClose: () => void) {
  if (event.key === "Escape") {
    onClose();
    return;
  }
  if (event.key !== "Tab" || !dialog) return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function FeatureHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <section className="welcome-row page-title-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="title-dot">.</span></h1><p>{subtitle}</p></div></section>;
}

export function EmptyFeature({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{detail}</span></div>;
}

export type PinRequest = (title: string, submit: (pin: string) => Promise<void>) => void;

/**
 * The row title. Money moved between your own accounts reads as a direction, not a shop:
 * "Own savings" −$50 → "To savings", "Own checking" +$50 → "From checking".
 * MoneyWise's own transfers ("Own accounts") use their description, e.g. "Saved for iPhone 17".
 */
function transactionTitle(transaction: Transaction): string {
  const name = transaction.merchant || transaction.description;
  if (transaction.category !== "transfer" || !/^own /i.test(name)) return name;
  if (/^own accounts$/i.test(name)) return transaction.description || "Between your accounts";
  const account = name.replace(/^own /i, "");
  return transaction.amountCents < 0 ? `To ${account}` : `From ${account}`;
}
