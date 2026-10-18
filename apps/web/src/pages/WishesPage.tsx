import { useEffect, useState, type FormEvent } from "react";
import type { PayCycle, Persona, WishDetail as WishDetailData } from "@mandate/shared";
import { contributeWish, deleteWish, getWish, patchWish } from "../lib/api";


import { categoryLabel, createWish, describeCadence, getWishes, previewWish, statusLabel, WishSchema, updateWish, type Wish, type WishDraft, type WishList, type WishPreview } from "../lib/wishes";
import { Icon, PanelState, formatMoney, formatDate, errorText, type Resource, type View, useResource } from "./shared";

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

export function WishesPage({
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
    return <WishDetail wish={selectedWish} persona={persona} payday={payCycle.data.payday} onBack={() => onNavigate("wishes")} onEdit={() => onEditWish(selectedWish.id)} onRefresh={reloadWishes} onDeleted={() => onNavigate("wishes")} />;
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

export function WishCard({ wish, currency, payday, onClick }: { wish: Wish; currency: string; payday: string; onClick: () => void }) {
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

export function WishForm({ persona, payCycle, priority, initialWish, onCancel, onCreated }: {
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

export function WishPlanPanel({ preview, payday, surplus, currency }: {
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

export function WishDetail({ wish: initialWish, persona, payday, onBack, onEdit, onRefresh, onDeleted }: {
  wish: Wish;
  persona: Persona;
  payday: string;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  const [wish, setWish] = useState(initialWish);
  const [detail, setDetail] = useState<WishDetailData | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const localOnly = wish.id.startsWith("local_");
  useEffect(() => {
    setWish(initialWish);
    setDetail(null);
    if (initialWish.id.startsWith("local_")) return;
    const controller = new AbortController();
    getWish(initialWish.id, controller.signal).then(
      (result) => { setDetail(result); setWish(WishSchema.parse(result.wish)); },
      (caught: unknown) => { if (!controller.signal.aborted) setError(errorText(caught, "Couldn't load wish history.")); },
    );
    return () => controller.abort();
  }, [initialWish.id, initialWish]);
  const percentage = Math.min(wish.progressPct, 100);
  const update = async (patch: { autoSave?: boolean; paused?: boolean }) => {
    setBusy(true); setError("");
    try {
      const updated = await patchWish(wish.id, patch);
      setWish(WishSchema.parse(updated));
      onRefresh();
    } catch (caught) { setError(errorText(caught, "Couldn't update this wish.")); }
    finally { setBusy(false); }
  };
  const contribute = async (event: FormEvent) => {
    event.preventDefault();
    const cents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setError("Enter an amount greater than $0."); return; }
    setBusy(true); setError(""); setActionMessage("");
    try {
      const action = await contributeWish(wish.id, cents);
      setActionMessage(action.status === "executed" ? `Done: saved ${formatMoney(cents, persona.currency)} toward ${wish.title}.` : action.status === "pending_approval" ? "Needs your approval before money moves." : `Blocked: ${action.reasons[0] ?? "your rules did not allow this contribution."}`);
      setAmount("");
      onRefresh();
      if (action.status === "executed") {
        const updated = await getWish(wish.id);
        setDetail(updated);
        setWish(WishSchema.parse(updated.wish));
      }
    } catch (caught) { setError(errorText(caught, "Couldn't add money to this wish.")); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Delete this wish? Money you've saved stays in savings.")) return;
    setBusy(true); setError("");
    try { await deleteWish(wish.id); onRefresh(); onDeleted(); }
    catch (caught) { setError(errorText(caught, "Couldn't delete this wish.")); }
    finally { setBusy(false); }
  };
  const projectedPoints = detail?.projection ?? [];
  const projectedMax = Math.max(wish.targetCents, ...projectedPoints.map((point) => point.savedCents), 1);
  const projectedLine = projectedPoints.map((point, index) => `${8 + index / Math.max(projectedPoints.length - 1, 1) * 284},${92 - point.savedCents / projectedMax * 78}`).join(" ");
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
      {projectedPoints.length > 0 && <section className="surface wish-projection-panel"><span className="eyebrow">PROJECTED SAVINGS</span><h2>Progress by payday</h2><svg viewBox="0 0 300 105" role="img" aria-label="Projected savings progress by payday"><line x1="8" x2="292" y1="92" y2="92" stroke="#e8e8f0" /><line x1="8" x2="292" y1={92 - wish.targetCents / projectedMax * 78} y2={92 - wish.targetCents / projectedMax * 78} stroke="#d8d9e9" strokeDasharray="4 4" /><polyline points={projectedLine} fill="none" stroke="#6872e6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></section>}
      <section className="content-grid wish-detail-grid">
        <article className="surface detail-plan-card"><span className="eyebrow">YOUR SAVING RHYTHM</span><h2>{wish.status === "achieved" ? "You made it!" : describeCadence(wish.plan.cadence, payday, wish.plan.perPaydayCents)}</h2><p>{wish.autoSave ? "Automatic saving is turned on for this wish." : "Automatic saving is off for this wish."}</p><div className="detail-plan-row"><span>Next planned payday</span><strong>{wish.plan.nextContributionDate ? formatDate(wish.plan.nextContributionDate, { weekday: "short", month: "short", day: "numeric" }) : "No contribution planned"}</strong></div><div className="detail-plan-row"><span>Estimated finish</span><strong>{wish.eta ? formatDate(wish.eta.date, { month: "short", day: "numeric", year: "numeric" }) : "Not yet reachable"}</strong></div>
          {!localOnly && <><button className="button button-secondary wish-action-button" disabled={busy} onClick={() => void update({ autoSave: !wish.autoSave })}>{wish.autoSave ? "Turn auto-save off" : "Turn auto-save on"}</button><button className="button button-secondary wish-action-button" disabled={busy} onClick={() => void update({ paused: !wish.paused })}>{wish.paused ? "Resume wish" : "Pause wish"}</button></>}
        </article>
        <article className="surface detail-advice-card"><span className="eyebrow">PLAN NOTES</span><h2>A plan that fits your life</h2>{wish.advice.length ? <ul>{wish.advice.map((note) => <li key={note}><span><Icon name="spark" size={14} /></span>{note}</li>)}</ul> : <p>Your wish is on its way. Check back as your savings grow.</p>}</article>
      </section>
      {!localOnly && <section className="surface wish-contribution-panel"><div className="section-heading"><div><span className="eyebrow">OPTIONAL TOP-UP</span><h2>Add money now</h2></div></div><form className="contribute-form" onSubmit={(event) => void contribute(event)}><label className="form-field"><span>Amount</span><span className="money-input"><span>$</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(sanitizeMoneyInput(event.target.value))} placeholder="20.00" /></span></label><button className="button button-primary" disabled={busy || !amount}>{busy ? "Processing…" : "Add money"}</button></form><p>Top-ups go through your rules. Money moves only if policy allows it.</p></section>}
      {localOnly && <div className="notice-card"><span className="notice-icon"><Icon name="shield" size={17} /></span><span><strong>Device-only wish.</strong> This plan is stored in this browser and does not move money or trigger an action.</span></div>}
      {detail && <section className="surface wish-history-panel"><div className="section-heading"><div><span className="eyebrow">SAVING HISTORY</span><h2>Contributions</h2></div></div>{detail.contributions.length ? detail.contributions.map((item) => <div className="detail-plan-row" key={item.id}><span>{formatDate(item.date, { month: "short", day: "numeric" })} · {item.source === "agent" ? "Agent auto-save" : "You"}</span><strong>+{formatMoney(item.amountCents, persona.currency)}</strong></div>) : <div className="empty-note">No contributions yet.</div>}</section>}
      {error && <div className="form-error-banner" role="alert">{error}</div>}
      {actionMessage && <div className="notice-card" role="status">{actionMessage}</div>}
      {!localOnly && <button className="text-button delete-wish-button" disabled={busy} onClick={() => void remove()}>Delete wish · money already saved stays in savings</button>}
      <div className="notice-card"><span className="notice-icon"><Icon name="shield" size={17} /></span><span><strong>Your money stays yours.</strong> Saving {describeCadence(wish.plan.cadence, payday, wish.plan.perPaydayCents)} is a plan—not a transfer. Money moves only when your backend policy allows it.</span></div>
    </div>
  );
}
