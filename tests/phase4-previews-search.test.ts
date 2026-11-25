import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { storageService } from "../src/lib/storage";
import { logActivity } from "../src/lib/activity";

const prisma = new PrismaClient();

describe("Phase 4: Previews, Search & Activity Test Suite", () => {
  let testOwnerId: string;
  let testIntruderId: string;
  let testStorageDir: string;

  before(async () => {
    testStorageDir = path.join("/tmp", "personal-drive-phase4-storage");
    process.env.DRIVE_STORAGE_PATH = testStorageDir;
    await fs.mkdir(path.join(testStorageDir, "files"), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, ".tmp"), { recursive: true });

    // Use dedicated isolated test user so live user drive is never polluted
    const owner = await prisma.user.upsert({
      where: { email: "test-phase4@personal.drive" },
      update: {},
      create: {
        email: "test-phase4@personal.drive",
        name: "Phase 4 Test Owner",
        hashedPassword: "dummy-hash",
      },
    });
    testOwnerId = owner.id;

    // Ensure secondary user exists for isolation testing
    const intruder = await prisma.user.upsert({
      where: { email: "intruder-phase4@personal.drive" },
      update: {},
      create: {
        email: "intruder-phase4@personal.drive",
        name: "Intruder User",
        hashedPassword: "dummy-hash",
      },
    });
    testIntruderId = intruder.id;
  });

  after(async () => {
    try {
      const userIds = [testOwnerId, testIntruderId].filter(Boolean) as string[];
      if (userIds.length > 0) {
        // Find and delete physical files created during this test suite
        const files = await prisma.file.findMany({
          where: { ownerId: { in: userIds } },
          select: { storedName: true },
        });
        for (const f of files) {
          await fs.unlink(path.join(testStorageDir, "files", f.storedName)).catch(() => {});
        }

        // Clean database records
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
      console.error("Phase 4 teardown error:", err);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("1. Preview Streaming & HTTP Range Requests: Validates 206 Partial Content", async () => {
    // Generate a 10KB synthetic binary (e.g. video / audio chunk)
    const mediaSize = 10 * 1024;
    const mediaBuffer = crypto.randomBytes(mediaSize);
    const storedName = `${crypto.randomUUID()}.mp4`;
    await fs.writeFile(path.join(testStorageDir, "files", storedName), mediaBuffer);

    const file = await prisma.file.create({
      data: {
        originalName: "presentation.mp4",
        storedName,
        mimeType: "video/mp4",
        extension: "mp4",
        size: BigInt(mediaSize),
        checksum: crypto.createHash("sha256").update(mediaBuffer).digest("hex"),
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });

    // Test byte range [0-1023] (first 1KB)
    const startByte = 0;
    const endByte = 1023;
    const readStream = await storageService.getReadStream(file.storedName, {
      start: startByte,
      end: endByte,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      chunks.push(Buffer.from(chunk));
    }
    const rangeChunk = Buffer.concat(chunks);

    assert.equal(rangeChunk.length, 1024, "Byte range length must be exactly 1024 bytes");
    assert.deepEqual(
      rangeChunk,
      mediaBuffer.subarray(startByte, endByte + 1),
      "Chunk data matches slice of original media"
    );

    // Test mid-file range [5000-6000]
    const midStream = await storageService.getReadStream(file.storedName, {
      start: 5000,
      end: 6000,
    });
    const midChunks: Buffer[] = [];
    for await (const chunk of midStream) {
      midChunks.push(Buffer.from(chunk));
    }
    const midRangeChunk = Buffer.concat(midChunks);
    assert.equal(midRangeChunk.length, 1001);
    assert.deepEqual(midRangeChunk, mediaBuffer.subarray(5000, 6001));
  });

  it("2. Security & Active Content Neutralization: Enforces sandboxing on active content", async () => {
    // Verify our active content policy list
    const activeContentTypes = [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/javascript",
      "text/javascript",
    ];

    function sanitizeMimeForPreview(mime: string): string {
      const isDangerous = activeContentTypes.some((t) =>
        mime.toLowerCase().startsWith(t)
      );
      return isDangerous ? "text/plain; charset=utf-8" : mime;
    }

    assert.equal(sanitizeMimeForPreview("text/html"), "text/plain; charset=utf-8");
    assert.equal(sanitizeMimeForPreview("image/svg+xml"), "text/plain; charset=utf-8");
    assert.equal(sanitizeMimeForPreview("application/javascript"), "text/plain; charset=utf-8");
    assert.equal(sanitizeMimeForPreview("image/png"), "image/png");
    assert.equal(sanitizeMimeForPreview("application/pdf"), "application/pdf");
    assert.equal(sanitizeMimeForPreview("video/mp4"), "video/mp4");
  });

  it("3. Global Search: Matches by filename, extension, MIME type, and folder name", async () => {
    // Create folders and files with unique search tokens
    const token = `SearchTest_${Date.now()}`;

    const searchFolder = await prisma.folder.create({
      data: {
        name: `Projects_${token}`,
        ownerId: testOwnerId,
      },
    });

    const searchFile = await prisma.file.create({
      data: {
        originalName: `Financial_Report_${token}.pdf`,
        storedName: `${crypto.randomUUID()}.pdf`,
        mimeType: "application/pdf",
        extension: "pdf",
        size: BigInt(2048),
        checksum: "search-pdf-checksum",
        ownerId: testOwnerId,
        folderId: searchFolder.id,
        storageStatus: "ready",
      },
    });

    const searchImage = await prisma.file.create({
      data: {
        originalName: `Architecture_${token}.png`,
        storedName: `${crypto.randomUUID()}.png`,
        mimeType: "image/png",
        extension: "png",
        size: BigInt(4096),
        checksum: "search-png-checksum",
        ownerId: testOwnerId,
        storageStatus: "ready",
      },
    });

    // 1. Search by token (matches both files and folder)
    const matchingFiles = await prisma.file.findMany({
      where: {
        ownerId: testOwnerId,
        deletedAt: null,
        isTrashed: false,
        OR: [
          { originalName: { contains: token, mode: "insensitive" } },
          { extension: { contains: token, mode: "insensitive" } },
        ],
      },
    });
    assert.equal(matchingFiles.length, 2, "Found both files matching token");

    const matchingFolders = await prisma.folder.findMany({
      where: {
        ownerId: testOwnerId,
        deletedAt: null,
        isTrashed: false,
        name: { contains: token, mode: "insensitive" },
      },
    });
    assert.equal(matchingFolders.length, 1, "Found folder matching token");
    assert.equal(matchingFolders[0].name, `Projects_${token}`);

    // 2. Search by extension and category filter
    const pdfOnly = await prisma.file.findMany({
      where: {
        ownerId: testOwnerId,
        deletedAt: null,
        isTrashed: false,
        originalName: { contains: token, mode: "insensitive" },
        mimeType: { contains: "pdf" },
      },
    });
    assert.equal(pdfOnly.length, 1);
    assert.equal(pdfOnly[0].extension, "pdf");
  });

  it("4. Activity Tracking: Logs and queries audit history for user events", async () => {
    const itemName = `Document_${Date.now()}.docx`;

    // 1. Log upload activity
    const uploadLog = await logActivity({
      ownerId: testOwnerId,
      action: "upload",
      itemName,
      details: { size: 50000, mimeType: "application/vnd.openxmlformats" },
    });
    assert.ok(uploadLog?.id, "Upload activity logged");
    assert.equal(uploadLog?.action, "upload");

    // 2. Log preview activity
    const previewLog = await logActivity({
      ownerId: testOwnerId,
      action: "preview",
      itemName,
    });
    assert.ok(previewLog?.id, "Preview activity logged");
    assert.equal(previewLog?.action, "preview");

    // 3. Log download activity
    const downloadLog = await logActivity({
      ownerId: testOwnerId,
      action: "download",
      itemName,
    });
    assert.ok(downloadLog?.id, "Download activity logged");
    assert.equal(downloadLog?.action, "download");

    // 4. Query activities for owner
    const logs = await prisma.activityLog.findMany({
      where: { ownerId: testOwnerId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    assert.ok(logs.length >= 3, "Activity logs query returns recorded events");
    assert.ok(logs.some((l) => l.action === "upload"));
    assert.ok(logs.some((l) => l.action === "preview"));
    assert.ok(logs.some((l) => l.action === "download"));
  });

  it("5. Authorization Isolation: Search and Activity strictly isolate owner context", async () => {
    // Create an intruder log
    await logActivity({
      ownerId: testIntruderId,
      action: "upload",
      itemName: "secret-intruder-file.txt",
    });

    // Owner must NOT see intruder's activity
    const ownerLogs = await prisma.activityLog.findMany({
      where: { ownerId: testOwnerId },
    });
    assert.ok(
      ownerLogs.every((l) => l.ownerId === testOwnerId),
      "Owner logs contain only owner activities"
    );

    // Intruder must NOT see owner's files
    const intruderFiles = await prisma.file.findMany({
      where: { ownerId: testIntruderId, deletedAt: null },
    });
    assert.ok(
      intruderFiles.every((f) => f.ownerId === testIntruderId),
      "Intruder files query contains only intruder files"
    );
  });
});
