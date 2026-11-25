import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "migrate-storage.sh");

export const runtime = "nodejs";

/**
 * GET: Retrieve active migration status & storage stats
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const latestMigration = await prisma.storageMigration.findFirst({
    orderBy: { startedAt: "desc" },
  });

  const diskStats = await storageService.validateStoragePath();

  return NextResponse.json({
    migration: latestMigration
      ? {
          id: latestMigration.id,
          status: latestMigration.status,
          sourcePath: latestMigration.sourcePath,
          destPath: latestMigration.destPath,
          totalFiles: latestMigration.totalFiles,
          copiedFiles: latestMigration.copiedFiles,
          totalBytes: Number(latestMigration.totalBytes),
          copiedBytes: Number(latestMigration.copiedBytes),
          writeLocked: latestMigration.writeLocked,
          errorMessage: latestMigration.errorMessage,
          startedAt: latestMigration.startedAt,
          completedAt: latestMigration.completedAt,
        }
      : null,
    storage: {
      currentPath: storageService.getStoragePath(),
      valid: diskStats.valid,
      stats: diskStats.stats
        ? {
            totalBytes: diskStats.stats.totalBytes.toString(),
            usedBytes: diskStats.stats.usedBytes.toString(),
            freeBytes: diskStats.stats.freeBytes.toString(),
            device: diskStats.stats.device,
            mountPoint: diskStats.stats.mountPoint,
          }
        : null,
    },
  });
}

/**
 * POST: Execute controlled migration step
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, destPath } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    switch (action) {
      case "validate": {
        if (!destPath) {
          return NextResponse.json({ error: "Destination path is required." }, { status: 400 });
        }

        try {
          const { stdout } = await execFileAsync("bash", [SCRIPT_PATH, "validate", destPath]);
          const result = JSON.parse(stdout.trim());
          return NextResponse.json(result);
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message: string };
          try {
            if (e.stdout) {
              const parsed = JSON.parse(e.stdout.trim());
              return NextResponse.json(parsed, { status: 400 });
            }
          } catch {
            // fallback
          }
          return NextResponse.json(
            { valid: false, error: e.stderr || e.message },
            { status: 400 }
          );
        }
      }

      case "start": {
        if (!destPath) {
          return NextResponse.json({ error: "Destination path is required." }, { status: 400 });
        }

        // 1. First validate
        const { stdout: valOut } = await execFileAsync("bash", [SCRIPT_PATH, "validate", destPath]);
        const valRes = JSON.parse(valOut.trim());
        if (!valRes.valid) {
          return NextResponse.json({ error: valRes.error }, { status: 400 });
        }

        // 2. Count source files & bytes
        const sourceFilesCount = await prisma.file.count({
          where: { deletedAt: null },
        });
        const sourceBytesAggr = await prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { size: true },
        });

        // 3. Create or update StorageMigration record
        const migration = await prisma.storageMigration.create({
          data: {
            status: "copying",
            sourcePath: valRes.sourcePath,
            destPath,
            totalFiles: sourceFilesCount,
            totalBytes: sourceBytesAggr._sum.size || BigInt(0),
            copiedFiles: 0,
            copiedBytes: BigInt(0),
            writeLocked: false,
          },
        });

        // 4. Run copy
        const { stdout: copyOut } = await execFileAsync("bash", [SCRIPT_PATH, "copy", destPath]);
        const copyRes = JSON.parse(copyOut.trim());

        await prisma.storageMigration.update({
          where: { id: migration.id },
          data: {
            status: "copied",
            copiedFiles: copyRes.copiedFiles || 0,
          },
        });

        return NextResponse.json({
          success: true,
          migrationId: migration.id,
          copiedFiles: copyRes.copiedFiles,
          totalFiles: sourceFilesCount,
        });
      }

      case "sync": {
        const migration = await prisma.storageMigration.findFirst({
          where: { status: { in: ["copied", "copying", "syncing"] } },
          orderBy: { startedAt: "desc" },
        });

        if (!migration) {
          return NextResponse.json(
            { error: "No active copy phase found to synchronize." },
            { status: 400 }
          );
        }

        // Brief write lock during final synchronization
        await prisma.storageMigration.update({
          where: { id: migration.id },
          data: { writeLocked: true, status: "syncing" },
        });

        try {
          const { stdout: syncOut } = await execFileAsync("bash", [
            SCRIPT_PATH,
            "sync",
            migration.destPath,
          ]);
          const syncRes = JSON.parse(syncOut.trim());

          await prisma.storageMigration.update({
            where: { id: migration.id },
            data: {
              status: "synced",
              copiedFiles: syncRes.copiedFiles || migration.copiedFiles,
            },
          });

          return NextResponse.json({
            success: true,
            status: "synced",
            copiedFiles: syncRes.copiedFiles,
          });
        } catch (err: unknown) {
          const e = err as Error;
          await prisma.storageMigration.update({
            where: { id: migration.id },
            data: { writeLocked: false, status: "failed", errorMessage: e.message },
          });
          return NextResponse.json({ error: e.message }, { status: 500 });
        }
      }

      case "verify": {
        const migration = await prisma.storageMigration.findFirst({
          where: { status: { in: ["synced", "copied"] } },
          orderBy: { startedAt: "desc" },
        });

        if (!migration) {
          return NextResponse.json(
            { error: "No synchronized migration ready for verification." },
            { status: 400 }
          );
        }

        try {
          const { stdout: verifyOut } = await execFileAsync("bash", [
            SCRIPT_PATH,
            "verify",
            migration.destPath,
          ]);
          const verifyRes = JSON.parse(verifyOut.trim());

          if (verifyRes.verified) {
            await prisma.storageMigration.update({
              where: { id: migration.id },
              data: { status: "verified" },
            });
            return NextResponse.json({
              verified: true,
              verifiedCount: verifyRes.verifiedCount,
            });
          } else {
            await prisma.storageMigration.update({
              where: { id: migration.id },
              data: {
                status: "failed",
                errorMessage: `Verification failed: ${verifyRes.mismatches} file mismatch(es).`,
              },
            });
            return NextResponse.json(
              { verified: false, mismatches: verifyRes.mismatches },
              { status: 400 }
            );
          }
        } catch (err: unknown) {
          const e = err as Error;
          await prisma.storageMigration.update({
            where: { id: migration.id },
            data: { status: "failed", errorMessage: e.message },
          });
          return NextResponse.json({ verified: false, error: e.message }, { status: 400 });
        }
      }

      case "switch": {
        const migration = await prisma.storageMigration.findFirst({
          where: { status: "verified" },
          orderBy: { startedAt: "desc" },
        });

        if (!migration) {
          return NextResponse.json(
            { error: "Migration must be successfully verified before switching storage." },
            { status: 400 }
          );
        }

        try {
          const { stdout: switchOut } = await execFileAsync("bash", [
            SCRIPT_PATH,
            "switch",
            migration.destPath,
          ]);
          const switchRes = JSON.parse(switchOut.trim());

          await prisma.storageMigration.update({
            where: { id: migration.id },
            data: {
              status: "completed",
              writeLocked: false,
              completedAt: new Date(),
            },
          });

          return NextResponse.json({
            success: true,
            switchedPath: switchRes.switchedPath,
            message:
              "Storage location switched successfully. Host environment has been updated.",
          });
        } catch (err: unknown) {
          const e = err as Error;
          await prisma.storageMigration.update({
            where: { id: migration.id },
            data: { status: "failed", errorMessage: e.message },
          });
          return NextResponse.json({ error: e.message }, { status: 500 });
        }
      }

      case "rollback": {
        const migration = await prisma.storageMigration.findFirst({
          where: { status: { not: "rolled_back" } },
          orderBy: { startedAt: "desc" },
        });

        try {
          const { stdout: rollOut } = await execFileAsync("bash", [
            SCRIPT_PATH,
            "rollback",
            migration?.destPath || "",
          ]);
          const rollRes = JSON.parse(rollOut.trim());

          if (migration) {
            await prisma.storageMigration.update({
              where: { id: migration.id },
              data: {
                status: "rolled_back",
                writeLocked: false,
                errorMessage: "Migration rolled back by user.",
              },
            });
          }

          return NextResponse.json({
            success: true,
            message: rollRes.message || "Rollback completed.",
          });
        } catch (err: unknown) {
          const e = err as Error;
          return NextResponse.json({ error: e.message }, { status: 500 });
        }
      }

      default:
        return NextResponse.json({ error: `Unknown action: "${action}"` }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
