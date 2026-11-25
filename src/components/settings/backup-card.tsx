"use client";

import { useState, useEffect } from "react";
import { formatBytes } from "@/lib/utils";
import {
  Archive,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HardDrive,
  ShieldCheck,
  RefreshCw,
  Clock,
  ShieldAlert,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BackupItem {
  id: string;
  status: string;
  backupType: string;
  archivePath: string;
  sizeBytes: string;
  totalFiles: number;
  verified: boolean;
  verificationLog: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export function BackupCard() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [destination, setDestination] = useState<string>("");
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [loading, setLoading] = useState<boolean>(true);
  const [creating, setCreating] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchBackups = async () => {
    try {
      const res = await fetch("/api/backup");
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
        setDestination(data.backupDestination || "");
        setRetentionDays(data.retentionDays || 30);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    setCreating(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create backup");
      }
      setActionMessage({
        type: "success",
        text: `Backup created successfully (${formatBytes(Number(data.sizeBytes))}, ${data.totalFiles} files). Verified: ${data.verified ? "Yes" : "No"}`,
      });
      await fetchBackups();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Backup creation failed",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleVerify = async (backupId: string) => {
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", backupId }),
      });
      const data = await res.json();
      if (data.verified) {
        setActionMessage({ type: "success", text: `Backup ${backupId.slice(0, 8)} verified successfully!` });
      } else {
        setActionMessage({ type: "error", text: `Verification failed: ${data.log}` });
      }
      await fetchBackups();
    } catch (err) {
      setActionMessage({ type: "error", text: "Verification request failed" });
    }
  };

  const handleRestore = async (backupId: string) => {
    try {
      setActionMessage(null);
      const res = await fetch(`/api/backup/${backupId}/restore`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Restore procedure failed");
      }
      setActionMessage({
        type: "success",
        text: `Restoration complete! ${data.filesRestored} files and database records restored with 100% integrity.`,
      });
      await fetchBackups();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Restore failed",
      });
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Backup & Disaster Recovery
            </h2>
            <p className="text-xs text-muted-foreground">
              Isolated full database dumps, file archives & instant cold-restore
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-xs disabled:opacity-50"
          >
            {creating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Backing Up...
              </>
            ) : (
              <>
                <Archive className="w-3.5 h-3.5" />
                Create Backup Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl text-xs font-medium border flex items-center gap-2.5 ${
            actionMessage.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}
        >
          {actionMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Backup Destination & Policy Info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-xs text-muted-foreground block font-medium">
            Backup Destination
          </span>
          <span className="text-xs font-mono text-foreground mt-1 block truncate" title={destination}>
            {destination || "drive_backups/"}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            Independent storage location
          </span>
        </div>
        <div className="p-4 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-xs text-muted-foreground block font-medium">
            Retention Policy
          </span>
          <span className="text-xl font-bold text-foreground mt-1 block">
            {retentionDays} Days
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            Preserves 3 newest backups minimum
          </span>
        </div>
        <div className="p-4 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-xs text-muted-foreground block font-medium">
            Total Backups
          </span>
          <span className="text-xl font-bold text-primary mt-1 block">
            {backups.length}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            Point-in-time recovery archives
          </span>
        </div>
      </div>

      {/* Backup History Table */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Backup History & Archives
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-xs">Loading backup catalog...</span>
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-border rounded-xl">
            <Archive className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">
              No backups created yet. Click "Create Backup Now" to safeguard your data.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-background/50">
            {backups.map((b) => (
              <div
                key={b.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {b.id.slice(0, 8)}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        b.verified
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                      }`}
                    >
                      {b.verified ? "Verified" : "Unverified"}
                    </span>
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {b.backupType}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(b.startedAt).toLocaleString()}
                    </span>
                    <span>•</span>
                    <span>{formatBytes(Number(b.sizeBytes))}</span>
                    <span>•</span>
                    <span>{b.totalFiles} file(s)</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleVerify(b.id)}
                    title="Verify SHA-256 integrity"
                    className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition text-xs flex items-center gap-1"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Verify</span>
                  </button>

                  <a
                    href={`/api/backup/${b.id}/download`}
                    download
                    title="Download archive (.tar.gz)"
                    className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition text-xs flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Download</span>
                  </a>

                  <AlertDialog>
                    <AlertDialogTrigger
                      title="Restore this backup"
                      className="p-2 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition text-xs flex items-center gap-1 font-medium cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Restore</span>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Restore Drive from Backup?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will restore all files and PostgreSQL database records from backup archive{" "}
                          <span className="font-mono font-bold text-foreground">
                            {b.id.slice(0, 8)}
                          </span>{" "}
                          ({formatBytes(Number(b.sizeBytes))}). Current files with identical names will be safely synchronized.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleRestore(b.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Confirm & Restore
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
