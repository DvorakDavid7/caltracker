import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { countPendingMenus, createMenu, finishMenu, listMenus } from "@/lib/db";
import { generateMenu, parseMenuRequest } from "@/lib/menu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Nejsi přihlášen" }, { status: 401 });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ menus: listMenus(user.id) });
}

/**
 * Starts generating a menu and returns right away with a pending menu.
 * A multi-day plan takes the AI a few minutes – longer than proxies like to
 * keep a request open – so the work runs after the response and the client
 * polls GET /api/menus/[id].
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const request = parseMenuRequest(body);
  if (typeof request === "string") return NextResponse.json({ error: request }, { status: 400 });

  if (countPendingMenus(user.id) >= 2) {
    return NextResponse.json({ error: "Počkej, až se dokončí rozpracované jídelníčky" }, { status: 429 });
  }

  const menu = createMenu(user.id, request);
  after(async () => {
    try {
      finishMenu(menu.id, { plan: await generateMenu(request) });
    } catch (err) {
      console.error("Menu generation failed:", err);
      const message = err instanceof Error ? err.message : "Neznámá chyba";
      finishMenu(menu.id, { error: `Nepodařilo se sestavit jídelníček: ${message}` });
    }
  });
  return NextResponse.json({ menu }, { status: 202 });
}
