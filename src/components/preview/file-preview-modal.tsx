"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatBytes } from "@/lib/utils";
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  FileText,
  FileCode,
  Table as TableIcon,
  Play,
  Volume2,
  FileQuestion,
  Loader2,
  ExternalLink,
} from "lucide-react";

export interface PreviewableFile {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  extension: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface FilePreviewModalProps {
  isOpen: boolean;
  file: PreviewableFile | null;
  files?: PreviewableFile[];
  onClose: () => void;
  onNavigate?: (file: PreviewableFile) => void;
}

export function FilePreviewModal({
  isOpen,
  file,
  files = [],
  onClose,
  onNavigate,
}: FilePreviewModalProps) {
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [csvRows, setCsvRows] = useState<string[][]>([]);

  const modalRef = useRef<HTMLDivElement>(null);

  // Categorize file
  const ext = (file?.extension || "").toLowerCase();
  const mime = (file?.mimeType || "").toLowerCase();

  const isImage =
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);

  const isPdf = mime.includes("pdf") || ext === "pdf";

  const isAudio =
    mime.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "aac", "flac", "m4a"].includes(ext);

  const isVideo =
    mime.startsWith("video/") ||
    ["mp4", "webm", "mkv", "mov"].includes(ext);

  const isCsv = ext === "csv" || mime.includes("csv");

  const isTextOrCode =
    mime.startsWith("text/") ||
    isCsv ||
    [
      "txt",
      "md",
      "json",
      "js",
      "ts",
      "tsx",
      "jsx",
      "html",
      "css",
      "py",
      "sh",
      "rs",
      "go",
      "yaml",
      "yml",
      "xml",
      "sql",
    ].includes(ext);

  const isMarkdown = ext === "md";

  // Filter previewable sibling files for image/file gallery navigation
  const siblingFiles = files.filter((f) => {
    if (isImage) {
      const e = (f.extension || "").toLowerCase();
      const m = (f.mimeType || "").toLowerCase();
      return (
        m.startsWith("image/") ||
        ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(e)
      );
    }
    return true;
  });

  const currentIndex = file
    ? siblingFiles.findIndex((f) => f.id === file.id)
    : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < siblingFiles.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigate) {
      setScale(1);
      onNavigate(siblingFiles[currentIndex - 1]);
    }
  }, [hasPrev, currentIndex, siblingFiles, onNavigate]);

  const handleNext = useCallback(() => {
    if (hasNext && onNavigate) {
      setScale(1);
      onNavigate(siblingFiles[currentIndex + 1]);
    }
  }, [hasNext, currentIndex, siblingFiles, onNavigate]);

  // Reset zoom on file change
  useEffect(() => {
    setScale(1);
    setTextContent(null);
    setCsvRows([]);
  }, [file?.id]);

  // Fetch text/markdown/csv content if applicable
  useEffect(() => {
    if (!isOpen || !file || !isTextOrCode || isPdf || isImage || isAudio || isVideo) {
      return;
    }

    const currentFileId = file.id;
    let isMounted = true;
    async function loadText() {
      try {
        setLoadingText(true);
        const res = await fetch(`/api/files/${currentFileId}/preview`);
        if (!res.ok) throw new Error("Failed to load content");
        const text = await res.text();
        if (!isMounted) return;

        setTextContent(text);

        if (isCsv) {
          // Parse basic CSV
          const lines = text
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0)
            .map((line) => {
              // Simple comma split handling quotes
              const row: string[] = [];
              let inQuote = false;
              let cell = "";
              for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' || char === "'") {
                  inQuote = !inQuote;
                } else if (char === "," && !inQuote) {
                  row.push(cell.trim());
                  cell = "";
                } else {
                  cell += char;
                }
              }
              row.push(cell.trim());
              return row;
            });
          setCsvRows(lines);
        }
      } catch {
        if (isMounted) setTextContent("Error loading preview content.");
      } finally {
        if (isMounted) setLoadingText(false);
      }
    }

    loadText();
    return () => {
      isMounted = false;
    };
  }, [isOpen, file, isTextOrCode, isPdf, isImage, isAudio, isVideo, isCsv]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!modalRef.current) return;
    if (!document.fullscreenElement) {
      modalRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "+" || e.key === "=") {
        setScale((s) => Math.min(3, s + 0.25));
      } else if (e.key === "-") {
        setScale((s) => Math.max(0.5, s - 0.25));
      } else if (e.key === "0") {
        setScale(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  if (!isOpen || !file) return null;

  const previewUrl = `/api/files/${file.id}/preview`;
  const downloadUrl = `/api/files/${file.id}/download`;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md text-white select-none animate-in fade-in-0 duration-200"
    >
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate max-w-md sm:max-w-xl text-white">
              {file.originalName}
            </h3>
            <p className="text-xs text-white/60">
              {formatBytes(file.size)} • {file.mimeType || "Unknown type"}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Zoom controls for images and pdfs */}
          {isImage && (
            <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1 mr-2">
              <button
                onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white cursor-pointer"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => setScale(1)}
                className="px-2 py-1 text-xs font-mono font-semibold text-white/90 hover:bg-white/10 rounded-lg cursor-pointer"
                title="Reset Zoom (0)"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                onClick={() => setScale((s) => Math.min(3, s + 0.25))}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white cursor-pointer"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Download Button */}
          <a
            href={downloadUrl}
            download={file.originalName}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer transition-colors shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </a>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer ml-1 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Preview Viewport */}
      <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
        {/* Previous Image / File Arrow */}
        {hasPrev && (
          <button
            onClick={handlePrev}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-20 p-3 rounded-2xl bg-black/60 hover:bg-black/80 text-white/80 hover:text-white border border-white/10 shadow-xl cursor-pointer transition-all"
            title="Previous (Left Arrow)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Next Image / File Arrow */}
        {hasNext && (
          <button
            onClick={handleNext}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-20 p-3 rounded-2xl bg-black/60 hover:bg-black/80 text-white/80 hover:text-white border border-white/10 shadow-xl cursor-pointer transition-all"
            title="Next (Right Arrow)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* 1. IMAGE PREVIEW */}
        {isImage && (
          <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={file.originalName}
              style={{ transform: `scale(${scale})`, transition: "transform 0.15s ease-out" }}
              className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl origin-center"
            />
          </div>
        )}

        {/* 2. PDF VIEWER */}
        {isPdf && (
          <div className="w-full h-full max-w-5xl rounded-2xl overflow-hidden border border-white/10 bg-white shadow-2xl flex flex-col">
            <iframe
              src={`${previewUrl}#toolbar=1&navpanes=1`}
              title={file.originalName}
              className="w-full h-full border-0"
            />
          </div>
        )}

        {/* 3. VIDEO PLAYER */}
        {isVideo && (
          <div className="max-w-4xl w-full flex flex-col items-center justify-center">
            <video
              controls
              autoPlay
              playsInline
              src={previewUrl}
              className="max-h-[80vh] w-full rounded-2xl shadow-2xl bg-black"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        )}

        {/* 4. AUDIO PLAYER */}
        {isAudio && (
          <div className="w-full max-w-md p-8 rounded-3xl bg-white/10 border border-white/20 backdrop-blur-xl flex flex-col items-center gap-6 shadow-2xl">
            <div className="w-20 h-20 rounded-2xl bg-primary/20 text-primary flex items-center justify-center">
              <Volume2 className="w-10 h-10" />
            </div>
            <div className="text-center space-y-1">
              <h4 className="font-semibold text-lg text-white truncate max-w-xs">{file.originalName}</h4>
              <p className="text-xs text-white/60">{formatBytes(file.size)}</p>
            </div>
            <audio controls autoPlay src={previewUrl} className="w-full">
              Your browser does not support audio playback.
            </audio>
          </div>
        )}

        {/* 5. CSV VIEWER */}
        {isCsv && (
          <div className="w-full max-w-5xl h-[80vh] rounded-2xl border border-white/10 bg-slate-900 shadow-2xl flex flex-col overflow-hidden text-xs">
            <div className="px-4 py-2.5 bg-slate-800 border-b border-white/10 flex items-center justify-between text-white/80">
              <div className="flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold">CSV Data View</span>
              </div>
              <span>{csvRows.length} rows loaded</span>
            </div>

            <div className="flex-1 overflow-auto p-2">
              {loadingText ? (
                <div className="h-full flex items-center justify-center gap-2 text-white/60">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading spreadsheet...</span>
                </div>
              ) : csvRows.length > 0 ? (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-800 text-white/90">
                      {csvRows[0].map((header, i) => (
                        <th key={i} className="border border-white/10 px-3 py-2 text-left font-semibold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(1).map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-white/5 border-b border-white/5">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="border border-white/10 px-3 py-1.5 text-white/80">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="h-full flex items-center justify-center text-white/60">Empty CSV file</div>
              )}
            </div>
          </div>
        )}

        {/* 6. PLAIN TEXT & MARKDOWN & CODE VIEWER */}
        {isTextOrCode && !isCsv && !isPdf && (
          <div className="w-full max-w-4xl h-[80vh] rounded-2xl border border-white/10 bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-800 border-b border-white/10 flex items-center justify-between text-xs text-white/80">
              <div className="flex items-center gap-2">
                {isMarkdown ? <FileText className="w-4 h-4 text-rose-400" /> : <FileCode className="w-4 h-4 text-emerald-400" />}
                <span className="font-semibold">{isMarkdown ? "Markdown Preview" : "Source / Text Content"}</span>
              </div>
              <span className="font-mono uppercase">{file.extension || "TXT"}</span>
            </div>

            <div className="flex-1 overflow-auto p-6 font-mono text-sm leading-relaxed text-slate-200">
              {loadingText ? (
                <div className="h-full flex items-center justify-center gap-2 text-white/60">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading text...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{textContent}</pre>
              )}
            </div>
          </div>
        )}

        {/* 7. UNSUPPORTED FORMAT FALLBACK */}
        {!isImage && !isPdf && !isVideo && !isAudio && !isTextOrCode && (
          <div className="max-w-md p-8 rounded-3xl bg-white/10 border border-white/20 backdrop-blur-xl flex flex-col items-center gap-5 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-white/10 text-white/70 flex items-center justify-center">
              <FileQuestion className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="font-semibold text-base text-white">{file.originalName}</h4>
              <p className="text-xs text-white/60">
                No inline browser preview available for .{file.extension || "unknown"} files ({formatBytes(file.size)}).
              </p>
            </div>
            <a
              href={downloadUrl}
              download={file.originalName}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer shadow-lg transition-transform hover:scale-105"
            >
              <Download className="w-4 h-4" />
              Download to Open
            </a>
          </div>
        )}
      </div>

      {/* Sibling Image Thumbnails Bar */}
      {isImage && siblingFiles.length > 1 && (
        <div className="px-6 py-3 border-t border-white/10 bg-black/40 backdrop-blur-sm flex items-center justify-center gap-2 overflow-x-auto shrink-0">
          {siblingFiles.map((sibling) => (
            <button
              key={sibling.id}
              onClick={() => onNavigate?.(sibling)}
              className={`relative w-12 h-12 rounded-lg overflow-hidden border-2 transition-all cursor-pointer shrink-0 ${
                sibling.id === file.id
                  ? "border-primary scale-110 shadow-lg"
                  : "border-transparent opacity-50 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${sibling.id}/preview`}
                alt={sibling.originalName}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
