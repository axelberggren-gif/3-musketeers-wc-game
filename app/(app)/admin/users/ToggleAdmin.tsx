"use client";

import { useState, useTransition } from "react";
import { toggleUserAdmin } from "@/lib/admin/actions";

export function ToggleAdmin({ userId, initial }: { userId: string; initial: boolean }) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !value;
    setValue(next);
    startTransition(async () => {
      const result = await toggleUserAdmin(userId, next);
      if (!result.ok) setValue(!next);
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={`btn ${value ? "btn-primary" : "btn-secondary"} text-xs px-2 py-1`}
    >
      {value ? "Admin" : "Member"}
    </button>
  );
}
