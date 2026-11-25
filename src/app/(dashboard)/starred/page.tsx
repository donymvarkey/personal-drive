import { FileExplorer } from "@/components/files/file-explorer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Starred – Personal Drive",
  description: "Quick access to your starred files.",
};

export default function StarredPage() {
  return (
    <FileExplorer
      filter="starred"
      title="Starred Items"
      description="Files and documents you have marked for fast retrieval."
    />
  );
}
