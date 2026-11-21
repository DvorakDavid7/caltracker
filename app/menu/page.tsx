import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import MenuPlanner from "./MenuPlanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jídelníček – CalTracker" };

export default async function MenuPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <MenuPlanner />;
}
