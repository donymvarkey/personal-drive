"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatBytes } from "@/lib/utils";
import {
  Upload,
  Download,
  Trash2,
  Star,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
  FileText,
  FileCode,
  Image as ImageIcon,
  Film,
  Archive,
  File as GenericFile,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  Folder as FolderIcon,
  FolderPlus,
  MoreVertical,
  Copy,
  FolderInput,
  Edit2,
  ChevronRight,
  Home,
  CheckSquare,
  Square,
  PackageCheck,
  Calendar,
  Filter,
  Eye,
  History,
} from "lucide-react";
import { MoveModal } from "./move-modal";
import { FilePreviewModal } from "@/components/preview/file-preview-modal";
import { VersionHistoryModal } from "./version-history-modal";

export interface DriveFile {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  extension: string;
  size: number;
  checksum: string;
  folderId: string | null;
  isStarred: boolean;
  isTrashed: boolean;
  storageStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
  isStarred?: boolean;
  isTrashed?: boolean;
  createdAt: string;
  updatedAt: string;
  filesCount?: number;
  childrenCount?: number;
}

interface UploadTask {
  id: string;
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error" | "cancelled";
  error?: string;
  isDuplicate?: boolean;
  duplicateOf?: string | null;
  xhr?: XMLHttpRequest;
}

interface BreadcrumbItem {
  id: string | null;
  name: string;
}

interface FileExplorerProps {
  filter?: "all" | "starred" | "recent" | "trash";
  title?: string;
  description?: string;
}

export function FileExplorer({
  filter = "all",
  title = "My Files",
  description = "Browse, organize, and manage files and folders stored on your physical storage.",
}: FileExplorerProps) {
  // Items state
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: null, name: "Drive" },
  ]);

  // View & Filter state
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"createdAt" | "originalName" | "size" | "updatedAt" | "extension">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Selection state
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());

  // Upload state
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals state
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: "file" | "folder" } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
    permanent?: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{
    fileIds: string[];
    folderIds: string[];
    names: string[];
  } | null>(null);

  // Preview & Version History Modal state
  const [previewTarget, setPreviewTarget] = useState<DriveFile | null>(null);
  const [versionTarget, setVersionTarget] = useState<DriveFile | null>(null);
  const [emptyTrashConfirmOpen, setEmptyTrashConfirmOpen] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  // Action menu popover state
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const showToast = useCallback((text: string, type: "success" | "error" | "info" = "info") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-action-menu]")) {
        setActiveMenuId(null);
      }
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // Fetch folders and files
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      if (filter === "starred") {
        const res = await fetch("/api/starred");
        if (!res.ok) throw new Error("Failed to load starred items");
        const data = await res.json();
        setFiles(data.files || []);
        setFolders(data.folders || []);
        setBreadcrumbs([{ id: null, name: "Starred Items" }]);
      } else if (filter === "trash") {
        const [filesRes, foldersRes] = await Promise.all([
          fetch("/api/files?trashed=true"),
          fetch("/api/folders?trashed=true"),
        ]);
        const filesData = await filesRes.json();
        const foldersData = await foldersRes.json();
        setFiles(filesData.files || []);
        setFolders(foldersData.folders || []);
        setBreadcrumbs([{ id: null, name: "Trash" }]);
      } else {
        const filesParams = new URLSearchParams({
          sortBy,
          order: sortOrder,
          fileType: fileTypeFilter,
          dateRange: dateFilter,
        });

        if (filter === "recent") {
          filesParams.set("folderId", "all");
          filesParams.set("sortBy", "updatedAt");
          filesParams.set("order", "desc");
        } else {
          filesParams.set("folderId", currentFolderId || "root");
        }

        if (searchQuery.trim()) {
          filesParams.set("search", searchQuery.trim());
        }

        const filesPromise = fetch(`/api/files?${filesParams.toString()}`).then((r) => r.json());

        let foldersPromise: Promise<{ folders: DriveFolder[] }> = Promise.resolve({ folders: [] });
        if (filter !== "recent") {
          const folderUrl = currentFolderId
            ? `/api/folders?parentId=${encodeURIComponent(currentFolderId)}`
            : "/api/folders";
          foldersPromise = fetch(folderUrl).then((r) => r.json());
        }

        const [filesData, foldersData] = await Promise.all([filesPromise, foldersPromise]);
        setFiles(filesData.files || []);
        setFolders(foldersData.folders || []);

        if (currentFolderId && filter === "all") {
          try {
            const folderDetailRes = await fetch(`/api/folders/${currentFolderId}`);
            if (folderDetailRes.ok) {
              const detailData = await folderDetailRes.json();
              const crumbs: BreadcrumbItem[] = [{ id: null, name: "Drive" }];
              if (detailData.breadcrumbs) {
                detailData.breadcrumbs.forEach((b: { id: string; name: string }) => {
                  crumbs.push({ id: b.id, name: b.name });
                });
              }
              setBreadcrumbs(crumbs);
            }
          } catch {
            // fallback
          }
        } else {
          setBreadcrumbs([
            { id: null, name: filter === "recent" ? "Recent Files" : "Drive" },
          ]);
        }
      }
    } catch {
      showToast("Could not load files and folders.", "error");
    } finally {
      setLoading(false);
    }
  }, [filter, currentFolderId, sortBy, sortOrder, fileTypeFilter, dateFilter, searchQuery, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
  }, [currentFolderId, filter]);

  // Upload handler
  const uploadFiles = (newFiles: FileList | File[]) => {
    const list = Array.from(newFiles);
    if (list.length === 0) return;

    list.forEach((file) => {
      const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);
      if (currentFolderId) {
        formData.append("folderId", currentFolderId);
      }

      const task: UploadTask = {
        id: taskId,
        file,
        progress: 0,
        status: "uploading",
        xhr,
      };

      setUploadTasks((prev) => [task, ...prev]);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, progress: percent } : t))
          );
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText);
            const uploadedFile = resp.files?.[0];
            const isDup = uploadedFile?.isDuplicate;
            const dupOf = uploadedFile?.duplicateOf;

            setUploadTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? {
                    ...t,
                    progress: 100,
                    status: "completed",
                    isDuplicate: isDup,
                    duplicateOf: dupOf,
                  }
                  : t
              )
            );

            if (isDup) {
              showToast(`"${file.name}" uploaded. Matches "${dupOf}".`, "info");
            } else {
              showToast(`"${file.name}" saved to physical storage.`, "success");
            }
            fetchData();
          } catch {
            fetchData();
          }
        } else {
          let errText = "Upload failed";
          try {
            const errJson = JSON.parse(xhr.responseText);
            errText = errJson.error || errText;
          } catch {
            errText = xhr.statusText || errText;
          }
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, status: "error", error: errText } : t
            )
          );
          showToast(`Upload failed for "${file.name}": ${errText}`, "error");
        }
      };

      xhr.onerror = () => {
        setUploadTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "error", error: "Storage or network error" } : t
          )
        );
        showToast(`Error uploading "${file.name}".`, "error");
      };

      xhr.onabort = () => {
        setUploadTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: "cancelled" } : t))
        );
        showToast(`Upload cancelled: "${file.name}".`, "info");
      };

      xhr.open("POST", "/api/files/upload", true);
      xhr.send(formData);
    });
  };

  const cancelUpload = (taskId: string) => {
    setUploadTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (task?.xhr && task.status === "uploading") {
        task.xhr.abort();
      }
      return prev.map((t) => (t.id === taskId ? { ...t, status: "cancelled" } : t));
    });
  };

  const clearUploadTask = (taskId: string) => {
    setUploadTasks((prev) => prev.filter((t) => t.status === "uploading"));
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (filter !== "trash") setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (filter === "trash") return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  // Empty Trash Handler
  const handleEmptyTrash = async () => {
    try {
      setEmptyingTrash(true);
      const res = await fetch("/api/trash/empty", { method: "POST" });
      if (!res.ok) throw new Error("Failed to empty trash");
      const data = await res.json();
      showToast(
        `Trash emptied: ${data.filesDeleted || 0} files and ${data.foldersDeleted || 0} folders permanently removed.`,
        "info"
      );
      setEmptyTrashConfirmOpen(false);
      fetchData();
    } catch {
      showToast("Failed to empty trash.", "error");
    } finally {
      setEmptyingTrash(false);
    }
  };

  // Create Folder Handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      setCreatingFolder(true);
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: currentFolderId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create folder");
      }

      showToast(`Folder "${newFolderName.trim()}" created.`, "success");
      setNewFolderName("");
      setNewFolderOpen(false);
      fetchData();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to create folder.", "error");
    } finally {
      setCreatingFolder(false);
    }
  };

  // Rename Handler
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;

    try {
      setRenaming(true);
      const endpoint =
        renameTarget.type === "folder"
          ? `/api/folders/${renameTarget.id}`
          : `/api/files/${renameTarget.id}`;

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to rename");
      }

      showToast(`Renamed to "${renameValue.trim()}".`, "success");
      setRenameTarget(null);
      setRenameValue("");
      fetchData();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to rename.", "error");
    } finally {
      setRenaming(false);
    }
  };

  // Delete Handler
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmTarget) return;

    try {
      setDeleting(true);
      const isPermanent = deleteConfirmTarget.permanent;
      const endpoint =
        deleteConfirmTarget.type === "folder"
          ? `/api/folders/${deleteConfirmTarget.id}${isPermanent ? "?permanent=true" : ""}`
          : `/api/files/${deleteConfirmTarget.id}${isPermanent ? "?permanent=true" : ""}`;

      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete item");
      }

      showToast(
        isPermanent
          ? `"${deleteConfirmTarget.name}" permanently deleted.`
          : `"${deleteConfirmTarget.name}" moved to Trash.`,
        "info"
      );
      setDeleteConfirmTarget(null);
      fetchData();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to delete.", "error");
    } finally {
      setDeleting(false);
    }
  };

  // Restore Handler
  const handleRestore = async (id: string, type: "file" | "folder") => {
    try {
      const endpoint = type === "folder" ? `/api/folders/${id}` : `/api/files/${id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });

      if (!res.ok) throw new Error("Failed to restore item");
      showToast("Item restored from trash.", "success");
      fetchData();
    } catch {
      showToast("Failed to restore item.", "error");
    }
  };

  // Star Toggle Handler
  const handleToggleStar = async (id: string, type: "file" | "folder", currentStarred: boolean) => {
    try {
      const nextStarred = !currentStarred;
      const res = await fetch("/api/starred", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [type === "folder" ? "folderId" : "fileId"]: id,
          starred: nextStarred,
        }),
      });

      if (!res.ok) throw new Error("Failed to update starred status");

      if (type === "file") {
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, isStarred: nextStarred } : f))
        );
      } else {
        setFolders((prev) =>
          prev.map((f) => (f.id === id ? { ...f, isStarred: nextStarred } : f))
        );
      }

      showToast(nextStarred ? "Added to Starred." : "Removed from Starred.", "info");
      if (filter === "starred" && !nextStarred) {
        fetchData();
      }
    } catch {
      showToast("Failed to update star.", "error");
    }
  };

  // Copy File Handler
  const handleCopyFile = async (file: DriveFile) => {
    try {
      showToast(`Copying "${file.originalName}"...`, "info");
      const res = await fetch(`/api/files/${file.id}/copy`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Copy failed");
      }
      showToast(`Created copy of "${file.originalName}".`, "success");
      fetchData();
    } catch (err: unknown) {
      showToast((err as Error).message || "Failed to copy file.", "error");
    }
  };

  // Single Move Trigger
  const triggerSingleMove = (id: string, name: string, type: "file" | "folder") => {
    setMoveTarget({
      fileIds: type === "file" ? [id] : [],
      folderIds: type === "folder" ? [id] : [],
      names: [name],
    });
    setMoveModalOpen(true);
  };

  // Bulk Move Trigger
  const triggerBulkMove = () => {
    const selectedNames: string[] = [];
    selectedFolderIds.forEach((id) => {
      const f = folders.find((item) => item.id === id);
      if (f) selectedNames.push(f.name);
    });
    selectedFileIds.forEach((id) => {
      const f = files.find((item) => item.id === id);
      if (f) selectedNames.push(f.originalName);
    });

    setMoveTarget({
      fileIds: Array.from(selectedFileIds),
      folderIds: Array.from(selectedFolderIds),
      names: selectedNames,
    });
    setMoveModalOpen(true);
  };

  // Execute Move
  const handleExecuteMove = async (targetFolderId: string | null) => {
    if (!moveTarget) return;

    const res = await fetch("/api/files/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move",
        fileIds: moveTarget.fileIds,
        folderIds: moveTarget.folderIds,
        targetFolderId,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to move items");
    }

    showToast(`Successfully moved ${moveTarget.names.length} item(s).`, "success");
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
    fetchData();
  };

  // Bulk Delete
  const handleBulkDelete = async (permanent: boolean = false) => {
    const totalCount = selectedFileIds.size + selectedFolderIds.size;
    if (totalCount === 0) return;

    try {
      const res = await fetch("/api/files/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          fileIds: Array.from(selectedFileIds),
          folderIds: Array.from(selectedFolderIds),
          permanent,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Bulk delete failed");
      }

      showToast(
        permanent
          ? `${totalCount} item(s) permanently removed from disk.`
          : `${totalCount} item(s) moved to Trash.`,
        "info"
      );
      setSelectedFileIds(new Set());
      setSelectedFolderIds(new Set());
      fetchData();
    } catch (err: unknown) {
      showToast((err as Error).message || "Bulk delete failed.", "error");
    }
  };

  // Bulk ZIP Download
  const handleBulkDownload = async () => {
    if (selectedFileIds.size === 0) {
      showToast("Please select at least one file to download.", "info");
      return;
    }

    try {
      showToast("Generating ZIP archive stream...", "info");
      const res = await fetch("/api/files/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selectedFileIds) }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create archive");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `personal-drive-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showToast("ZIP archive downloaded.", "success");
    } catch (err: unknown) {
      showToast((err as Error).message || "ZIP download failed.", "error");
    }
  };

  // Selection toggles
  const toggleSelectFile = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectFolder = (id: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedFileIds.size === files.length && selectedFolderIds.size === folders.length) {
      setSelectedFileIds(new Set());
      setSelectedFolderIds(new Set());
    } else {
      setSelectedFileIds(new Set(files.map((f) => f.id)));
      setSelectedFolderIds(new Set(folders.map((f) => f.id)));
    }
  };

  const selectedTotal = selectedFileIds.size + selectedFolderIds.size;

  // File type icon helper
  const getFileIcon = (mime: string, ext: string) => {
    const cleanExt = ext.toLowerCase();
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(cleanExt)) {
      return <ImageIcon className="w-5 h-5 text-blue-500" />;
    }
    if (mime.startsWith("video/") || ["mp4", "mkv", "mov", "webm"].includes(cleanExt)) {
      return <Film className="w-5 h-5 text-purple-500" />;
    }
    if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed") || ["zip", "tar", "gz", "rar", "7z"].includes(cleanExt)) {
      return <Archive className="w-5 h-5 text-amber-500" />;
    }
    if (
      mime.includes("javascript") ||
      mime.includes("typescript") ||
      mime.includes("json") ||
      ["js", "ts", "tsx", "jsx", "json", "py", "sh", "rs", "go", "html", "css"].includes(cleanExt)
    ) {
      return <FileCode className="w-5 h-5 text-emerald-500" />;
    }
    if (mime.includes("pdf") || mime.includes("text") || ["pdf", "txt", "md", "doc", "docx"].includes(cleanExt)) {
      return <FileText className="w-5 h-5 text-rose-500" />;
    }
    return <GenericFile className="w-5 h-5 text-muted-foreground" />;
  };

  return (
    <div
      className="space-y-6"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border animate-in slide-in-from-bottom-5 ${toastMessage.type === "success"
            ? "bg-emerald-500 text-white border-emerald-600"
            : toastMessage.type === "error"
              ? "bg-rose-500 text-white border-rose-600"
              : "bg-slate-900 text-white border-slate-700 dark:bg-slate-100 dark:text-slate-900"
            }`}
        >
          {toastMessage.type === "success" && <CheckCircle2 className="w-5 h-5" />}
          {toastMessage.type === "error" && <AlertCircle className="w-5 h-5" />}
          {toastMessage.type === "info" && <CheckCircle2 className="w-5 h-5" />}
          <span className="text-sm font-medium">{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 p-1 hover:opacity-75 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Floating Selection Toolbar */}
      {selectedTotal > 0 && (
        <div className="sticky top-4 z-40 flex items-center justify-between p-3.5 rounded-2xl bg-primary text-primary-foreground shadow-2xl animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/20 text-xs font-bold">
              {selectedTotal}
            </div>
            <span className="text-sm font-semibold">
              {selectedTotal} item{selectedTotal > 1 ? "s" : ""} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            {filter === "trash" && (files.length > 0 || folders.length > 0) && (
              <button
                onClick={() => setEmptyTrashConfirmOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-semibold transition-colors shadow-xs cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Empty Trash</span>
              </button>
            )}

            {filter !== "trash" && (
              <>
                <button
                  onClick={triggerBulkMove}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium cursor-pointer transition-colors"
                >
                  <FolderInput className="w-4 h-4" />
                  Move
                </button>

                {selectedFileIds.size > 0 && (
                  <button
                    onClick={handleBulkDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium cursor-pointer transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download ZIP
                  </button>
                )}

                <button
                  onClick={() => handleBulkDelete(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/80 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Trash
                </button>
              </>
            )}

            {filter === "trash" && (
              <button
                onClick={() => handleBulkDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium cursor-pointer transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Forever
              </button>
            )}

            <button
              onClick={() => {
                setSelectedFileIds(new Set());
                setSelectedFolderIds(new Set());
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white cursor-pointer ml-1"
              title="Deselect all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Explorer Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>

        {filter === "trash" && (files.length > 0 || folders.length > 0) && (
          <button
            onClick={() => setEmptyTrashConfirmOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-semibold transition-colors shadow-xs cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Empty Trash</span>
          </button>
        )}

        {filter !== "trash" && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setNewFolderOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border bg-card hover:bg-muted text-card-foreground text-sm font-medium transition-colors shadow-xs cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-primary" />
              <span>New Folder</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors shadow-xs cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Files</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      {/* Breadcrumb Navigation Bar */}
      {filter === "all" && (
        <nav className="flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl bg-muted/40 border border-border/60 overflow-x-auto">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <div key={crumb.id || "root"} className="flex items-center gap-1.5 shrink-0">
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />}
                {isLast ? (
                  <span className="font-semibold text-foreground flex items-center gap-1.5 px-2 py-1 rounded-lg bg-card border border-border/80 shadow-2xs">
                    {crumb.id === null ? <Home className="w-3.5 h-3.5 text-primary" /> : <FolderIcon className="w-3.5 h-3.5 text-amber-500 fill-amber-500/20" />}
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    onClick={() => setCurrentFolderId(crumb.id)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card cursor-pointer transition-colors"
                  >
                    {crumb.id === null ? <Home className="w-3.5 h-3.5" /> : <FolderIcon className="w-3.5 h-3.5 text-amber-500/80" />}
                    <span>{crumb.name}</span>
                  </button>
                )}
              </div>
            );
          })}
        </nav>
      )}

      {/* Toolbar: Search, Filters, Sorting, and View Modes */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter current view..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-input bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters and Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* File Type Filter */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={fileTypeFilter}
              onChange={(e) => setFileTypeFilter(e.target.value)}
              className="bg-transparent text-foreground font-medium focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="documents">Documents</option>
              <option value="images">Images</option>
              <option value="videos">Videos</option>
              <option value="audio">Audio</option>
              <option value="archives">Archives</option>
              <option value="code">Code</option>
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent text-foreground font-medium focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">Past 7 Days</option>
              <option value="month">Past 30 Days</option>
              <option value="year">Past Year</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground">
            <ArrowUpDown className="w-3.5 h-3.5" />
            <select
              value={sortBy}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-foreground font-medium focus:outline-hidden cursor-pointer"
            >
              <option value="createdAt">Date Uploaded</option>
              <option value="updatedAt">Date Modified</option>
              <option value="originalName">Name</option>
              <option value="size">Size</option>
              <option value="extension">File Type</option>
            </select>

            <button
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              className="px-1 text-xs font-semibold uppercase hover:text-foreground cursor-pointer"
              title="Toggle sort direction"
            >
              {sortOrder}
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center border border-border bg-card rounded-xl p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${viewMode === "grid"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
                }`}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-lg cursor-pointer transition-colors ${viewMode === "list"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
                }`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Drag & Drop Visual Overlay */}
      {isDragging && filter !== "trash" && (
        <div className="border-2 border-dashed border-primary rounded-3xl p-12 text-center bg-primary/5 animate-pulse flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <Upload className="w-7 h-7" />
          </div>
          <div className="text-base font-semibold text-primary">
            Drop files to store them directly on physical storage
          </div>
          <div className="text-xs text-muted-foreground">
            {currentFolderId ? "Files will be organized in this folder" : "Files will be placed in root Drive"}
          </div>
        </div>
      )}

      {/* Active Uploads Drawer */}
      {uploadTasks.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Uploads Queue ({uploadTasks.filter((t) => t.status === "uploading").length} active)
            </span>
            <button
              onClick={() => setUploadTasks((prev) => prev.filter((t) => t.status === "uploading"))}
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Clear Finished
            </button>
          </div>

          <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
            {uploadTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 text-xs p-2 rounded-xl bg-muted/40 border border-border/50"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Upload className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-medium truncate text-foreground">{task.file.name}</span>
                  <span className="text-muted-foreground shrink-0">({formatBytes(task.file.size)})</span>

                  {task.isDuplicate && (
                    <span className="px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-[10px] shrink-0">
                      SHA Duplicate
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {task.status === "uploading" && (
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-primary h-full transition-all duration-300"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <span className="font-mono text-muted-foreground">{task.progress}%</span>
                      <button
                        onClick={() => cancelUpload(task.id)}
                        className="p-1 text-muted-foreground hover:text-destructive cursor-pointer"
                        title="Cancel upload"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {task.status === "completed" && (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Saved
                    </span>
                  )}

                  {task.status === "error" && (
                    <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {task.error || "Failed"}
                    </span>
                  )}

                  {task.status === "cancelled" && (
                    <span className="text-muted-foreground">Cancelled</span>
                  )}

                  {task.status !== "uploading" && (
                    <button
                      onClick={() => clearUploadTask(task.id)}
                      className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
          <span className="text-sm">Loading storage items...</span>
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center gap-4 text-center rounded-3xl border border-dashed border-border bg-card/50">
          <div className="w-16 h-16 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center">
            <PackageCheck className="w-8 h-8 stroke-1" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-base text-foreground">
              {filter === "trash" ? "Trash is empty" : "No files or folders yet"}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              {filter === "trash"
                ? "Deleted items will appear here before being permanently removed from disk."
                : "Create a folder or drop files anywhere on this page to begin storing files on your physical disk."}
            </p>
          </div>
          {filter === "trash" && (files.length > 0 || folders.length > 0) && (
            <button
              onClick={() => setEmptyTrashConfirmOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-semibold transition-colors shadow-xs cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Empty Trash</span>
            </button>
          )}

          {filter !== "trash" && (
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setNewFolderOpen(true)}
                className="px-3.5 py-2 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold cursor-pointer"
              >
                Create Folder
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer"
              >
                Upload File
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Select All Bar */}
          <div className="flex items-center justify-between pb-2 border-b border-border text-xs text-muted-foreground">
            <button
              onClick={selectAll}
              className="flex items-center gap-2 hover:text-foreground cursor-pointer font-medium"
            >
              {selectedTotal > 0 && selectedTotal === files.length + folders.length ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : selectedTotal > 0 ? (
                <div className="w-4 h-4 rounded-sm bg-primary/20 flex items-center justify-center">
                  <div className="w-2 h-0.5 bg-primary rounded-full" />
                </div>
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span>Select all items ({folders.length + files.length})</span>
            </button>
            <span>
              {folders.length} folder{folders.length !== 1 ? "s" : ""}, {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Section: FOLDERS */}
          {folders.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <FolderIcon className="w-4 h-4 text-amber-500" />
                <span>Folders ({folders.length})</span>
              </h2>

              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {folders.map((folder) => {
                    const isSelected = selectedFolderIds.has(folder.id);
                    return (
                      <div
                        key={folder.id}
                        className={`group relative flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${isSelected
                          ? "border-primary bg-primary/5 shadow-xs"
                          : "border-border bg-card hover:border-primary/50 hover:shadow-xs"
                          }`}
                        onClick={() => {
                          if (filter !== "trash") {
                            setCurrentFolderId(folder.id);
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectFolder(folder.id);
                            }}
                            className="text-muted-foreground hover:text-primary cursor-pointer shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4 group-hover:text-foreground opacity-40 group-hover:opacity-100" />
                            )}
                          </button>

                          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                            <FolderIcon className="w-5 h-5 fill-amber-500/20" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-semibold text-foreground truncate" title={folder.name}>
                              {folder.name}
                            </h4>
                            <p className="text-[11px] text-muted-foreground">
                              {folder.filesCount !== undefined ? `${folder.filesCount} file(s)` : "Folder"}
                            </p>
                          </div>
                        </div>

                        {/* Folder Action Menu Button */}
                        <div className="relative shrink-0" data-action-menu>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuId(activeMenuId === folder.id ? null : folder.id);
                            }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeMenuId === folder.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-border bg-card p-1 shadow-xl text-xs space-y-0.5 animate-in zoom-in-95"
                            >
                              {filter !== "trash" ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setCurrentFolderId(folder.id);
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                  >
                                    <FolderIcon className="w-3.5 h-3.5 text-amber-500" />
                                    Open
                                  </button>

                                  <button
                                    onClick={() => {
                                      handleToggleStar(folder.id, "folder", Boolean(folder.isStarred));
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                  >
                                    <Star className={`w-3.5 h-3.5 ${folder.isStarred ? "text-amber-500 fill-amber-500" : ""}`} />
                                    {folder.isStarred ? "Unstar" : "Star"}
                                  </button>

                                  <button
                                    onClick={() => {
                                      setRenameTarget({ id: folder.id, name: folder.name, type: "folder" });
                                      setRenameValue(folder.name);
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                  >
                                    <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                                    Rename
                                  </button>

                                  <button
                                    onClick={() => {
                                      triggerSingleMove(folder.id, folder.name, "folder");
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                  >
                                    <FolderInput className="w-3.5 h-3.5 text-muted-foreground" />
                                    Move
                                  </button>

                                  <div className="h-px bg-border my-1" />

                                  <button
                                    onClick={() => {
                                      setDeleteConfirmTarget({ id: folder.id, name: folder.name, type: "folder" });
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Move to Trash
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => {
                                      handleRestore(folder.id, "folder");
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                                    Restore
                                  </button>

                                  <button
                                    onClick={() => {
                                      setDeleteConfirmTarget({ id: folder.id, name: folder.name, type: "folder", permanent: true });
                                      setActiveMenuId(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Delete Permanently
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Folders List Mode */
                <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {folders.map((folder) => {
                    const isSelected = selectedFolderIds.has(folder.id);
                    return (
                      <div
                        key={folder.id}
                        className={`flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""
                          }`}
                        onClick={() => {
                          if (filter !== "trash") setCurrentFolderId(folder.id);
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectFolder(folder.id);
                            }}
                            className="text-muted-foreground hover:text-primary cursor-pointer shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                          <FolderIcon className="w-5 h-5 text-amber-500 fill-amber-500/20 shrink-0" />
                          <span className="font-semibold text-sm text-foreground truncate">
                            {folder.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-6 text-xs text-muted-foreground shrink-0">
                          <span>{folder.filesCount !== undefined ? `${folder.filesCount} file(s)` : "Folder"}</span>
                          <span className="hidden sm:inline">
                            {new Date(folder.updatedAt).toLocaleDateString()}
                          </span>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleStar(folder.id, "folder", Boolean(folder.isStarred));
                            }}
                            className="p-1 hover:text-foreground cursor-pointer"
                          >
                            <Star
                              className={`w-4 h-4 ${folder.isStarred ? "text-amber-500 fill-amber-500" : "text-muted-foreground/40"}`}
                            />
                          </button>

                          <div className="relative" data-action-menu>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(activeMenuId === folder.id ? null : folder.id);
                              }}
                              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {activeMenuId === folder.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-border bg-card p-1 shadow-xl text-xs space-y-0.5 animate-in zoom-in-95"
                              >
                                {filter !== "trash" ? (
                                  <>
                                    <button
                                      onClick={() => {
                                        setRenameTarget({ id: folder.id, name: folder.name, type: "folder" });
                                        setRenameValue(folder.name);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                                      Rename
                                    </button>
                                    <button
                                      onClick={() => {
                                        triggerSingleMove(folder.id, folder.name, "folder");
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <FolderInput className="w-3.5 h-3.5 text-muted-foreground" />
                                      Move
                                    </button>
                                    <button
                                      onClick={() => {
                                        setDeleteConfirmTarget({ id: folder.id, name: folder.name, type: "folder" });
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Move to Trash
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => {
                                        handleRestore(folder.id, "folder");
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                                      Restore
                                    </button>
                                    <button
                                      onClick={() => {
                                        setDeleteConfirmTarget({ id: folder.id, name: folder.name, type: "folder", permanent: true });
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Delete Permanently
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section: FILES */}
          {files.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <GenericFile className="w-4 h-4" />
                <span>Files ({files.length})</span>
              </h2>

              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {files.map((file) => {
                    const isSelected = selectedFileIds.has(file.id);
                    return (
                      <div
                        key={file.id}
                        className={`group relative flex flex-col justify-between p-4 rounded-2xl border transition-all duration-200 ${isSelected
                          ? "border-primary bg-primary/5 shadow-xs"
                          : "border-border bg-card hover:border-primary/50 hover:shadow-xs"
                          }`}
                      >
                        {/* Top: Icon, Select, and Actions */}
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => toggleSelectFile(file.id)}
                            className="text-muted-foreground hover:text-primary cursor-pointer shrink-0 mt-0.5"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4 group-hover:text-foreground opacity-40 group-hover:opacity-100" />
                            )}
                          </button>

                          <div
                            onClick={() => setPreviewTarget(file)}
                            className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 transition-transform"
                            title="Click to preview"
                          >
                            {getFileIcon(file.mimeType, file.extension)}
                          </div>

                          <div className="relative shrink-0" data-action-menu>
                            <button
                              onClick={() => setActiveMenuId(activeMenuId === file.id ? null : file.id)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {activeMenuId === file.id && (
                              <div className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-border bg-card p-1 shadow-xl text-xs space-y-0.5 animate-in zoom-in-95">
                                {filter !== "trash" ? (
                                  <>
                                    <button
                                      onClick={() => {
                                        setPreviewTarget(file);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-primary" />
                                      Preview
                                    </button>

                                    <a
                                      href={`/api/files/${file.id}/download`}
                                      download={file.originalName}
                                      onClick={() => setActiveMenuId(null)}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Download className="w-3.5 h-3.5 text-blue-500" />
                                      Download
                                    </a>

                                    <button
                                      onClick={() => {
                                        handleCopyFile(file);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Copy className="w-3.5 h-3.5 text-emerald-500" />
                                      Duplicate
                                    </button>

                                    <button
                                      onClick={() => {
                                        setVersionTarget(file);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <History className="w-3.5 h-3.5 text-primary" />
                                      Versions
                                    </button>

                                    <button
                                      onClick={() => {
                                        setRenameTarget({ id: file.id, name: file.originalName, type: "file" });
                                        setRenameValue(file.originalName);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                                      Rename
                                    </button>

                                    <button
                                      onClick={() => {
                                        triggerSingleMove(file.id, file.originalName, "file");
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <FolderInput className="w-3.5 h-3.5 text-muted-foreground" />
                                      Move
                                    </button>

                                    <button
                                      onClick={() => {
                                        handleToggleStar(file.id, "file", file.isStarred);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Star className={`w-3.5 h-3.5 ${file.isStarred ? "text-amber-500 fill-amber-500" : ""}`} />
                                      {file.isStarred ? "Unstar" : "Star"}
                                    </button>

                                    <div className="h-px bg-border my-1" />

                                    <button
                                      onClick={() => {
                                        setDeleteConfirmTarget({ id: file.id, name: file.originalName, type: "file" });
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Move to Trash
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => {
                                        handleRestore(file.id, "file");
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                                      Restore
                                    </button>
                                    <button
                                      onClick={() => {
                                        setDeleteConfirmTarget({ id: file.id, name: file.originalName, type: "file", permanent: true });
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Delete Permanently
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Middle: File Name */}
                        <div
                          className="mt-3 cursor-pointer hover:opacity-85 transition-opacity"
                          onClick={() => setPreviewTarget(file)}
                        >
                          <h4
                            className="font-medium text-sm text-foreground truncate"
                            title={file.originalName}
                          >
                            {file.originalName}
                          </h4>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span>{formatBytes(file.size)}</span>
                            <span>•</span>
                            <span className="uppercase">{file.extension || "file"}</span>
                          </div>
                        </div>

                        {/* Bottom: Date & Star */}
                        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                          {filter !== "trash" && (
                            <button
                              onClick={() => handleToggleStar(file.id, "file", file.isStarred)}
                              className="p-1 hover:text-foreground cursor-pointer"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${file.isStarred ? "text-amber-500 fill-amber-500" : "text-muted-foreground/30 hover:text-muted-foreground"}`}
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Files List Mode */
                <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {files.map((file) => {
                    const isSelected = selectedFileIds.has(file.id);
                    return (
                      <div
                        key={file.id}
                        className={`flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors ${isSelected ? "bg-primary/5" : ""
                          }`}
                      >
                        <div
                          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer hover:opacity-85 transition-opacity"
                          onClick={() => setPreviewTarget(file)}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectFile(file.id);
                            }}
                            className="text-muted-foreground hover:text-primary cursor-pointer shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>

                          <div className="shrink-0">{getFileIcon(file.mimeType, file.extension)}</div>

                          <div className="min-w-0 flex-1">
                            <h4
                              className="text-sm font-medium text-foreground truncate"
                              title={file.originalName}
                            >
                              {file.originalName}
                            </h4>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 text-xs text-muted-foreground shrink-0">
                          <span className="w-20 text-right">{formatBytes(file.size)}</span>
                          <span className="w-24 hidden md:inline truncate">{file.mimeType}</span>
                          <span className="w-24 hidden sm:inline text-right">
                            {new Date(file.createdAt).toLocaleDateString()}
                          </span>

                          {filter === "trash" && (files.length > 0 || folders.length > 0) && (
                            <button
                              onClick={() => setEmptyTrashConfirmOpen(true)}
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-semibold transition-colors shadow-xs cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>Empty Trash</span>
                            </button>
                          )}

                          {filter !== "trash" && (
                            <button
                              onClick={() => handleToggleStar(file.id, "file", file.isStarred)}
                              className="p-1 hover:text-foreground cursor-pointer"
                            >
                              <Star
                                className={`w-4 h-4 ${file.isStarred ? "text-amber-500 fill-amber-500" : "text-muted-foreground/30"}`}
                              />
                            </button>
                          )}

                          <div className="relative" data-action-menu>
                            <button
                              onClick={() => setActiveMenuId(activeMenuId === file.id ? null : file.id)}
                              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {activeMenuId === file.id && (
                              <div className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-border bg-card p-1 shadow-xl text-xs space-y-0.5 animate-in zoom-in-95">
                                {filter !== "trash" ? (
                                  <>
                                    <button
                                      onClick={() => {
                                        setPreviewTarget(file);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-primary" />
                                      Preview
                                    </button>

                                    <a
                                      href={`/api/files/${file.id}/download`}
                                      download={file.originalName}
                                      onClick={() => setActiveMenuId(null)}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Download className="w-3.5 h-3.5 text-blue-500" />
                                      Download
                                    </a>

                                    <button
                                      onClick={() => {
                                        handleCopyFile(file);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Copy className="w-3.5 h-3.5 text-emerald-500" />
                                      Duplicate
                                    </button>

                                    <button
                                      onClick={() => {
                                        setVersionTarget(file);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <History className="w-3.5 h-3.5 text-primary" />
                                      Versions
                                    </button>

                                    <button
                                      onClick={() => {
                                        setRenameTarget({ id: file.id, name: file.originalName, type: "file" });
                                        setRenameValue(file.originalName);
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                                      Rename
                                    </button>

                                    <button
                                      onClick={() => {
                                        triggerSingleMove(file.id, file.originalName, "file");
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <FolderInput className="w-3.5 h-3.5 text-muted-foreground" />
                                      Move
                                    </button>

                                    <div className="h-px bg-border my-1" />

                                    <button
                                      onClick={() => {
                                        setDeleteConfirmTarget({ id: file.id, name: file.originalName, type: "file" });
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Move to Trash
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => {
                                        handleRestore(file.id, "file");
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted font-medium text-foreground cursor-pointer text-left"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                                      Restore
                                    </button>
                                    <button
                                      onClick={() => {
                                        setDeleteConfirmTarget({ id: file.id, name: file.originalName, type: "file", permanent: true });
                                        setActiveMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 font-medium text-rose-600 dark:text-rose-400 cursor-pointer text-left"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Delete Permanently
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* New Folder Modal */}
      {newFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
          <form
            onSubmit={handleCreateFolder}
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-foreground">Create New Folder</h3>
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Folder Name</label>
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. Documents, Projects, Photos"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-border hover:bg-muted text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingFolder || !newFolderName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {creatingFolder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Folder
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
          <form
            onSubmit={handleRename}
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-foreground">
                Rename {renameTarget.type === "folder" ? "Folder" : "File"}
              </h3>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">New Name</label>
              <input
                type="text"
                required
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-3.5 py-2 rounded-xl border border-border hover:bg-muted text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={renaming || !renameValue.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {renaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-destructive">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-foreground">
                  {deleteConfirmTarget.permanent ? "Delete Permanently?" : "Move to Trash?"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {deleteConfirmTarget.type === "folder" ? "Folder" : "File"}: {deleteConfirmTarget.name}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {deleteConfirmTarget.permanent
                ? "This operation will completely erase the physical file/folder from the server disk. This action cannot be undone."
                : "This item will be moved to the Trash. You can restore it later if needed."}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-3.5 py-2 rounded-xl border border-border hover:bg-muted text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-50 cursor-pointer"
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deleteConfirmTarget.permanent ? "Delete Forever" : "Move to Trash"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {moveModalOpen && moveTarget && (
        <MoveModal
          isOpen={moveModalOpen}
          onClose={() => {
            setMoveModalOpen(false);
            setMoveTarget(null);
          }}
          onMove={handleExecuteMove}
          currentFolderId={currentFolderId}
          movingItemNames={moveTarget.names}
          movingFolderIds={moveTarget.folderIds}
        />
      )}

      {/* File Preview Modal */}
      {previewTarget && (
        <FilePreviewModal
          isOpen={Boolean(previewTarget)}
          file={previewTarget}
          files={files}
          onClose={() => setPreviewTarget(null)}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onNavigate={(f) => setPreviewTarget(f as any)}
        />
      )}

      {/* Version History Modal */}
      {versionTarget && (
        <VersionHistoryModal
          isOpen={Boolean(versionTarget)}
          fileId={versionTarget.id}
          fileName={versionTarget.originalName}
          onClose={() => setVersionTarget(null)}
          onVersionChanged={fetchData}
        />
      )}

      {/* Empty Trash Confirmation Modal */}
      {emptyTrashConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-destructive">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-foreground">Empty Trash?</h3>
                <p className="text-xs text-muted-foreground">Permanent deletion of all items</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              This will permanently delete all {files.length} file(s) and {folders.length} folder(s) from the physical storage disk. This operation cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmptyTrashConfirmOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-border hover:bg-muted text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEmptyTrash}
                disabled={emptyingTrash}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-50 cursor-pointer"
              >
                {emptyingTrash && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Empty All Items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
