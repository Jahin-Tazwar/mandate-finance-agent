/** Cents → text for messages, e.g. 123456 → "$1,234.56", 20000 → "$200" (no ".00"). */
export function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}
