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
    .select("username, onboarded")
    .eq("id", user.id)
    .maybeSingle();
  // Single onboarding gate for every (app) route: un-named users go pick a
  // username at /welcome (which lives in (auth), outside this gate — no loop).
  if (!profile || !profile.onboarded) redirect("/welcome");
  Sentry.setUser({ id: user.id, username: profile.username });

  return (
    <>
      <Nav />
      <div className="flex-1">{children}</div>
    </>
  );
}
