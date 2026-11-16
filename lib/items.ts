// Shared by server and client (no Node imports).

/** One ingredient of a meal. Values are stored per 100 g so grams can be edited. */
export type MealItem = {
  id: number;
  food: string;
  grams: number;
  kcal100: number;
  protein100: number;
  fat100: number;
  carbs100: number;
};

export type MealItemInput = Omit<MealItem, "id">;

export type Totals = { kcal: number; protein: number; fat: number; carbs: number };

export const MAX_GRAMS = 5000;

/** Nutrients of one item at its current weight (unrounded). */
export function itemValues(i: Pick<MealItem, "grams" | "kcal100" | "protein100" | "fat100" | "carbs100">): Totals {
  const f = i.grams / 100;
  return { kcal: i.kcal100 * f, protein: i.protein100 * f, fat: i.fat100 * f, carbs: i.carbs100 * f };
}

/** Meal totals, rounded to whole numbers like the rest of the app. */
export function sumItems(items: Parameters<typeof itemValues>[0][]): Totals {
  const t = items.reduce(
    (acc, i) => {
      const v = itemValues(i);
      return { kcal: acc.kcal + v.kcal, protein: acc.protein + v.protein, fat: acc.fat + v.fat, carbs: acc.carbs + v.carbs };
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );
  return {
    kcal: Math.round(t.kcal),
    protein: Math.round(t.protein),
    fat: Math.round(t.fat),
    carbs: Math.round(t.carbs),
  };
}
