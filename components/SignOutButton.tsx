"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function handleSignOut() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/");
  }
  return (
    <button onClick={handleSignOut} className="btn btn-ghost text-sm">
      Sign out
    </button>
  );
}
