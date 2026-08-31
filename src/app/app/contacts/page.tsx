import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth";
import { ContactsDesk } from "@/components/contacts-desk";

export default async function ContactsPage() {
  const user = await requireActiveUser();
  if (!user) redirect("/");
  return <ContactsDesk />;
}
