import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { restoreService } from "@/lib/restore";
import { rateLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const backup = await prisma.backupRecord.findUnique({
    where: { id },
  });

  if (!backup) {
    return NextResponse.json({ error: "Backup record not found" }, { status: 404 });
  }

  // Rate limit: max 1 restore per 5 minutes
  const limitCheck = rateLimiter.check(`restore:${session.user.id}`, 1, 300);
  if (!limitCheck.success) {
    return NextResponse.json(
      { error: `Restore rate limit reached. Please wait ${limitCheck.resetSeconds}s.` },
      { status: 429 }
    );
  }

  try {
    logger.info("Initiating disaster recovery restore", { backupId: id, archivePath: backup.archivePath });
    const result = await restoreService.restoreFromArchive(backup.archivePath);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("Restore failed", err, { backupId: id });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restore procedure failed" },
      { status: 500 }
    );
  }
}
