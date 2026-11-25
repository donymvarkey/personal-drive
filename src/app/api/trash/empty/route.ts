import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerId = session.user.id;

    // 1. Fetch all trashed files
    const trashedFiles = await prisma.file.findMany({
      where: { ownerId, isTrashed: true },
      include: { versions: true },
    });

    // 2. Fetch all trashed folders
    const trashedFolders = await prisma.folder.findMany({
      where: { ownerId, isTrashed: true },
    });

    if (trashedFiles.length === 0 && trashedFolders.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Trash is already empty.",
        filesDeleted: 0,
        foldersDeleted: 0,
      });
    }

    // 3. Delete physical files from disk for all trashed files and their versions
    for (const file of trashedFiles) {
      await storageService.deletePhysicalFile(file.storedName);
      for (const version of file.versions) {
        await storageService.deletePhysicalFile(version.storedName);
      }
    }

    // 4. Delete file records and folder records from database
    const fileIds = trashedFiles.map((f) => f.id);
    const folderIds = trashedFolders.map((f) => f.id);

    if (fileIds.length > 0) {
      await prisma.file.deleteMany({
        where: { id: { in: fileIds }, ownerId },
      });
    }

    if (folderIds.length > 0) {
      await prisma.folder.deleteMany({
        where: { id: { in: folderIds }, ownerId },
      });
    }

    // 5. Log activity
    await logActivity({
      ownerId,
      action: "delete",
      itemName: `Empty Trash (${trashedFiles.length} files, ${trashedFolders.length} folders)`,
      details: { filesCount: trashedFiles.length, foldersCount: trashedFolders.length },
    });

    return NextResponse.json({
      success: true,
      filesDeleted: trashedFiles.length,
      foldersDeleted: trashedFolders.length,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Empty trash error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
