import { z } from "zod";
import { MAX_GRAMS, sumItems, type MealItemInput, type Totals } from "./items";

// Shape the model must return. Kept free of min/max constraints so it maps
// cleanly onto each provider's structured-output JSON schema support.
//
// The model breaks the meal into ingredients first; we sum the totals
// ourselves. Estimating per ingredient (grams × reference values per 100 g)
// is far more accurate than guessing a whole-meal number in one shot.
export const NutritionSchema = z.object({
  name: z.string(),
  items: z.array(
    z.object({
      food: z.string(),
      grams: z.number(),
      kcal: z.number(),
      protein: z.number(),
      fat: z.number(),
      carbs: z.number(),
    })
  ),
});

export type Nutrition = Totals & { name: string; items: MealItemInput[] };

export const SYSTEM_PROMPT = `You are a precise nutrition analyst. The user describes a meal, usually in Czech, sometimes with quantities. Estimate its nutritional content as accurately as possible.

Method:
1. Split the meal into its individual ingredients, including the ones that are easy to miss: cooking fat or oil, butter, spreads, sauces, dressings, sugar in drinks.
2. Give each ingredient a weight in grams, as eaten.
   - If the user states an amount (grams, pieces, slices, spoons, cups), convert it to grams using typical Czech unit weights. Examples: rohlík 43 g, chléb 1 slice 40 g, vejce M 50 g without shell, lžíce oleje 10 g, lžička cukru 5 g, hrnek 250 ml.
   - If no amount is given, use a typical adult portion for Czech home cooking or Czech restaurants.
   - Distinguish raw and cooked weights. Cooked rice, pasta and potatoes have much lower values per gram than dry or raw ones. Meat loses about 25–30 % of its weight when cooked.
3. Calculate each ingredient from standard reference values per 100 g (USDA FoodData Central or the Czech food composition database), scaled to its weight. Use values for the specific product named. For example, "cottage" means Czech cottage cheese (about 100 kcal per 100 g), and "šunka" means standard cooked ham.
4. Check each ingredient: kcal should be about 4 × protein + 4 × carbs + 9 × fat (plus 7 kcal per gram of alcohol). Fix values that don't add up.
5. Do not round to "nice" numbers and do not inflate or shrink portions. Give your single best estimate.

Output:
- name: a short Czech name for the whole meal, in lowercase, like the user wrote it (e.g. "kuřecí s rýží")
- items: one entry per ingredient with food (Czech), grams, kcal, protein, fat and carbs (grams), for that ingredient's full weight. Use up to one decimal place.`;

export type Provider = "openai" | "anthropic";

/**
 * AI_PROVIDER wins if set; otherwise Anthropic when its key is present,
 * else OpenAI.
 */
export function selectProvider(): Provider {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") return explicit;
  if (explicit) throw new Error(`Neznámý AI_PROVIDER "${explicit}" (použij openai nebo anthropic)`);
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error("Chybí ANTHROPIC_API_KEY nebo OPENAI_API_KEY v souboru .env");
}

export async function estimateNutrition(description: string): Promise<Nutrition> {
  const provider = selectProvider();
  const raw =
    provider === "anthropic"
      ? await (await import("./providers/anthropic")).estimate(description)
      : await (await import("./providers/openai")).estimate(description);

  const n = NutritionSchema.parse(raw);
  if (!n.name.trim()) throw new Error("AI nevrátila název jídla");

  // Convert to per-100 g values so the user can later change the weight.
  const items: MealItemInput[] = n.items
    .filter((i) => i.grams > 0 && i.food.trim())
    .map((i) => {
      const grams = Math.min(MAX_GRAMS, Math.round(i.grams));
      const per100 = (v: number) => Math.round((Math.max(0, v) / i.grams) * 100 * 10) / 10;
      return {
        food: i.food.trim(),
        grams,
        kcal100: per100(i.kcal),
        protein100: per100(i.protein),
        fat100: per100(i.fat),
        carbs100: per100(i.carbs),
      };
    });
  if (items.length === 0) throw new Error("AI nerozpoznala žádné ingredience");

  return { name: n.name.trim(), items, ...sumItems(items) };
}
