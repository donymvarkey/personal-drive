"use client";

import { useState, useEffect, useRef } from "react";
import { formatBytes } from "@/lib/utils";
import {
  History,
  X,
  Upload,
  Download,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  FileText,
} from "lucide-react";

interface VersionItem {
  id: string;
  versionNumber: number;
  size: number;
  checksum: string;
  note?: string | null;
  createdAt: string;
}

interface VersionHistoryModalProps {
  isOpen: boolean;
  fileId: string;
  fileName: string;
  onClose: () => void;
  onVersionChanged?: () => void;
}

export function VersionHistoryModal({
  isOpen,
  fileId,
  fileName,
  onClose,
  onVersionChanged,
}: VersionHistoryModalProps) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVersions = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/files/${fileId}/versions`);
      if (!res.ok) throw new Error("Failed to load versions");
      const data = await res.json();
      setVersions(data.versions || []);
    } catch {
      setMessage({ text: "Could not load version history.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadVersions();
    }
  }, [isOpen, fileId]);

  if (!isOpen) return null;

  const handleUploadNewVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setMessage(null);
      const formData = new FormData();
      formData.append("file", file);
      if (versionNote.trim()) {
        formData.append("note", versionNote.trim());
      }

      const res = await fetch(`/api/files/${fileId}/versions`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      setMessage({ text: "New version successfully uploaded.", type: "success" });
      setVersionNote("");
      await loadVersions();
      onVersionChanged?.();
    } catch (err: unknown) {
      setMessage({ text: (err as Error).message || "Failed to upload new version.", type: "error" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRestoreVersion = async (version: VersionItem) => {
    if (!confirm(`Are you sure you want to restore version ${version.versionNumber}? This will make it the active version.`)) {
      return;
    }

    try {
      setRestoringId(version.id);
      setMessage(null);
      const res = await fetch(`/api/files/${fileId}/versions/${version.id}/restore`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Restore failed");
      }

      setMessage({ text: `Restored to version ${version.versionNumber}.`, type: "success" });
      await loadVersions();
      onVersionChanged?.();
    } catch (err: unknown) {
      setMessage({ text: (err as Error).message || "Failed to restore version.", type: "error" });
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeleteVersion = async (version: VersionItem) => {
    if (!confirm(`Permanently delete version ${version.versionNumber} from disk? This cannot be undone.`)) {
      return;
    }

    try {
      setDeletingId(version.id);
      setMessage(null);
      const res = await fetch(`/api/files/${fileId}/versions/${version.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }

      setMessage({ text: `Version ${version.versionNumber} deleted.`, type: "success" });
      await loadVersions();
    } catch (err: unknown) {
      setMessage({ text: (err as Error).message || "Failed to delete version.", type: "error" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-6 space-y-5 animate-in zoom-in-95 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Version History</h3>
              <p className="text-xs text-muted-foreground truncate max-w-xs">{fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Message */}
        {message && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 shrink-0 ${
              message.type === "success"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}
          >
            {message.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Upload New Version Bar */}
        <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-2.5 shrink-0">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5 text-primary" />
            Upload New Version
          </span>

          <input
            type="text"
            placeholder="Optional version note (e.g. Revised figures)"
            value={versionNote}
            onChange={(e) => setVersionNote(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>{uploading ? "Uploading..." : "Select File for New Version"}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUploadNewVersion}
          />
        </div>

        {/* Versions List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 divide-y divide-border/60">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-xs">Loading versions...</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground space-y-1">
              <p>No historical versions recorded yet.</p>
              <p className="text-muted-foreground/60">Upload a new version above to start tracking revision history.</p>
            </div>
          ) : (
            versions.map((ver, idx) => (
              <div key={ver.id} className="pt-2.5 pb-2 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">Version {ver.versionNumber}</span>
                    {idx === 0 && (
                      <span className="px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary font-semibold text-[10px]">
                        Active
                      </span>
                    )}
                  </div>

                  {ver.note && <p className="text-xs text-muted-foreground mt-0.5 truncate">{ver.note}</p>}

                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {formatBytes(ver.size)} • {new Date(ver.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`/api/files/${fileId}/versions/${ver.id}/download`}
                    className="p-1.5 rounded-lg border border-border hover:bg-muted text-foreground cursor-pointer"
                    title="Download this version"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>

                  {idx !== 0 && (
                    <button
                      onClick={() => handleRestoreVersion(ver)}
                      disabled={restoringId === ver.id}
                      className="p-1.5 rounded-lg border border-border hover:bg-muted text-emerald-600 dark:text-emerald-400 cursor-pointer"
                      title="Restore as current active version"
                    >
                      {restoringId === ver.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  {idx !== 0 && (
                    <button
                      onClick={() => handleDeleteVersion(ver)}
                      disabled={deletingId === ver.id}
                      className="p-1.5 rounded-lg border border-border hover:bg-rose-500/10 text-rose-500 cursor-pointer"
                      title="Delete version"
                    >
                      {deletingId === ver.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
