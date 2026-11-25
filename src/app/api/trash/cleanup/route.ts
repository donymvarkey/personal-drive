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

    // 1. Check user retention policy
    const settings = await prisma.appSettings.findUnique({
      where: { ownerId },
    });

    const retentionDays = settings?.trashRetentionDays ?? 30; // default 30 days if configured
    if (retentionDays <= 0) {
      return NextResponse.json({
        success: true,
        cleaned: 0,
        message: "Automatic trash cleanup is disabled (manual retention policy).",
      });
    }

    // 2. Identify items older than retention cutoff
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const expiredFiles = await prisma.file.findMany({
      where: {
        ownerId,
        isTrashed: true,
        trashedAt: { lte: cutoffDate },
      },
      include: { versions: true },
    });

    const expiredFolders = await prisma.folder.findMany({
      where: {
        ownerId,
        isTrashed: true,
        trashedAt: { lte: cutoffDate },
      },
    });

    if (expiredFiles.length === 0 && expiredFolders.length === 0) {
      return NextResponse.json({
        success: true,
        cleaned: 0,
        message: `No items older than ${retentionDays} days in Trash.`,
      });
    }

    // 3. Delete physical files from disk
    for (const file of expiredFiles) {
      await storageService.deletePhysicalFile(file.storedName);
      for (const v of file.versions) {
        await storageService.deletePhysicalFile(v.storedName);
      }
    }

    // 4. Delete records
    const fileIds = expiredFiles.map((f) => f.id);
    const folderIds = expiredFolders.map((f) => f.id);

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

    await logActivity({
      ownerId,
      action: "delete",
      itemName: `Auto Trash Cleanup (${expiredFiles.length} files, ${expiredFolders.length} folders older than ${retentionDays} days)`,
      details: { retentionDays, expiredCount: expiredFiles.length + expiredFolders.length },
    });

    return NextResponse.json({
      success: true,
      cleanedFiles: expiredFiles.length,
      cleanedFolders: expiredFolders.length,
      retentionDays,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
