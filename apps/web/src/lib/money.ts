/**
 * Money and date helpers for MoneyWise
 * Rule: Money is always integer cents from the API. Never show raw cents.
 */

export const money = (cents: number, currency = "USD"): string => {
  try {
    return (cents / 100).toLocaleString("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

export const formatShortDate = (dateStr: string, options?: Intl.DateTimeFormatOptions): string => {
  if (!dateStr) return "";
  const date = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", options ?? { month: "short", day: "numeric" });
};

export const formatRelativeDate = (dateStr: string, referenceDateStr?: string): string => {
  if (!dateStr) return "";
  const target = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`);
  const today = referenceDateStr
    ? new Date(referenceDateStr.includes("T") ? referenceDateStr : `${referenceDateStr}T12:00:00`)
    : new Date();
  if (!referenceDateStr) today.setHours(12, 0, 0, 0);
  
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;
  return formatShortDate(dateStr);
};

export const formatCadenceText = (cadence: string, payday: string, perPaydayCents: number, currency = "USD"): string => {
  const formattedAmount = money(perPaydayCents, currency);
  if (cadence === "daily") return `${formattedAmount} a day`;
  if (cadence === "weekly") return `${formattedAmount} every ${payday || "week"}`;
  if (cadence === "biweekly") return `${formattedAmount} every two weeks`;
  if (cadence === "monthly") return `${formattedAmount} every month`;
  return `${formattedAmount} per pay cycle`;
};

export const truncateHash = (hash: string, head = 4, tail = 2): string => {
  if (!hash || hash.length <= head + tail) return hash || "";
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
};
