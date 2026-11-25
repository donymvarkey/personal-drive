import { RecentView } from "@/components/recent/recent-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recent Activity – Personal Drive",
  description: "View recent file access, uploads, previews, and operations.",
};

export default function RecentPage() {
  return <RecentView />;
}
