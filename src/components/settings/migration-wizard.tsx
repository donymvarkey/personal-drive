"use client";

import { useState, useEffect } from "react";
import {
  HardDrive,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldAlert,
  RotateCcw,
  Play,
  RefreshCw,
  FolderSync,
  Lock,
  Layers,
} from "lucide-react";

interface ValidationResult {
  valid: boolean;
  sourcePath?: string;
  destPath?: string;
  requiredKb?: number;
  availableKb?: number;
  error?: string;
}

interface MigrationState {
  id: string;
  status: string;
  sourcePath: string;
  destPath: string;
  totalFiles: number;
  copiedFiles: number;
  totalBytes: number;
  copiedBytes: number;
  writeLocked: boolean;
  errorMessage?: string;
}

export function MigrationWizard() {
  const [destPath, setDestPath] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [migration, setMigration] = useState<MigrationState | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Poll migration status
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/storage/migrate");
      if (res.ok) {
        const data = await res.json();
        if (data.migration) {
          setMigration(data.migration);
          if (!destPath && data.migration.destPath) {
            setDestPath(data.migration.destPath);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleValidate = async () => {
    if (!destPath.trim()) {
      setFeedback({ type: "error", text: "Please enter a destination mount directory." });
      return;
    }

    setValidating(true);
    setValidation(null);
    setFeedback(null);

    try {
      const res = await fetch("/api/storage/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", destPath: destPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setValidation({ valid: false, error: data.error || "Validation failed." });
        setFeedback({ type: "error", text: data.error || "Validation failed." });
      } else {
        setValidation(data);
        setFeedback({ type: "success", text: "Destination verified! Safe marker and capacity confirmed." });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Validation error";
      setValidation({ valid: false, error: msg });
      setFeedback({ type: "error", text: msg });
    } finally {
      setValidating(false);
    }
  };

  const handleAction = async (action: "start" | "sync" | "verify" | "switch" | "rollback") => {
    setLoadingAction(action);
    setFeedback(null);

    try {
      const res = await fetch("/api/storage/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, destPath: destPath.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: "error", text: data.error || `Failed during ${action}` });
      } else {
        setFeedback({
          type: "success",
          text: data.message || `Step "${action}" succeeded!`,
        });
        await fetchStatus();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setFeedback({ type: "error", text: msg });
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <FolderSync className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Storage Disk Migration
            </h2>
            <p className="text-xs text-muted-foreground">
              Guided, safe migration to external SSD/HDD without database metadata modification
            </p>
          </div>
        </div>

        {migration?.status && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-muted text-foreground border border-border">
            Status: {migration.status}
          </span>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Safety Notice */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          Safety Guarantees & Prerequisites
        </div>
        <p className="leading-relaxed">
          1. <strong>Marker File Requirement:</strong> Destination must contain an empty{" "}
          <code className="px-1 py-0.5 rounded bg-muted/60 font-mono">.drive-target</code> file to
          confirm it is a dedicated target volume.
        </p>
        <p className="leading-relaxed">
          2. <strong>Zero Downtime Copy:</strong> Normal file downloads and reads remain active during initial synchronization.
        </p>
        <p className="leading-relaxed">
          3. <strong>Data Safety:</strong> Files are never deleted from the original storage. Rollback is always available.
        </p>
      </div>

      {/* Step 1: Destination Input & Validation */}
      <div className="space-y-3">
        <label className="text-xs font-semibold text-foreground block">
          Destination Mount Directory Path
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="/Volumes/ExternalSSD/personal-drive-storage"
            value={destPath}
            onChange={(e) => setDestPath(e.target.value)}
            disabled={migration?.status === "copying" || migration?.status === "syncing"}
            className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleValidate}
            disabled={validating || !destPath.trim()}
            className="px-4 h-9 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {validating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            )}
            Validate Target
          </button>
        </div>

        {validation && (
          <div
            className={`p-3 rounded-xl border text-xs space-y-1 ${
              validation.valid
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-destructive/10 text-destructive border-destructive/20"
            }`}
          >
            {validation.valid ? (
              <>
                <p className="font-semibold">✓ Pre-flight checks passed:</p>
                <p>• Safety marker <code>.drive-target</code> found.</p>
                <p>• Directory is writable.</p>
                <p>
                  • Capacity verified: Required ~{(validation.requiredKb || 0) / 1024} MB, Available ~
                  {(validation.availableKb || 0) / 1024} MB.
                </p>
              </>
            ) : (
              <p className="font-semibold">✕ Validation failed: {validation.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Migration Progress Bar */}
      {migration && (
        <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-foreground">
              Progress ({migration.copiedFiles} / {migration.totalFiles} files copied)
            </span>
            <span className="font-mono text-muted-foreground">
              {migration.totalFiles > 0
                ? Math.round((migration.copiedFiles / migration.totalFiles) * 100)
                : 100}
              %
            </span>
          </div>

          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{
                width: `${
                  migration.totalFiles > 0
                    ? Math.min(Math.round((migration.copiedFiles / migration.totalFiles) * 100), 100)
                    : 100
                }%`,
              }}
            />
          </div>

          {migration.writeLocked && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <Lock className="w-3.5 h-3.5" />
              Writes are temporarily paused for final synchronization. Reads are active.
            </div>
          )}
        </div>
      )}

      {/* Workflow Step Buttons */}
      <div className="pt-2 flex flex-wrap gap-2.5 items-center justify-end">
        {/* Step 1: Start Initial Copy */}
        <button
          onClick={() => handleAction("start")}
          disabled={!validation?.valid || loadingAction !== null}
          className="px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
        >
          {loadingAction === "start" ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          1. Start Initial Copy
        </button>

        {/* Step 2: Final Sync */}
        <button
          onClick={() => handleAction("sync")}
          disabled={
            !migration ||
            !["copied", "copying", "syncing"].includes(migration.status) ||
            loadingAction !== null
          }
          className="px-3.5 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
        >
          {loadingAction === "sync" ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Layers className="w-3.5 h-3.5" />
          )}
          2. Final Sync (Brief Write-Lock)
        </button>

        {/* Step 3: Verify Checksums */}
        <button
          onClick={() => handleAction("verify")}
          disabled={
            !migration ||
            !["synced", "copied", "verified"].includes(migration.status) ||
            loadingAction !== null
          }
          className="px-3.5 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
        >
          {loadingAction === "verify" ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
          3. Verify SHA-256 Checksums
        </button>

        {/* Step 4: Switch Location */}
        <button
          onClick={() => {
            if (
              confirm(
                "Are you ready to switch active storage location? This updates host environment settings and keeps a safety backup."
              )
            ) {
              handleAction("switch");
            }
          }}
          disabled={migration?.status !== "verified" || loadingAction !== null}
          className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
        >
          {loadingAction === "switch" ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ArrowRight className="w-3.5 h-3.5" />
          )}
          4. Switch Storage Location
        </button>

        {/* Rollback Button */}
        <button
          onClick={() => {
            if (confirm("Rollback storage configuration to the previous location?")) {
              handleAction("rollback");
            }
          }}
          disabled={loadingAction !== null}
          className="px-3.5 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground text-xs font-medium hover:bg-muted transition-colors cursor-pointer flex items-center gap-1.5 ml-auto"
        >
          {loadingAction === "rollback" ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5" />
          )}
          Rollback
        </button>
      </div>
    </div>
  );
}
