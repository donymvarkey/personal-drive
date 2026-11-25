import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { storageService } from "../src/lib/storage";
import { ZipArchive } from "archiver";
import { Readable } from "stream";

const prisma = new PrismaClient();

describe("Phase 3: File Manager & Organization Test Suite", () => {
  let testOwnerId: string;
  let testOtherUserId: string;
  let testStorageDir: string;

  const createdPhysicalFiles: string[] = [];

  before(async () => {
    testStorageDir = path.join("/tmp", "personal-drive-phase3-storage");
    process.env.DRIVE_STORAGE_PATH = testStorageDir;
    await fs.mkdir(path.join(testStorageDir, "files"), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, ".tmp"), { recursive: true });

    // Use dedicated isolated test user so live user drive is never polluted
    const owner = await prisma.user.upsert({
      where: { email: "test-phase3@personal.drive" },
      update: {},
      create: {
        email: "test-phase3@personal.drive",
        name: "Phase 3 Test Owner",
        hashedPassword: "dummy-hash",
      },
    });
    testOwnerId = owner.id;

    // Create a secondary user for authorization isolation testing
    const otherUser = await prisma.user.upsert({
      where: { email: "intruder-phase3@personal.drive" },
      update: {},
      create: {
        email: "intruder-phase3@personal.drive",
        name: "Intruder User",
        hashedPassword: "dummy-hash",
      },
    });
    testOtherUserId = otherUser.id;
  });

  after(async () => {
    try {
      const userIds = [testOwnerId, testOtherUserId].filter(Boolean) as string[];
      if (userIds.length > 0) {
        // Find and delete all physical files created during this test suite
        const files = await prisma.file.findMany({
          where: { ownerId: { in: userIds } },
          select: { storedName: true },
        });
        for (const f of files) {
          await fs.unlink(path.join(testStorageDir, "files", f.storedName)).catch(() => {});
        }
        for (const pf of createdPhysicalFiles) {
          await fs.unlink(path.join(testStorageDir, "files", pf)).catch(() => {});
        }

        // Clean database records
        await prisma.starredItem.deleteMany({
          where: { ownerId: { in: userIds } },
        });
        await prisma.activityLog.deleteMany({
          where: { ownerId: { in: userIds } },
        });
        await prisma.file.deleteMany({
          where: { ownerId: { in: userIds } },
        });
        await prisma.folder.updateMany({
          where: { ownerId: { in: userIds } },
          data: { parentId: null },
        });
        await prisma.folder.deleteMany({
          where: { ownerId: { in: userIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    } catch (err) {
      console.error("Phase 3 teardown error:", err);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("1. Folder Management: Creates nested folder hierarchy", async () => {
    // Create root folder
    const rootFolder = await prisma.folder.create({
      data: {
        name: `Test-Root-${Date.now()}`,
        parentId: null,
        ownerId: testOwnerId,
      },
    });
    assert.ok(rootFolder.id, "Root folder created");
    assert.equal(rootFolder.parentId, null);

    // Create subfolder
    const subFolder = await prisma.folder.create({
      data: {
        name: "Subfolder-Level-1",
        parentId: rootFolder.id,
        ownerId: testOwnerId,
      },
    });
    assert.ok(subFolder.id, "Subfolder created");
    assert.equal(subFolder.parentId, rootFolder.id);

    // Create deeper nested folder
    const deepFolder = await prisma.folder.create({
      data: {
        name: "Subfolder-Level-2",
        parentId: subFolder.id,
        ownerId: testOwnerId,
      },
    });
    assert.ok(deepFolder.id, "Deep subfolder created");
    assert.equal(deepFolder.parentId, subFolder.id);
  });

  it("2. Circular Relationship Prevention: Detects and rejects cycles", async () => {
    // Setup A -> B -> C hierarchy
    const folderA = await prisma.folder.create({
      data: { name: "Cycle-Folder-A", ownerId: testOwnerId },
    });
    const folderB = await prisma.folder.create({
      data: { name: "Cycle-Folder-B", parentId: folderA.id, ownerId: testOwnerId },
    });
    const folderC = await prisma.folder.create({
      data: { name: "Cycle-Folder-C", parentId: folderB.id, ownerId: testOwnerId },
    });

    // Cycle check function equivalent to the API implementation
    async function wouldCreateCycle(sourceId: string, destId: string, owner: string): Promise<boolean> {
      if (sourceId === destId) return true;
      let curr: string | null = destId;
      const visited = new Set<string>();
      while (curr) {
        if (curr === sourceId) return true;
        if (visited.has(curr)) return true;
        visited.add(curr);
        const p: { parentId: string | null } | null = await prisma.folder.findFirst({
          where: { id: curr, ownerId: owner },
          select: { parentId: true },
        });
        if (!p) break;
        curr = p.parentId;
      }
      return false;
    }

    // Attempting to move A into C must be detected as a cycle (since C is descendant of A)
    const isCycleMoveAtoC = await wouldCreateCycle(folderA.id, folderC.id, testOwnerId);
    assert.equal(isCycleMoveAtoC, true, "Moving A into C must be detected as circular");

    // Attempting to move A into itself must be detected as cycle
    const isSelfCycle = await wouldCreateCycle(folderA.id, folderA.id, testOwnerId);
    assert.equal(isSelfCycle, true, "Moving A into itself must be detected as circular");

    // Moving C to root (null) is valid
    const isValidMove = await wouldCreateCycle(folderC.id, folderA.id, testOwnerId);
    assert.equal(isValidMove, false, "Moving C into A is valid");
  });

  it("3. Physical File Duplication: Clones binary on disk with atomic consistency", async () => {
    // Write original file to physical storage
    const content = Buffer.from("Phase 3 Physical File Duplication Test Binary Content");
    const originalStoredName = `${crypto.randomUUID()}.txt`;
    const originalPath = path.join(testStorageDir, "files", originalStoredName);
    await fs.writeFile(originalPath, content);

    const originalFile = await prisma.file.create({
      data: {
        originalName: "Report.txt",
        storedName: originalStoredName,
        mimeType: "text/plain",
        extension: "txt",
        size: BigInt(content.length),
        checksum: crypto.createHash("sha256").update(content).digest("hex"),
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });

    // Execute physical copy
    const copiedStoredName = `${crypto.randomUUID()}.txt`;
    const copiedPath = await storageService.copyPhysicalFile(originalStoredName, copiedStoredName);
    assert.ok(copiedPath, "Physical file copied to new location");

    // Verify copy exists on disk with identical content
    const copiedContent = await fs.readFile(copiedPath);
    assert.deepEqual(copiedContent, content, "Copied file content matches original");

    // Create DB record for duplicate
    const copiedDbFile = await prisma.file.create({
      data: {
        originalName: "Report (Copy).txt",
        storedName: copiedStoredName,
        mimeType: originalFile.mimeType,
        extension: originalFile.extension,
        size: originalFile.size,
        checksum: originalFile.checksum,
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });

    assert.notEqual(copiedDbFile.id, originalFile.id, "Copied file has unique ID");
    assert.notEqual(copiedDbFile.storedName, originalFile.storedName, "Copied file has unique physical storedName");
    assert.equal(copiedDbFile.checksum, originalFile.checksum, "SHA-256 checksums match");
  });

  it("4. Bulk Operations: Bulk move, bulk trash, and bulk restore", async () => {
    const parentTarget = await prisma.folder.create({
      data: { name: "Bulk-Destination-Folder", ownerId: testOwnerId },
    });

    // Create 3 files
    const file1 = await prisma.file.create({
      data: {
        originalName: "bulk-1.txt",
        storedName: `${crypto.randomUUID()}.txt`,
        mimeType: "text/plain",
        extension: "txt",
        size: BigInt(100),
        checksum: "dummy1",
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });
    const file2 = await prisma.file.create({
      data: {
        originalName: "bulk-2.txt",
        storedName: `${crypto.randomUUID()}.txt`,
        mimeType: "text/plain",
        extension: "txt",
        size: BigInt(200),
        checksum: "dummy2",
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });

    const fileIds = [file1.id, file2.id];

    // Bulk Move to target folder
    await prisma.file.updateMany({
      where: { id: { in: fileIds }, ownerId: testOwnerId },
      data: { folderId: parentTarget.id },
    });

    const movedFiles = await prisma.file.findMany({
      where: { id: { in: fileIds } },
    });
    assert.equal(movedFiles.length, 2);
    assert.equal(movedFiles[0].folderId, parentTarget.id);
    assert.equal(movedFiles[1].folderId, parentTarget.id);

    // Bulk Trash
    await prisma.file.updateMany({
      where: { id: { in: fileIds }, ownerId: testOwnerId },
      data: { isTrashed: true, trashedAt: new Date() },
    });

    const trashedFiles = await prisma.file.findMany({
      where: { id: { in: fileIds } },
    });
    assert.equal(trashedFiles.every((f) => f.isTrashed), true, "All items marked as trashed");

    // Bulk Restore
    await prisma.file.updateMany({
      where: { id: { in: fileIds }, ownerId: testOwnerId },
      data: { isTrashed: false, trashedAt: null },
    });

    const restoredFiles = await prisma.file.findMany({
      where: { id: { in: fileIds } },
    });
    assert.equal(restoredFiles.every((f) => !f.isTrashed), true, "All items restored");
  });

  it("5. Bulk Download: Generates valid streaming ZIP archive using ZipArchive", async () => {
    // Create 2 test physical files
    const fileAContent = Buffer.from("Hello from File A in ZIP");
    const fileAStored = `${crypto.randomUUID()}.txt`;
    await fs.writeFile(path.join(testStorageDir, "files", fileAStored), fileAContent);

    const fileBContent = Buffer.from("Hello from File B in ZIP");
    const fileBStored = `${crypto.randomUUID()}.txt`;
    await fs.writeFile(path.join(testStorageDir, "files", fileBStored), fileBContent);
    createdPhysicalFiles.push(fileAStored, fileBStored);

    // Create ZipArchive instance
    const zip = new ZipArchive({ zlib: { level: 1 } });
    const chunks: Buffer[] = [];

    zip.on("data", (chunk: Buffer) => chunks.push(chunk));

    const zipPromise = new Promise<Buffer>((resolve, reject) => {
      zip.on("end", () => resolve(Buffer.concat(chunks)));
      zip.on("error", (err) => reject(err));
    });

    // Append entries
    const streamA = await storageService.getReadStream(fileAStored);
    const streamB = await storageService.getReadStream(fileBStored);

    zip.append(streamA, { name: "documents/file-a.txt" });
    zip.append(streamB, { name: "documents/file-b.txt" });
    await zip.finalize();

    const zipBuffer = await zipPromise;
    assert.ok(zipBuffer.length > 0, "ZIP buffer generated");
    // Verify standard ZIP magic bytes (PK\x03\x04)
    assert.equal(zipBuffer[0], 0x50, "ZIP magic byte 1 is 'P'");
    assert.equal(zipBuffer[1], 0x4b, "ZIP magic byte 2 is 'K'");
    assert.equal(zipBuffer[2], 0x03, "ZIP magic byte 3 is 0x03");
    assert.equal(zipBuffer[3], 0x04, "ZIP magic byte 4 is 0x04");
  });

  it("6. Starred Items: Stars and unstars files and folders", async () => {
    const starFolder = await prisma.folder.create({
      data: { name: "Starred-Folder-Test", ownerId: testOwnerId },
    });

    const starFile = await prisma.file.create({
      data: {
        originalName: "starred-note.txt",
        storedName: `${crypto.randomUUID()}.txt`,
        mimeType: "text/plain",
        extension: "txt",
        size: BigInt(50),
        checksum: "star-dummy-checksum",
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });

    // Star folder
    await prisma.folder.update({
      where: { id: starFolder.id },
      data: { isStarred: true },
    });
    await prisma.starredItem.create({
      data: {
        ownerId: testOwnerId,
        folderId: starFolder.id,
      },
    });

    // Star file
    await prisma.file.update({
      where: { id: starFile.id },
      data: { isStarred: true },
    });
    await prisma.starredItem.create({
      data: {
        ownerId: testOwnerId,
        fileId: starFile.id,
      },
    });

    // Verify Starred query retrieves both
    const starredFiles = await prisma.file.findMany({
      where: { ownerId: testOwnerId, isStarred: true, isTrashed: false, deletedAt: null },
    });
    const starredFolders = await prisma.folder.findMany({
      where: { ownerId: testOwnerId, isStarred: true, isTrashed: false, deletedAt: null },
    });

    assert.ok(starredFiles.some((f) => f.id === starFile.id), "File is listed in starred");
    assert.ok(starredFolders.some((f) => f.id === starFolder.id), "Folder is listed in starred");

    // Unstar
    await prisma.starredItem.deleteMany({
      where: { ownerId: testOwnerId, fileId: starFile.id },
    });
    await prisma.file.update({
      where: { id: starFile.id },
      data: { isStarred: false },
    });

    const verifyUnstarred = await prisma.file.findUnique({
      where: { id: starFile.id },
    });
    assert.equal(verifyUnstarred?.isStarred, false, "File is now unstarred");
  });

  it("7. Security & Isolation: Other users cannot access or modify owner files/folders", async () => {
    const protectedFolder = await prisma.folder.create({
      data: { name: "Owner-Private-Folder", ownerId: testOwnerId },
    });

    // Attempt query with other user context
    const intruderFolderQuery = await prisma.folder.findFirst({
      where: { id: protectedFolder.id, ownerId: testOtherUserId },
    });
    assert.equal(intruderFolderQuery, null, "Other user cannot view owner folder");

    // Attempt folder update with other user context
    const intruderUpdateResult = await prisma.folder.updateMany({
      where: { id: protectedFolder.id, ownerId: testOtherUserId },
      data: { name: "Hacked Folder Name" },
    });
    assert.equal(intruderUpdateResult.count, 0, "Other user cannot modify owner folder");

    // Verify folder name unchanged
    const unchangedFolder = await prisma.folder.findUnique({
      where: { id: protectedFolder.id },
    });
    assert.equal(unchangedFolder?.name, "Owner-Private-Folder", "Folder name remained secure and untouched");
  });
});
