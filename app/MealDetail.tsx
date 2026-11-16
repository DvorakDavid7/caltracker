"use client";

import { useState } from "react";
import { itemValues, MAX_GRAMS, sumItems, type MealItem } from "@/lib/items";

type Meal = {
  id: number;
  description: string;
  items: MealItem[];
};

const fmt = (n: number) => String(Math.round(n));

/** Ingredient breakdown with editable weights. Values update live; saving recomputes the meal. */
export default function MealDetail<M extends Meal>({
  meal,
  onSaved,
  onUnauthorized,
}: {
  meal: M;
  onSaved: (meal: M) => void;
  onUnauthorized: (res: Response) => void;
}) {
  const initial = () => Object.fromEntries(meal.items.map((i) => [i.id, String(i.grams)]));
  const [grams, setGrams] = useState<Record<number, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (meal.items.length === 0) {
    return (
      <div className="detail">
        <p className="detail-desc">Zadáno: {meal.description}</p>
        <p className="detail-empty">Toto jídlo bylo přidáno dřív, rozpad na ingredience není k dispozici.</p>
      </div>
    );
  }

  const parsed = (id: number) => {
    const v = Number(grams[id]?.replace(",", "."));
    return Number.isFinite(v) && v >= 0 && v <= MAX_GRAMS ? v : null;
  };
  const invalid = meal.items.some((i) => parsed(i.id) === null);
  const live = meal.items.map((i) => ({ ...i, grams: parsed(i.id) ?? 0 }));
  const totals = sumItems(live);
  const changes = meal.items
    .filter((i) => parsed(i.id) !== null && Math.round(parsed(i.id)!) !== i.grams)
    .map((i) => ({ id: i.id, grams: Math.round(parsed(i.id)!) }));
  const dirty = changes.length > 0;

  async function save() {
    if (!dirty || invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meals/${meal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: changes }),
      });
      onUnauthorized(res);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved(data.meal);
      setGrams(Object.fromEntries((data.meal as M).items.map((i) => [i.id, String(i.grams)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodařilo se uložit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="detail">
      <p className="detail-desc">Zadáno: {meal.description}</p>
      <ul className="detail-items">
        {live.map((i) => {
          const v = itemValues(i);
          const bad = parsed(i.id) === null;
          return (
            <li key={i.id} className="detail-item">
              <span className="detail-food">{i.food}</span>
              <label className={`detail-grams${bad ? " invalid" : ""}`}>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Gramy: ${i.food}`}
                  value={grams[i.id] ?? ""}
                  onChange={(e) => setGrams((g) => ({ ...g, [i.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                  disabled={saving}
                />
                g
              </label>
              <span className="detail-kcal">{fmt(v.kcal)} kcal</span>
              <span className="detail-macros">
                B {fmt(v.protein)} · T {fmt(v.fat)} · S {fmt(v.carbs)} g
              </span>
            </li>
          );
        })}
      </ul>

      <div className="detail-total">
        <span>Celkem</span>
        <b>{totals.kcal} kcal</b>
        <span className="detail-macros">
          B {totals.protein} · T {totals.fat} · S {totals.carbs} g
        </span>
      </div>

      {error && <p className="error inline">{error}</p>}
      {(dirty || invalid) && (
        <div className="detail-actions">
          <button type="button" className="secondary" onClick={() => setGrams(initial())} disabled={saving}>
            Zrušit
          </button>
          <button type="button" className="primary" onClick={save} disabled={saving || invalid}>
            {saving ? "Ukládám…" : "Uložit"}
          </button>
        </div>
      )}
    </div>
  );
}
