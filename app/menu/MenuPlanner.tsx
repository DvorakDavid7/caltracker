"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Menu } from "@/lib/db";
import { itemValues } from "@/lib/items";
import { MENU_LIMITS, type MenuRequest, type PlannedDay, type PlannedMeal } from "@/lib/menu-types";
import { handleUnauthorized, localDate } from "../client-utils";

type MenuSummary = Omit<Menu, "plan">;
type View = { kind: "list" } | { kind: "form" } | { kind: "detail"; id: number };

type FormState = {
  days: string;
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  slots: string[];
  requirements: string;
};

const DEFAULT_FORM: FormState = {
  days: "7",
  kcal: "2200",
  protein: "150",
  fat: "70",
  carbs: "240",
  slots: ["Snídaně", "Oběd", "Večeře"],
  requirements: "",
};

const POLL_MS = 4000;

function formFromRequest(r: MenuRequest): FormState {
  const s = (v: number | null) => (v === null ? "" : String(v));
  return {
    days: String(r.days),
    kcal: String(r.kcal),
    protein: s(r.protein),
    fat: s(r.fat),
    carbs: s(r.carbs),
    slots: [...r.slots],
    requirements: r.requirements,
  };
}

function describe(r: MenuRequest) {
  const days = r.days === 1 ? "1 den" : r.days < 5 ? `${r.days} dny` : `${r.days} dní`;
  return `${days} · ${r.kcal} kcal · ${r.slots.length}× denně`;
}

function formatCreated(utc: string) {
  const d = new Date(utc.replace(" ", "T") + "Z");
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" }) +
    " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  handleUnauthorized(res);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Něco se pokazilo");
  return data as T;
}

export default function MenuPlanner() {
  const [view, setViewState] = useState<View>({ kind: "list" });
  const [menus, setMenus] = useState<MenuSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the open menu in the URL (?id=…) so a reload comes back to it.
  const setView = useCallback((v: View) => {
    setViewState(v);
    setError(null);
    const url = v.kind === "detail" ? `/menu?id=${v.id}` : "/menu";
    window.history.replaceState(null, "", url);
  }, []);

  const loadList = useCallback(async () => {
    try {
      setMenus((await api<{ menus: MenuSummary[] }>("/api/menus")).menus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst jídelníčky");
    }
  }, []);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (Number.isInteger(id) && id > 0) setViewState({ kind: "detail", id });
    loadList();
  }, [loadList]);

  return (
    <main className="screen">
      <nav className="topbar">
        {view.kind === "list" ? (
          <Link className="topbar-back" href="/">‹ Přehled</Link>
        ) : (
          <button className="topbar-back" onClick={() => { setView({ kind: "list" }); loadList(); }}>
            ‹ Jídelníčky
          </button>
        )}
      </nav>

      {error && <div className="error" role="alert" onClick={() => setError(null)}>{error}</div>}

      {view.kind === "list" && (
        <MenuList
          menus={menus}
          onNew={() => setView({ kind: "form" })}
          onOpen={(id) => setView({ kind: "detail", id })}
        />
      )}
      {view.kind === "form" && (
        <MenuForm
          initial={menus?.[0] ? formFromRequest(menus[0].request) : DEFAULT_FORM}
          onCreated={(m) => { setMenus((all) => [m, ...(all ?? [])]); setView({ kind: "detail", id: m.id }); }}
        />
      )}
      {view.kind === "detail" && (
        <MenuDetail
          key={view.id}
          id={view.id}
          onDeleted={() => { setMenus((all) => all?.filter((m) => m.id !== view.id) ?? null); setView({ kind: "list" }); }}
          onRetry={() => setView({ kind: "form" })}
          onError={setError}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

function MenuList({
  menus,
  onNew,
  onOpen,
}: {
  menus: MenuSummary[] | null;
  onNew: () => void;
  onOpen: (id: number) => void;
}) {
  return (
    <section>
      <div className="menu-head">
        <h1>Jídelníčky</h1>
        <button className="primary menu-new" onClick={onNew}>+ Nový</button>
      </div>
      {menus === null ? (
        <p className="empty">Načítám…</p>
      ) : menus.length === 0 ? (
        <p className="empty">Zatím žádný jídelníček. Nech AI sestavit první.</p>
      ) : (
        <ul className="menu-list">
          {menus.map((m) => (
            <li key={m.id}>
              <button className="menu-row" onClick={() => onOpen(m.id)}>
                <span className="menu-row-main">
                  <b>{describe(m.request)}</b>
                  <span className="menu-row-sub">
                    {formatCreated(m.createdAt)}
                    {m.request.requirements && ` · ${m.request.requirements}`}
                  </span>
                </span>
                <span className={`menu-status ${m.status}`}>
                  {m.status === "pending" ? "Sestavuji…" : m.status === "error" ? "Chyba" : "›"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function MenuForm({ initial, onCreated }: { initial: FormState; onCreated: (m: MenuSummary) => void }) {
  const [f, setF] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  // Warn when the macros don't add up to the calories (4/9/4 kcal per gram).
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const p = num(f.protein), fa = num(f.fat), c = num(f.carbs), kcal = num(f.kcal);
  const macroKcal = p !== null && fa !== null && c !== null ? Math.round(p * 4 + fa * 9 + c * 4) : null;
  const mismatch = macroKcal !== null && kcal ? Math.abs(macroKcal - kcal) / kcal > 0.08 : false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { menu } = await api<{ menu: MenuSummary }>("/api/menus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: num(f.days),
          kcal,
          protein: p,
          fat: fa,
          carbs: c,
          slots: f.slots,
          requirements: f.requirements,
        }),
      });
      onCreated(menu);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodařilo se spustit sestavení");
      setSubmitting(false);
    }
  }

  return (
    <form className="menu-form" onSubmit={submit}>
      <h1>Nový jídelníček</h1>

      <div className="field-row">
        <label className="field">
          Počet dní
          <input type="number" inputMode="numeric" min={MENU_LIMITS.days.min} max={MENU_LIMITS.days.max}
            value={f.days} onChange={(e) => set({ days: e.target.value })} required />
        </label>
        <label className="field">
          Kalorie / den
          <input type="number" inputMode="numeric" min={MENU_LIMITS.kcal.min} max={MENU_LIMITS.kcal.max}
            value={f.kcal} onChange={(e) => set({ kcal: e.target.value })} required />
        </label>
      </div>

      <fieldset className="field-group">
        <legend>Makra / den (g) <span className="hint">prázdné = nechá na AI</span></legend>
        <div className="field-row three">
          <label className="field"><span><span className="dot protein" /> Bílkoviny</span>
            <input type="number" inputMode="numeric" min={0} max={MENU_LIMITS.macro.max}
              value={f.protein} onChange={(e) => set({ protein: e.target.value })} />
          </label>
          <label className="field"><span><span className="dot fat" /> Tuky</span>
            <input type="number" inputMode="numeric" min={0} max={MENU_LIMITS.macro.max}
              value={f.fat} onChange={(e) => set({ fat: e.target.value })} />
          </label>
          <label className="field"><span><span className="dot carbs" /> Sacharidy</span>
            <input type="number" inputMode="numeric" min={0} max={MENU_LIMITS.macro.max}
              value={f.carbs} onChange={(e) => set({ carbs: e.target.value })} />
          </label>
        </div>
        {macroKcal !== null && (
          <p className={`hint${mismatch ? " warn" : ""}`}>
            Makra dávají {macroKcal} kcal{mismatch ? ` – neodpovídá cíli ${kcal} kcal, AI dá přednost makrům` : ""}
          </p>
        )}
      </fieldset>

      <fieldset className="field-group">
        <legend>Jídla během dne</legend>
        <ol className="slots">
          {f.slots.map((s, i) => (
            <li key={i}>
              <input
                value={s}
                maxLength={MENU_LIMITS.slotLength}
                placeholder="např. Před tréninkem"
                aria-label={`Jídlo ${i + 1}`}
                onChange={(e) => set({ slots: f.slots.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              <button type="button" className="slot-remove" aria-label="Odebrat"
                disabled={f.slots.length <= MENU_LIMITS.slots.min}
                onClick={() => set({ slots: f.slots.filter((_, j) => j !== i) })}>×</button>
            </li>
          ))}
        </ol>
        {f.slots.length < MENU_LIMITS.slots.max && (
          <button type="button" className="secondary slot-add" onClick={() => set({ slots: [...f.slots, ""] })}>
            + Přidat jídlo
          </button>
        )}
      </fieldset>

      <label className="field">
        Zvláštní požadavky
        <textarea
          rows={3}
          maxLength={MENU_LIMITS.requirements}
          value={f.requirements}
          onChange={(e) => set({ requirements: e.target.value })}
          placeholder="např. vařit jen jedno jídlo denně, bez ryb, snídaně do 5 minut"
        />
      </label>

      {error && <p className="error inline">{error}</p>}
      <button type="submit" className="primary menu-submit" disabled={submitting}>
        {submitting ? "Odesílám…" : "Sestavit jídelníček"}
      </button>
      <p className="hint center">Sestavení trvá obvykle 1–3 minuty. Můžeš mezitím odejít.</p>
    </form>
  );
}

// ---------------------------------------------------------------------------

function MenuDetail({
  id,
  onDeleted,
  onRetry,
  onError,
}: {
  id: number;
  onDeleted: () => void;
  onRetry: () => void;
  onError: (msg: string) => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [day, setDay] = useState(0);
  const [tab, setTab] = useState<"days" | "shopping">("days");

  // Poll while the AI is still working on it.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const { menu } = await api<{ menu: Menu }>(`/api/menus/${id}`);
        if (cancelled) return;
        setMenu(menu);
        if (menu.status === "pending") timer = setTimeout(load, POLL_MS);
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : "Nepodařilo se načíst jídelníček");
      }
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, onError]);

  async function remove() {
    if (!confirm("Smazat tento jídelníček?")) return;
    try {
      await api(`/api/menus/${id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Nepodařilo se smazat");
    }
  }

  if (!menu) return <p className="empty">Načítám…</p>;
  const r = menu.request;

  return (
    <section className="menu-detail">
      <div className="menu-head">
        <div>
          <h1>Jídelníček</h1>
          <p className="menu-row-sub">{describe(r)}{r.requirements && ` · ${r.requirements}`}</p>
        </div>
        <button className="secondary menu-delete" onClick={remove}>Smazat</button>
      </div>

      {menu.status === "pending" && (
        <div className="menu-pending">
          <span className="spinner" aria-hidden />
          <p>AI sestavuje jídelníček… obvykle 1–3 minuty. Stránku můžeš zavřít, výsledek se uloží.</p>
        </div>
      )}

      {menu.status === "error" && (
        <div className="menu-pending">
          <p className="error inline">{menu.error}</p>
          <button className="primary" onClick={onRetry}>Zkusit znovu</button>
        </div>
      )}

      {menu.status === "ready" && menu.plan && (
        <>
          {menu.plan.notes && <p className="menu-notes">{menu.plan.notes}</p>}

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "days"} className={tab === "days" ? "on" : ""} onClick={() => setTab("days")}>
              Jídla
            </button>
            <button role="tab" aria-selected={tab === "shopping"} className={tab === "shopping" ? "on" : ""} onClick={() => setTab("shopping")}>
              Nákupní seznam
            </button>
          </div>

          {tab === "days" ? (
            <>
              {menu.plan.days.length > 1 && (
                <div className="day-chips">
                  {menu.plan.days.map((_, i) => (
                    <button key={i} className={i === day ? "on" : ""} onClick={() => setDay(i)}>Den {i + 1}</button>
                  ))}
                </div>
              )}
              <DayView menuId={menu.id} dayIndex={day} day={menu.plan.days[day]} request={r} />
            </>
          ) : (
            <ShoppingList menuId={menu.id} items={menu.plan.shopping} />
          )}
        </>
      )}
    </section>
  );
}

function Delta({ actual, target, unit }: { actual: number; target: number | null; unit: string }) {
  if (target === null) return <b>{actual} {unit}</b>;
  const off = target ? (actual - target) / target : 0;
  const cls = Math.abs(off) <= 0.05 ? "ok" : Math.abs(off) <= 0.1 ? "near" : "off";
  return (
    <b className={`delta ${cls}`} title={`Cíl ${target} ${unit}`}>
      {actual}<span className="target"> / {target} {unit}</span>
    </b>
  );
}

function DayView({ menuId, dayIndex, day, request }: { menuId: number; dayIndex: number; day: PlannedDay; request: MenuRequest }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="day-totals">
        <span>Kalorie <Delta actual={day.kcal} target={request.kcal} unit="kcal" /></span>
        <span><span className="dot protein" /> B <Delta actual={day.protein} target={request.protein} unit="g" /></span>
        <span><span className="dot fat" /> T <Delta actual={day.fat} target={request.fat} unit="g" /></span>
        <span><span className="dot carbs" /> S <Delta actual={day.carbs} target={request.carbs} unit="g" /></span>
      </div>
      <ul className="meals-list">
        {day.meals.map((m, i) => (
          <li key={`${dayIndex}-${i}`} className={`meal-card${open === i ? " open" : ""}`}>
            <div className="meal">
              <button className="meal-toggle" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                <span className="meal-name">
                  <span className="meal-slot">{m.slot}</span>
                  {m.name}
                </span>
                <span className="meal-kcal">{m.kcal} kcal</span>
                <span className="meal-chevron" aria-hidden>›</span>
              </button>
            </div>
            {open === i && <PlannedMealDetail menuId={menuId} dayIndex={dayIndex} mealIndex={i} meal={m} />}
          </li>
        ))}
      </ul>
    </>
  );
}

function PlannedMealDetail({ menuId, dayIndex, mealIndex, meal }: { menuId: number; dayIndex: number; mealIndex: number; meal: PlannedMeal }) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function log() {
    setState("saving");
    setError(null);
    try {
      await api(`/api/menus/${menuId}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: dayIndex, meal: mealIndex, date: localDate() }),
      });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodařilo se přidat");
      setState("idle");
    }
  }

  const fmt = (n: number) => String(Math.round(n));
  return (
    <div className="detail">
      {meal.prep && <p className="detail-desc">{meal.prep}</p>}
      <ul className="detail-items">
        {meal.items.map((i, k) => {
          const v = itemValues(i);
          return (
            <li key={k} className="detail-item">
              <span className="detail-food">{i.food}</span>
              <span className="detail-grams">{i.grams} g</span>
              <span className="detail-kcal">{fmt(v.kcal)} kcal</span>
              <span className="detail-macros">B {fmt(v.protein)} · T {fmt(v.fat)} · S {fmt(v.carbs)} g</span>
            </li>
          );
        })}
      </ul>
      <div className="detail-total">
        <span>Celkem</span>
        <b>{meal.kcal} kcal</b>
        <span className="detail-macros">B {meal.protein} · T {meal.fat} · S {meal.carbs} g</span>
      </div>
      {error && <p className="error inline">{error}</p>}
      <div className="detail-actions">
        <button className="primary" onClick={log} disabled={state !== "idle"}>
          {state === "done" ? "✓ Přidáno do dneška" : state === "saving" ? "Přidávám…" : "Snědl jsem – přidat do dneška"}
        </button>
      </div>
    </div>
  );
}

function ShoppingList({ menuId, items }: { menuId: number; items: { food: string; amount: string }[] }) {
  // Ticked items are a per-device convenience, so localStorage is enough.
  const key = `caltracker:shopping:${menuId}`;
  const [done, setDone] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      setDone(new Set(JSON.parse(localStorage.getItem(key) ?? "[]")));
    } catch {}
  }, [key]);
  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDone(next);
    try { localStorage.setItem(key, JSON.stringify([...next])); } catch {}
  };

  if (items.length === 0) return <p className="empty">Nákupní seznam je prázdný.</p>;
  return (
    <ul className="shopping">
      {items.map((s, i) => (
        <li key={i} className={done.has(i) ? "done" : ""}>
          <label>
            <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} />
            <span className="shopping-food">{s.food}</span>
            <span className="shopping-amount">{s.amount}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
