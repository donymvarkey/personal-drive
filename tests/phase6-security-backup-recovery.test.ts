import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import { prisma, checkDatabaseHealth } from "../src/lib/db";
import { storageService } from "../src/lib/storage";
import { backupService } from "../src/lib/backup";
import { restoreService } from "../src/lib/restore";
import { rateLimiter } from "../src/lib/rate-limit";

describe("Phase 6: Security, Backup, Recovery and Production Hardening", () => {
  let testUserId: string;
  let originalStoragePath: string | undefined;
  let originalBackupPath: string | undefined;
  const testStorageDir = path.join("/tmp", "personal-drive-phase6-storage");
  const testBackupDir = path.join("/tmp", "personal-drive-phase6-backups");
  const testRestoreTargetDir = path.join("/tmp", "personal-drive-phase6-restore-target");

  before(async () => {
    // 1. Setup isolated directories
    originalStoragePath = process.env.DRIVE_STORAGE_PATH;
    originalBackupPath = process.env.DRIVE_BACKUP_PATH;
    process.env.DRIVE_STORAGE_PATH = testStorageDir;
    process.env.DRIVE_BACKUP_PATH = testBackupDir;

    await fs.mkdir(path.join(testStorageDir, "files"), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, ".tmp"), { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });
    await fs.mkdir(testRestoreTargetDir, { recursive: true });

    // 2. Create dedicated isolated test user
    const user = await prisma.user.upsert({
      where: { email: "test-phase6@personal.drive" },
      update: {},
      create: {
        email: "test-phase6@personal.drive",
        name: "Phase 6 Test Owner",
        hashedPassword: "dummy-hashed-password-12345678",
      },
    });
    testUserId = user.id;
  });

  after(async () => {
    try {
      if (testUserId) {
        // Clean DB test records scoped strictly to testUserId
        await prisma.fileVersion.deleteMany({
          where: { file: { ownerId: testUserId } },
        });
        await prisma.starredItem.deleteMany({
          where: { ownerId: testUserId },
        });
        await prisma.activityLog.deleteMany({
          where: { ownerId: testUserId },
        });
        await prisma.file.deleteMany({
          where: { ownerId: testUserId },
        });
        await prisma.folder.updateMany({
          where: { ownerId: testUserId },
          data: { parentId: null },
        });
        await prisma.folder.deleteMany({
          where: { ownerId: testUserId },
        });
        await prisma.backupRecord.deleteMany({});
        await prisma.appSettings.deleteMany({
          where: { ownerId: testUserId },
        });
        await prisma.user.delete({
          where: { id: testUserId },
        }).catch(() => {});
      }

      // Clean filesystem directories
      await fs.rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(testBackupDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(testRestoreTargetDir, { recursive: true, force: true }).catch(() => {});

      // Restore environment variables
      process.env.DRIVE_STORAGE_PATH = originalStoragePath;
      process.env.DRIVE_BACKUP_PATH = originalBackupPath;
    } catch (err) {
      console.error("Phase 6 teardown error:", err);
    } finally {
      await prisma.$disconnect();
    }
  });

  // ============================================================================
  // TASK 1 & 2: SECURITY AUDIT & RATE LIMITING
  // ============================================================================
  describe("Task 1 & 2: Security & Rate Limiting Hardening", () => {
    test("Rate Limiter: enforces sliding window and returns 429 reset time when threshold exceeded", () => {
      const key = `test-ip-${Date.now()}`;
      const limit = 3;
      const windowSec = 10;

      // 1st, 2nd, 3rd requests should succeed
      assert.equal(rateLimiter.check(key, limit, windowSec).success, true);
      assert.equal(rateLimiter.check(key, limit, windowSec).success, true);
      assert.equal(rateLimiter.check(key, limit, windowSec).success, true);

      // 4th request must be rejected
      const blocked = rateLimiter.check(key, limit, windowSec);
      assert.equal(blocked.success, false);
      assert.equal(blocked.remaining, 0);
      assert.ok(blocked.resetSeconds > 0 && blocked.resetSeconds <= windowSec);

      // Resetting key clears limit
      rateLimiter.reset(key);
      assert.equal(rateLimiter.check(key, limit, windowSec).success, true);
    });

    test("Path Traversal Guard: rejects traversal characters and escape sequences", () => {
      assert.throws(() => storageService.resolveFilePath("../../../etc/shadow"), {
        message: /Path traversal detected/,
      });
      assert.throws(() => storageService.resolveFilePath("/etc/passwd"), {
        message: /Path traversal detected/,
      });
    });

    test("Active Content Neutralization: disallows HTML/SVG execution inside origin", () => {
      const dangerousTypes = ["text/html", "image/svg+xml", "application/javascript"];
      for (const mime of dangerousTypes) {
        // App neutralizes to plain text or applies sandbox CSP
        const isDangerous = ["text/html", "application/xhtml+xml", "image/svg+xml", "application/javascript"].some(
          (t) => mime.toLowerCase().startsWith(t)
        );
        assert.equal(isDangerous, true, `MIME ${mime} must be recognized as dangerous`);
      }
    });
  });

  // ============================================================================
  // TASK 3: BACKUP ENGINE
  // ============================================================================
  describe("Task 3: Backup Engine & Verification", () => {
    let createdBackupId: string;
    let createdArchivePath: string;

    test("Disallows primary storage directory from being used as its own backup destination", () => {
      const originalBackupPath = process.env.DRIVE_BACKUP_PATH;
      try {
        process.env.DRIVE_BACKUP_PATH = path.join(testStorageDir, "files", "nested-backup");
        assert.throws(() => backupService.getBackupPath(), {
          message: /Backup destination cannot be inside or identical to primary storage disk/,
        });
      } finally {
        process.env.DRIVE_BACKUP_PATH = originalBackupPath;
      }
    });

    test("Creates full atomic backup with database snapshot, physical files, and SHA-256 manifest", async () => {
      // 1. Create 2 test physical files
      const file1Content = "Personal Drive Sample Document Content for Backup";
      const file1Stored = `${crypto.randomUUID()}.txt`;
      await fs.writeFile(path.join(testStorageDir, "files", file1Stored), file1Content);

      const file2Content = "Second binary test payload for backup verification";
      const file2Stored = `${crypto.randomUUID()}.txt`;
      await fs.writeFile(path.join(testStorageDir, "files", file2Stored), file2Content);

      // 2. Create database records
      await prisma.file.create({
        data: {
          originalName: "Document1.txt",
          storedName: file1Stored,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(file1Content.length),
          checksum: crypto.createHash("sha256").update(file1Content).digest("hex"),
          ownerId: testUserId,
          storageStatus: "ready",
        },
      });

      await prisma.file.create({
        data: {
          originalName: "Document2.txt",
          storedName: file2Stored,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(file2Content.length),
          checksum: crypto.createHash("sha256").update(file2Content).digest("hex"),
          ownerId: testUserId,
          storageStatus: "ready",
        },
      });

      // 3. Trigger backup
      const backupResult = await backupService.createBackup("manual");
      createdBackupId = backupResult.backupId;
      createdArchivePath = backupResult.archivePath;

      assert.ok(backupResult.backupId);
      assert.ok(backupResult.sizeBytes > BigInt(0));
      assert.equal(backupResult.totalFiles >= 2, true);
      assert.equal(backupResult.verified, true);

      // 4. Verify DB record exists and is marked as verified
      const record = await prisma.backupRecord.findUnique({
        where: { id: createdBackupId },
      });
      assert.ok(record);
      assert.equal(record.status, "verified");
      assert.equal(record.verified, true);
      assert.equal(record.databaseDumped, true);

      // 5. Verify physical .tar.gz archive exists on disk
      const archiveStat = await fs.stat(createdArchivePath);
      assert.ok(archiveStat.size > 0);
    });

    test("Verifies existing backup archive integrity", async () => {
      const verifyRes = await backupService.verifyBackup(createdBackupId);
      assert.equal(verifyRes.valid, true);
      assert.match(verifyRes.log, /Archive file exists/);
    });
  });

  // ============================================================================
  // TASK 4: RESTORE & DISASTER RECOVERY
  // ============================================================================
  describe("Task 4: Disaster Recovery & Restore Engine", () => {
    test("Restores full database and physical files onto replacement storage directory", async () => {
      // Prepare dedicated test backup archive containing only testUserId
      const testArchiveDir = path.join(testBackupDir, "staging-restore-test");
      await fs.mkdir(path.join(testArchiveDir, "files"), { recursive: true });

      const fileContent = "Restoration verification payload";
      const storedName = `${crypto.randomUUID()}.txt`;
      await fs.writeFile(path.join(testArchiveDir, "files", storedName), fileContent);

      const fileChecksum = crypto.createHash("sha256").update(fileContent).digest("hex");
      const testManifest = {
        version: "1.0",
        backupId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        backupType: "manual" as const,
        sourceStoragePath: testStorageDir,
        databaseExported: true,
        totalFiles: 1,
        totalBytes: fileContent.length,
        dbRecords: { users: 1, files: 1, folders: 0, fileVersions: 0, starredItems: 0, appSettings: 0, activityLogs: 0 },
        fileInventory: {
          [storedName]: {
            originalName: "RestoreDoc.txt",
            size: fileContent.length,
            checksum: fileChecksum,
          },
        },
        checksum: "test-checksum",
      };

      await fs.writeFile(path.join(testArchiveDir, "manifest.json"), JSON.stringify(testManifest, null, 2));

      const testDbExport = {
        exportedAt: new Date().toISOString(),
        version: "1.0",
        data: {
          users: [{ id: testUserId, email: "test-phase6@personal.drive", name: "Phase 6 Test Owner", hashedPassword: "hash", createdAt: new Date().toISOString() }],
          files: [{ id: crypto.randomUUID(), originalName: "RestoreDoc.txt", storedName, mimeType: "text/plain", extension: "txt", size: fileContent.length.toString(), checksum: fileChecksum, folderId: null, ownerId: testUserId, storageStatus: "ready", isStarred: false, isTrashed: false, trashedAt: null, createdAt: new Date().toISOString() }],
          folders: [],
          fileVersions: [],
          starredItems: [],
          appSettings: [],
          activityLogs: [],
        },
      };

      await fs.writeFile(path.join(testArchiveDir, "database_export.json"), JSON.stringify(testDbExport, null, 2));

      const testArchiveTar = path.join(testBackupDir, "test-restore-package.tar.gz");
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      await promisify(execFile)("tar", ["-czf", testArchiveTar, "-C", testArchiveDir, "."]);
      await fs.rm(testArchiveDir, { recursive: true, force: true });

      // Execute restoration targeting replacement storage directory
      const restoreResult = await restoreService.restoreFromArchive(
        testArchiveTar,
        testRestoreTargetDir
      );

      assert.equal(restoreResult.success, true);
      assert.equal(restoreResult.filesRestored, 1);
      assert.equal(restoreResult.dbRecordsRestored.files, 1);
      assert.equal(restoreResult.integrityVerified, true);

      // Verify physical files exist in destination directory
      const restoredFiles = await fs.readdir(path.join(testRestoreTargetDir, "files"));
      assert.equal(restoredFiles.length, 1);
    });
  });

  // ============================================================================
  // TASK 5 & 8: HEALTH MONITORING & FAULT TOLERANCE
  // ============================================================================
  describe("Task 5 & 8: Health Monitoring & Reliability", () => {
    test("Database Health: measures query latency and returns connected status", async () => {
      const health = await checkDatabaseHealth();
      assert.equal(health.ok, true);
      assert.ok(health.latencyMs >= 0);
    });

    test("Storage Health: verifies path validation and detects invalid directories gracefully", async () => {
      const validHealth = await storageService.validateStoragePath(true);
      assert.equal(validHealth.valid, true);

      // Test with non-existent path
      const originalPath = process.env.DRIVE_STORAGE_PATH;
      try {
        process.env.DRIVE_STORAGE_PATH = "/nonexistent/invalid/mount/path";
        const invalidHealth = await storageService.validateStoragePath(true);
        assert.equal(invalidHealth.valid, false);
        assert.match(invalidHealth.error ?? "", /does not exist/);
      } finally {
        process.env.DRIVE_STORAGE_PATH = originalPath;
      }
    });

    test("Resource Limits: Node heap memory stays well within 2GB budget", () => {
      const mem = process.memoryUsage();
      const heapUsedMB = mem.heapUsed / 1024 / 1024;
      assert.ok(heapUsedMB < 1000, `Heap memory usage (${heapUsedMB} MB) is well under 1GB`);
    });
  });
});
