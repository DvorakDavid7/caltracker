import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AuthForm from "../AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Přihlášení – CalTracker" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode="login" />;
}
