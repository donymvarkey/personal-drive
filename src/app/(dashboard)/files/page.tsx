import { FileExplorer } from "@/components/files/file-explorer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Files – Personal Drive",
  description: "Browse and manage files stored on physical storage.",
};

export default function FilesPage() {
  return <FileExplorer />;
}
