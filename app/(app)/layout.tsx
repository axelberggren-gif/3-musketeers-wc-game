import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { supabaseServer } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  Sentry.setUser({ id: user.id, username: profile?.username ?? undefined });

  return (
    <>
      <Nav />
      <div className="flex-1">{children}</div>
    </>
  );
}
