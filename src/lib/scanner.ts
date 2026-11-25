import * as fs from "fs";
import * as path from "path";
import { prisma } from "./db";
import { storageService } from "./storage";
import { logActivity } from "./activity";

export interface ScanResult {
  scanId: string;
  filesIndexed: number;
  foldersIndexed: number;
  bytesIndexed: bigint;
  changesDetected: number;
  errors?: string[];
  durationMs: number;
}

const IGNORED_DIRECTORY_NAMES = new Set([
  ".personal-drive",
  ".tmp",
  "files", // legacy app directory
  "$recycle.bin",
  "system volume information",
  ".trashes",
  ".fseventsd",
  ".spotlight-v100",
  ".git",
  "node_modules",
  "__pycache__",
]);

const IGNORED_FILE_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".write-test",
]);

export class ExternalStorageScanner {
  private static instance: ExternalStorageScanner;
  private isScanning = false;

  private constructor() {}

  static getInstance(): ExternalStorageScanner {
    if (!ExternalStorageScanner.instance) {
      ExternalStorageScanner.instance = new ExternalStorageScanner();
    }
    return ExternalStorageScanner.instance;
  }

  getIsScanning(): boolean {
    return this.isScanning;
  }

  /**
   * Scans and indexes all pre-existing files and folders on the external storage SSD in-place.
   * Does NOT copy, move, or modify existing files.
   * Preserves folder hierarchy and synchronizes state with PostgreSQL.
   */
  async scanStorage(ownerId: string): Promise<ScanResult> {
    if (this.isScanning) {
      throw new Error("A storage scan is already currently running.");
    }

    this.isScanning = true;
    const startTime = Date.now();
    const errors: string[] = [];

    // 1. Verify storage mount first
    const mountCheck = await storageService.validateStoragePath(true);
    if (!mountCheck.valid) {
      this.isScanning = false;
      throw new Error(
        `Cannot scan external storage: ${mountCheck.error || "Storage is disconnected or unavailable."}`
      );
    }

    const storageRoot = storageService.getStoragePath();

    // 2. Initialize scan record in database
    const scanRecord = await prisma.storageScanRecord.create({
      data: {
        status: "in_progress",
        startedAt: new Date(),
      },
    });

    let filesIndexed = 0;
    let foldersIndexed = 0;
    let bytesIndexed = BigInt(0);
    let changesDetected = 0;

    // Track physical files and folders seen during scan for reconciliation
    const seenRelativePaths = new Set<string>();
    const seenFolderPaths = new Set<string>();

    // In-memory cache of folder path -> database folder ID
    const folderPathToId = new Map<string, string>();

    try {
      // Pre-populate folderPathToId with existing external folders in DB for this owner
      const existingFolders = await prisma.folder.findMany({
        where: { ownerId, isExternal: true, deletedAt: null },
        select: { id: true, path: true },
      });
      for (const ef of existingFolders) {
        if (ef.path) folderPathToId.set(ef.path, ef.id);
      }

      // BFS queue of directories to scan: [relativeDirPath, parentFolderId]
      const dirQueue: Array<{ relPath: string; parentId: string | null }> = [
        { relPath: "", parentId: null },
      ];

      while (dirQueue.length > 0) {
        const { relPath: currentRelDir, parentId: currentParentId } = dirQueue.shift()!;
        const currentAbsDir = currentRelDir
          ? path.join(storageRoot, currentRelDir)
          : storageRoot;

        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(currentAbsDir, { withFileTypes: true });
        } catch (err: unknown) {
          const e = err as Error;
          errors.push(`Failed to read directory "${currentRelDir}": ${e.message}`);
          continue;
        }

        for (const entry of entries) {
          const entryName = entry.name;
          const lowerName = entryName.toLowerCase();

          // Skip ignored system directories and files
          if (
            IGNORED_DIRECTORY_NAMES.has(lowerName) ||
            IGNORED_FILE_NAMES.has(lowerName) ||
            lowerName.startsWith(".trash-") ||
            lowerName.startsWith(".write-test-")
          ) {
            continue;
          }

          const entryRelPath = currentRelDir
            ? path.join(currentRelDir, entryName)
            : entryName;
          const entryAbsPath = path.join(storageRoot, entryRelPath);

          // Get stats (avoiding following symlinks)
          let lstat: fs.Stats;
          try {
            lstat = await fs.promises.lstat(entryAbsPath);
          } catch (err: unknown) {
            const e = err as Error;
            errors.push(`Failed to stat "${entryRelPath}": ${e.message}`);
            continue;
          }

          // Skip symlinks (exFAT does not support POSIX symlinks)
          if (lstat.isSymbolicLink()) {
            continue;
          }

          if (lstat.isDirectory()) {
            seenFolderPaths.add(entryRelPath);

            // Find or upsert folder in database
            let folderId = folderPathToId.get(entryRelPath);
            if (!folderId) {
              const existingFolder = await prisma.folder.findFirst({
                where: {
                  ownerId,
                  path: entryRelPath,
                },
              });

              if (existingFolder) {
                folderId = existingFolder.id;
                if (existingFolder.deletedAt || existingFolder.isTrashed) {
                  await prisma.folder.update({
                    where: { id: existingFolder.id },
                    data: { deletedAt: null, isTrashed: false, trashedAt: null },
                  });
                  changesDetected++;
                }
              } else {
                const newFolder = await prisma.folder.create({
                  data: {
                    name: entryName,
                    path: entryRelPath,
                    isExternal: true,
                    ownerId,
                    parentId: currentParentId,
                  },
                });
                folderId = newFolder.id;
                foldersIndexed++;
                changesDetected++;
              }
              folderPathToId.set(entryRelPath, folderId);
            }

            // Enqueue subfolder for BFS traversal
            dirQueue.push({ relPath: entryRelPath, parentId: folderId });
          } else if (lstat.isFile()) {
            seenRelativePaths.add(entryRelPath);
            const fileSize = BigInt(lstat.size);

            try {
              // 1. Read initial 512 bytes for MIME type detection
              let mimeType = "application/octet-stream";
              const { extension } = storageService.sanitizeFilename(entryName);

              try {
                const fd = await fs.promises.open(entryAbsPath, "r");
                const buffer = Buffer.alloc(Math.min(512, lstat.size));
                if (lstat.size > 0) {
                  await fd.read(buffer, 0, buffer.length, 0);
                }
                await fd.close();
                mimeType = storageService.detectMimeType(buffer, extension);
              } catch {
                mimeType = storageService.detectMimeType(Buffer.alloc(0), extension);
              }

              // 2. Compute SHA-256 streaming hash
              const checksum = await storageService.computeSHA256(entryRelPath);

              // 3. Upsert file in database
              const existingFile = await prisma.file.findFirst({
                where: {
                  ownerId,
                  storedName: entryRelPath,
                },
              });

              if (existingFile) {
                // Check if file was modified externally
                if (
                  existingFile.size !== fileSize ||
                  existingFile.checksum !== checksum ||
                  existingFile.deletedAt !== null
                ) {
                  await prisma.file.update({
                    where: { id: existingFile.id },
                    data: {
                      size: fileSize,
                      checksum,
                      mimeType,
                      extension,
                      folderId: currentParentId,
                      storageStatus: "ready",
                      deletedAt: null,
                      isTrashed: false,
                      trashedAt: null,
                      updatedAt: lstat.mtime,
                    },
                  });
                  changesDetected++;
                }
              } else {
                // New discovered file
                await prisma.file.create({
                  data: {
                    originalName: entryName,
                    storedName: entryRelPath,
                    size: fileSize,
                    checksum,
                    mimeType,
                    extension,
                    folderId: currentParentId,
                    ownerId,
                    isExternal: true,
                    storageStatus: "ready",
                    createdAt: lstat.birthtime || lstat.ctime || new Date(),
                    updatedAt: lstat.mtime || new Date(),
                  },
                });
                filesIndexed++;
                changesDetected++;
              }

              bytesIndexed += fileSize;
            } catch (err: unknown) {
              const e = err as Error;
              errors.push(`Error indexing file "${entryRelPath}": ${e.message}`);
            }
          }
        }
      }

      // 4. Reconciliation: detect files in DB that no longer exist on the external SSD
      const existingDbFiles = await prisma.file.findMany({
        where: {
          ownerId,
          isExternal: true,
          deletedAt: null,
          isTrashed: false,
        },
        select: { id: true, storedName: true },
      });

      for (const dbFile of existingDbFiles) {
        if (!seenRelativePaths.has(dbFile.storedName)) {
          // File was removed or renamed externally -> mark as deleted
          await prisma.file.update({
            where: { id: dbFile.id },
            data: { deletedAt: new Date() },
          });
          changesDetected++;
        }
      }

      // Reconcile deleted external folders
      const existingDbFolders = await prisma.folder.findMany({
        where: {
          ownerId,
          isExternal: true,
          deletedAt: null,
          isTrashed: false,
        },
        select: { id: true, path: true },
      });

      for (const dbFolder of existingDbFolders) {
        if (dbFolder.path && !seenFolderPaths.has(dbFolder.path)) {
          await prisma.folder.update({
            where: { id: dbFolder.id },
            data: { deletedAt: new Date() },
          });
          changesDetected++;
        }
      }

      // 5. Update Scan Record
      await prisma.storageScanRecord.update({
        where: { id: scanRecord.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          filesIndexed,
          foldersIndexed,
          bytesIndexed,
          changesDetected,
          errors: errors.length > 0 ? errors.slice(0, 10).join("\n") : null,
        },
      });

      // 6. Update AppSettings summary
      const totalIndexedFiles = await prisma.file.count({
        where: { ownerId, isExternal: true, deletedAt: null },
      });
      const totalIndexedFolders = await prisma.folder.count({
        where: { ownerId, isExternal: true, deletedAt: null },
      });

      await prisma.appSettings.upsert({
        where: { ownerId },
        update: {
          lastScanAt: new Date(),
          indexedFilesCount: totalIndexedFiles,
          indexedFoldersCount: totalIndexedFolders,
        },
        create: {
          ownerId,
          lastScanAt: new Date(),
          indexedFilesCount: totalIndexedFiles,
          indexedFoldersCount: totalIndexedFolders,
        },
      });

      // 7. Log Activity
      await logActivity({
        action: "scan",
        itemName: "External Storage Scan",
        ownerId,
        details: {
          filesIndexed,
          foldersIndexed,
          bytesIndexed: bytesIndexed.toString(),
          changesDetected,
          durationMs: Date.now() - startTime,
        },
      });

      return {
        scanId: scanRecord.id,
        filesIndexed,
        foldersIndexed,
        bytesIndexed,
        changesDetected,
        errors: errors.length > 0 ? errors : undefined,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const e = err as Error;
      await prisma.storageScanRecord.update({
        where: { id: scanRecord.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          errors: e.message,
        },
      });
      throw err;
    } finally {
      this.isScanning = false;
    }
  }
}

export const externalStorageScanner = ExternalStorageScanner.getInstance();
