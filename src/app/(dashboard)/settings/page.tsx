import { getStorageStats } from "@/app/actions/storage";
import { formatBytes } from "@/lib/utils";
import { ExternalDriveCard } from "@/components/settings/external-drive-card";
import { ReconcileCard } from "@/components/settings/reconcile-card";
import { MigrationWizard } from "@/components/settings/migration-wizard";
import { SettingsForm } from "@/components/settings/settings-form";
import { BackupCard } from "@/components/settings/backup-card";
import { SystemHealthCard } from "@/components/settings/system-health-card";
import {
  HardDrive,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Server,
  Database,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings & Storage Management – Personal Drive",
};

export default async function SettingsPage() {
  const stats = await getStorageStats();

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="pb-2 border-b border-border/60">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Settings & Storage Management
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor physical disk health, perform guided external drive migration, configure retention policies, manage automated backups, and review system telemetry.
        </p>
      </div>

      {/* 1. Real-Time Server Health & Tailscale Telemetry */}
      <SystemHealthCard />

      {/* 2. External SSD Storage & In-Place Discovery */}
      <ExternalDriveCard />

      {/* 3. Physical Storage Device & Health Dashboard */}
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Physical Storage Dashboard
              </h2>
              <p className="text-xs text-muted-foreground">
                Active dedicated disk mount & hardware capacity
              </p>
            </div>
          </div>

          {stats.valid ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-4 h-4" />
              Storage Healthy
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">
              <AlertTriangle className="w-4 h-4" />
              Storage Unavailable
            </span>
          )}
        </div>

        {stats.valid ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-muted/40 border border-border/60">
                <span className="text-xs text-muted-foreground block font-medium">
                  Total Physical Capacity
                </span>
                <span className="text-xl font-bold text-foreground mt-1 block">
                  {formatBytes(stats.totalBytes)}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  Hardware disk block size
                </span>
              </div>
              <div className="p-4 rounded-xl bg-muted/40 border border-border/60">
                <span className="text-xs text-muted-foreground block font-medium">
                  Used Disk Space
                </span>
                <span className="text-xl font-bold text-foreground mt-1 block">
                  {formatBytes(stats.usedBytes)} ({stats.usedPercent}%)
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  Files, versions & system
                </span>
              </div>
              <div className="p-4 rounded-xl bg-muted/40 border border-border/60">
                <span className="text-xs text-muted-foreground block font-medium">
                  Available Free Space
                </span>
                <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
                  {formatBytes(stats.freeBytes)}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  Real unallocated disk space
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Disk Utilization</span>
                <span>{stats.usedPercent}% utilized</span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden p-0.5">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(Math.max(stats.usedPercent, 2), 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-muted/30 border border-border text-xs space-y-2 text-muted-foreground">
              <div className="flex items-center gap-2 font-mono flex-wrap">
                <Server className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-foreground font-semibold">Active Storage Path:</span>
                <span className="px-2 py-0.5 rounded bg-muted text-foreground break-all">
                  {process.env.DRIVE_STORAGE_PATH || "/srv/home-server/personal-drive/storage"}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Controlled by host-side Docker bind-mount. Zero application path manipulation allowed directly from web containers.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            <p className="font-semibold">Disk validation failed:</p>
            <p className="text-xs mt-1">{stats.error || "Could not read storage statistics."}</p>
          </div>
        )}
      </div>

      {/* 2. Hybrid Storage Migration Wizard */}
      <MigrationWizard />

      {/* 3. Reconcile & Consistency Check */}
      <ReconcileCard />

      {/* 4. Automated Backup & Disaster Recovery */}
      <BackupCard />

      {/* 5. Settings Form (Retention Policies, Password, Appearance) */}
      <SettingsForm />

      {/* 5. Security & Ownership Summary */}
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Security Architecture</h2>
            <p className="text-xs text-muted-foreground">
              Single-owner authorization with physical isolation
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <span className="text-muted-foreground block">Session Security</span>
            <span className="font-medium text-foreground mt-0.5 block">
              Auth.js v5 JWT with HTTP-only Cookies
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <span className="text-muted-foreground block">Authorized Email</span>
            <span className="font-medium text-foreground mt-0.5 block font-mono">
              {process.env.DRIVE_OWNER_EMAIL || "admin@personal.drive"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
