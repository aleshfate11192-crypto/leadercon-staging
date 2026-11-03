"use client";

import { useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { demoMode, supabase } from "@/lib/supabase";

type Answer = { answer: string; sourceRefs: string[]; caveats: string[] };
type Message = { question: string; answer?: Answer; error?: string; createdAt: string };
const suggestions = ["Which vendors have the largest outstanding balances?", "Summarize recent posted payments and invoices.", "Which active projects have budget and contract values recorded?", "What should I review in the current accounts data?"];

export default function AssistantPage() {
  const { organization } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(value: string) {
    const prompt = value.trim();
    if (!organization || !prompt || busy) return;
    setBusy(true); setError(""); setQuestion("");
    const message: Message = { question: prompt, createdAt: new Date().toISOString() };
    setMessages((current) => [message, ...current]);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.session.access_token }, body: JSON.stringify({ task: "assistant", organizationId: organization.id, question: prompt }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The assistant request failed.");
      setMessages((current) => current.map((item) => item.createdAt === message.createdAt ? { ...item, answer: payload.result as Answer } : item));
    } catch (cause) {
      const messageText = cause instanceof Error ? cause.message : "The assistant request failed.";
      setMessages((current) => current.map((item) => item.createdAt === message.createdAt ? { ...item, error: messageText } : item));
      setError(messageText);
    } finally { setBusy(false); }
  }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Insights · AI assistant</p><h1>Accounts Assistant</h1><p>Ask questions about authorized workspace records. Financial balances come from deterministic database calculations.</p></div></div>
    {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(270px, .65fr)", alignItems: "start" }}>
      <section className="panel"><div className="panel-header"><div><h2>Ask about this workspace</h2><p>Each request uses the current workspace snapshot and does not post or change records.</p></div><span className="chip">Private scope check</span></div>
        <form className="panel-body" onSubmit={(event) => { event.preventDefault(); void ask(question); }}><label className="field">Question<textarea className="textarea" rows={4} maxLength={1500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about vendor balances, recent payments, or project records…" /></label><div className="form-actions"><span className="muted">AI output is an explanation, not an accounting entry.</span><button className="button button-primary" disabled={busy || !question.trim()}>{busy ? "Thinking…" : "Ask assistant"}</button></div></form>
        {messages.length > 0 && <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}><div className="stack">{messages.map((message) => <article key={message.createdAt} className="assistant-message"><p className="eyebrow">You asked</p><h3>{message.question}</h3>{message.error && <p className="alert alert-error">{message.error}</p>}{message.answer ? <><p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{message.answer.answer}</p>{message.answer.sourceRefs.length > 0 && <div className="source-ref"><strong>Sources:</strong> {message.answer.sourceRefs.join(" · ")}</div>}{message.answer.caveats.length > 0 && <div className="alert alert-info" style={{ marginTop: 10 }}><strong>Limitations</strong><ul>{message.answer.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}</ul></div>}</> : !message.error && <p className="muted">{busy ? "Reading current workspace records…" : "No response yet."}</p>}</article>)}</div></div>}
      </section>
      <div className="stack"><section className="panel"><div className="panel-header"><div><h2>Suggested questions</h2><p>Start from common accounts tasks.</p></div></div><div className="panel-body">{suggestions.map((item) => <button key={item} className="quick-link" style={{ width: "100%", border: 0, background: "transparent", textAlign: "left" }} onClick={() => void ask(item)} disabled={busy}><span className="quick-link-icon">✦</span>{item}</button>)}</div></section>
        <section className="panel"><div className="panel-header"><div><h2>Data and limitations</h2></div></div><div className="panel-body"><ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.8, marginTop: 0 }}><li>Balances use the complete posted vendor ledger.</li><li>Recent transaction detail is limited to the latest records supplied with the request.</li><li>{demoMode ? "AI is disabled in local demo mode; no workspace data is sent to a provider." : "The configured AI provider receives the question and workspace context."}</li><li>AI may explain records but cannot post payments, approvals, or accounting changes.</li></ul></div></section></div>
    </div>
    <p className="credit-line">AI features require a server-side OPENAI_API_KEY. No key is exposed to the browser.</p>
  </div>;
}
