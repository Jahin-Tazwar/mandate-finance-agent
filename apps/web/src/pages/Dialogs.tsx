import { useEffect, useRef, useState, type FormEvent } from "react";
import { type Persona } from "@mandate/shared";
import { ApiError, uploadDocument, type UploadDocumentResult } from "../lib/api";

import { formatShortDate, money } from "../lib/money";
import { errorText, sentence, trapDialogFocus } from "./shared";
import { ActionCard } from "./ActionCard";

export function BillUploadDialog({ persona, onClose, onUntrusted, onRefresh }: {
  persona: Persona;
  onClose: () => void;
  onUntrusted: () => void;
  onRefresh: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadDocumentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => trapDialogFocus(event, dialog.current, onClose);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const chooseFile = (candidate?: File) => {
    setError("");
    setResult(null);
    if (!candidate) return;
    if (candidate.type !== "application/pdf" && !candidate.name.toLowerCase().endsWith(".pdf")) {
      setFile(null); setError("Choose a PDF file."); return;
    }
    if (candidate.size > 5 * 1024 * 1024) {
      setFile(null); setError("This PDF is over the 5 MB limit."); return;
    }
    setFile(candidate);
  };
  const submit = async () => {
    if (!file) { setError("Choose a PDF bill first."); return; }
    setBusy(true); setError("");
    try {
      const value = await uploadDocument(persona.id, file);
      setResult(value);
      if (value.warnings.length) onUntrusted();
      onRefresh();
    } catch (caught) { setError(errorText(caught, "Couldn't read this bill.")); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <div className="section-heading"><div><span className="eyebrow">DOCUMENTS ARE UNTRUSTED</span><h2 id="upload-title">Upload a bill</h2></div><button className="icon-button" aria-label="Close upload dialog" onClick={onClose}>×</button></div>
      {!result ? <>
        <button type="button" className="drop-zone" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}>
          <strong>{file ? file.name : "Drop a PDF here or choose a file"}</strong><span>PDF only · maximum 5 MB</span>
        </button>
        <input ref={input} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseFile(event.target.files?.[0])} />
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="rules-controls"><button className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" onClick={() => void submit()} disabled={busy || !file}>{busy ? "Reading your bill…" : "Read bill"}</button></div>
      </> : <>
        {result.warnings.length > 0 && <div className="document-danger" role="alert"><strong>A document tried to make a payment. We blocked it and nothing moved.</strong>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        <div className="document-result"><span className="status-pill status-review">UNTRUSTED · FROM DOCUMENT</span><strong>{result.extracted.payee}</strong><span>{money(result.extracted.amountCents, persona.currency)} · due {formatShortDate(result.extracted.dueDate)}</span>{result.extracted.accountNumber && <small>Account ending/details: {result.extracted.accountNumber}</small>}</div>
        {result.actions.map((action) => <ActionCard action={action} key={action.id} />)}
        <button className="button button-primary" onClick={onClose}>Done</button>
      </>}
    </section>
  </div>;
}

export function PinPrompt({ title, submit, onCancel }: { title: string; submit: (pin: string) => Promise<void>; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => trapDialogFocus(event, dialog.current, onCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin)) { setError("Enter your four-digit PIN."); return; }
    const submittedPin = pin;
    setPin("");
    setError("");
    setBusy(true);
    try { await submit(submittedPin); }
    catch (caught) {
      const failure = caught instanceof ApiError ? caught : null;
      setAttemptsLeft(typeof failure?.attemptsLeft === "number" ? failure.attemptsLeft : null);
      setError(failure?.retryAfterSeconds
        ? `Too many attempts. Try again in ${Math.ceil(failure.retryAfterSeconds / 60)} minutes.`
        : `${sentence(errorText(caught, "PIN verification failed."))}${typeof failure?.attemptsLeft === "number" ? ` ${failure.attemptsLeft} attempts left.` : ""}`);
    } finally { setBusy(false); }
  };
  return <div className="modal-backdrop pin-backdrop"><form ref={dialog} className="modal-card pin-card" role="dialog" aria-modal="true" aria-labelledby="pin-title" onSubmit={(event) => void confirm(event)}>
    <span className="eyebrow">SECURITY CHECK</span><h2 id="pin-title">Confirm with your PIN</h2><p>{title}</p>
    <label className="form-field"><span>Four-digit PIN</span><input ref={input} inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} aria-describedby="pin-error" /></label>
    {error && <div id="pin-error" className="inline-error" role="alert">{error}</div>}
    {attemptsLeft !== null && !error && <small>{attemptsLeft} attempts left.</small>}
    <div className="rules-controls"><button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button></div>
  </form></div>;
}
