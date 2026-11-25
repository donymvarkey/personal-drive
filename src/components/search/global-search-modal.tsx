"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/utils";
import {
  Search,
  X,
  Folder as FolderIcon,
  File as FileIcon,
  Image as ImageIcon,
  Film,
  Archive,
  FileText,
  FileCode,
  Loader2,
  Calendar,
  ArrowRight,
  Filter,
} from "lucide-react";
import { FilePreviewModal, PreviewableFile } from "@/components/preview/file-preview-modal";

interface SearchResultFile extends PreviewableFile {
  isStarred?: boolean;
}

interface SearchResultFolder {
  id: string;
  name: string;
  parentId: string | null;
  filesCount: number;
  createdAt: string;
}

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<SearchResultFile[]>([]);
  const [folders, setFolders] = useState<SearchResultFolder[]>([]);

  // Preview modal inside search
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setFiles([]);
      setFolders([]);
    }
  }, [isOpen]);

  // Execute live search
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (dateFilter !== "all") params.set("dateRange", dateFilter);

        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setFiles(data.files || []);
        setFolders(data.folders || []);
      } catch (err) {
        console.error("Search query error:", err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [isOpen, query, typeFilter, dateFilter]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !previewFile) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, previewFile, onClose]);

  if (!isOpen) return null;

  const getFileIcon = (mime: string, ext: string) => {
    const cleanExt = ext.toLowerCase();
    if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(cleanExt)) {
      return <ImageIcon className="w-4 h-4 text-blue-500" />;
    }
    if (mime.startsWith("video/") || ["mp4", "mkv", "mov", "webm"].includes(cleanExt)) {
      return <Film className="w-4 h-4 text-purple-500" />;
    }
    if (mime.includes("zip") || ["zip", "tar", "gz", "7z"].includes(cleanExt)) {
      return <Archive className="w-4 h-4 text-amber-500" />;
    }
    if (["js", "ts", "tsx", "py", "json", "html", "css"].includes(cleanExt)) {
      return <FileCode className="w-4 h-4 text-emerald-500" />;
    }
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
        <div className="w-full max-w-2xl rounded-2xl border border-border bg-card text-card-foreground shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95">
          {/* Search Header */}
          <div className="p-4 border-b border-border flex items-center gap-3">
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search all files, extensions, folders..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden"
            />
            {loading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Type & Date Filters */}
          <div className="px-4 py-2.5 border-b border-border/60 bg-muted/30 flex items-center gap-2 overflow-x-auto text-xs">
            <div className="flex items-center gap-1 shrink-0 font-medium text-muted-foreground mr-1">
              <Filter className="w-3.5 h-3.5" />
              <span>Filters:</span>
            </div>

            {["all", "folders", "documents", "images", "videos", "code", "archives"].map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2.5 py-1 rounded-lg capitalize cursor-pointer transition-colors shrink-0 ${
                  typeFilter === type
                    ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {type}
              </button>
            ))}

            <div className="h-4 w-px bg-border shrink-0 mx-1" />

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2 py-1 text-xs text-foreground cursor-pointer focus:outline-hidden"
            >
              <option value="all">Any Date</option>
              <option value="today">Today</option>
              <option value="week">Past Week</option>
              <option value="month">Past Month</option>
              <option value="year">Past Year</option>
            </select>
          </div>

          {/* Results Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5 divide-y divide-border/60">
            {folders.length === 0 && files.length === 0 && !loading && (
              <div className="py-12 text-center space-y-1">
                <p className="text-sm font-medium text-muted-foreground">
                  {query ? `No matching items found for "${query}"` : "Type to search your personal drive"}
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Search across file names, file extensions (.png, .pdf, .mp4), MIME types, and folder names.
                </p>
              </div>
            )}

            {/* Matching Folders */}
            {folders.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Folders ({folders.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {folders.map((folder) => (
                    <div
                      key={folder.id}
                      onClick={() => {
                        onClose();
                        router.push(`/files?folderId=${folder.id}`);
                      }}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FolderIcon className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />
                        <span className="text-xs font-semibold text-foreground truncate">{folder.name}</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Matching Files */}
            {files.length > 0 && (
              <div className="space-y-2 pt-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Files ({files.length})
                </span>
                <div className="space-y-1.5">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => setPreviewFile(file)}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                          {getFileIcon(file.mimeType, file.extension)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-medium text-foreground truncate">{file.originalName}</h4>
                          <p className="text-[10px] text-muted-foreground">
                            {formatBytes(file.size)} • {file.mimeType || "File"} • {new Date(file.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-mono uppercase text-muted-foreground">
                          {file.extension || "file"}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          isOpen={Boolean(previewFile)}
          file={previewFile}
          files={files}
          onClose={() => setPreviewFile(null)}
          onNavigate={(f) => setPreviewFile(f)}
        />
      )}
    </>
  );
}
