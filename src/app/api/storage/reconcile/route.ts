import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await storageService.validateStoragePath();
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Storage unavailable" },
        { status: 503 }
      );
    }

    const storagePath = storageService.getStoragePath();
    const filesDir = path.join(storagePath, "files");

    // Read physical files
    let diskFiles: string[] = [];
    try {
      diskFiles = await fs.promises.readdir(filesDir);
    } catch {
      diskFiles = [];
    }

    // Read DB stored files
    const dbFiles = await prisma.file.findMany({
      where: {
        ownerId: session.user.id,
        deletedAt: null,
      },
      select: {
        id: true,
        storedName: true,
        originalName: true,
      },
    });

    const dbStoredSet = new Set(dbFiles.map((f) => f.storedName));
    const diskFileSet = new Set(diskFiles);

    // Orphaned files on physical disk not referenced in DB
    const orphanedDiskFiles = diskFiles.filter((f) => !dbStoredSet.has(f));

    // Missing files in DB that don't exist on physical disk
    const missingDbFiles = dbFiles.filter((f) => !diskFileSet.has(f.storedName));

    return NextResponse.json({
      status: "success",
      physicalDiskFilesCount: diskFiles.length,
      databaseRecordsCount: dbFiles.length,
      orphanedDiskFiles,
      missingDbFiles,
      isConsistent: orphanedDiskFiles.length === 0 && missingDbFiles.length === 0,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action === "cleanup-staging") {
      const cleaned = await storageService.cleanupStagingFiles(0); // Clean all staging files
      return NextResponse.json({ success: true, cleanedStagingFiles: cleaned });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
