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

export function BalanceChart({ forecast, currency }: { forecast: Forecast; currency: string }) {
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

export function TransactionRow({ transaction, currency, account }: { transaction: Transaction; currency: string; account?: Account }) {
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
