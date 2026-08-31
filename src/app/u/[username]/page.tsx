import { redirect } from "next/navigation";

export default async function UsernameDeepLink({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  redirect(`/app/u/${encodeURIComponent(username)}`);
}
