// Shared by server and client (no Node imports).
import type { MealItemInput, Totals } from "./items";

// ---- what the user asks for ----

export type MenuRequest = {
  days: number;
  kcal: number;
  protein: number | null; // grams per day; null = let the AI choose
  fat: number | null;
  carbs: number | null;
  slots: string[]; // meals per day, in order, e.g. ["Snídaně", "Oběd", "Před tréninkem", "Večeře"]
  requirements: string;
};

export const MENU_LIMITS = {
  days: { min: 1, max: 14 },
  kcal: { min: 800, max: 6000 },
  macro: { min: 0, max: 1000 },
  slots: { min: 1, max: 8 },
  slotLength: 40,
  requirements: 1000,
};

// ---- what we store and show ----

export type PlannedMeal = Totals & { slot: string; name: string; prep: string; items: MealItemInput[] };
export type PlannedDay = Totals & { meals: PlannedMeal[] };
export type MenuPlan = { notes: string; days: PlannedDay[]; shopping: { food: string; amount: string }[] };
