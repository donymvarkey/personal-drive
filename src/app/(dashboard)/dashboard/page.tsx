import { getStorageStats } from "@/app/actions/storage";
import { formatBytes } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  HardDrive,
  Upload,
  FolderPlus,
  Folder as FolderIcon,
  FileText,
  Image as ImageIcon,
  Archive,
  Star,
  Trash2,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Download,
  Film,
  FileCode,
  File as GenericFile,
  Activity,
  Eye,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  const stats = await getStorageStats();

  let fileCount = 0;
  let folderCount = 0;
  let starredCount = 0;
  let recentUploadsCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recentFiles: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let starredFiles: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recentActivities: any[] = [];

  if (session?.user?.id) {
    const ownerId = session.user.id;
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalFiles,
      totalFolders,
      totalStarred,
      recentWeek,
      filesList,
      starredList,
      activitiesList,
    ] = await Promise.all([
      prisma.file.count({
        where: { ownerId, deletedAt: null, isTrashed: false },
      }),
      prisma.folder.count({
        where: { ownerId, deletedAt: null, isTrashed: false },
      }),
      prisma.file.count({
        where: { ownerId, deletedAt: null, isStarred: true, isTrashed: false },
      }),
      prisma.file.count({
        where: {
          ownerId,
          deletedAt: null,
          isTrashed: false,
          createdAt: { gte: oneWeekAgo },
        },
      }),
      prisma.file.findMany({
        where: { ownerId, deletedAt: null, isTrashed: false },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.file.findMany({
        where: { ownerId, deletedAt: null, isStarred: true, isTrashed: false },
        orderBy: { updatedAt: "desc" },
        take: 4,
      }),
      prisma.activityLog.findMany({
        where: { ownerId },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
    ]);

    fileCount = totalFiles;
    folderCount = totalFolders;
    starredCount = totalStarred;
    recentUploadsCount = recentWeek;
    recentFiles = filesList.map((f) => ({ ...f, size: Number(f.size) }));
    starredFiles = starredList.map((f) => ({ ...f, size: Number(f.size) }));
    recentActivities = activitiesList;
  }

  const getFileIcon = (mimeType: string, extension: string) => {
    const ext = extension.toLowerCase();
    if (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
      return <ImageIcon className="w-4 h-4 text-purple-500" />;
    }
    if (mimeType.startsWith("video/") || ["mp4", "mkv", "mov"].includes(ext)) {
      return <Film className="w-4 h-4 text-rose-500" />;
    }
    if (mimeType.includes("pdf") || ext === "pdf") {
      return <FileText className="w-4 h-4 text-red-500" />;
    }
    if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) {
      return <Archive className="w-4 h-4 text-amber-500" />;
    }
    if (["ts", "tsx", "js", "jsx", "json", "py", "sh", "rs", "go"].includes(ext)) {
      return <FileCode className="w-4 h-4 text-emerald-500" />;
    }
    return <GenericFile className="w-4 h-4 text-blue-500" />;
  };

  const getActivityBadge = (action: string) => {
    switch (action) {
      case "upload":
        return { label: "Uploaded", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" };
      case "preview":
        return { label: "Previewed", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
      case "download":
        return { label: "Downloaded", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" };
      case "rename":
        return { label: "Renamed", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" };
      case "move":
        return { label: "Moved", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" };
      case "copy":
        return { label: "Duplicated", color: "bg-teal-500/10 text-teal-600 dark:text-teal-400" };
      default:
        return { label: action, color: "bg-muted text-muted-foreground" };
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome & Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Drive Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Private, self-hosted personal storage backed by physical server disk.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/files"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition-colors shadow-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Files</span>
          </Link>
        </div>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* Storage Capacity Hero Card (spans 2 cols on lg) */}
        <div className="sm:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-foreground">Physical Storage Disk</h3>
                  <p className="text-xs text-muted-foreground">Attached Linux host volume</p>
                </div>
              </div>

              {stats.valid ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Healthy
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Unmounted
                </span>
              )}
            </div>

            {stats.valid ? (
              <div className="space-y-3 mt-4">
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tracking-tight text-foreground">
                      {formatBytes(stats.usedBytes)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      used of {formatBytes(stats.totalBytes)}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {stats.usedPercent}%
                  </span>
                </div>

                <div className="w-full h-3 bg-muted rounded-full overflow-hidden p-0.5">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(Math.max(stats.usedPercent, 2), 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                  <span>Free space: {formatBytes(stats.freeBytes)}</span>
                  <Link href="/settings" className="hover:text-primary transition-colors inline-flex items-center gap-1">
                    Storage details <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm mt-3">
                {stats.error || "Storage path is inaccessible. Verify physical mount."}
              </div>
            )}
          </div>
        </div>

        {/* Files Count Tile */}
        <Link
          href="/files"
          className="rounded-2xl border border-border bg-card p-5 shadow-xs hover:border-primary/50 hover:shadow-sm transition-all group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <GenericFile className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-foreground">{fileCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total files</p>
          </div>
        </Link>

        {/* Folders Count Tile */}
        <Link
          href="/files"
          className="rounded-2xl border border-border bg-card p-5 shadow-xs hover:border-primary/50 hover:shadow-sm transition-all group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <FolderIcon className="w-5 h-5 fill-amber-500/20" />
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-foreground">{folderCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total folders</p>
          </div>
        </Link>
      </div>

      {/* Middle: Starred Items & Recent Uploads Grid */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Starred Items Section */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              <h2 className="text-base font-semibold text-foreground">Starred Items</h2>
            </div>
            <Link href="/starred" className="text-xs text-primary hover:underline font-medium">
              View all ({starredCount})
            </Link>
          </div>

          {starredFiles.length > 0 ? (
            <div className="divide-y divide-border/60">
              {starredFiles.map((file) => (
                <div
                  key={file.id}
                  className="py-2.5 flex items-center justify-between hover:bg-muted/40 px-2 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      {getFileIcon(file.mimeType, file.extension)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate max-w-xs">
                        {file.originalName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(file.size)} • {file.extension.toUpperCase()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/files/${file.id}/download`}
                      download={file.originalName}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground space-y-1">
              <p>No starred items yet.</p>
              <p className="text-muted-foreground/60">Mark important files with a star for quick access.</p>
            </div>
          )}
        </div>

        {/* Recent Activity Timeline Section */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Recent Activity</h2>
            </div>
            <Link href="/recent" className="text-xs text-primary hover:underline font-medium">
              View full audit log
            </Link>
          </div>

          {recentActivities.length > 0 ? (
            <div className="divide-y divide-border/60">
              {recentActivities.map((act) => {
                const badge = getActivityBadge(act.action);
                return (
                  <div
                    key={act.id}
                    className="py-2.5 flex items-center justify-between hover:bg-muted/40 px-2 rounded-xl transition-colors text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0 ${badge.color}`}>
                        {badge.label}
                      </span>
                      <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-xs">
                        {act.itemName}
                      </span>
                    </div>

                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {new Date(act.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground space-y-1">
              <p>No activity recorded yet.</p>
              <p className="text-muted-foreground/60">Uploads, downloads, and previews will appear here.</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Recent Uploads Card */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Recent Uploads</h2>
          </div>
          <Link href="/files" className="text-xs text-primary hover:underline font-medium">
            Browse all files
          </Link>
        </div>

        {recentFiles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentFiles.map((file) => (
              <div
                key={file.id}
                className="p-3.5 rounded-xl border border-border bg-background/50 hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    {getFileIcon(file.mimeType, file.extension)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-foreground truncate max-w-[160px]" title={file.originalName}>
                      {file.originalName}
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      {formatBytes(file.size)} • {new Date(file.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <a
                  href={`/api/files/${file.id}/download`}
                  download={file.originalName}
                  className="p-1.5 rounded-lg hover:bg-card border border-border/80 text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                  title="Download file"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No files uploaded yet.
          </div>
        )}
      </div>
    </div>
  );
}
