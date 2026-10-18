
import type { Account, Category, Persona, Transaction } from "@mandate/shared";




import { Icon, PanelState, type Resource, TransactionRow, categoryNames } from "./shared";

export function TransactionsView({
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
