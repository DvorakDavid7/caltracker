"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MacroRing from "./MacroRing";

type Meal = {
  id: number;
  name: string;
  description: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Home() {
  const [date, setDate] = useState<string>("");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/meals?date=${d}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMeals(data.meals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst jídla");
    } finally {
      setLoading(false);
    }
  }, []);

  // Determine "today" on the client so it follows the user's timezone,
  // and roll over if the app is left open past midnight.
  useEffect(() => {
    const tick = () => setDate((prev) => (prev === localDate() ? prev : localDate()));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (date) load(date);
  }, [date, load]);

  useEffect(() => {
    if (sheetOpen) inputRef.current?.focus();
  }, [sheetOpen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const description = input.trim();
    if (!description || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMeals((m) => [...m, data.meal]);
      setInput("");
      setSheetOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodařilo se přidat jídlo");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(meal: Meal) {
    if (!confirm(`Smazat „${meal.name}“?`)) return;
    const prev = meals;
    setMeals((m) => m.filter((x) => x.id !== meal.id));
    const res = await fetch(`/api/meals/${meal.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      setMeals(prev);
      setError("Nepodařilo se smazat jídlo");
    }
  }

  const totals = meals.reduce(
    (t, m) => ({
      kcal: t.kcal + m.kcal,
      protein: t.protein + m.protein,
      fat: t.fat + m.fat,
      carbs: t.carbs + m.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );

  return (
    <main className="screen">
      <header className="summary">
        <p className="summary-label">Celkový příjem kalorií</p>
        <MacroRing {...totals} />
        <ul className="legend">
          <li><span className="dot protein" />Bílkoviny <b>{totals.protein} g</b></li>
          <li><span className="dot fat" />Tuky <b>{totals.fat} g</b></li>
          <li><span className="dot carbs" />Sacharidy <b>{totals.carbs} g</b></li>
        </ul>
      </header>

      {error && !sheetOpen && (
        <div className="error" role="alert" onClick={() => setError(null)}>{error}</div>
      )}

      <section className="meals">
        {loading ? (
          <p className="empty">Načítám…</p>
        ) : meals.length === 0 ? (
          <p className="empty">Zatím žádné jídlo. Přidej první tlačítkem +.</p>
        ) : (
          <ul>
            {meals.map((m) => (
              <li key={m.id} className="meal" title={m.description}>
                <span className="meal-name">{m.name}</span>
                <span className="meal-kcal">{m.kcal} kcal</span>
                <button className="meal-delete" aria-label={`Smazat ${m.name}`} onClick={() => remove(m)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="fab" aria-label="Přidat jídlo" onClick={() => { setError(null); setSheetOpen(true); }}>
        +
      </button>

      {sheetOpen && (
        <div className="backdrop" onClick={() => !submitting && setSheetOpen(false)}>
          <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h2>Přidat jídlo</h2>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) submit(e);
              }}
              placeholder="např. 3 míchaná vajíčka a rohlík"
              rows={3}
              maxLength={500}
              disabled={submitting}
            />
            {error && <p className="error inline">{error}</p>}
            <div className="sheet-actions">
              <button type="button" className="secondary" onClick={() => setSheetOpen(false)} disabled={submitting}>
                Zrušit
              </button>
              <button type="submit" className="primary" disabled={submitting || !input.trim()}>
                {submitting ? "AI počítá…" : "Přidat"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
