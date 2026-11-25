"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Trash2, FolderSync } from "lucide-react";

interface ReconcileReport {
  physicalDiskFilesCount: number;
  databaseRecordsCount: number;
  orphanedDiskFiles: string[];
  missingDbFiles: Array<{
    id: string;
    originalName: string;
    storedName: string;
  }>;
  isConsistent: boolean;
}

export function ReconcileCard() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  const runReconcile = async () => {
    try {
      setLoading(true);
      setCleanupMessage(null);
      const res = await fetch("/api/storage/reconcile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reconcile storage");
      setReport(data);
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const cleanupStaging = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/storage/reconcile?action=cleanup-staging", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCleanupMessage(`Cleaned up ${data.cleanedStagingFiles} orphaned temporary file(s).`);
      runReconcile();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <FolderSync className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Storage & Database Consistency</h2>
            <p className="text-xs text-muted-foreground">Verify physical disk files against database records</p>
          </div>
        </div>

        <button
          onClick={runReconcile}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-border bg-background hover:bg-muted text-foreground text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Verify Consistency</span>
        </button>
      </div>

      {cleanupMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20">
          {cleanupMessage}
        </div>
      )}

      {report && (
        <div className="space-y-3 pt-2 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
              <span className="text-muted-foreground block">Physical Disk Files</span>
              <span className="text-lg font-bold text-foreground mt-0.5 block">{report.physicalDiskFilesCount}</span>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
              <span className="text-muted-foreground block">Database Records</span>
              <span className="text-lg font-bold text-foreground mt-0.5 block">{report.databaseRecordsCount}</span>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60 col-span-2 sm:col-span-1">
              <span className="text-muted-foreground block">Integrity Status</span>
              {report.isConsistent ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-1 mt-1">
                  <CheckCircle2 className="w-4 h-4" /> 100% In Sync
                </span>
              ) : (
                <span className="text-amber-500 font-bold inline-flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-4 h-4" /> Discrepancies
                </span>
              )}
            </div>
          </div>

          {report.orphanedDiskFiles.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
              <p className="font-semibold">Orphaned files found on disk ({report.orphanedDiskFiles.length}):</p>
              <ul className="list-disc pl-4 mt-1 font-mono text-[11px] space-y-0.5">
                {report.orphanedDiskFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </div>
          )}

          {report.missingDbFiles.length > 0 && (
            <div className="p-3 rounded-xl bg-destructive/10 text-destructive border border-destructive/20">
              <p className="font-semibold">Database records missing physical binaries ({report.missingDbFiles.length}):</p>
              <ul className="list-disc pl-4 mt-1 font-mono text-[11px] space-y-0.5">
                {report.missingDbFiles.map((f) => (
                  <li key={f.id}>{f.originalName} ({f.storedName})</li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              onClick={cleanupStaging}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clean temporary staging files</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
