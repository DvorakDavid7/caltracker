import { NextResponse } from "next/server";
import { addMeal, listMeals } from "@/lib/db";
import { estimateNutrition } from "@/lib/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "Neplatné datum" }, { status: 400 });
  }
  return NextResponse.json({ meals: listMeals(date) });
}

export async function POST(req: Request) {
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
    const meal = addMeal({ date, description, ...nutrition });
    return NextResponse.json({ meal }, { status: 201 });
  } catch (err) {
    console.error("Nutrition estimate failed:", err);
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: `Nepodařilo se vyhodnotit jídlo: ${message}` }, { status: 502 });
  }
}
