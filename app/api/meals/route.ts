import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addMeal, listMeals } from "@/lib/db";
import { estimateNutrition } from "@/lib/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNAUTHORIZED = () => NextResponse.json({ error: "Nejsi přihlášen" }, { status: 401 });

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return UNAUTHORIZED();

  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Neplatné datum" }, { status: 400 });
  }
  return NextResponse.json({ meals: listMeals(user.id, date) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return UNAUTHORIZED();

  let body: { description?: unknown; date?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  if (!description || description.length > 500) {
    return NextResponse.json({ error: "Popiš jídlo (max. 500 znaků)" }, { status: 400 });
  }
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Neplatné datum" }, { status: 400 });
  }

  try {
    const nutrition = await estimateNutrition(description);
    const meal = addMeal(user.id, { date, description, ...nutrition });
    return NextResponse.json({ meal }, { status: 201 });
  } catch (err) {
    console.error("Nutrition estimate failed:", err);
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: `Nepodařilo se vyhodnotit jídlo: ${message}` }, { status: 502 });
  }
}
