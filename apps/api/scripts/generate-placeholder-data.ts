/**
 * Generates PLACEHOLDER seed data so the API works before the team's real
 * spreadsheets arrive. Same format as the templates; real files simply replace these.
 *
 *   npm run seed:placeholder            (refuses to overwrite existing files)
 *   npm run seed:placeholder -- --force (overwrites)
 *
 * The output is deterministic: a seeded random generator gives the same
 * "random" data on every run, so demos and tests are repeatable.
 */
import fs from "node:fs";
import path from "node:path";
import type { AccountType, Category } from "@mandate/shared";
import { rootDir } from "../src/config";
import { formatMoney } from "../src/store/csv";

// Where files go, and whether existing files may be overwritten
const seedDir = path.join(rootDir, "data", "seed");
const templatesDir = path.join(rootDir, "data", "templates");
const force = process.argv.includes("--force");

// The 6-month period the data covers
const START = Date.UTC(2026, 4, 1); // May 1, 2026 (months are 0-based)
const END = Date.UTC(2026, 9, 11); // Oct 11, 2026
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Row {
  date: string;
  account: AccountType;
  description: string;
  merchant: string;
  cents: number;
  category: Category;
}

/**
 * A small, well-known random number generator ("mulberry32"). You don't need to follow the
 * bit maths: what matters is that the same seed always gives the same sequence of numbers.
 */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything a persona's day-by-day script needs. */
function makeTools(seed: number) {
  const random = seededRandom(seed);
  const rows: Row[] = [];
  const tools = {
    rows,
    /** A random whole number from min to max, e.g. between(2500, 6000) → 4371 (cents) */
    between: (min: number, max: number) => min + Math.floor(random() * (max - min + 1)),
    /** True on about `perWeek` days a week, e.g. chance(2) → true on ~2 of every 7 days */
    chance: (perWeek: number) => random() < perWeek / 7,
    /** One random item, e.g. pick(["FreshMart", "Asia Mart"]) → "Asia Mart" */
    pick: <T>(items: T[]) => items[Math.floor(random() * items.length)]!,
    /** One transaction row */
    add(date: string, account: AccountType, description: string, merchant: string, cents: number, category: Category) {
      rows.push({ date, account, description, merchant, cents, category });
    },
    /** Money between your own accounts = two rows: out of one, into the other. */
    transfer(date: string, from: AccountType, to: AccountType, cents: number, description: string) {
      tools.add(date, from, description, `Own ${to}`, -cents, "transfer");
      tools.add(date, to, description, `Own ${from}`, cents, "transfer");
    },
  };
  return tools;
}

type Tools = ReturnType<typeof makeTools>;

/** Runs a persona's `dayScript` once for every day from May 1 to Oct 11. */
function generate(seed: number, dayScript: (t: Tools, date: string, dom: number, weekday: number, month: string) => void) {
  const tools = makeTools(seed);
  for (let ms = START; ms <= END; ms += DAY) {
    // dom = day of month (1–31), weekday 0 = Sunday … 5 = Friday, month = "May"
    const d = new Date(ms);
    dayScript(tools, d.toISOString().slice(0, 10), d.getUTCDate(), d.getUTCDay(), MONTHS[d.getUTCMonth()]!);
  }
  return tools.rows;
}

// ---- Maya: international student, paid weekly (Fridays), tight budget ----
// Order matters: every random call shifts the ones after it. Add new lines at the END only.
const maya = generate(1, (t, date, dom, weekday, month) => {
  // Fixed monthly items, on the same day each month
  if (dom === 1) {
    t.add(date, "checking", "Family support transfer", "Family", 60000, "income");
    t.add(date, "checking", `Rent ${month}`, "Greenview Student Housing", -75000, "housing");
    t.add(date, "checking", "Monthly transit pass", "City Transit", -6000, "transport");
  }
  if (dom === 2) t.add(date, "checking", "Gym membership", "FitZone", -2999, "subscriptions"); // never visited
  if (dom === 5) t.add(date, "checking", "Music streaming", "Spotify", -1199, "subscriptions");
  if (dom === 9) t.add(date, "checking", "Video streaming", "Netflix", -1549, "subscriptions");
  if (dom === 10) t.transfer(date, "checking", "savings", 5000, "Move to savings");
  if (dom === 12) t.add(date, "checking", "Phone bill", "Mobi Telecom", -3500, "utilities");
  if (dom === 20) t.add(date, "checking", "Utilities share", "Greenview Utilities", -t.between(3500, 5000), "utilities");
  // Pay every Friday ($190–$330)
  if (weekday === 5) t.add(date, "checking", "Weekly pay", "Campus Cafe Payroll", t.between(19000, 33000), "income");
  // One-offs on specific dates
  if (date === "2026-08-20") t.add(date, "checking", "Tuition support", "Family", 250000, "income");
  if (date === "2026-08-25") t.add(date, "checking", "Tuition fall semester", "City University", -280000, "education");
  if (date === "2026-08-12") t.add(date, "checking", "Laptop repair", "FixIt Electronics", -18000, "shopping"); // the "nearly $0" week
  // Everyday spending: groceries ~2×/week, food ~3×/week, shopping now and then
  if (t.chance(2)) t.add(date, "checking", "Groceries", t.pick(["FreshMart", "Daily Grocer", "Asia Mart"]), -t.between(2500, 6000), "groceries");
  if (t.chance(3)) t.add(date, "checking", "Food", t.pick(["Noodle Bar", "Campus Canteen", "Bean There Cafe", "Pizza Corner"]), -t.between(800, 2000), "dining");
  if (t.chance(0.3)) t.add(date, "checking", "Shopping", t.pick(["Campus Bookstore", "StyleHub"]), -t.between(1500, 6000), "shopping");
});

// ---- Daniel: young professional, paid monthly (25th), lives on the credit card ----
// Running total of what Daniel owes on his card; paid off in full on the 28th
let danielCardOwed = 0;
const daniel = generate(2, (t, date, dom, _weekday, month) => {
  // Spending on the credit card (also adds to what he owes)
  const card = (description: string, merchant: string, cents: number, category: Category) => {
    t.add(date, "credit", description, merchant, -cents, category);
    danielCardOwed += cents;
  };
  // Fixed monthly items: rent and bills from checking, subscriptions on the card
  if (dom === 1) t.add(date, "checking", `Rent ${month}`, "Harbor View Apartments", -145000, "housing");
  if (dom === 2) card("Gym membership", "FitZone Premium", 4999, "subscriptions");
  if (dom === 3) card("Video streaming", "Netflix", 1549, "subscriptions");
  if (dom === 7) card("Music streaming", "Spotify", 1199, "subscriptions");
  if (dom === 11) card("Video streaming", "Disney+", 1399, "subscriptions");
  if (dom === 14) card("Cloud storage", "CloudBox", 999, "subscriptions");
  if (dom === 15) t.add(date, "checking", "Electricity bill", "CityPower", -t.between(9000, 14000), "utilities");
  if (dom === 17) card("News subscription", "NewsDaily", 1200, "subscriptions");
  if (dom === 18) t.add(date, "checking", "Phone bill", "Mobi Telecom", -5500, "utilities");
  if (dom === 20) t.add(date, "checking", "Internet", "FiberNet", -6000, "utilities");
  // Salary on the 25th, then savings and paying off the card
  if (dom === 25) t.add(date, "checking", "Salary", "ACME Ltd Payroll", 420000, "income");
  if (dom === 26) t.transfer(date, "checking", "savings", 50000, "Monthly savings");
  if (dom === 28 && danielCardOwed > 0) {
    t.transfer(date, "checking", "credit", danielCardOwed, "Credit card payment");
    danielCardOwed = 0;
  }
  if (date === "2026-09-14") {
    // Duplicate charge: same shop, same amount, same day (for the demo)
    card("TechStore purchase", "TechStore", 12999, "shopping");
    card("TechStore purchase", "TechStore", 12999, "shopping");
  }
  // Everyday spending, mostly on the card
  if (t.chance(1)) t.add(date, "checking", "Groceries", t.pick(["FreshMart", "GreenBasket"]), -t.between(6000, 12000), "groceries");
  if (t.chance(4)) card("Dining", t.pick(["Sakura Sushi", "The Burger Joint", "Bella Italia", "Bean There Cafe"]), t.between(1500, 5500), "dining");
  if (t.chance(1)) card("Shopping", t.pick(["TechStore", "StyleHub", "HomeGoods"]), t.between(3000, 15000), "shopping");
  if (t.chance(1)) card("Ride", "RideNow", t.between(1200, 3000), "transport");
});

// ---- Aisha: gig worker, paid daily (ride-share) + weekly on Mondays (delivery) ----
const aisha = generate(3, (t, date, dom, weekday, month) => {
  // Pay: ride-share payout on ~5 of every 7 days, courier payout every Monday
  if (t.chance(5.25)) t.add(date, "checking", "Daily driver payout", "RideNow Driver Payout", t.between(3000, 14000), "income");
  if (weekday === 1) t.add(date, "checking", "Weekly courier payout", "QuickEats Courier", t.between(12000, 40000), "income");
  // Fixed monthly items
  if (dom === 5) t.add(date, "checking", `Rent ${month}`, "Maple Court Rentals", -110000, "housing");
  if (dom === 6) t.add(date, "checking", "Music streaming", "Spotify", -1199, "subscriptions");
  if (dom === 10) t.add(date, "checking", "Car insurance", "SafeDrive Insurance", -14000, "transport");
  if (dom === 15) t.add(date, "checking", "Phone bill", "Mobi Telecom", -4500, "utilities");
  if (dom === 22) t.add(date, "checking", "Electricity bill", "CityPower", -t.between(6000, 9000), "utilities");
  // One-off
  if (date === "2026-07-18") t.add(date, "checking", "Car repair", "AutoFix Garage", -38000, "transport");
  // Everyday spending: fuel ~2×/week, groceries, food
  if (t.chance(2)) t.add(date, "checking", "Fuel", "QuickFuel", -t.between(3000, 6000), "transport");
  if (t.chance(1.5)) t.add(date, "checking", "Groceries", t.pick(["FreshMart", "Daily Grocer"]), -t.between(3000, 8000), "groceries");
  if (t.chance(2)) t.add(date, "checking", "Food", t.pick(["Shawarma House", "Noodle Bar", "Roadside Diner"]), -t.between(800, 2500), "dining");
});

// ---- Write the files ----

/** Makes text safe for a CSV cell: wraps it in quotes if it has a comma, quote or line break. */
function csvField(value: string): string {
  // Plain text needs nothing
  const needsQuotes = /[",\n]/.test(value);
  if (!needsQuotes) return value;

  // Double any quotes inside, then wrap the whole thing in quotes
  // e.g. Rent, May → "Rent, May"
  return `"${value.replace(/"/g, '""')}"`;
}

/** Writes one seed file, unless it already exists (protects the team's real files). */
function writeFile(relative: string, content: string) {
  const full = path.join(seedDir, relative);

  // Skip: file exists and --force wasn't given
  if (fs.existsSync(full) && !force) {
    console.log(`skip   ${relative} (exists; use --force to overwrite)`);
    return;
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.log(`wrote  ${relative}`);
}

// One transactions file per persona, in the same format as the team's template
const header = "date,account,description,merchant,amount,category,memo";
for (const [id, rows] of Object.entries({ maya, daniel, aisha })) {
  const lines = rows.map((r) =>
    [r.date, r.account, r.description, r.merchant, formatMoney(r.cents), r.category, ""].map(csvField).join(","),
  );
  writeFile(`transactions/${id}.csv`, [header, ...lines].join("\n") + "\n");
}
// Simulated usage: when each subscription was last used (empty = never)
writeFile(
  "subscription_usage.csv",
  [
    "persona,merchant,last_used",
    "maya,FitZone,", // paid every month since May, never used: the demo's "unused subscription"
    "maya,Spotify,2026-10-11",
    "maya,Netflix,2026-10-09",
    "daniel,FitZone Premium,2026-07-30", // used once in summer, then stopped going
    "daniel,Netflix,2026-10-10",
    "daniel,Spotify,2026-10-11",
    "daniel,Disney+,2026-09-28",
    "daniel,CloudBox,2026-10-08",
    "daniel,NewsDaily,2026-10-11",
    "aisha,Spotify,2026-10-11",
  ].join("\n") + "\n",
);
// Personas and wishes are copied from the templates
writeFile("personas.csv", fs.readFileSync(path.join(templatesDir, "personas_template.csv"), "utf8"));
writeFile("wishes.csv", fs.readFileSync(path.join(templatesDir, "wishes_template.csv"), "utf8"));
