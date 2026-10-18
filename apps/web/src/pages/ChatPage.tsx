import { useEffect, useRef, useState, type FormEvent } from "react";
import { Action as ActionSchema, type Action, type Persona } from "@mandate/shared";
import { decideAction } from "../lib/api";
import { streamChat } from "../lib/sse";

import { errorText, FeatureHeader } from "./shared";
import { ActionCard } from "./ActionCard";

type ChatMessage = {
  id: number;
  speaker: "you" | "agent";
  text: string;
  tools: string[];
  actions: Action[];
  busy?: boolean;
  error?: string;
};

export function ChatPage({ persona, onApprove, onRefresh }: {
  persona: Persona;
  onApprove: (action: Action) => void;
  onRefresh: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const nextId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestions = [
    "How am I doing this month?",
    "Can I afford a $60 ticket?",
    "Plan for a car in 2 years",
    "Which subscriptions should I cancel?",
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => { setMessages([]); setDraft(""); }, [persona.id]);
  useEffect(() => {
    const onActionUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      try {
        const updated = ActionSchema.parse(event.detail);
        setMessages((current) => current.map((item) => ({
          ...item,
          actions: item.actions.map((action) => action.id === updated.id ? updated : action),
        })));
      } catch (caught) {
        setError(errorText(caught, "Couldn't update the action status."));
      }
    };
    window.addEventListener("moneywise:action-updated", onActionUpdated);
    return () => window.removeEventListener("moneywise:action-updated", onActionUpdated);
  }, []);

  const send = async (event?: FormEvent, message = draft) => {
    event?.preventDefault();
    const content = message.trim();
    if (!content || sending) return;
    setError("");
    setDraft("");
    setSending(true);
    const userId = nextId.current++;
    const agentId = nextId.current++;
    setMessages((current) => [
      ...current,
      { id: userId, speaker: "you", text: content, tools: [], actions: [] },
      { id: agentId, speaker: "agent", text: "", tools: [], actions: [], busy: true },
    ]);
    try {
      await streamChat(persona.id, content, (event) => {
        if (event.type === "text") {
          setMessages((current) => current.map((item) => item.id === agentId ? { ...item, text: item.text + event.delta } : item));
        } else if (event.type === "tool") {
          setMessages((current) => current.map((item) => item.id === agentId
            ? { ...item, tools: [...item.tools.filter((tool) => tool !== event.name), `${event.status === "running" ? "Checking" : "Checked"}: ${event.name.replaceAll("_", " ")}`] }
            : item));
        } else if (event.type === "action") {
          setMessages((current) => current.map((item) => item.id === agentId ? { ...item, actions: [...item.actions, event.action] } : item));
          if (event.action.source === "untrusted") window.dispatchEvent(new CustomEvent("moneywise:untrusted"));
          onRefresh();
        } else if (event.type === "error") {
          setMessages((current) => current.map((item) => item.id === agentId ? { ...item, error: event.error } : item));
          if (event.error.toLowerCase().includes("sign in") || event.error.includes("401")) window.dispatchEvent(new Event("moneywise:unauthorized"));
        } else if (event.type === "done") {
          setMessages((current) => current.map((item) => item.id === agentId ? { ...item, busy: false } : item));
        }
      });
    } catch (caught) {
      setMessages((current) => current.map((item) => item.id === agentId
        ? { ...item, error: errorText(caught, "The reply was interrupted."), busy: false }
        : item));
    } finally {
      setSending(false);
    }
  };
  const reject = async (action: Action) => {
    try {
      const result = await decideAction(action.id, "reject");
      setMessages((current) => current.map((item) => ({
        ...item,
        actions: item.actions.map((candidate) => candidate.id === action.id ? result : candidate),
      })));
      onRefresh();
    } catch (caught) { setError(errorText(caught, "Couldn't decline this action.")); }
  };

  return <div className="page-stack feature-page">
    <FeatureHeader eyebrow="MONEYWISE ASSISTANT" title="Chat" subtitle="Ask about your money. The agent explains its reasoning and your rules decide what can happen." />
    <section className="surface chat-panel">
      <div className="chat-messages" aria-live="polite">
        {!messages.length && <div className="chat-welcome"><span className="plan-orbit">✦</span><h2>How can I help?</h2><p>Ask a question about your balances, bills, budget, or savings wishes.</p><div className="chat-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(undefined, suggestion)}>{suggestion}</button>)}</div></div>}
        {messages.map((item) => <div className={`chat-message message-${item.speaker}`} key={item.id}>
          <span className="message-label">{item.speaker === "you" ? "You" : "Agent · suggestions are checked against your rules"}</span>
          {item.tools.map((tool, index) => <small className="tool-trace" key={`${tool}-${index}`}>{tool}</small>)}
          {item.text && <p className="message-bubble">{item.text}</p>}
          {item.busy && !item.text && <p className="message-bubble"><span className="spinner" /> Thinking…</p>}
          {item.error && <p className="inline-error" role="alert">{item.error} You can try again.</p>}
          {item.actions.map((action) => <ActionCard key={action.id} action={action} onApprove={onApprove} onReject={reject} />)}
          {item.busy && item.text && <span className="streaming-indicator">Writing…</span>}
        </div>)}
        <div ref={bottomRef} />
      </div>
      {error && <div className="form-error-banner" role="alert">{error}</div>}
      <form className="chat-compose" onSubmit={(event) => void send(event)}>
        <label className="sr-only" htmlFor="chat-input">Ask anything about your money</label>
        <textarea id="chat-input" rows={2} maxLength={2000} placeholder="Ask anything about your money…" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={sending} />
        <button className="button button-primary" type="submit" disabled={sending || !draft.trim()}>{sending ? "Sending…" : "Send"}</button>
      </form>
    </section>
  </div>;
}
