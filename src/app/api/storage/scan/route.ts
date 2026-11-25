import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { externalStorageScanner } from "@/lib/scanner";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await storageService.validateStoragePath();

    const [latestScan, settings] = await Promise.all([
      prisma.storageScanRecord.findFirst({
        orderBy: { startedAt: "desc" },
      }),
      prisma.appSettings.findUnique({
        where: { ownerId: session.user.id },
        select: {
          lastScanAt: true,
          indexedFilesCount: true,
          indexedFoldersCount: true,
        },
      }),
    ]);

    return NextResponse.json({
      isScanning: externalStorageScanner.getIsScanning(),
      lastScan: latestScan
        ? {
            ...latestScan,
            bytesIndexed: latestScan.bytesIndexed.toString(),
          }
        : null,
      settings: settings || {
        lastScanAt: null,
        indexedFilesCount: 0,
        indexedFoldersCount: 0,
      },
      mount: {
        valid: validation.valid,
        isMounted: validation.isMounted,
        fsType: validation.fsType,
        device: validation.device,
        uuid: validation.uuid,
        markerVerified: validation.markerVerified,
        markerId: validation.markerId,
        error: validation.error,
        storagePath: storageService.getStoragePath(),
        stats: validation.stats
          ? {
              totalBytes: validation.stats.totalBytes.toString(),
              usedBytes: validation.stats.usedBytes.toString(),
              freeBytes: validation.stats.freeBytes.toString(),
            }
          : null,
      },
    });
  } catch (err: unknown) {
    const e = err as Error;
    return NextResponse.json(
      { error: `Failed to fetch scan status: ${e.message}` },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (externalStorageScanner.getIsScanning()) {
      return NextResponse.json(
        { error: "A storage scan is already in progress." },
        { status: 409 }
      );
    }

    // Verify storage mount
    const validation = await storageService.validateStoragePath(true);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error:
            validation.error ||
            "External storage drive is disconnected or not writable.",
        },
        { status: 503 }
      );
    }

    const result = await externalStorageScanner.scanStorage(session.user.id);

    return NextResponse.json({
      success: true,
      message: "External storage scan completed successfully.",
      result: {
        ...result,
        bytesIndexed: result.bytesIndexed.toString(),
      },
    });
  } catch (err: unknown) {
    const e = err as Error;
    return NextResponse.json(
      { error: `Failed to perform scan: ${e.message}` },
      { status: 500 }
    );
  }
}
