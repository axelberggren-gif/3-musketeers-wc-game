import { supabaseServer } from "@/lib/supabase/server";
import { isoToLocal } from "@/lib/utils";
import { ToggleAdmin } from "./ToggleAdmin";

export default async function AdminUsersPage() {
  const supabase = await supabaseServer();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, username, display_name, is_admin, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Username</th>
              <th className="text-left px-4 py-2">Display name</th>
              <th className="text-left px-4 py-2">Joined</th>
              <th className="text-left px-4 py-2">Admin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-mono">{u.username}</td>
                <td className="px-4 py-2">{u.display_name ?? "—"}</td>
                <td className="px-4 py-2 text-[var(--muted)] text-xs">{isoToLocal(u.created_at)}</td>
                <td className="px-4 py-2">
                  <ToggleAdmin userId={u.id} initial={u.is_admin} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
