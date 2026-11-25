"use client";

import { useState, useEffect } from "react";
import { Folder, FolderPlus, ArrowRight, X, Loader2 } from "lucide-react";

interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
}

interface MoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMove: (targetFolderId: string | null) => Promise<void>;
  currentFolderId: string | null;
  movingItemNames: string[];
  movingFolderIds?: string[]; // IDs of folders being moved (to disallow selecting them or their children)
}

export function MoveModal({
  isOpen,
  onClose,
  onMove,
  currentFolderId,
  movingItemNames,
  movingFolderIds = [],
}: MoveModalProps) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    async function loadFolders() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/folders?all=true");
        const data = await res.json();
        setFolders(data.folders || []);
      } catch {
        setError("Failed to load folder list.");
      } finally {
        setLoading(false);
      }
    }
    loadFolders();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await onMove(selectedFolderId);
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to move items.");
    } finally {
      setSubmitting(false);
    }
  };

  // Filter out any folders currently being moved to avoid immediate self-move
  const availableFolders = folders.filter((f) => !movingFolderIds.includes(f.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-0">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Move {movingItemNames.length} item(s)</h3>
              <p className="text-xs text-muted-foreground truncate max-w-xs">
                {movingItemNames.join(", ")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Select Destination Folder
          </p>

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span>Loading folder hierarchy...</span>
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-1 pr-1 border border-border rounded-xl p-2 bg-background/50">
              {/* Root / Drive folder option */}
              <button
                type="button"
                onClick={() => setSelectedFolderId(null)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                  selectedFolderId === null
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <Folder className="w-4 h-4" />
                <span>Drive (Root Directory)</span>
              </button>

              {availableFolders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer ${
                    selectedFolderId === f.id
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <Folder className="w-4 h-4 text-primary" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}

              {availableFolders.length === 0 && (
                <p className="text-center py-4 text-xs text-muted-foreground">
                  No other folders found. You can move to Root.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-xs font-medium transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || (selectedFolderId === currentFolderId)}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors inline-flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Moving…</span>
              </>
            ) : (
              <>
                <span>Move Here</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
