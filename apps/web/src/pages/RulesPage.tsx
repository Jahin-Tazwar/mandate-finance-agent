import { useEffect, useState } from "react";
import { type Mandate, type Persona } from "@mandate/shared";
import { compileMandate, explainMandate, getMandate, signMandate } from "../lib/api";


import { errorText, FeatureHeader, EmptyFeature, type PinRequest } from "./shared";

type CompileResult = Awaited<ReturnType<typeof compileMandate>>;

export function RulesPage({ persona, requestPin }: { persona: Persona; requestPin: PinRequest }) {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [text, setText] = useState("");
  const [compiled, setCompiled] = useState<CompileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof explainMandate>>["suggestions"]>([]);
  const [explaining, setExplaining] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getMandate(persona.id, controller.signal).then((value) => {
      setMandate(value);
      setText(value.naturalLanguage);
    }, (caught: unknown) => {
      if (!controller.signal.aborted) setError(errorText(caught, "Couldn't load your current rules."));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [persona.id]);
  const compile = async () => {
    setError("");
    setCompiling(true);
    setSuggestions([]);
    try { setCompiled(await compileMandate(persona.id, text)); }
    catch (caught) { setError(errorText(caught, "Couldn't translate these rules.")); }
    finally { setCompiling(false); }
  };
  const explain = async () => {
    if (!compiled?.notUnderstood.length) return;
    setExplaining(true);
    setError("");
    try { setSuggestions((await explainMandate(persona.id, compiled.notUnderstood)).suggestions); }
    catch (caught) { setError(errorText(caught, "Couldn't get help with those sentences.")); }
    finally { setExplaining(false); }
  };
  const sign = () => {
    if (!compiled) return;
    const signedText = text;
    requestPin("Sign your rules", async (pin) => {
      const result = await signMandate(persona.id, signedText, pin);
      setMandate(result);
      setText(result.naturalLanguage);
      setCompiled(null);
      setError("The agent will follow these rules from now on.");
    });
  };
  const applyRewrite = (original: string, rewrite: string) => {
    setText((current) => current.replace(original, rewrite));
    setCompiled(null);
    setSuggestions([]);
  };
  return <div className="page-stack feature-page">
    <FeatureHeader eyebrow="YOUR MONEY, YOUR RULES" title="Rules" subtitle="Write rules in plain English. Check exactly what they mean before signing." />
    {error && <div className="notice-card" role={error.includes("Couldn't") ? "alert" : "status"}>{error}</div>}
    <section className="surface rules-panel">
      <div className="section-heading"><div><span className="eyebrow">STEP 1</span><h2>Write your rules</h2></div></div>
      {loading ? <div className="panel-state"><span className="spinner" />Loading current rules…</div> : <textarea className="rules-editor" maxLength={2000} value={text} onChange={(event) => { setText(event.target.value); setCompiled(null); setSuggestions([]); }} aria-label="Rules in plain English" />}
      <div className="rules-controls"><button className="button button-primary" disabled={loading || compiling || !text.trim()} onClick={() => void compile()}>{compiling ? "Translating your rules…" : "Translate into rules"}</button><span>Your text is editable until you sign.</span></div>
    </section>
    {compiled && <section className="surface rules-panel">
      <div className="section-heading"><div><span className="eyebrow">STEP 2</span><h2>Check what they mean</h2></div></div>
      {compiled.summary.length ? <ul className="rule-summary">{compiled.summary.map((item) => <li key={item}>{item}</li>)}</ul> : <EmptyFeature title="No rules were understood yet." detail="Try a more specific sentence or ask for help with the wording." />}
      {compiled.warnings.map((warning) => <div className="warning-box" key={warning}><span className="warning-dot" /><p>{warning}</p></div>)}
      {compiled.notUnderstood.length > 0 && <div className="rule-help"><p>Some sentences could not be translated into enforceable rules. AI help suggests wording only; nothing is applied unless you review and sign it.</p><button className="button button-secondary" disabled={explaining} onClick={() => void explain()}>{explaining ? "Getting help…" : "Get help"}</button></div>}
      {suggestions.map((suggestion, index) => <article className="suggestion-card" key={`${suggestion.original}-${index}`}>
        <strong>{suggestion.original}</strong><p>{suggestion.explanation}</p>
        {suggestion.rewrite && <><p className="rewrite-text">{suggestion.rewrite}</p>{suggestion.summary.map((item) => <small key={item}>{item}</small>)}{suggestion.warnings.map((warning) => <div className="warning-box" key={warning}>{warning}</div>)}<button className="text-button" onClick={() => applyRewrite(suggestion.original, suggestion.rewrite!)}>Use this</button></>}
      </article>)}
      <button className="text-button technical-toggle" aria-expanded={showPolicy} onClick={() => setShowPolicy((value) => !value)}>{showPolicy ? "Hide" : "Show"} technical version</button>
      {showPolicy && <pre className="policy-json">{JSON.stringify(compiled.policy, null, 2)}</pre>}
      <div className="rules-controls"><button className="button button-secondary" onClick={() => setCompiled(null)}>Edit text</button><button className="button button-primary" disabled={!compiled.summary.length} onClick={sign}>Sign rules</button></div>
    </section>}
    {mandate && <section className="surface current-rules"><span className="eyebrow">CURRENT SIGNED RULES · VERSION {mandate.version}</span><p>{mandate.naturalLanguage}</p><small>{mandate.signedAt ? `Signed ${new Date(mandate.signedAt).toLocaleString()}` : "Not signed yet"}</small><ul>{mandate.summary.map((item) => <li key={item}>{item}</li>)}</ul></section>}
  </div>;
}
