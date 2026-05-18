import { SyncButtons } from "./SyncButtons";

export default function AdminSyncPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Sync</h1>
        <p className="text-sm text-[var(--muted)]">
          Trigger football-data.org pulls manually. Cron jobs handle this every 10 minutes
          automatically, but the manual buttons are useful for the initial seed or after a fixture
          update.
        </p>
      </header>
      <SyncButtons />
    </div>
  );
}
