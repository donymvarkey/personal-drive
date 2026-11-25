import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import * as crypto from "node:crypto";
import busboy from "busboy";
import { storageService } from "../src/lib/storage";

describe("Upload Concurrency & Streaming Fix Validation", () => {
  const testStorageDir = path.join("/tmp", "personal-drive-concurrency-tests");

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

  test("1. Concurrent validateStoragePath: 20 simultaneous calls never collide or throw ENOENT", async () => {
    // Simulate 20 requests hitting the storage validator in the exact same millisecond
    const promises = Array.from({ length: 20 }, (_, i) =>
      storageService.validateStoragePath(i % 2 === 0)
    );

    const results = await Promise.all(promises);

    for (const res of results) {
      assert.equal(res.valid, true, `Validation should be valid, got error: ${res.error}`);
      assert.ok(res.stats);
    }
  });

  test("2. MOV video detection: correctly detects video/quicktime from QuickTime atoms and extension", () => {
    // QuickTime atom: [size: 4 bytes] [type: 'moov']
    const moovHeader = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x6d, 0x6f, 0x6f, 0x76]);
    const detectedMime = storageService.detectMimeType(moovHeader, "mov");
    assert.equal(detectedMime, "video/quicktime");

    // ftypqt header
    const ftypQtHeader = Buffer.from([
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    ]);
    const ftypMime = storageService.detectMimeType(ftypQtHeader, "mov");
    assert.equal(ftypMime, "video/quicktime");
  });

  test("3. Large file streaming: streams multi-megabyte payload into atomic storage with zero RAM buffering", async () => {
    const chunkSize = 128 * 1024; // 128 KB
    const totalChunks = 40; // 5.12 MB
    let chunksEmitted = 0;
    const testHash = crypto.createHash("sha256");

    const sampleChunk = Buffer.alloc(chunkSize, "V");

    const stream = new Readable({
      read() {
        if (chunksEmitted < totalChunks) {
          testHash.update(sampleChunk);
          this.push(sampleChunk);
          chunksEmitted++;
        } else {
          this.push(null);
        }
      },
    });

    const storedName = `${crypto.randomUUID()}.mov`;
    const result = await storageService.saveStreamAtomic(storedName, stream, "mov");

    assert.equal(result.storedName, storedName);
    assert.equal(result.size, BigInt(chunkSize * totalChunks));
    assert.equal(result.checksum, testHash.digest("hex"));

    // Verify written file exists on disk
    const exists = await storageService.fileExists(storedName);
    assert.equal(exists, true);

    await storageService.deletePhysicalFile(storedName);
  });

  test("4. Busboy multipart streaming parser: processes file and folderId without buffer exhaustion", async () => {
    const boundary = "----TestBoundaryPersonalDrive";
    const fileContent = "Simulated binary video stream content payload 1234567890";
    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="presentation.mov"\r\n` +
      `Content-Type: video/quicktime\r\n\r\n` +
      `${fileContent}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="folderId"\r\n\r\n` +
      `target-folder-uuid-123\r\n` +
      `--${boundary}--\r\n`;

    const webStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(multipartBody));
        controller.close();
      },
    });

    const nodeStream = Readable.fromWeb(
      webStream as unknown as import("stream/web").ReadableStream<Uint8Array>
    );

    const bb = busboy({
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });

    let receivedFolderId: string | null = null;
    let savedStoredName: string | null = null;
    let savePromise: Promise<any> | null = null;

    const parsePromise = new Promise<void>((resolve, reject) => {
      bb.on("field", (name, val) => {
        if (name === "folderId") receivedFolderId = val;
      });

      bb.on("file", (_name, fileStream) => {
        const fileUuid = crypto.randomUUID();
        savedStoredName = `${fileUuid}.mov`;
        savePromise = storageService.saveStreamAtomic(savedStoredName, fileStream, "mov");
      });

      bb.on("error", reject);
      bb.on("close", () => resolve());
    });

    nodeStream.pipe(bb);
    await parsePromise;

    const streamWriteResult: any = await savePromise;

    assert.equal(receivedFolderId, "target-folder-uuid-123");
    assert.ok(streamWriteResult);
    assert.equal(streamWriteResult.detectedMimeType, "video/quicktime");
    assert.equal(streamWriteResult.size, BigInt(Buffer.byteLength(fileContent)));

    if (savedStoredName) {
      await storageService.deletePhysicalFile(savedStoredName);
    }
  });
});
