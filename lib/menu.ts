import { z } from "zod";
import { MAX_GRAMS, sumItems, type MealItemInput, type Totals } from "./items";
import { MENU_LIMITS, type MenuPlan, type MenuRequest, type PlannedDay, type PlannedMeal } from "./menu-types";
import { selectProvider } from "./nutrition";

/** Validates untrusted input. Returns the cleaned request or an error message. */
export function parseMenuRequest(body: unknown): MenuRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const L = MENU_LIMITS;
  const int = (v: unknown) => (typeof v === "number" || typeof v === "string") && v !== "" ? Number(v) : NaN;

  const days = int(b.days);
  if (!Number.isInteger(days) || days < L.days.min || days > L.days.max) {
    return `Počet dní musí být ${L.days.min}–${L.days.max}`;
  }
  const kcal = int(b.kcal);
  if (!Number.isFinite(kcal) || kcal < L.kcal.min || kcal > L.kcal.max) {
    return `Kalorie musí být ${L.kcal.min}–${L.kcal.max} kcal`;
  }
  const macro = (v: unknown, label: string): number | null | string => {
    if (v === null || v === undefined || v === "") return null;
    const n = int(v);
    return Number.isFinite(n) && n >= L.macro.min && n <= L.macro.max ? Math.round(n) : `${label} musí být 0–${L.macro.max} g`;
  };
  const protein = macro(b.protein, "Bílkoviny");
  const fat = macro(b.fat, "Tuky");
  const carbs = macro(b.carbs, "Sacharidy");
  for (const m of [protein, fat, carbs]) if (typeof m === "string") return m;

  const slots = (Array.isArray(b.slots) ? b.slots : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  if (slots.length < L.slots.min || slots.length > L.slots.max) {
    return `Zadej ${L.slots.min}–${L.slots.max} jídel za den`;
  }
  if (slots.some((s) => s.length > L.slotLength)) return `Název jídla může mít max. ${L.slotLength} znaků`;

  const requirements = typeof b.requirements === "string" ? b.requirements.trim() : "";
  if (requirements.length > L.requirements) return `Požadavky mohou mít max. ${L.requirements} znaků`;

  return {
    days,
    kcal: Math.round(kcal),
    protein: protein as number | null,
    fat: fat as number | null,
    carbs: carbs as number | null,
    slots,
    requirements,
  };
}

// ---- what the AI returns ----

// Same approach as meal logging: the model lists ingredients with their
// nutrients, and we compute the totals ourselves. No min/max constraints so
// the schema maps onto each provider's structured-output support.
const ItemSchema = z.object({
  food: z.string(),
  grams: z.number(),
  kcal: z.number(),
  protein: z.number(),
  fat: z.number(),
  carbs: z.number(),
});

export const MenuSchema = z.object({
  notes: z.string(),
  days: z.array(
    z.object({
      meals: z.array(
        z.object({
          slot: z.string(),
          name: z.string(),
          prep: z.string(),
          items: z.array(ItemSchema),
        })
      ),
    })
  ),
});

export const MENU_SYSTEM_PROMPT = `You are an experienced sports nutritionist and practical home cook who writes meal plans for Czech users. You write everything in Czech.

You get the number of days, a daily calorie target, optional daily macronutrient targets, the meals the user eats each day (in order), and optional special requirements. Create a meal plan that meets them.

Targets:
- Each day's total should be within ±5 % of the calorie target, and within ±10 % of each macro target that is given. If a macro target is not given, choose a sensible split for a physically active adult.
- If the targets contradict each other (4 × protein + 4 × carbs + 9 × fat is far from the calorie target), follow the macro targets and mention it in notes.
- Small deviations are corrected afterwards by scaling portions, so focus on the right foods and roughly right portion sizes.
- Plan exactly the requested meals each day, in the given order, with the slot names exactly as given. Size each meal for its role: a pre-workout meal is lighter, easy to digest and carb-focused; main meals carry most of the protein.

Special requirements override variety. For example, "only one meal per day to cook" means one cooked dish per day; the other meals are no-cook (yoghurt, cottage cheese, bread, fruit, nuts…) or leftovers of an earlier cooked dish. Batch-cooking for two days is fine when it makes life easier; say so in prep (e.g. "uvař dvojitou porci, polovina na zítřejší oběd" and "zbytek ze včerejší večeře"). Keep the plan practical: everyday ingredients available in Czech supermarkets (Albert, Lidl, Kaufland), reuse ingredients across days to limit waste, and repeat good meals instead of inventing a new one every time.

Ingredients and nutrition:
- List each meal's ingredients, including cooking fat, sauces and spreads.
- Give grams as weighed when preparing: dry rice, pasta, oats and legumes; raw meat and fish; raw potatoes. Say the state in the food name, e.g. "rýže (suchá)", "kuřecí prsa (syrová)".
- Calculate each ingredient's kcal, protein, fat and carbs for its full weight from standard reference values per 100 g (USDA FoodData Central or the Czech food composition database) for that state. kcal should be about 4 × protein + 4 × carbs + 9 × fat.
- Before answering, add up each day and adjust portions until the day hits the targets.

Output:
- notes: 2–5 sentences: the cooking strategy for the period and anything the user should know (contradicting targets, what to prepare ahead). Don't comment on whether the targets are met; the app shows the numbers.
- days: one entry per day, each with meals in the requested order. For each meal: slot (exactly as given), name (only the dish, short Czech, lowercase), prep (one or two short sentences: how to prepare it, or that it is a leftover/no-cook; batch-cooking notes go here), items (food, grams, kcal, protein, fat, carbs).
- Use exactly the same food name for the same ingredient everywhere; the app adds them up into a shopping list.`;

export function menuUserPrompt(r: MenuRequest): string {
  const macro = (v: number | null) => (v === null ? "not specified" : `${v} g`);
  return [
    `Number of days: ${r.days}`,
    `Calories per day: ${r.kcal} kcal`,
    `Protein per day: ${macro(r.protein)}`,
    `Fat per day: ${macro(r.fat)}`,
    `Carbohydrates per day: ${macro(r.carbs)}`,
    `Meals each day, in order: ${r.slots.map((s) => `"${s}"`).join(", ")}`,
    `Special requirements: ${r.requirements || "none"}`,
  ].join("\n");
}

export async function generateMenu(r: MenuRequest): Promise<MenuPlan> {
  const provider = selectProvider();
  const system = MENU_SYSTEM_PROMPT;
  const user = menuUserPrompt(r);
  const raw =
    provider === "anthropic"
      ? await (await import("./providers/anthropic")).planMenu(system, user)
      : await (await import("./providers/openai")).planMenu(system, user);

  const m = MenuSchema.parse(raw);
  if (m.days.length === 0) throw new Error("AI nevrátila žádné dny");

  const days = m.days.slice(0, r.days).map((d) => {
    const meals = d.meals.map((meal) => ({
      slot: meal.slot.trim(),
      name: meal.name.trim(),
      prep: meal.prep.trim(),
      items: meal.items
        .filter((i) => i.grams > 0 && i.food.trim())
        .map((i): MealItemInput => {
          const per100 = (v: number) => Math.round((Math.max(0, v) / i.grams) * 100 * 10) / 10;
          return {
            food: i.food.trim(),
            grams: i.grams,
            kcal100: per100(i.kcal),
            protein100: per100(i.protein),
            fat100: per100(i.fat),
            carbs100: per100(i.carbs),
          };
        }),
    }));
    fitPortions(meals.flatMap((x) => x.items), r);
    return withTotals(meals);
  });

  return { notes: m.notes.trim(), days, shopping: shoppingList(days) };
}

// ---- post-processing ----

const MACROS = ["kcal", "protein", "fat", "carbs"] as const;

/**
 * Models are good at choosing foods but bad at arithmetic: a day often lands
 * 10–30 % off target. This nudges each ingredient's weight so the day hits the
 * calorie and macro targets, while keeping every weight as close to the AI's
 * as possible (regularised least squares, solved by projected gradient descent).
 * Scaling ingredients separately lets protein, fat and carbs move independently.
 * Mutates the items' grams.
 */
function fitPortions(items: MealItemInput[], r: MenuRequest) {
  const targets = MACROS.map((k) => ({ key: k, target: k === "kcal" ? r.kcal : r[k], weight: k === "kcal" ? 2 : 1 }))
    .filter((t): t is { key: (typeof MACROS)[number]; target: number; weight: number } => !!t.target);
  if (items.length === 0) return;

  const per100 = (i: MealItemInput, k: (typeof MACROS)[number]) => i[`${k}100`];
  // contrib[i][t]: item i's share of target t at its original weight.
  const contrib = items.map((i) => targets.map((t) => (per100(i, t.key) * i.grams) / 100 / t.target));
  const LAMBDA = 0.0002; // how strongly to keep the AI's weights
  const f = items.map(() => 1);

  for (let iter = 0; iter < 4000; iter++) {
    const err = targets.map((_, t) => contrib.reduce((s, c, i) => s + c[t] * f[i], 0) - 1);
    for (let i = 0; i < items.length; i++) {
      let g = 2 * LAMBDA * (f[i] - 1);
      for (let t = 0; t < targets.length; t++) g += 2 * targets[t].weight * err[t] * contrib[i][t];
      f[i] = Math.min(2, Math.max(0.5, f[i] - 0.3 * g));
    }
  }

  items.forEach((item, i) => {
    const g = item.grams * f[i];
    // Round to what a kitchen scale and a person would use.
    item.grams = Math.min(MAX_GRAMS, Math.max(1, g >= 100 ? Math.round(g / 5) * 5 : Math.round(g)));
  });
}

function withTotals(meals: Omit<PlannedMeal, keyof Totals>[]): PlannedDay {
  const withSums: PlannedMeal[] = meals.map((m) => ({ ...m, ...sumItems(m.items) }));
  const total = withSums.reduce(
    (t, x) => ({ kcal: t.kcal + x.kcal, protein: t.protein + x.protein, fat: t.fat + x.fat, carbs: t.carbs + x.carbs }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );
  return { meals: withSums, ...total };
}

/** Sums each ingredient across the whole plan. Computed here so it always matches the (fitted) weights. */
function shoppingList(days: PlannedDay[]): MenuPlan["shopping"] {
  const sums = new Map<string, { food: string; grams: number }>();
  for (const item of days.flatMap((d) => d.meals.flatMap((m) => m.items))) {
    const key = item.food.toLocaleLowerCase("cs");
    const entry = sums.get(key) ?? { food: item.food, grams: 0 };
    entry.grams += item.grams;
    sums.set(key, entry);
  }
  return [...sums.values()]
    .sort((a, b) => a.food.localeCompare(b.food, "cs"))
    .map(({ food, grams }) => ({
      food,
      amount: grams >= 1000 ? `${(Math.round(grams / 100) / 10).toLocaleString("cs-CZ")} kg` : `${Math.round(grams)} g`,
    }));
}
