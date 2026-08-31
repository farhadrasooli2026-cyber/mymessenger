import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";

export default async function WelcomePage() {
  const user = await requireActiveUser();
  if (user) redirect("/app");
  redirect("/");
}
