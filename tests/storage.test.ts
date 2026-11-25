import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { storageService } from "../src/lib/storage";

describe("StorageService", () => {
  const testStorageDir = path.join("/tmp", "personal-drive-unit-tests");

  before(async () => {
    process.env.DRIVE_STORAGE_PATH = testStorageDir;
    await fs.mkdir(testStorageDir, { recursive: true });
  });

  after(async () => {
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("getStoragePath returns configured environment variable", () => {
    assert.equal(storageService.getStoragePath(), testStorageDir);
  });

  test("validateStoragePath succeeds when directory exists and is writable", async () => {
    const result = await storageService.validateStoragePath();
    assert.equal(result.valid, true);
    assert.ok(result.stats !== undefined);
  });

  test("validateStoragePath fails when path does not exist", async () => {
    try {
      process.env.DRIVE_STORAGE_PATH = "/nonexistent/path/on/disk";
      const result = await storageService.validateStoragePath(true);
      assert.equal(result.valid, false);
      assert.match(result.error ?? "", /does not exist/);
    } finally {
      process.env.DRIVE_STORAGE_PATH = testStorageDir;
    }
  });

  test("resolveFilePath guards against directory traversal attacks", () => {
    assert.throws(
      () => {
        storageService.resolveFilePath("../../../etc/passwd");
      },
      {
        message: /Path traversal detected/,
      }
    );
  });

  test("saveFile writes stream and computeSHA256 returns valid checksum", async () => {
    const relativePath = "subfolder/hello.txt";
    const content = "Hello Personal Cloud Drive!";
    const stream = Readable.from(Buffer.from(content));

    await storageService.saveFile(relativePath, stream);

    // Verify SHA-256
    const hash = await storageService.computeSHA256(relativePath);
    // echo -n "Hello Personal Cloud Drive!" | shasum -a 256
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);

    // Verify reading stream
    const readStream = await storageService.getReadStream(relativePath);
    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      chunks.push(Buffer.from(chunk));
    }
    const readContent = Buffer.concat(chunks).toString("utf-8");
    assert.equal(readContent, content);

    // Cleanup
    await storageService.deleteFile(relativePath);
  });
});
