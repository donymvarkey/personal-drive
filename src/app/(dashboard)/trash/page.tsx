import { FileExplorer } from "@/components/files/file-explorer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trash – Personal Drive",
  description: "Manage deleted files before permanent deletion.",
};

export default function TrashPage() {
  return (
    <FileExplorer
      filter="trash"
      title="Trash"
      description="Items moved to trash. You can restore them or permanently delete them from physical storage."
    />
  );
}
