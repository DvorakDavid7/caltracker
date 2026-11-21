import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteMenu, getMenu } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Nejsi přihlášen" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Jídelníček nenalezen" }, { status: 404 });

async function menuId(ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const id = await menuId(ctx);
  const menu = id ? getMenu(user.id, id) : undefined;
  return menu ? NextResponse.json({ menu }) : notFound();
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const id = await menuId(ctx);
  if (!id || !deleteMenu(user.id, id)) return notFound();
  return new NextResponse(null, { status: 204 });
}
