import { NextResponse } from "next/server";
import {
  clientIp,
  hashPassword,
  isEmailAllowed,
  normalizeEmail,
  rateLimited,
  startSession,
  validateCredentials,
} from "@/lib/auth";
import { createUser } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (rateLimited(`register:${clientIp(req)}`)) {
    return NextResponse.json({ error: "Příliš mnoho pokusů, zkus to později" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Zadej platný e-mail" }, { status: 400 });

  const error = validateCredentials(body?.username, body?.password);
  if (error) return NextResponse.json({ error }, { status: 400 });

  if (!isEmailAllowed(email)) {
    return NextResponse.json({ error: "Registrace pro tento e-mail není povolená" }, { status: 403 });
  }

  const result = createUser(body.username, email, await hashPassword(body.password));
  if (result === "username_taken") {
    return NextResponse.json({ error: "Toto uživatelské jméno je obsazené" }, { status: 409 });
  }
  if (result === "email_taken") {
    return NextResponse.json({ error: "Účet s tímto e-mailem už existuje" }, { status: 409 });
  }

  await startSession(result.id);
  return NextResponse.json({ user: result }, { status: 201 });
}
