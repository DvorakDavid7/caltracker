import { NextResponse } from "next/server";
import { clearRateLimit, clientIp, getDummyHash, rateLimited, startSession, verifyPassword } from "@/lib/auth";
import { findUserByUsername } from "@/lib/db";

export const runtime = "nodejs";

const INVALID = "Nesprávné uživatelské jméno nebo heslo";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || password.length > 200) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  if (rateLimited(`login:${clientIp(req)}`) || rateLimited(`login-user:${username.toLowerCase()}`)) {
    return NextResponse.json({ error: "Příliš mnoho pokusů, zkus to za 15 minut" }, { status: 429 });
  }

  const user = findUserByUsername(username);
  // Always run the hash check so timing doesn't reveal whether the user exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) return NextResponse.json({ error: INVALID }, { status: 401 });

  clearRateLimit(`login-user:${username.toLowerCase()}`);
  await startSession(user.id);
  return NextResponse.json({ user: { id: user.id, username: user.username } });
}
