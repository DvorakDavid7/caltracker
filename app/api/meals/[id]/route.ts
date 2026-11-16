import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteMeal, updateMealItemGrams } from "@/lib/db";
import { MAX_GRAMS } from "@/lib/items";

export const runtime = "nodejs";

const unauthorized = () => NextResponse.json({ error: "Nejsi přihlášen" }, { status: 401 });

async function mealId(ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Body: { items: [{ id, grams }] } – change ingredient weights. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const id = await mealId(ctx);
  if (!id) return NextResponse.json({ error: "Neplatné id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const changes = raw.map((c) => {
    const { id, grams } = (c ?? {}) as { id?: unknown; grams?: unknown };
    return { id: Number(id), grams: Number(grams) };
  });
  const valid =
    changes.length > 0 &&
    changes.length <= 100 &&
    changes.every((c) => Number.isInteger(c.id) && Number.isFinite(c.grams) && c.grams >= 0 && c.grams <= MAX_GRAMS);
  if (!valid) {
    return NextResponse.json({ error: `Gramy musí být číslo od 0 do ${MAX_GRAMS}` }, { status: 400 });
  }

  const meal = updateMealItemGrams(
    user.id,
    id,
    changes.map((c) => ({ id: c.id, grams: Math.round(c.grams) }))
  );
  if (!meal) return NextResponse.json({ error: "Jídlo nenalezeno" }, { status: 404 });
  return NextResponse.json({ meal });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const id = await mealId(ctx);
  if (!id) return NextResponse.json({ error: "Neplatné id" }, { status: 400 });
  if (!deleteMeal(user.id, id)) {
    return NextResponse.json({ error: "Jídlo nenalezeno" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
