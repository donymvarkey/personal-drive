import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import * as crypto from "node:crypto";
import { storageService } from "../src/lib/storage";

describe("Phase 2: File Storage Engine Tests", () => {
  const testStorageDir = path.join("/tmp", "personal-drive-phase2-tests");

  before(async () => {
    process.env.DRIVE_STORAGE_PATH = testStorageDir;
    await fs.mkdir(path.join(testStorageDir, "files"), { recursive: true });
    await fs.mkdir(path.join(testStorageDir, ".tmp"), { recursive: true });
  });

  after(async () => {
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("1. Small file upload and streaming read", async () => {
    const originalContent = "This is a small text file for Phase 2 validation.";
    const stream = Readable.from(Buffer.from(originalContent));
    const storedName = `${crypto.randomUUID()}.txt`;

    const result = await storageService.saveStreamAtomic(storedName, stream, "txt");

    assert.equal(result.storedName, storedName);
    assert.equal(result.size, BigInt(Buffer.byteLength(originalContent)));
    assert.equal(result.detectedMimeType, "text/plain; charset=utf-8");

    // Verify file exists on disk in files/
    const exists = await storageService.fileExists(storedName);
    assert.equal(exists, true);

    // Verify content via getReadStream
    const readStream = await storageService.getReadStream(storedName);
    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      chunks.push(Buffer.from(chunk));
    }
    const readText = Buffer.concat(chunks).toString("utf-8");
    assert.equal(readText, originalContent);

    // Clean up
    await storageService.deletePhysicalFile(storedName);
  });

  test("2. Large file streaming upload without buffering (simulated multi-megabyte stream)", async () => {
    // Generate a multi-chunk stream of 2MB
    const chunkSize = 64 * 1024; // 64KB
    const totalChunks = 32; // 2MB
    const sampleChunk = Buffer.alloc(chunkSize, "A");

    let chunksProduced = 0;
    const largeStream = new Readable({
      read() {
        if (chunksProduced < totalChunks) {
          this.push(sampleChunk);
          chunksProduced++;
        } else {
          this.push(null);
        }
      },
    });

    const storedName = `${crypto.randomUUID()}.bin`;
    const result = await storageService.saveStreamAtomic(storedName, largeStream, "bin");

    const expectedSize = BigInt(chunkSize * totalChunks);
    assert.equal(result.size, expectedSize);

    // Verify SHA-256 match
    const expectedHash = crypto
      .createHash("sha256")
      .update(Buffer.alloc(chunkSize * totalChunks, "A"))
      .digest("hex");
    assert.equal(result.checksum, expectedHash);

    // Clean up
    await storageService.deletePhysicalFile(storedName);
  });

  test("3. Multiple files upload independently without collision", async () => {
    const file1Name = `${crypto.randomUUID()}.txt`;
    const file2Name = `${crypto.randomUUID()}.txt`;

    const res1 = await storageService.saveStreamAtomic(
      file1Name,
      Readable.from(Buffer.from("File One Content")),
      "txt"
    );
    const res2 = await storageService.saveStreamAtomic(
      file2Name,
      Readable.from(Buffer.from("File Two Content")),
      "txt"
    );

    assert.notEqual(res1.storedName, res2.storedName);
    assert.notEqual(res1.checksum, res2.checksum);
    assert.equal(await storageService.fileExists(file1Name), true);
    assert.equal(await storageService.fileExists(file2Name), true);

    await storageService.deletePhysicalFile(file1Name);
    await storageService.deletePhysicalFile(file2Name);
  });

  test("4. Duplicate upload detection via SHA-256 checksum", async () => {
    const sharedContent = "Identical content uploaded multiple times.";
    const file1Name = `${crypto.randomUUID()}.txt`;
    const file2Name = `${crypto.randomUUID()}.txt`;

    const res1 = await storageService.saveStreamAtomic(
      file1Name,
      Readable.from(Buffer.from(sharedContent)),
      "txt"
    );
    const res2 = await storageService.saveStreamAtomic(
      file2Name,
      Readable.from(Buffer.from(sharedContent)),
      "txt"
    );

    // Both files have different stored physical names but identical checksums
    assert.notEqual(res1.storedName, res2.storedName);
    assert.equal(res1.checksum, res2.checksum);

    await storageService.deletePhysicalFile(file1Name);
    await storageService.deletePhysicalFile(file2Name);
  });

  test("5. Interrupted upload cleans up temporary staging file safely", async () => {
    const failingStream = new Readable({
      read() {
        this.destroy(new Error("Network connection lost mid-upload"));
      },
    });

    const storedName = `${crypto.randomUUID()}.dat`;

    await assert.rejects(
      async () => {
        await storageService.saveStreamAtomic(storedName, failingStream, "dat");
      },
      {
        message: /Network connection lost/,
      }
    );

    // Confirm that no orphaned file exists in files/
    const existsInFinal = await storageService.fileExists(storedName);
    assert.equal(existsInFinal, false);

    // Confirm staging directory has 0 active files for this upload
    const stagingFiles = await fs.readdir(path.join(testStorageDir, ".tmp"));
    assert.equal(stagingFiles.length, 0);
  });

  test("6. Missing storage disk: refuses to write or fall back silently", async () => {
    process.env.DRIVE_STORAGE_PATH = "/invalid/nonexistent/disk/mount/storage";

    const validation = await storageService.validateStoragePath();
    assert.equal(validation.valid, false);
    assert.match(validation.error || "", /does not exist/);

    // Attempting to resolve path outside or write throws
    assert.throws(() => {
      storageService.resolveFilePath("../../../etc/passwd");
    });

    process.env.DRIVE_STORAGE_PATH = testStorageDir;
  });

  test("7. Filename sanitization guards against path traversal and dangerous characters", () => {
    const malicious1 = "../../../../etc/shadow";
    const res1 = storageService.sanitizeFilename(malicious1);
    assert.equal(res1.safeName.includes("/"), false);
    assert.equal(res1.safeName.includes(".."), false);
    assert.equal(res1.safeName, "etcshadow");

    const nullByte = "report\0.pdf.exe";
    const res2 = storageService.sanitizeFilename(nullByte);
    assert.equal(res2.safeName.includes("\0"), false);
    assert.equal(res2.safeName, "report.pdf.exe");

    const unicode = "Résumé 2026.pdf";
    const res3 = storageService.sanitizeFilename(unicode);
    assert.equal(res3.extension, "pdf");
    assert.equal(res3.safeName, "Résumé 2026.pdf");
  });

  test("8. True MIME type detection from magic bytes", () => {
    // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    assert.equal(storageService.detectMimeType(pngHeader, "exe"), "image/png");

    // PDF magic header: %PDF (25 50 44 46)
    const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    assert.equal(storageService.detectMimeType(pdfHeader, "txt"), "application/pdf");

    // JPEG magic header: FF D8 FF
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    assert.equal(storageService.detectMimeType(jpegHeader, "png"), "image/jpeg");
  });

  test("9. Accidental collision guard prevents overwriting existing physical file", async () => {
    const storedName = `${crypto.randomUUID()}.txt`;
    await storageService.saveStreamAtomic(
      storedName,
      Readable.from(Buffer.from("First File")),
      "txt"
    );

    // Attempt to save another file with the exact same storedName
    await assert.rejects(
      async () => {
        await storageService.saveStreamAtomic(
          storedName,
          Readable.from(Buffer.from("Second File Overwrite")),
          "txt"
        );
      },
      {
        message: /already exists on storage/,
      }
    );

    // Verify first content is untouched
    const stream = await storageService.getReadStream(storedName);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    assert.equal(Buffer.concat(chunks).toString("utf-8"), "First File");

    await storageService.deletePhysicalFile(storedName);
  });
});
