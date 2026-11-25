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
    const query = (searchParams.get("q") || "").trim();
    const typeFilter = searchParams.get("type") || "all";
    const dateRange = searchParams.get("dateRange") || "all";
    const sortBy = searchParams.get("sortBy") || "updatedAt";
    const sortOrder = searchParams.get("order") === "asc" ? "asc" : "desc";

    const ownerId = session.user.id;

    // Date range filter helper
    let dateFilter: { gte?: Date } | undefined;
    if (dateRange !== "all") {
      const now = new Date();
      if (dateRange === "today") {
        now.setHours(0, 0, 0, 0);
        dateFilter = { gte: now };
      } else if (dateRange === "week") {
        now.setDate(now.getDate() - 7);
        dateFilter = { gte: now };
      } else if (dateRange === "month") {
        now.setMonth(now.getMonth() - 1);
        dateFilter = { gte: now };
      } else if (dateRange === "year") {
        now.setFullYear(now.getFullYear() - 1);
        dateFilter = { gte: now };
      }
    }

    // Build Files query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filesWhere: any = {
      ownerId,
      isTrashed: false,
      deletedAt: null,
    };

    if (query) {
      filesWhere.OR = [
        { originalName: { contains: query, mode: "insensitive" } },
        { extension: { contains: query.replace(/^\./, ""), mode: "insensitive" } },
        { mimeType: { contains: query, mode: "insensitive" } },
      ];
    }

    if (dateFilter) {
      filesWhere.createdAt = dateFilter;
    }

    // Category / MIME Type filtering
    if (typeFilter !== "all" && typeFilter !== "files" && typeFilter !== "folders") {
      switch (typeFilter) {
        case "images":
          filesWhere.mimeType = { startsWith: "image/" };
          break;
        case "videos":
          filesWhere.mimeType = { startsWith: "video/" };
          break;
        case "audio":
          filesWhere.mimeType = { startsWith: "audio/" };
          break;
        case "documents":
          filesWhere.OR = [
            { mimeType: { contains: "pdf" } },
            { mimeType: { contains: "document" } },
            { mimeType: { contains: "text" } },
            { extension: { in: ["pdf", "doc", "docx", "txt", "md", "csv", "rtf", "odt"] } },
          ];
          break;
        case "archives":
          filesWhere.OR = [
            { mimeType: { contains: "zip" } },
            { mimeType: { contains: "compressed" } },
            { mimeType: { contains: "tar" } },
            { extension: { in: ["zip", "tar", "gz", "rar", "7z"] } },
          ];
          break;
        case "code":
          filesWhere.OR = [
            { mimeType: { contains: "javascript" } },
            { mimeType: { contains: "json" } },
            { extension: { in: ["js", "ts", "tsx", "jsx", "json", "py", "sh", "rs", "go", "html", "css"] } },
          ];
          break;
      }
    }

    // Build Folders query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const foldersWhere: any = {
      ownerId,
      isTrashed: false,
      deletedAt: null,
    };

    if (query) {
      foldersWhere.name = { contains: query, mode: "insensitive" };
    }

    if (dateFilter) {
      foldersWhere.createdAt = dateFilter;
    }

    // Execute queries based on type filter
    const shouldFetchFiles = typeFilter !== "folders";
    const shouldFetchFolders =
      typeFilter === "all" || typeFilter === "folders";

    // Ordering
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fileOrderBy: any = { createdAt: sortOrder };
    if (sortBy === "name") fileOrderBy = { originalName: sortOrder };
    else if (sortBy === "size") fileOrderBy = { size: sortOrder };
    else if (sortBy === "updatedAt") fileOrderBy = { updatedAt: sortOrder };

    const [files, folders] = await Promise.all([
      shouldFetchFiles
        ? prisma.file.findMany({
            where: filesWhere,
            orderBy: fileOrderBy,
            take: 100,
          })
        : Promise.resolve([]),
      shouldFetchFolders
        ? prisma.folder.findMany({
            where: foldersWhere,
            orderBy: { name: sortOrder },
            take: 50,
            include: {
              _count: {
                select: {
                  files: { where: { isTrashed: false, deletedAt: null } },
                  children: { where: { isTrashed: false, deletedAt: null } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const serializedFiles = files.map((f) => ({
      ...f,
      size: Number(f.size),
    }));

    const serializedFolders = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      isStarred: f.isStarred,
      filesCount: f._count?.files || 0,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));

    return NextResponse.json({
      query,
      total: serializedFiles.length + serializedFolders.length,
      files: serializedFiles,
      folders: serializedFolders,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
