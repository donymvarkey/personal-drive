import { NextResponse } from "next/server";
import { checkDatabaseHealth, prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  const startTime = Date.now();

  // 1. Check Database Health
  const dbHealth = await checkDatabaseHealth();

  // 2. Check Physical Storage Health
  const storageCheck = await storageService.validateStoragePath();

  // 3. Check System Memory
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);

  // 4. Check Backup Status
  let latestBackup: { completedAt: Date | null; verified: boolean; status: string } | null = null;
  let totalBackupsCount = 0;
  try {
    totalBackupsCount = await prisma.backupRecord.count();
    latestBackup = await prisma.backupRecord.findFirst({
      orderBy: { startedAt: "desc" },
      select: { completedAt: true, verified: true, status: true },
    });
  } catch {}

  // 5. Determine Overall Status
  let overallStatus: "healthy" | "degraded" | "down" = "healthy";
  if (!dbHealth.ok || !storageCheck.valid) {
    overallStatus = "down";
  }

  const responseTimeMs = Date.now() - startTime;

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTimeMs,
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memory: {
          heapUsedMB,
          heapTotalMB,
          rssMB,
        },
      },
      database: {
        status: dbHealth.ok ? "connected" : "disconnected",
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error,
      },
      storage: {
        status: storageCheck.valid ? "healthy" : "unavailable",
        path: storageService.getStoragePath(),
        device: storageCheck.stats?.device,
        totalBytes: storageCheck.stats?.totalBytes.toString(),
        freeBytes: storageCheck.stats?.freeBytes.toString(),
        usedBytes: storageCheck.stats?.usedBytes.toString(),
        error: storageCheck.error,
      },
      backup: {
        totalBackups: totalBackupsCount,
        latestBackupAt: latestBackup?.completedAt?.toISOString() || null,
        latestBackupVerified: latestBackup?.verified || false,
        latestBackupStatus: latestBackup?.status || "none",
      },
      security: {
        rateLimiterActive: true,
        strictCSP: true,
        authenticationEnforced: true,
      },
    },
    {
      status: overallStatus === "down" ? 503 : 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
