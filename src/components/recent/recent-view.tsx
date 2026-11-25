"use client";

import { useState, useEffect } from "react";
import { formatBytes } from "@/lib/utils";
import {
  Clock,
  Upload,
  Eye,
  Download,
  Edit2,
  FolderInput,
  Copy,
  Trash2,
  File as FileIcon,
  Filter,
  Loader2,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import { FilePreviewModal, PreviewableFile } from "@/components/preview/file-preview-modal";

interface ActivityItem {
  id: string;
  action: string;
  itemName: string;
  fileId?: string | null;
  folderId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
  createdAt: string;
  file?: {
    id: string;
    originalName: string;
    mimeType: string;
    extension: string;
    size: number;
    isStarred: boolean;
    isTrashed: boolean;
  } | null;
}

export function RecentView() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  useEffect(() => {
    async function loadActivities() {
      try {
        setLoading(true);
        const url =
          actionFilter === "all"
            ? "/api/activity?limit=60"
            : `/api/activity?action=${actionFilter}&limit=60`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load activity logs");
        const data = await res.json();
        setActivities(data.activities || []);
      } catch (err) {
        console.error("Failed to fetch activity:", err);
      } finally {
        setLoading(false);
      }
    }
    loadActivities();
  }, [actionFilter]);

  const getActionBadge = (action: string) => {
    switch (action) {
      case "upload":
        return {
          icon: <Upload className="w-3.5 h-3.5 text-blue-500" />,
          label: "Uploaded",
          bgColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
        };
      case "preview":
        return {
          icon: <Eye className="w-3.5 h-3.5 text-emerald-500" />,
          label: "Previewed",
          bgColor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        };
      case "download":
        return {
          icon: <Download className="w-3.5 h-3.5 text-purple-500" />,
          label: "Downloaded",
          bgColor: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
        };
      case "rename":
        return {
          icon: <Edit2 className="w-3.5 h-3.5 text-amber-500" />,
          label: "Renamed",
          bgColor: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
        };
      case "move":
        return {
          icon: <FolderInput className="w-3.5 h-3.5 text-indigo-500" />,
          label: "Moved",
          bgColor: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
        };
      case "copy":
        return {
          icon: <Copy className="w-3.5 h-3.5 text-teal-500" />,
          label: "Duplicated",
          bgColor: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
        };
      case "delete":
        return {
          icon: <Trash2 className="w-3.5 h-3.5 text-rose-500" />,
          label: "Deleted",
          bgColor: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
        };
      default:
        return {
          icon: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
          label: action,
          bgColor: "bg-muted text-muted-foreground border-border",
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Recent Activity</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Audit log of recently accessed, uploaded, downloaded, and modified files.
          </p>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 flex-wrap bg-card border border-border rounded-xl p-1 text-xs">
          {[
            { id: "all", label: "All Events" },
            { id: "upload", label: "Uploads" },
            { id: "preview", label: "Previews" },
            { id: "download", label: "Downloads" },
            { id: "rename", label: "Renames" },
            { id: "move", label: "Moves" },
            { id: "copy", label: "Copies" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setActionFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
                actionFilter === f.id
                  ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline List */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm">Loading activity history...</span>
        </div>
      ) : activities.length === 0 ? (
        <div className="py-16 text-center rounded-3xl border border-dashed border-border bg-card/40 space-y-2">
          <Clock className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
          <h3 className="font-semibold text-sm text-foreground">No recent activity found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Actions like uploads, previews, downloads, and file reorganizations will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden shadow-xs">
          {activities.map((act) => {
            const badge = getActionBadge(act.action);
            const isClickable = Boolean(act.file && !act.file.isTrashed);

            return (
              <div
                key={act.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/40 transition-colors gap-4"
              >
                {/* Left: Action Icon + Item info */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
                    {badge.icon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        onClick={() => {
                          if (isClickable && act.file) {
                            setPreviewFile({
                              id: act.file.id,
                              originalName: act.file.originalName,
                              storedName: "",
                              mimeType: act.file.mimeType,
                              extension: act.file.extension,
                              size: act.file.size,
                              createdAt: act.createdAt,
                              updatedAt: act.createdAt,
                            });
                          }
                        }}
                        className={`text-sm font-semibold text-foreground truncate max-w-md ${
                          isClickable ? "hover:underline hover:text-primary cursor-pointer" : ""
                        }`}
                      >
                        {act.itemName}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bgColor}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground mt-0.5">
                      {act.details?.size ? `${formatBytes(act.details.size)} • ` : ""}
                      {act.details?.mimeType ? `${act.details.mimeType} • ` : ""}
                      {new Date(act.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>

                {/* Right: Quick Preview/Download Actions if available */}
                {isClickable && act.file && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setPreviewFile({
                          id: act.file!.id,
                          originalName: act.file!.originalName,
                          storedName: "",
                          mimeType: act.file!.mimeType,
                          extension: act.file!.extension,
                          size: act.file!.size,
                          createdAt: act.createdAt,
                          updatedAt: act.createdAt,
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium cursor-pointer text-foreground flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      <span className="hidden sm:inline">Preview</span>
                    </button>

                    <a
                      href={`/api/files/${act.file.id}/download`}
                      download={act.file.originalName}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Download file"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Embedded File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          isOpen={Boolean(previewFile)}
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
