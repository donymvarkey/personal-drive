"use server";

import { storageService } from "@/lib/storage";
import { prisma } from "@/lib/db";

export interface StorageStats {
  totalBytes: string;
  usedBytes: string;
  freeBytes: string;
  usedPercent: number;
  valid: boolean;
  isMounted?: boolean;
  fsType?: string;
  uuid?: string;
  device?: string;
  markerVerified?: boolean;
  markerId?: string;
  error?: string;
}

export async function getStorageStats(): Promise<StorageStats> {
  const result = await storageService.validateStoragePath();

  if (!result.valid || !result.stats) {
    return {
      totalBytes: "0",
      usedBytes: "0",
      freeBytes: "0",
      usedPercent: 0,
      valid: false,
      isMounted: result.isMounted ?? false,
      fsType: result.fsType,
      error: result.error,
    };
  }

  const { totalBytes, usedBytes, freeBytes } = result.stats;
  const usedPercent =
    totalBytes > BigInt(0)
      ? Math.round(Number((usedBytes * BigInt(100)) / totalBytes))
      : 0;

  // Optionally log health check at runtime if database is available
  if (process.env.NODE_ENV !== "test" && process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      await prisma.storageHealth.create({
        data: {
          status: "healthy",
          storagePath: storageService.getStoragePath(),
          totalBytes,
          usedBytes,
          freeBytes,
        },
      });
    } catch {
      // Don't fail if DB is not connected
    }
  }

  return {
    totalBytes: totalBytes.toString(),
    usedBytes: usedBytes.toString(),
    freeBytes: freeBytes.toString(),
    usedPercent,
    valid: true,
    isMounted: result.isMounted ?? true,
    fsType: result.fsType || "exfat",
    uuid: result.uuid,
    device: result.device,
    markerVerified: result.markerVerified,
    markerId: result.markerId,
  };
}
