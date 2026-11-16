"use client";

import Link from "next/link";
import { useState } from "react";

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Přihlášení",
    submit: "Přihlásit se",
    busy: "Přihlašuji…",
    switchText: "Nemáš účet?",
    switchLink: "Zaregistruj se",
    switchHref: "/register",
  },
  register: {
    title: "Registrace",
    submit: "Vytvořit účet",
    busy: "Vytvářím účet…",
    switchText: "Už máš účet?",
    switchLink: "Přihlas se",
    switchHref: "/login",
  },
} as const;

export default function AuthForm({ mode }: { mode: Mode }) {
  const t = COPY[mode];
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === "register" && password !== confirm) {
      setError("Hesla se neshodují");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { username: username.trim(), email: email.trim(), password }
            : { username: username.trim(), password }
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Něco se pokazilo");
      }
      // Full navigation so the server renders the tracker with the new session.
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Něco se pokazilo");
      setBusy(false);
    }
  }

  return (
    <main className="screen auth">
      <h1 className="auth-brand">CalTracker</h1>
      <form className="auth-card" onSubmit={submit}>
        <h2>{t.title}</h2>

        <label>
          Uživatelské jméno
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={3}
            maxLength={32}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
        </label>

        {mode === "register" && (
          <label>
            E-mail
            <input
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
        )}

        <label>
          Heslo
          <input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : undefined}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>

        {mode === "register" && (
          <label>
            Heslo znovu
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
        )}

        {mode === "register" && <p className="auth-hint">Heslo alespoň 8 znaků. Registrace je jen pro povolené e-maily.</p>}
        {error && <p className="error inline" role="alert">{error}</p>}

        <button type="submit" className="primary auth-submit" disabled={busy}>
          {busy ? t.busy : t.submit}
        </button>

        <p className="auth-switch">
          {t.switchText} <Link href={t.switchHref}>{t.switchLink}</Link>
        </p>
      </form>
    </main>
  );
}
