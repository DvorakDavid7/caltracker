import { NextResponse } from "next/server";
import { clientIp, hashPassword, rateLimited, startSession, validateCredentials } from "@/lib/auth";
import { createUser } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (rateLimited(`register:${clientIp(req)}`)) {
    return NextResponse.json({ error: "Příliš mnoho pokusů, zkus to později" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const error = validateCredentials(body?.username, body?.password);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const user = createUser(body.username, await hashPassword(body.password));
  if (!user) return NextResponse.json({ error: "Toto uživatelské jméno je obsazené" }, { status: 409 });

  await startSession(user.id);
  return NextResponse.json({ user }, { status: 201 });
}
