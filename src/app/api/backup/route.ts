import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { backupService } from "@/lib/backup";
import { rateLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET: Retrieve list of backups, destination path, and backup status
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const backupDir = backupService.getBackupPath();
    const backups = await prisma.backupRecord.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    const settings = await prisma.appSettings.findFirst();

    return NextResponse.json({
      backupDestination: backupDir,
      retentionDays: settings?.backupRetentionDays ?? 30,
      scheduleHours: settings?.backupScheduleHours ?? 24,
      backups: backups.map((b) => ({
        id: b.id,
        status: b.status,
        backupType: b.backupType,
        archivePath: b.archivePath,
        sizeBytes: b.sizeBytes.toString(),
        totalFiles: b.totalFiles,
        verified: b.verified,
        verificationLog: b.verificationLog,
        errorMessage: b.errorMessage,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
      })),
    });
  } catch (err) {
    logger.error("Error retrieving backups", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to retrieve backups" },
      { status: 500 }
    );
  }
}

/**
 * POST: Trigger a manual backup or integrity verification
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: max 3 backup operations per 10 minutes to prevent resource abuse
  const limitCheck = rateLimiter.check(`backup:${session.user.id}`, 3, 600);
  if (!limitCheck.success) {
    return NextResponse.json(
      {
        error: `Backup rate limit exceeded. Please wait ${limitCheck.resetSeconds}s before initiating a new backup.`,
      },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "verify" && body.backupId) {
      const result = await backupService.verifyBackup(body.backupId);
      return NextResponse.json({ verified: result.valid, log: result.log });
    }

    // Default: create new backup
    const backup = await backupService.createBackup("manual");
    return NextResponse.json(
      {
        success: true,
        backupId: backup.backupId,
        archivePath: backup.archivePath,
        sizeBytes: backup.sizeBytes.toString(),
        totalFiles: backup.totalFiles,
        verified: backup.verified,
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Error creating backup", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backup operation failed" },
      { status: 500 }
    );
  }
}
