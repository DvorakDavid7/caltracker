import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Tracker from "./Tracker";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Tracker username={user.username} />;
}
