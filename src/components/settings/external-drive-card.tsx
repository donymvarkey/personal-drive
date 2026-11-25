"use client";

import { useState, useEffect } from "react";
import { formatBytes } from "@/lib/utils";
import {
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FolderTree,
  FileCheck,
  Disc,
  Info,
} from "lucide-react";

interface ScanStatusData {
  isScanning: boolean;
  lastScan: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    filesIndexed: number;
    foldersIndexed: number;
    bytesIndexed: string;
    changesDetected: number;
    errors: string | null;
  } | null;
  settings: {
    lastScanAt: string | null;
    indexedFilesCount: number;
    indexedFoldersCount: number;
  };
  mount: {
    valid: boolean;
    isMounted: boolean;
    fsType?: string;
    device?: string;
    uuid?: string;
    markerVerified: boolean;
    markerId?: string;
    error?: string;
    storagePath: string;
    stats: {
      totalBytes: string;
      usedBytes: string;
      freeBytes: string;
    } | null;
  };
}

export function ExternalDriveCard() {
  const [data, setData] = useState<ScanStatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [scanning, setScanning] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/storage/scan");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.isScanning) {
          setScanning(true);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerScan = async () => {
    try {
      setScanning(true);
      setScanMessage(null);
      setErrorMessage(null);

      const res = await fetch("/api/storage/scan", { method: "POST" });
      const json = await res.json();

      if (res.ok) {
        setScanMessage(
          `Scan completed: ${json.result.filesIndexed} files, ${json.result.foldersIndexed} folders indexed (${json.result.changesDetected} changes detected).`
        );
        fetchStatus();
      } else {
        setErrorMessage(json.error || "Failed to scan storage drive.");
      }
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMessage(e.message || "Network error occurred.");
    } finally {
      setScanning(false);
    }
  };

  const mount = data?.mount;
  const isHealthy = mount?.valid && mount?.isMounted;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              External SSD & exFAT Storage
            </h2>
            <p className="text-xs text-muted-foreground">
              Primary external drive mount, marker validation & in-place discovery
            </p>
          </div>
        </div>

        {isHealthy ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4" />
            Connected & Mounted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">
            <AlertTriangle className="w-4 h-4" />
            Disconnected
          </span>
        )}
      </div>

      {/* Disconnected error banner if drive missing */}
      {!isHealthy && mount?.error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm space-y-1">
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Storage Device Unreachable
          </div>
          <p className="text-xs leading-relaxed">{mount.error}</p>
          <p className="text-[11px] opacity-80 pt-1">
            Ensure your external SSD is connected via USB and mounted. Personal Drive refuses to write to the internal SSD to protect your data.
          </p>
        </div>
      )}

      {/* Drive Metadata Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-muted-foreground block text-[11px]">Filesystem</span>
          <span className="font-semibold text-foreground mt-0.5 block uppercase tracking-wide">
            {mount?.fsType || "exFAT"}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-muted-foreground block text-[11px]">Disk Marker</span>
          <span className="font-semibold text-foreground mt-0.5 block truncate">
            {mount?.markerVerified ? "Verified (disk.marker)" : "Unverified"}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-muted-foreground block text-[11px]">Indexed Files</span>
          <span className="font-semibold text-foreground mt-0.5 block">
            {data?.settings.indexedFilesCount ?? 0} files
          </span>
        </div>
        <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
          <span className="text-muted-foreground block text-[11px]">Indexed Folders</span>
          <span className="font-semibold text-foreground mt-0.5 block">
            {data?.settings.indexedFoldersCount ?? 0} folders
          </span>
        </div>
      </div>

      {/* Mount Path and Details */}
      <div className="p-4 rounded-xl bg-muted/30 border border-border text-xs space-y-2">
        <div className="flex items-center gap-2 font-mono flex-wrap">
          <Disc className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-foreground font-semibold">Mount Point:</span>
          <span className="px-2 py-0.5 rounded bg-muted text-foreground break-all">
            {mount?.storagePath || "/mnt/personal-drive"}
          </span>
        </div>
        {mount?.uuid && (
          <div className="flex items-center gap-2 font-mono flex-wrap text-[11px]">
            <span className="text-muted-foreground">Volume UUID:</span>
            <span className="px-1.5 py-0.5 rounded bg-muted/80 text-foreground">
              {mount.uuid}
            </span>
          </div>
        )}
      </div>

      {/* Scan & Reconciliation Actions */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-border/60">
        <div>
          <div className="text-xs text-muted-foreground">
            Last in-place scan:{" "}
            <span className="text-foreground font-medium">
              {data?.settings.lastScanAt
                ? new Date(data.settings.lastScanAt).toLocaleString()
                : "Not yet scanned"}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-0.5">
            Indexes pre-existing files directly on SSD without duplication or data loss.
          </div>
        </div>

        <button
          onClick={handleTriggerScan}
          disabled={scanning || !isHealthy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning External SSD..." : "Rescan External Drive"}
        </button>
      </div>

      {/* Status Messages */}
      {scanMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{scanMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
