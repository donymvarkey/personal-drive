import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const folderId = searchParams.get("folderId");
    const isStarred = searchParams.get("starred") === "true";
    const isTrashed = searchParams.get("trashed") === "true";
    const fileType = searchParams.get("fileType") || "all";
    const dateRange = searchParams.get("dateRange") || "all";
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ownerId: session.user.id,
      deletedAt: null,
    };

    if (isTrashed) {
      where.isTrashed = true;
    } else {
      where.isTrashed = false;
      if (isStarred) {
        where.isStarred = true;
      }

      if (folderId === "root") {
        where.folderId = null;
      } else if (folderId && folderId !== "all") {
        where.folderId = folderId;
      }
    }

    // Search query
    if (search.trim()) {
      where.originalName = {
        contains: search.trim(),
        mode: "insensitive",
      };
    }

    // File Type Filter
    if (fileType !== "all") {
      switch (fileType) {
        case "images":
          where.mimeType = { startsWith: "image/" };
          break;
        case "videos":
          where.mimeType = { startsWith: "video/" };
          break;
        case "audio":
          where.mimeType = { startsWith: "audio/" };
          break;
        case "documents":
          where.extension = {
            in: ["pdf", "doc", "docx", "txt", "rtf", "odt", "xls", "xlsx", "ppt", "pptx", "csv"],
          };
          break;
        case "archives":
          where.extension = { in: ["zip", "tar", "gz", "7z", "rar", "bz2"] };
          break;
        case "code":
          where.extension = {
            in: ["js", "ts", "jsx", "tsx", "html", "css", "json", "py", "rs", "go", "c", "cpp", "sh", "sql", "md"],
          };
          break;
      }
    }

    // Date Filter
    if (dateRange !== "all") {
      const now = new Date();
      let sinceDate: Date;
      if (dateRange === "today") {
        sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (dateRange === "week") {
        sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "month") {
        sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      } else if (dateRange === "year") {
        sinceDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      } else {
        sinceDate = new Date(0);
      }
      where.createdAt = { gte: sinceDate };
    }

    // Valid sort fields
    const validSortFields: Record<string, string> = {
      name: "originalName",
      originalName: "originalName",
      size: "size",
      type: "extension",
      extension: "extension",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };
    const sortField = validSortFields[sortBy] || "createdAt";

    const files = await prisma.file.findMany({
      where,
      orderBy: {
        [sortField]: sortOrder,
      },
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        extension: true,
        size: true,
        checksum: true,
        folderId: true,
        isStarred: true,
        isTrashed: true,
        storageStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const serializedFiles = files.map((file) => ({
      ...file,
      size: Number(file.size),
    }));

    return NextResponse.json({ files: serializedFiles });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
