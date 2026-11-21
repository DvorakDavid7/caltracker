import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addMeal, getMenu } from "@/lib/db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Body: { day, meal, date } – adds a planned meal to the tracker as eaten on `date`. No AI call. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nejsi přihlášen" }, { status: 401 });

  const id = Number((await ctx.params).id);
  const body = await req.json().catch(() => null);
  const day = Number(body?.day);
  const index = Number(body?.meal);
  const date = typeof body?.date === "string" ? body.date : "";
  if (!Number.isInteger(id) || !Number.isInteger(day) || !Number.isInteger(index) || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Neplatný požadavek" }, { status: 400 });
  }

  const planned = getMenu(user.id, id)?.plan?.days[day]?.meals[index];
  if (!planned) return NextResponse.json({ error: "Jídlo nenalezeno" }, { status: 404 });

  const meal = addMeal(user.id, {
    date,
    description: `Z jídelníčku – den ${day + 1}, ${planned.slot}`,
    name: planned.name,
    kcal: planned.kcal,
    protein: planned.protein,
    fat: planned.fat,
    carbs: planned.carbs,
    items: planned.items,
  });
  return NextResponse.json({ meal }, { status: 201 });
}
