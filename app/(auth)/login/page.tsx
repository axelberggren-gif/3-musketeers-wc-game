import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/leagues");

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="card w-full max-w-md flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            We&rsquo;ll email you a magic link. No password.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
