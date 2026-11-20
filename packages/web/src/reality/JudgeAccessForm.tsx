import { useRef, useState, type FormEvent } from "react";

export function JudgeAccessForm({ onAccess }: { onAccess: () => void }) {
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !field.current) return;
    const code = field.current.value.trim();
    field.current.value = "";
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/judge/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) onAccess();
      else if (response.status === 401) setError("That access code is invalid or expired.");
      else if (response.status === 429) setError("Too many sign-in attempts. Try again in a minute.");
      else setError("Judge access is temporarily unavailable.");
    } catch {
      setError("Judge access is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="name-path" onSubmit={(event) => void submit(event)} data-testid="judge-access">
      <label className="small">
        Judge access code
        <input ref={field} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40} required />
      </label>
      <button className="btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Unlock AI"}</button>
      {error && <p className="field-error small" role="status">{error}</p>}
    </form>
  );
}
