import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteMeal } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nejsi přihlášen" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Neplatné id" }, { status: 400 });
  }
  if (!deleteMeal(user.id, id)) {
    return NextResponse.json({ error: "Jídlo nenalezeno" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
