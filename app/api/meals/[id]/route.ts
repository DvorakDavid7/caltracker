import { NextResponse } from "next/server";
import { deleteMeal } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Neplatné id" }, { status: 400 });
  }
  if (!deleteMeal(id)) {
    return NextResponse.json({ error: "Jídlo nenalezeno" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
