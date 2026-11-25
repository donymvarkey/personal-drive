import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import { Transform } from "stream";

const execAsync = promisify(exec);

export interface StorageStats {
  totalBytes: bigint;
  usedBytes: bigint;
  freeBytes: bigint;
  device?: string;
  mountPoint?: string;
  fsType?: string;
  uuid?: string;
}

export interface StorageValidation {
  valid: boolean;
  error?: string;
  stats?: StorageStats;
  isMounted?: boolean;
  fsType?: string;
  uuid?: string;
  device?: string;
  markerVerified?: boolean;
  markerId?: string;
}

export interface ExternalMountValidation extends StorageValidation {
  isMounted: boolean;
  markerVerified: boolean;
  markerId?: string;
}

export interface StreamWriteResult {
  storedName: string;
  size: bigint;
  checksum: string;
  detectedMimeType: string;
}

export class StorageService {
  private static instance: StorageService;

  private constructor() {}

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Returns the storage root path from the DRIVE_STORAGE_PATH env var.
   * Throws if missing — never falls back silently.
   */
  getStoragePath(): string {
    const storagePath = process.env.DRIVE_STORAGE_PATH;
    if (!storagePath) {
      throw new Error(
        "DRIVE_STORAGE_PATH environment variable is not set. " +
          "Configure it to the absolute path of the dedicated physical storage mount."
      );
    }
    return storagePath;
  }

  private lastValidationTime = 0;
  private lastValidatedPath = "";
  private lastValidationResult: ExternalMountValidation | null = null;

  /**
   * Comprehensive validation for external SSD storage (e.g. exFAT):
   * 1. Checks if the storage path exists and is a directory.
   *    Never creates the storage path if missing (prevents silent fallback to internal drive).
   * 2. Checks mount status via /proc/mounts (Linux) or findmnt/df.
   * 3. Validates filesystem type (exFAT) if DRIVE_STORAGE_FS_TYPE is specified or detected.
   * 4. Validates UUID if DRIVE_STORAGE_UUID is specified.
   * 5. Checks or initializes the application marker file (<storagePath>/.personal-drive/disk.marker).
   * 6. Ensures application-managed directories (.personal-drive/uploads, versions, trash, metadata, temp) exist.
   * 7. Verifies read and write permissions.
   */
  async validateExternalMount(
    targetPath?: string,
    expectedUuid?: string,
    expectedFsType?: string
  ): Promise<ExternalMountValidation> {
    const storagePath = targetPath || this.getStoragePath();
    const targetUuid = expectedUuid || process.env.DRIVE_STORAGE_UUID;
    const targetFs = expectedFsType || process.env.DRIVE_STORAGE_FS_TYPE;

    // 1. Check directory existence - NEVER silently mkdir the root storagePath if missing
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(storagePath);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        return {
          valid: false,
          isMounted: false,
          markerVerified: false,
          error: `External storage path "${storagePath}" does not exist. The external SSD appears disconnected. Personal Drive will not fall back to internal storage.`,
        };
      }
      return {
        valid: false,
        isMounted: false,
        markerVerified: false,
        error: `Cannot access storage path: ${e.message}`,
      };
    }

    if (!stat.isDirectory()) {
      return {
        valid: false,
        isMounted: false,
        markerVerified: false,
        error: `Storage path "${storagePath}" is not a directory.`,
      };
    }

    // 2. Inspect mount point & filesystem type
    let isMounted = false;
    let detectedFsType: string | undefined;
    let detectedDevice: string | undefined;
    let detectedUuid: string | undefined;

    // On Linux: inspect /proc/mounts
    try {
      if (fs.existsSync("/proc/mounts")) {
        const mountsContent = await fs.promises.readFile("/proc/mounts", "utf-8");
        const lines = mountsContent.split("\n");
        const resolvedTarget = path.resolve(storagePath);

        let bestMatch = "";
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const [dev, mountPoint, fsType] = parts;
            if (
              resolvedTarget === mountPoint ||
              resolvedTarget.startsWith(mountPoint.endsWith("/") ? mountPoint : mountPoint + "/")
            ) {
              if (mountPoint.length > bestMatch.length) {
                bestMatch = mountPoint;
                detectedDevice = dev;
                detectedFsType = fsType;
                isMounted = true;
              }
            }
          }
        }
      }
    } catch {
      // Continue to fallback
    }

    // Fallback or cross-platform query via findmnt / df
    if (!isMounted) {
      try {
        const { stdout } = await execAsync(
          `findmnt -n -o TARGET,FSTYPE,UUID,SOURCE --target "${storagePath}"`
        );
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 2) {
          isMounted = true;
          detectedFsType = parts[1];
          if (parts.length >= 3 && parts[2] !== "-") detectedUuid = parts[2];
          if (parts.length >= 4) detectedDevice = parts[3];
        }
      } catch {
        try {
          const { stdout } = await execAsync(`df -k "${storagePath}"`);
          if (stdout.trim().split("\n").length > 1) {
            isMounted = true;
          }
        } catch {
          // Dev or mock environment fallback
          isMounted = true;
        }
      }
    }

    // Check expected filesystem type if configured
    if (targetFs && detectedFsType) {
      const normalizedDetected = detectedFsType.toLowerCase();
      const normalizedTarget = targetFs.toLowerCase();
      const isExfatMatch =
        (normalizedTarget === "exfat" &&
          ["exfat", "fuse.exfat", "vfat", "msdos"].includes(normalizedDetected)) ||
        normalizedDetected === normalizedTarget;

      if (!isExfatMatch) {
        return {
          valid: false,
          isMounted,
          fsType: detectedFsType,
          markerVerified: false,
          error: `Storage filesystem mismatch: expected "${targetFs}", but detected "${detectedFsType}".`,
        };
      }
    }

    // Check expected UUID if configured
    if (targetUuid && detectedUuid && detectedUuid.toLowerCase() !== targetUuid.toLowerCase()) {
      return {
        valid: false,
        isMounted,
        fsType: detectedFsType,
        uuid: detectedUuid,
        markerVerified: false,
        error: `Storage UUID mismatch: expected "${targetUuid}", but detected "${detectedUuid}".`,
      };
    }

    // 3. Test read/write permissions
    try {
      await fs.promises.access(storagePath, fs.constants.R_OK | fs.constants.W_OK);
      const testFile = path.join(storagePath, `.write-test-${crypto.randomUUID()}`);
      await fs.promises.writeFile(testFile, "ok");
      await fs.promises.unlink(testFile).catch(() => {});
    } catch (err: unknown) {
      const e = err as Error;
      return {
        valid: false,
        isMounted,
        fsType: detectedFsType,
        markerVerified: false,
        error: `Storage path is not writable: ${e.message}`,
      };
    }

    // 4. Ensure Application-Managed Directories exist
    // (.personal-drive/uploads, versions, trash, metadata, temp)
    const managedDir = path.join(storagePath, ".personal-drive");
    const subDirs = ["uploads", "versions", "trash", "metadata", "temp"];
    try {
      await fs.promises.mkdir(managedDir, { recursive: true });
      for (const sub of subDirs) {
        await fs.promises.mkdir(path.join(managedDir, sub), { recursive: true });
      }
    } catch (err: unknown) {
      const e = err as Error;
      return {
        valid: false,
        isMounted,
        fsType: detectedFsType,
        markerVerified: false,
        error: `Failed to initialize application directories on external SSD: ${e.message}`,
      };
    }

    // 5. Marker File Verification / Initialization
    const markerPath = path.join(managedDir, "disk.marker");
    let markerVerified = false;
    let markerId: string | undefined;

    try {
      const markerContent = await fs.promises.readFile(markerPath, "utf-8");
      const parsed = JSON.parse(markerContent);
      if (parsed.app === "personal-drive" && parsed.markerId) {
        markerVerified = true;
        markerId = parsed.markerId;
      }
    } catch {
      // Marker does not exist yet -> initialize it
      try {
        const newMarker = {
          markerId: crypto.randomUUID(),
          app: "personal-drive",
          createdAt: new Date().toISOString(),
          fsType: detectedFsType || targetFs || "exfat",
          uuid: detectedUuid || targetUuid || null,
          version: "1.0.0",
        };
        await fs.promises.writeFile(markerPath, JSON.stringify(newMarker, null, 2), "utf-8");
        markerVerified = true;
        markerId = newMarker.markerId;
      } catch (err: unknown) {
        const e = err as Error;
        return {
          valid: false,
          isMounted,
          fsType: detectedFsType,
          markerVerified: false,
          error: `Failed to write disk marker on external SSD: ${e.message}`,
        };
      }
    }

    const diskStats = await this.getStorageStats();
    if (detectedFsType) diskStats.fsType = detectedFsType;
    if (detectedUuid) diskStats.uuid = detectedUuid;

    return {
      valid: true,
      isMounted: true,
      fsType: detectedFsType || targetFs || diskStats.fsType || "exfat",
      device: detectedDevice || diskStats.device,
      uuid: detectedUuid || targetUuid,
      markerVerified,
      markerId,
      stats: diskStats,
    };
  }

  /**
   * Validates that the storage path exists, is a directory, is mounted, and is writable.
   * Never silently creates the directory if the underlying mount does not exist.
   * Uses crypto.randomUUID() and short-term caching to prevent race conditions during concurrent uploads.
   */
  async validateStoragePath(force = false): Promise<ExternalMountValidation> {
    const storagePath = this.getStoragePath();
    const now = Date.now();

    // Cache positive validation only if storage path has not changed
    if (
      !force &&
      this.lastValidatedPath === storagePath &&
      this.lastValidationResult?.valid &&
      now - this.lastValidationTime < 3000
    ) {
      return this.lastValidationResult;
    }

    const res = await this.validateExternalMount(storagePath);
    if (res.valid) {
      this.lastValidationTime = now;
      this.lastValidatedPath = storagePath;
      this.lastValidationResult = res;
    } else {
      this.lastValidationResult = null;
    }
    return res;
  }

  /**
   * Resolves a relative path inside the storage root and verifies against path traversal.
   */
  resolveFilePath(relativePath: string): string {
    const storagePath = this.getStoragePath();
    const resolved = path.resolve(storagePath, relativePath);

    if (!resolved.startsWith(path.resolve(storagePath))) {
      throw new Error(
        `Path traversal detected: "${relativePath}" resolves outside storage root`
      );
    }

    return resolved;
  }

  /**
   * Sanitizes user-provided filenames specifically for exFAT filesystem constraints:
   * 1. Removes illegal characters: \ / : * ? " < > | \0 and ASCII control characters (0x00 - 0x1F)
   * 2. Trims leading and trailing spaces and dots (exFAT forbids filenames ending with dot or space)
   * 3. Normalizes Unicode (NFC) while preserving original case
   * 4. Enforces max length 255 characters (preserving extension)
   * 5. Defaults to unnamed-file-<timestamp>.<ext> if sanitized name is empty
   */
  sanitizeExfatFilename(filename: string): { safeName: string; extension: string } {
    // 1. Remove null bytes, path separators, illegal exFAT chars, and control characters
    let clean = filename
      .replace(/\0/g, "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .trim();

    // 2. Normalize Unicode (NFC)
    clean = clean.normalize("NFC");

    // 3. Remove leading dots and trailing dots/spaces
    clean = clean.replace(/^\.+/, "").replace(/[\s.]+$/, "").trim();

    // 4. Default fallback if empty
    if (!clean || clean === "." || clean === "..") {
      clean = `unnamed-file-${Date.now()}`;
    }

    // 5. Truncate to maximum safe filesystem length (255 chars)
    if (clean.length > 255) {
      const ext = path.extname(clean);
      const base = clean.slice(0, 255 - ext.length);
      clean = `${base}${ext}`;
    }

    // 6. Extract extension in lowercase (without dot)
    const rawExt = path.extname(clean).replace(/^\./, "").toLowerCase();
    const extension = rawExt || "bin";

    return { safeName: clean, extension };
  }

  /**
   * Sanitizes user-provided filenames to prevent traversal, null-byte injection,
   * or illegal filesystem characters (exFAT compatible).
   */
  sanitizeFilename(filename: string): { safeName: string; extension: string } {
    return this.sanitizeExfatFilename(filename);
  }

  /**
   * Checks whether a filename already exists in a physical directory using case-insensitive comparison.
   * Crucial for exFAT where 'Photo.jpg' and 'photo.jpg' refer to the exact same file.
   */
  async checkFilenameCollision(
    dirPath: string,
    candidateName: string
  ): Promise<{ collides: boolean; existingName?: string }> {
    try {
      const entries = await fs.promises.readdir(dirPath);
      const targetLower = candidateName.toLowerCase();
      const match = entries.find((e) => e.toLowerCase() === targetLower);
      if (match) {
        return { collides: true, existingName: match };
      }
      return { collides: false };
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { collides: false };
      }
      throw e;
    }
  }

  /**
   * Generates a non-colliding filename in the given directory if a collision exists,
   * e.g., "vacation (1).jpg", "vacation (2).jpg".
   */
  async getNonCollidingFilename(dirPath: string, desiredName: string): Promise<string> {
    const collision = await this.checkFilenameCollision(dirPath, desiredName);
    if (!collision.collides) {
      return desiredName;
    }

    const ext = path.extname(desiredName);
    const base = path.basename(desiredName, ext);

    let counter = 1;
    while (counter < 1000) {
      const candidate = `${base} (${counter})${ext}`;
      const check = await this.checkFilenameCollision(dirPath, candidate);
      if (!check.collides) {
        return candidate;
      }
      counter++;
    }

    return `${base}-${Date.now()}${ext}`;
  }

  /**
   * Detects true MIME type from initial buffer magic bytes.
   */
  detectMimeType(headerBuffer: Buffer, extension?: string): string {
    if (headerBuffer.length >= 8) {
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (
        headerBuffer[0] === 0x89 &&
        headerBuffer[1] === 0x50 &&
        headerBuffer[2] === 0x4e &&
        headerBuffer[3] === 0x47 &&
        headerBuffer[4] === 0x0d &&
        headerBuffer[5] === 0x0a &&
        headerBuffer[6] === 0x1a &&
        headerBuffer[7] === 0x0a
      ) {
        return "image/png";
      }

      // PDF: %PDF (25 50 44 46)
      if (
        headerBuffer[0] === 0x25 &&
        headerBuffer[1] === 0x50 &&
        headerBuffer[2] === 0x44 &&
        headerBuffer[3] === 0x46
      ) {
        return "application/pdf";
      }

      // JPEG: FF D8 FF
      if (
        headerBuffer[0] === 0xff &&
        headerBuffer[1] === 0xd8 &&
        headerBuffer[2] === 0xff
      ) {
        return "image/jpeg";
      }

      // GIF: GIF87a or GIF89a (47 49 46 38)
      if (
        headerBuffer[0] === 0x47 &&
        headerBuffer[1] === 0x49 &&
        headerBuffer[2] === 0x46 &&
        headerBuffer[3] === 0x38
      ) {
        return "image/gif";
      }

      // ZIP / DOCX / XLSX / JAR: 50 4B 03 04
      if (
        headerBuffer[0] === 0x50 &&
        headerBuffer[1] === 0x4b &&
        headerBuffer[2] === 0x03 &&
        headerBuffer[3] === 0x04
      ) {
        if (extension === "docx")
          return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (extension === "xlsx")
          return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (extension === "pptx")
          return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        return "application/zip";
      }

      // GZIP: 1F 8B
      if (headerBuffer[0] === 0x1f && headerBuffer[1] === 0x8b) {
        return "application/gzip";
      }

      // WebP: RIFF....WEBP
      if (
        headerBuffer[0] === 0x52 &&
        headerBuffer[1] === 0x49 &&
        headerBuffer[2] === 0x46 &&
        headerBuffer[3] === 0x46 &&
        headerBuffer.length >= 12 &&
        headerBuffer[8] === 0x57 &&
        headerBuffer[9] === 0x45 &&
        headerBuffer[10] === 0x42 &&
        headerBuffer[11] === 0x50
      ) {
        return "image/webp";
      }

      // MP4 / MOV: ....ftyp or QuickTime container atoms
      if (
        headerBuffer.length >= 8 &&
        headerBuffer[4] === 0x66 &&
        headerBuffer[5] === 0x74 &&
        headerBuffer[6] === 0x79 &&
        headerBuffer[7] === 0x70
      ) {
        if (extension === "mov") return "video/quicktime";
        return "video/mp4";
      }

      // QuickTime atom markers (moov, mdat, wide, skip, free)
      if (headerBuffer.length >= 8) {
        const atomType = headerBuffer.subarray(4, 8).toString("ascii");
        if (["moov", "mdat", "wide", "skip", "free", "pnot"].includes(atomType)) {
          return "video/quicktime";
        }
      }
    }

    // Extension-based fallback map for common text and data formats
    const extMap: Record<string, string> = {
      txt: "text/plain; charset=utf-8",
      csv: "text/csv; charset=utf-8",
      json: "application/json",
      md: "text/markdown; charset=utf-8",
      html: "text/html; charset=utf-8",
      svg: "image/svg+xml",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      tar: "application/x-tar",
      gz: "application/gzip",
      zip: "application/zip",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      mkv: "video/x-matroska",
      avi: "video/x-msvideo",
    };

    if (extension && extMap[extension.toLowerCase()]) {
      return extMap[extension.toLowerCase()];
    }

    return "application/octet-stream";
  }

  /**
   * Backwards-compatible saveFile method: saves a stream to a relative path.
   */
  async saveFile(
    relativePath: string,
    source: NodeJS.ReadableStream
  ): Promise<void> {
    const absolute = this.resolveFilePath(relativePath);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await pipeline(source, fs.createWriteStream(absolute));
  }

  /**
   * Computes SHA-256 hash of a file on disk.
   */
  async computeSHA256(relativePath: string): Promise<string> {
    const absolute = this.resolveFilePath(relativePath);
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absolute);
    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  /**
   * Deletes the file at the given relative path.
   */
  async deleteFile(relativePath: string): Promise<void> {
    const absolute = this.resolveFilePath(relativePath);
    try {
      await fs.promises.unlink(absolute);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }
  }

  /**
   * Helper that resolves where a file is stored on physical disk.
   * Checks:
   * 1. Direct path relative to storage root (e.g. "Photos/2023/vacation.jpg" or ".personal-drive/uploads/uuid.png")
   * 2. Legacy "files/<storedName>" location
   * 3. ".personal-drive/uploads/<storedName>" location
   */
  resolveStoredPath(storedNameOrPath: string): string {
    const storagePath = this.getStoragePath();

    // 1. Direct relative path
    const direct = this.resolveFilePath(storedNameOrPath);
    if (fs.existsSync(direct)) return direct;

    // 2. Legacy "files/" prefix
    const inFiles = path.resolve(storagePath, "files", storedNameOrPath);
    if (fs.existsSync(inFiles)) return inFiles;

    // 3. ".personal-drive/uploads/" prefix
    const inUploads = path.resolve(storagePath, ".personal-drive", "uploads", storedNameOrPath);
    if (fs.existsSync(inUploads)) return inUploads;

    // Default to direct resolved path
    return direct;
  }

  /**
   * Streams an uploaded file directly to disk atomically:
   * 1. Streams to a temporary staging file in `.personal-drive/temp/` (or `.tmp/`).
   * 2. Computes SHA-256 hash and byte size on the fly without buffering in RAM.
   * 3. Detects true MIME type from first chunk.
   * 4. Atomically renames (or copy+unlinks on exFAT) to the target path.
   * 5. Cleans up staging file on any error or stream abortion.
   */
  async saveStreamAtomic(
    storedName: string,
    sourceStream: NodeJS.ReadableStream,
    fallbackExt?: string
  ): Promise<StreamWriteResult> {
    const storagePath = this.getStoragePath();
    const stagingDir = path.join(storagePath, ".personal-drive", "temp");
    await fs.promises.mkdir(stagingDir, { recursive: true });

    // Determine target location:
    // If storedName contains directory separators or starts with .personal-drive, use directly;
    // Otherwise place in "files/" for legacy compatibility.
    let finalPath: string;
    if (storedName.includes("/") || storedName.includes("\\") || storedName.startsWith(".")) {
      finalPath = this.resolveFilePath(storedName);
    } else {
      finalPath = this.resolveFilePath(path.join("files", storedName));
    }

    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });

    // Prevent accidental collision
    try {
      await fs.promises.access(finalPath);
      throw new Error(`File collision: "${storedName}" already exists on storage.`);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }

    const stagingPath = path.join(stagingDir, `${crypto.randomUUID()}.staging`);
    const hash = crypto.createHash("sha256");
    let totalBytes = BigInt(0);
    let firstChunk: Buffer | null = null;

    const inspector = new Transform({
      transform(chunk, _encoding, callback) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!firstChunk) {
          firstChunk = buf.subarray(0, 128);
        }
        hash.update(buf);
        totalBytes += BigInt(buf.length);
        callback(null, chunk);
      },
    });

    const fileWriteStream = fs.createWriteStream(stagingPath);

    try {
      await pipeline(sourceStream, inspector, fileWriteStream);

      // Move staging file to final location (try rename first, fallback to copy+unlink for exFAT)
      try {
        await fs.promises.rename(stagingPath, finalPath);
      } catch {
        await fs.promises.copyFile(stagingPath, finalPath);
        await fs.promises.unlink(stagingPath).catch(() => {});
      }

      const checksum = hash.digest("hex");
      const detectedMimeType = this.detectMimeType(
        firstChunk || Buffer.alloc(0),
        fallbackExt
      );

      return {
        storedName,
        size: totalBytes,
        checksum,
        detectedMimeType,
      };
    } catch (err) {
      try {
        await fs.promises.unlink(stagingPath);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
  }

  /**
   * Retrieves a readable file stream for download or preview.
   * Resolves directly, via files/, or via .personal-drive/uploads/.
   */
  async getReadStream(
    storedNameOrPath: string,
    options?: { start?: number; end?: number }
  ): Promise<fs.ReadStream> {
    const resolved = this.resolveStoredPath(storedNameOrPath);
    await fs.promises.access(resolved, fs.constants.R_OK);
    return fs.createReadStream(resolved, options);
  }

  /**
   * Moves a physical file from source to destination.
   * Tries atomic rename first; if cross-device or exFAT boundary error, falls back to copy + unlink.
   */
  async movePhysicalFile(srcPath: string, destPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    try {
      await fs.promises.rename(srcPath, destPath);
    } catch {
      await fs.promises.copyFile(srcPath, destPath);
      await fs.promises.unlink(srcPath).catch(() => {});
    }
  }

  /**
   * Moves a file to the .personal-drive/trash directory safely without loss of data.
   * Returns the new relative storedName inside trash and the original path.
   */
  async moveToTrash(storedName: string): Promise<{ trashedStoredName: string; originalPath: string }> {
    const sourceAbs = this.resolveStoredPath(storedName);
    const storagePath = this.getStoragePath();
    const trashDir = path.join(storagePath, ".personal-drive", "trash");
    await fs.promises.mkdir(trashDir, { recursive: true });

    const baseName = path.basename(storedName);
    const trashedStoredName = path.join(".personal-drive", "trash", `${Date.now()}-${baseName}`);
    const destAbs = path.join(storagePath, trashedStoredName);

    await this.movePhysicalFile(sourceAbs, destAbs);
    return { trashedStoredName, originalPath: storedName };
  }

  /**
   * Restores a file from .personal-drive/trash back to its original physical path (or fallback).
   */
  async restoreFromTrash(trashedStoredName: string, originalPath: string): Promise<string> {
    const sourceAbs = this.resolveStoredPath(trashedStoredName);
    const storagePath = this.getStoragePath();
    const destDir = path.dirname(path.join(storagePath, originalPath));
    await fs.promises.mkdir(destDir, { recursive: true });

    // Handle case collision at destination
    const baseName = path.basename(originalPath);
    const safeBaseName = await this.getNonCollidingFilename(destDir, baseName);
    const targetRelative = path.join(path.dirname(originalPath), safeBaseName);
    const destAbs = path.join(storagePath, targetRelative);

    await this.movePhysicalFile(sourceAbs, destAbs);
    return targetRelative;
  }

  /**
   * Copies a physical file on disk to a new storedName (for file copy operations).
   */
  async copyPhysicalFile(sourceStoredName: string, destStoredName: string): Promise<string> {
    const sourcePath = this.resolveStoredPath(sourceStoredName);

    let destPath: string;
    if (destStoredName.includes("/") || destStoredName.includes("\\") || destStoredName.startsWith(".")) {
      destPath = this.resolveFilePath(destStoredName);
    } else {
      destPath = this.resolveFilePath(path.join("files", destStoredName));
    }

    // Verify source exists
    await fs.promises.access(sourcePath, fs.constants.R_OK);

    // Verify dest does not exist
    try {
      await fs.promises.access(destPath, fs.constants.F_OK);
      throw new Error(`Destination file "${destStoredName}" already exists on storage.`);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, destPath);
    return destPath;
  }

  /**
   * Deletes a stored file from physical storage.
   */
  async deletePhysicalFile(storedName: string): Promise<void> {
    const resolved = this.resolveStoredPath(storedName);
    try {
      await fs.promises.unlink(resolved);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }
  }

  /**
   * Checks if a physical file exists on disk.
   */
  async fileExists(storedName: string): Promise<boolean> {
    try {
      const resolved = this.resolveStoredPath(storedName);
      await fs.promises.access(resolved, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns disk usage statistics for the storage volume.
   */
  async getStorageStats(): Promise<StorageStats> {
    const storagePath = this.getStoragePath();

    try {
      const { stdout } = await execAsync(
        `df -k "${storagePath}" | tail -1`
      );
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        const device = parts[0];
        const total = BigInt(parts[1]) * BigInt(1024);
        const used = BigInt(parts[2]) * BigInt(1024);
        const free = BigInt(parts[3]) * BigInt(1024);
        const mountPoint = parts.slice(8).join(" ") || parts[parts.length - 1];

        return {
          totalBytes: total,
          usedBytes: used,
          freeBytes: free,
          device,
          mountPoint,
        };
      }
    } catch {
      // Fallback
    }

    return { totalBytes: BigInt(0), usedBytes: BigInt(0), freeBytes: BigInt(0) };
  }

  /**
   * Cleans up orphaned temporary staging files older than maxAgeMs (default 1 hour).
   */
  async cleanupStagingFiles(maxAgeMs = 3600000): Promise<number> {
    const storagePath = this.getStoragePath();
    const stagingDir = path.join(storagePath, ".tmp");

    try {
      const files = await fs.promises.readdir(stagingDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(stagingDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(filePath);
            cleaned++;
          }
        } catch {
          // ignore
        }
      }
      return cleaned;
    } catch {
      return 0;
    }
  }
}

export const storageService = StorageService.getInstance();
