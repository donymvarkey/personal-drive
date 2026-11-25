import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import { prisma } from "../src/lib/db";
import { storageService } from "../src/lib/storage";
import { externalStorageScanner } from "../src/lib/scanner";

describe("exFAT External Storage Architecture & In-Place Discovery Tests", () => {
  let testUserId: string;
  let testStorageDir: string;
  let originalStoragePath: string | undefined;

  before(async () => {
    originalStoragePath = process.env.DRIVE_STORAGE_PATH;
    testStorageDir = path.join("/tmp", "personal-drive-exfat-test-storage");
    process.env.DRIVE_STORAGE_PATH = testStorageDir;

    // Clean any prior test storage
    await fs.rm(testStorageDir, { recursive: true, force: true });
    await fs.mkdir(testStorageDir, { recursive: true });

    // Create isolated test user
    const user = await prisma.user.upsert({
      where: { email: "test-exfat@personal.drive" },
      update: {},
      create: {
        email: "test-exfat@personal.drive",
        name: "exFAT Test User",
        hashedPassword: "dummy-hashed-pass-12345",
      },
    });
    testUserId = user.id;
  });

  after(async () => {
    try {
      if (testUserId) {
        await prisma.file.deleteMany({ where: { ownerId: testUserId } });
        await prisma.folder.updateMany({
          where: { ownerId: testUserId },
          data: { parentId: null },
        });
        await prisma.folder.deleteMany({ where: { ownerId: testUserId } });
        await prisma.storageScanRecord.deleteMany({});
        await prisma.appSettings.deleteMany({ where: { ownerId: testUserId } });
        await prisma.activityLog.deleteMany({ where: { ownerId: testUserId } });
        await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
      }

      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch (err) {
      console.error("exFAT test teardown error:", err);
    } finally {
      if (originalStoragePath) {
        process.env.DRIVE_STORAGE_PATH = originalStoragePath;
      }
      await prisma.$disconnect();
    }
  });

  // ============================================================================
  // TASK 1: exFAT FILENAME SANITIZATION & CASE COLLISION
  // ============================================================================
  describe("Task 1: exFAT Filename Sanitization & Case Collisions", () => {
    test("strips illegal exFAT characters and ASCII control codes", () => {
      const dirty = 'Report: "Q1*Financials" <Final>? /Draft\\ | v1.0.pdf';
      const { safeName, extension } = storageService.sanitizeExfatFilename(dirty);

      assert.equal(extension, "pdf");
      assert.ok(!/[\\/:*?"<>|]/.test(safeName), "Contains no exFAT forbidden characters");
      assert.equal(safeName, "Report Q1Financials Final Draft  v1.0.pdf");
    });

    test("trims trailing dots and spaces forbidden by exFAT", () => {
      const trailing = "MyDocument.txt. . .   ";
      const { safeName, extension } = storageService.sanitizeExfatFilename(trailing);

      assert.equal(extension, "txt");
      assert.ok(!safeName.endsWith("."), "Must not end with a period");
      assert.ok(!safeName.endsWith(" "), "Must not end with a space");
      assert.equal(safeName, "MyDocument.txt");
    });

    test("preserves case and normalizes Unicode NFC", () => {
      const mixedCase = "Résumé_2024_Café.DOCX";
      const { safeName, extension } = storageService.sanitizeExfatFilename(mixedCase);

      assert.equal(extension, "docx");
      assert.ok(safeName.includes("Résumé"), "Preserves accented unicode");
      assert.ok(safeName.includes("Café"), "Preserves accented unicode");
      assert.ok(safeName.includes("DOCX"), "Preserves uppercase characters in body");
    });

    test("detects case-insensitive filename collisions in a directory", async () => {
      const testDir = path.join(testStorageDir, "collision-test");
      await fs.mkdir(testDir, { recursive: true });

      // Create physical file "FinancialReport.pdf"
      await fs.writeFile(path.join(testDir, "FinancialReport.pdf"), "sample-data");

      // Check collision with lowercase "financialreport.pdf"
      const collision1 = await storageService.checkFilenameCollision(testDir, "financialreport.pdf");
      assert.equal(collision1.collides, true, "Should collide case-insensitively");
      assert.equal(collision1.existingName, "FinancialReport.pdf");

      // Check non-colliding filename generator
      const nonColliding = await storageService.getNonCollidingFilename(testDir, "financialreport.pdf");
      assert.equal(nonColliding, "financialreport (1).pdf");
    });
  });

  // ============================================================================
  // TASK 2: EXTERNAL DISK VALIDATION & APPLICATION MARKER
  // ============================================================================
  describe("Task 2: External Disk Validation & Marker Management", () => {
    test("initializes .personal-drive managed directories and disk.marker", async () => {
      const validation = await storageService.validateExternalMount(testStorageDir);

      assert.equal(validation.valid, true);
      assert.equal(validation.isMounted, true);
      assert.equal(validation.markerVerified, true);
      assert.ok(validation.markerId, "Marker ID generated");

      // Verify physical subdirectories
      const markerPath = path.join(testStorageDir, ".personal-drive", "disk.marker");
      const markerStat = await fs.stat(markerPath);
      assert.ok(markerStat.isFile());

      const markerContent = JSON.parse(await fs.readFile(markerPath, "utf-8"));
      assert.equal(markerContent.app, "personal-drive");
      assert.equal(markerContent.markerId, validation.markerId);

      // Verify managed subfolders exist
      for (const sub of ["uploads", "versions", "trash", "metadata", "temp"]) {
        const subStat = await fs.stat(path.join(testStorageDir, ".personal-drive", sub));
        assert.ok(subStat.isDirectory(), `Subdirectory ${sub} exists`);
      }
    });

    test("subsequent validation verifies existing marker without overwriting", async () => {
      const firstCheck = await storageService.validateExternalMount(testStorageDir);
      const originalMarkerId = firstCheck.markerId;

      const secondCheck = await storageService.validateExternalMount(testStorageDir);
      assert.equal(secondCheck.valid, true);
      assert.equal(secondCheck.markerVerified, true);
      assert.equal(secondCheck.markerId, originalMarkerId, "Marker ID was preserved");
    });

    test("disconnected storage: returns 503 error and never creates replacement directory", async () => {
      const nonExistentPath = path.join("/tmp", "disconnected-drive-xyz-999");
      const validation = await storageService.validateExternalMount(nonExistentPath);

      assert.equal(validation.valid, false);
      assert.equal(validation.isMounted, false);
      assert.ok(validation.error?.includes("does not exist") || validation.error?.includes("disconnected"));

      // Verify the missing directory was NOT created
      try {
        await fs.stat(nonExistentPath);
        assert.fail("Should not have created replacement directory on disk");
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        assert.equal(e.code, "ENOENT");
      }
    });
  });

  // ============================================================================
  // TASK 3: IN-PLACE DISCOVERY & INDEXING OF PRE-EXISTING FILES
  // ============================================================================
  describe("Task 3: In-Place Discovery of Pre-Existing Files & Folders", () => {
    test("discovers and indexes existing files and folders in-place without copying", async () => {
      // 1. Populate mock existing files on external SSD
      // Root level
      await fs.writeFile(path.join(testStorageDir, "MyNotes.txt"), "Important personal notes.");
      await fs.writeFile(
        path.join(testStorageDir, "Budget.csv"),
        "Month,Amount\nJan,100\nFeb,150\n"
      );

      // Subfolder Photos/2023
      const photosDir = path.join(testStorageDir, "Photos", "2023");
      await fs.mkdir(photosDir, { recursive: true });

      // Valid PNG header (89 50 4E 47 0D 0A 1A 0A)
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      await fs.writeFile(path.join(photosDir, "Vacation.png"), pngHeader);

      // Subfolder Documents/Work/Projects
      const workDir = path.join(testStorageDir, "Documents", "Work", "Projects");
      await fs.mkdir(workDir, { recursive: true });

      // Valid PDF header (%PDF)
      const pdfHeader = Buffer.from("%PDF-1.7 Test document content for discovery indexing.");
      await fs.writeFile(path.join(workDir, "Contract.pdf"), pdfHeader);

      // Create ignored folder ($RECYCLE.BIN, .DS_Store)
      const recycleDir = path.join(testStorageDir, "$RECYCLE.BIN");
      await fs.mkdir(recycleDir, { recursive: true });
      await fs.writeFile(path.join(recycleDir, "trash.bin"), "junk");
      await fs.writeFile(path.join(testStorageDir, ".DS_Store"), "junk");

      // 2. Run scan
      const scanResult = await externalStorageScanner.scanStorage(testUserId);

      assert.ok(scanResult.filesIndexed >= 4, `Indexed ${scanResult.filesIndexed} files`);
      assert.ok(scanResult.foldersIndexed >= 4, `Indexed ${scanResult.foldersIndexed} folders`);
      assert.equal(scanResult.errors, undefined);

      // 3. Verify Folders in Database
      const folders = await prisma.folder.findMany({
        where: { ownerId: testUserId, isExternal: true },
      });
      const folderPaths = new Set(folders.map((f) => f.path));

      assert.ok(folderPaths.has("Photos"));
      assert.ok(folderPaths.has(path.join("Photos", "2023")));
      assert.ok(folderPaths.has("Documents"));
      assert.ok(folderPaths.has(path.join("Documents", "Work")));
      assert.ok(folderPaths.has(path.join("Documents", "Work", "Projects")));
      assert.ok(!folderPaths.has("$RECYCLE.BIN"), "Ignored folder must not be indexed");

      // Verify hierarchy: Photos/2023 parent is Photos
      const parentPhotos = folders.find((f) => f.path === "Photos");
      const child2023 = folders.find((f) => f.path === path.join("Photos", "2023"));
      assert.equal(child2023?.parentId, parentPhotos?.id, "Correct parent folder hierarchy");

      // 4. Verify Files in Database
      const files = await prisma.file.findMany({
        where: { ownerId: testUserId, isExternal: true },
      });
      const fileNames = new Set(files.map((f) => f.storedName));

      assert.ok(fileNames.has("MyNotes.txt"));
      assert.ok(fileNames.has("Budget.csv"));
      assert.ok(fileNames.has(path.join("Photos", "2023", "Vacation.png")));
      assert.ok(fileNames.has(path.join("Documents", "Work", "Projects", "Contract.pdf")));
      assert.ok(!fileNames.has(path.join("$RECYCLE.BIN", "trash.bin")));

      // 5. Verify In-Place Integrity: original physical files are untouched and not copied into files/
      const pngFile = files.find((f) => f.originalName === "Vacation.png");
      assert.ok(pngFile);
      assert.equal(pngFile.mimeType, "image/png", "Detected MIME via magic bytes");
      assert.equal(pngFile.size, BigInt(pngHeader.length));
      assert.equal(pngFile.isExternal, true);

      // Physical file still exists at original path
      const originalPhysicalPath = path.join(testStorageDir, "Photos", "2023", "Vacation.png");
      const stat = await fs.stat(originalPhysicalPath);
      assert.equal(stat.size, pngHeader.length);
    });
  });

  // ============================================================================
  // TASK 4: OPERATIONS ON DISCOVERED EXTERNAL FILES
  // ============================================================================
  describe("Task 4: Operations on Discovered External Files", () => {
    test("reads discovered external file stream correctly", async () => {
      const relPath = path.join("Photos", "2023", "Vacation.png");
      const stream = await storageService.getReadStream(relPath);

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const data = Buffer.concat(chunks);
      assert.equal(data[0], 0x89);
      assert.equal(data[1], 0x50);
      assert.equal(data[2], 0x4e);
      assert.equal(data[3], 0x47);
    });

    test("soft-deletes discovered external file to .personal-drive/trash and restores it", async () => {
      const fileToTrash = await prisma.file.findFirst({
        where: { ownerId: testUserId, originalName: "MyNotes.txt" },
      });
      assert.ok(fileToTrash);

      // Soft delete: move to trash
      const moveRes = await storageService.moveToTrash(fileToTrash.storedName);
      assert.ok(moveRes.trashedStoredName.startsWith(path.join(".personal-drive", "trash")));
      assert.equal(moveRes.originalPath, "MyNotes.txt");

      // Verify file moved physically into .personal-drive/trash
      const trashedAbs = path.join(testStorageDir, moveRes.trashedStoredName);
      const trashedStat = await fs.stat(trashedAbs);
      assert.ok(trashedStat.isFile());

      // Verify original physical file was moved out
      try {
        await fs.stat(path.join(testStorageDir, "MyNotes.txt"));
        assert.fail("Original path should no longer exist while trashed");
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        assert.equal(e.code, "ENOENT");
      }

      // Restore: move back from trash to original location
      const restoredPath = await storageService.restoreFromTrash(
        moveRes.trashedStoredName,
        moveRes.originalPath
      );
      assert.equal(restoredPath, "MyNotes.txt");

      // Verify physical file is back at original path
      const restoredStat = await fs.stat(path.join(testStorageDir, "MyNotes.txt"));
      assert.ok(restoredStat.isFile());
    });
  });

  // ============================================================================
  // TASK 5: EXTERNAL RECONCILIATION
  // ============================================================================
  describe("Task 5: External Reconciliation Engine", () => {
    test("detects externally modified file and updates checksum and size", async () => {
      const targetPath = path.join(testStorageDir, "Budget.csv");
      const newContent = "Month,Amount\nJan,100\nFeb,150\nMar,300\nApr,450\n";
      await fs.writeFile(targetPath, newContent);

      const rescan = await externalStorageScanner.scanStorage(testUserId);
      assert.ok(rescan.changesDetected >= 1, "Detected modification");

      const updatedRecord = await prisma.file.findFirst({
        where: { ownerId: testUserId, storedName: "Budget.csv" },
      });
      assert.equal(updatedRecord?.size, BigInt(Buffer.byteLength(newContent)));
    });

    test("detects externally deleted file and marks as deleted in database", async () => {
      // Remove Vacation.png directly from disk
      const targetPhysical = path.join(testStorageDir, "Photos", "2023", "Vacation.png");
      await fs.unlink(targetPhysical);

      const rescan = await externalStorageScanner.scanStorage(testUserId);
      assert.ok(rescan.changesDetected >= 1, "Detected external deletion");

      const fileRecord = await prisma.file.findFirst({
        where: {
          ownerId: testUserId,
          storedName: path.join("Photos", "2023", "Vacation.png"),
        },
      });
      assert.ok(fileRecord?.deletedAt !== null, "Marked as deleted in DB");
    });
  });
});
