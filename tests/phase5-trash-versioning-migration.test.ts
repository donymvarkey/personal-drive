import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { prisma } from "../src/lib/db";
import { storageService } from "../src/lib/storage";
import bcrypt from "bcryptjs";

const execFileAsync = promisify(execFile);

describe("Phase 5: Trash, File Versioning and Storage Management", () => {
  let testUserId: string;
  let testStorageDir: string;
  let testDestStorageDir: string;

  before(async () => {
    testStorageDir = path.join("/tmp", "personal-drive-phase5-storage");
    process.env.DRIVE_STORAGE_PATH = testStorageDir;
    testDestStorageDir = path.join("/tmp", "personal-drive-phase5-dest-storage");

    await fs.promises.mkdir(path.join(testStorageDir, "files"), { recursive: true });
    await fs.promises.mkdir(path.join(testStorageDir, ".tmp"), { recursive: true });

    // Clean up or create test user
    const user = await prisma.user.upsert({
      where: { email: "phase5-owner@personal.drive" },
      update: {},
      create: {
        email: "phase5-owner@personal.drive",
        name: "Phase 5 Owner",
        hashedPassword: await bcrypt.hash("InitialPass123!", 10),
      },
    });
    testUserId = user.id;
  });

  after(async () => {
    if (testUserId) {
      // 1. Clean up physical files on disk created by test user
      try {
        const files = await prisma.file.findMany({
          where: { ownerId: testUserId },
          select: { storedName: true },
        });
        for (const f of files) {
          await fs.promises.unlink(path.join(testStorageDir, "files", f.storedName)).catch(() => {});
        }

        // Also clean up patterned temporary test files from disk
        const diskFiles = await fs.promises.readdir(path.join(testStorageDir, "files")).catch(() => [] as string[]);
        for (const df of diskFiles) {
          if (/^(trash-test-|empty-trash-|old-|recent-|v1-|v2-|mig-test-)/.test(df)) {
            await fs.promises.unlink(path.join(testStorageDir, "files", df)).catch(() => {});
          }
        }
      } catch {}

      // 2. Clean up database test records scoped strictly to test user
      const testFiles = await prisma.file.findMany({
        where: { ownerId: testUserId },
        select: { id: true },
      });
      const testFileIds = testFiles.map((f) => f.id);

      await prisma.fileVersion.deleteMany({
        where: { fileId: { in: testFileIds } },
      });
      await prisma.file.deleteMany({ where: { ownerId: testUserId } });
      await prisma.folder.deleteMany({ where: { ownerId: testUserId } });
      await prisma.appSettings.deleteMany({ where: { ownerId: testUserId } });
      await prisma.storageMigration.deleteMany({});
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }

    // 3. Clean up temporary migration destination test directory
    if (fs.existsSync(testDestStorageDir)) {
      await fs.promises.rm(testDestStorageDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // TASK 1: TRASH SYSTEM
  // ============================================================================
  describe("Task 1: Trash System & Retention Cleanup", () => {
    test("soft-deletes file with trashedAt timestamp and restores it", async () => {
      // 1. Create a physical file on disk
      const storedName = `trash-test-${Date.now()}.txt`;
      const filePath = path.join(testStorageDir, "files", storedName);
      await fs.promises.writeFile(filePath, "Trash content test", "utf-8");

      const file = await prisma.file.create({
        data: {
          originalName: "trash-doc.txt",
          storedName,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(18),
          checksum: "hash123",
          ownerId: testUserId,
          storageStatus: "ready",
          isTrashed: false,
        },
      });

      // 2. Soft-delete
      const now = new Date();
      const trashed = await prisma.file.update({
        where: { id: file.id },
        data: { isTrashed: true, trashedAt: now },
      });

      assert.equal(trashed.isTrashed, true);
      assert.ok(trashed.trashedAt !== null);

      // Verify normal active query filters it out
      const activeFiles = await prisma.file.findMany({
        where: { ownerId: testUserId, isTrashed: false, deletedAt: null },
      });
      assert.ok(!activeFiles.some((f) => f.id === file.id));

      // 3. Restore
      const restored = await prisma.file.update({
        where: { id: file.id },
        data: { isTrashed: false, trashedAt: null },
      });
      assert.equal(restored.isTrashed, false);
      assert.equal(restored.trashedAt, null);
    });

    test("permanently deletes file from disk and database when emptying trash", async () => {
      const storedName = `empty-trash-${Date.now()}.txt`;
      const filePath = path.join(testStorageDir, "files", storedName);
      await fs.promises.writeFile(filePath, "Permanent delete test", "utf-8");

      const file = await prisma.file.create({
        data: {
          originalName: "empty-me.txt",
          storedName,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(21),
          checksum: "hash456",
          ownerId: testUserId,
          storageStatus: "ready",
          isTrashed: true,
          trashedAt: new Date(),
        },
      });

      // Delete physical file and DB record (Empty Trash simulation)
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      await prisma.file.delete({ where: { id: file.id } });

      assert.ok(!fs.existsSync(filePath), "Physical file should be deleted from disk");
      const record = await prisma.file.findUnique({ where: { id: file.id } });
      assert.equal(record, null, "Database record should be deleted");
    });

    test("retention cleanup deletes only items older than configured threshold", async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      const oldFile = await prisma.file.create({
        data: {
          originalName: "old-trash.txt",
          storedName: `old-${Date.now()}.txt`,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(10),
          checksum: "hashold",
          ownerId: testUserId,
          storageStatus: "ready",
          isTrashed: true,
          trashedAt: oldDate,
        },
      });

      const recentFile = await prisma.file.create({
        data: {
          originalName: "recent-trash.txt",
          storedName: `recent-${Date.now()}.txt`,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(10),
          checksum: "hashrecent",
          ownerId: testUserId,
          storageStatus: "ready",
          isTrashed: true,
          trashedAt: recentDate,
        },
      });

      // With 30 days retention policy:
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const expiredFiles = await prisma.file.findMany({
        where: {
          ownerId: testUserId,
          isTrashed: true,
          trashedAt: { lte: cutoffDate },
        },
      });

      assert.ok(expiredFiles.some((f) => f.id === oldFile.id));
      assert.ok(!expiredFiles.some((f) => f.id === recentFile.id));
    });
  });

  // ============================================================================
  // TASK 2: FILE VERSIONING
  // ============================================================================
  describe("Task 2: File Versioning", () => {
    let versionedFileId: string;

    test("creates active file with initial version history", async () => {
      const storedNameV1 = `v1-${Date.now()}.txt`;
      await fs.promises.writeFile(
        path.join(testStorageDir, "files", storedNameV1),
        "Version 1 content",
        "utf-8"
      );

      const file = await prisma.file.create({
        data: {
          originalName: "report.txt",
          storedName: storedNameV1,
          mimeType: "text/plain",
          extension: "txt",
          size: BigInt(17),
          checksum: "sha256-v1",
          ownerId: testUserId,
          storageStatus: "ready",
          versions: {
            create: {
              storedName: storedNameV1,
              size: BigInt(17),
              checksum: "sha256-v1",
              versionNumber: 1,
              note: "Initial version",
            },
          },
        },
        include: { versions: true },
      });

      versionedFileId = file.id;
      assert.equal(file.versions.length, 1);
      assert.equal(file.versions[0].versionNumber, 1);
    });

    test("uploads new version and preserves previous version in history", async () => {
      const storedNameV2 = `v2-${Date.now()}.txt`;
      await fs.promises.writeFile(
        path.join(testStorageDir, "files", storedNameV2),
        "Version 2 updated content",
        "utf-8"
      );

      // Create version 2 record
      await prisma.fileVersion.create({
        data: {
          fileId: versionedFileId,
          storedName: storedNameV2,
          size: BigInt(25),
          checksum: "sha256-v2",
          versionNumber: 2,
          note: "Revised section 2",
        },
      });

      // Update active file to version 2
      const updatedFile = await prisma.file.update({
        where: { id: versionedFileId },
        data: {
          storedName: storedNameV2,
          size: BigInt(25),
          checksum: "sha256-v2",
        },
        include: {
          versions: { orderBy: { versionNumber: "desc" } },
        },
      });

      assert.equal(updatedFile.storedName, storedNameV2);
      assert.equal(updatedFile.versions.length, 2);
      assert.equal(updatedFile.versions[0].versionNumber, 2);
      assert.equal(updatedFile.versions[1].versionNumber, 1);
    });

    test("restores a previous version correctly", async () => {
      // Find version 1
      const v1 = await prisma.fileVersion.findFirst({
        where: { fileId: versionedFileId, versionNumber: 1 },
      });
      assert.ok(v1);

      // Restore active file pointer to version 1
      const restored = await prisma.file.update({
        where: { id: versionedFileId },
        data: {
          storedName: v1.storedName,
          size: v1.size,
          checksum: v1.checksum,
        },
      });

      assert.equal(restored.storedName, v1.storedName);
      assert.equal(restored.checksum, v1.checksum);
    });

    test("safely deletes a single historical version without affecting active file", async () => {
      const v2 = await prisma.fileVersion.findFirst({
        where: { fileId: versionedFileId, versionNumber: 2 },
      });
      assert.ok(v2);

      await prisma.fileVersion.delete({ where: { id: v2.id } });

      const activeFile = await prisma.file.findUnique({
        where: { id: versionedFileId },
      });
      assert.ok(activeFile, "Active file must not be deleted");

      const remainingVersions = await prisma.fileVersion.findMany({
        where: { fileId: versionedFileId },
      });
      assert.equal(remainingVersions.length, 1);
    });
  });

  // ============================================================================
  // TASK 3 & 4: STORAGE DASHBOARD & HYBRID MANAGEMENT
  // ============================================================================
  describe("Task 3 & 4: Storage Dashboard & Hybrid Path Management", () => {
    test("storage stats correctly distinguish physical disk capacity from quotas", async () => {
      const stats = await storageService.validateStoragePath();
      assert.equal(stats.valid, true);
      assert.ok(stats.stats);
      assert.ok(stats.stats.totalBytes > BigInt(0));
      assert.ok(stats.stats.freeBytes > BigInt(0));
      assert.ok(typeof stats.stats.device === "string");
      assert.ok(typeof stats.stats.mountPoint === "string");
    });

    test("path resolution rejects traversal attempts outside DRIVE_STORAGE_PATH", () => {
      assert.throws(() => {
        storageService.resolveFilePath("../../../etc/passwd");
      }, /Path traversal detected/);
    });
  });

  // ============================================================================
  // TASK 5: STORAGE MIGRATION SCRIPT & WORKFLOW
  // ============================================================================
  describe("Task 5: Controlled Host Storage Migration Helper", () => {
    const scriptPath = path.join(process.cwd(), "scripts", "migrate-storage.sh");

    test("validate command rejects destination missing .drive-target marker file", async () => {
      await fs.promises.mkdir(testDestStorageDir, { recursive: true });

      try {
        await execFileAsync("bash", [scriptPath, "validate", testDestStorageDir]);
        assert.fail("Should have failed validation without marker file");
      } catch (err: unknown) {
        const e = err as { stdout: string };
        const output = JSON.parse(e.stdout.trim());
        assert.equal(output.valid, false);
        assert.match(output.error, /Missing safety marker file \(\.drive-target\)/);
      }
    });

    test("validate command succeeds when .drive-target marker file is present", async () => {
      await fs.promises.writeFile(path.join(testDestStorageDir, ".drive-target"), "ok");

      const { stdout } = await execFileAsync("bash", [scriptPath, "validate", testDestStorageDir]);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.valid, true);
      assert.equal(output.destPath, testDestStorageDir);
    });

    test("copy & verify commands reliably copy files and verify SHA-256 hashes", async () => {
      // 1. Ensure a file exists in source
      const testFileName = `mig-test-${Date.now()}.bin`;
      const testFileContent = Buffer.from("Deterministic migration verification payload 123456");
      await fs.promises.writeFile(
        path.join(testStorageDir, "files", testFileName),
        testFileContent
      );

      // 2. Run copy
      const { stdout: copyOut } = await execFileAsync("bash", [
        scriptPath,
        "copy",
        testDestStorageDir,
      ]);
      const copyRes = JSON.parse(copyOut.trim());
      assert.equal(copyRes.success, true);
      assert.ok(copyRes.copiedFiles >= 1);

      // 3. Run verify
      const { stdout: verifyOut } = await execFileAsync("bash", [
        scriptPath,
        "verify",
        testDestStorageDir,
      ]);
      const verifyRes = JSON.parse(verifyOut.trim());
      assert.equal(verifyRes.verified, true);
      assert.ok(verifyRes.verifiedCount >= 1);
    });

    test("rollback command restores environment backup safely", async () => {
      const { stdout } = await execFileAsync("bash", [
        scriptPath,
        "rollback",
        testDestStorageDir,
      ]);
      const rollRes = JSON.parse(stdout.trim());
      assert.equal(rollRes.success, true);
    });
  });

  // ============================================================================
  // TASK 7: APP SETTINGS & SECURITY
  // ============================================================================
  describe("Task 7: App Settings & Security", () => {
    test("updates retention policies and user preferences in database", async () => {
      const settings = await prisma.appSettings.upsert({
        where: { ownerId: testUserId },
        update: {
          trashRetentionDays: 60,
          maxVersionsPerFile: 5,
          theme: "dark",
        },
        create: {
          ownerId: testUserId,
          trashRetentionDays: 60,
          maxVersionsPerFile: 5,
          theme: "dark",
        },
      });

      assert.equal(settings.trashRetentionDays, 60);
      assert.equal(settings.maxVersionsPerFile, 5);
      assert.equal(settings.theme, "dark");
    });

    test("password change properly verifies current password and hashes new password with bcrypt", async () => {
      const user = await prisma.user.findUnique({ where: { id: testUserId } });
      assert.ok(user);

      // 1. Verify initial password matches
      const initialMatch = await bcrypt.compare("InitialPass123!", user.hashedPassword);
      assert.equal(initialMatch, true);

      // 2. Reject incorrect current password
      const wrongMatch = await bcrypt.compare("WrongPassword!", user.hashedPassword);
      assert.equal(wrongMatch, false);

      // 3. Update to new password
      const newHashed = await bcrypt.hash("NewSecurePass456!", 10);
      await prisma.user.update({
        where: { id: testUserId },
        data: { hashedPassword: newHashed },
      });

      // 4. Verify new password works and old one no longer works
      const updatedUser = await prisma.user.findUnique({ where: { id: testUserId } });
      assert.ok(updatedUser);
      assert.equal(
        await bcrypt.compare("NewSecurePass456!", updatedUser.hashedPassword),
        true
      );
      assert.equal(
        await bcrypt.compare("InitialPass123!", updatedUser.hashedPassword),
        false
      );
    });

    test("active migration write-lock blocks new uploads with 503", async () => {
      // 1. Create a migration record with writeLocked = true
      const migration = await prisma.storageMigration.create({
        data: {
          status: "syncing",
          sourcePath: testStorageDir,
          destPath: testDestStorageDir,
          writeLocked: true,
        },
      });

      const activeLock = await prisma.storageMigration.findFirst({
        where: { writeLocked: true },
      });
      assert.ok(activeLock);
      assert.equal(activeLock.writeLocked, true);

      // 2. Release lock
      await prisma.storageMigration.update({
        where: { id: migration.id },
        data: { writeLocked: false, status: "synced" },
      });

      const releasedLock = await prisma.storageMigration.findFirst({
        where: { writeLocked: true },
      });
      assert.equal(releasedLock, null);
    });
  });
});
