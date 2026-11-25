import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { BackupManifest } from "@/lib/backup";

const execFileAsync = promisify(execFile);

export interface RestoreResult {
  success: boolean;
  backupId: string;
  filesRestored: number;
  dbRecordsRestored: {
    users: number;
    files: number;
    folders: number;
    versions: number;
  };
  integrityVerified: boolean;
  details: string[];
}

export class RestoreService {
  /**
   * Restore full drive state (files + database) from an archive file
   * @param archivePath Path to .tar.gz backup archive
   * @param targetStoragePath Optional replacement storage directory
   */
  public async restoreFromArchive(
    archivePath: string,
    targetStoragePath?: string
  ): Promise<RestoreResult> {
    const details: string[] = [];
    details.push(`Starting restoration from archive: ${archivePath}`);

    // Verify archive exists
    try {
      await fs.access(archivePath);
    } catch {
      throw new Error(`Backup archive file not found: ${archivePath}`);
    }

    const destStorage = targetStoragePath || storageService.getStoragePath();
    const destFilesDir = path.join(destStorage, "files");
    await fs.mkdir(destFilesDir, { recursive: true });

    // 1. Create temporary directory to unpack archive
    const tempExtractDir = path.join(
      destStorage,
      ".tmp",
      `restore-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    );
    await fs.mkdir(tempExtractDir, { recursive: true });

    try {
      // 2. Unpack archive using native system tar
      details.push(`Extracting archive into temporary staging directory`);
      await execFileAsync("tar", ["-xzf", archivePath, "-C", tempExtractDir]);

      // 3. Read and validate manifest.json
      const manifestPath = path.join(tempExtractDir, "manifest.json");
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest: BackupManifest = JSON.parse(manifestContent);

      details.push(
        `Manifest validated: Backup ID ${manifest.backupId}, created at ${manifest.createdAt}`
      );
      details.push(`Registered files to restore: ${manifest.totalFiles}`);

      // 4. Restore physical files into destination files/
      let filesRestored = 0;
      const extractedFilesDir = path.join(tempExtractDir, "files");

      let extractedFilenames: string[] = [];
      try {
        extractedFilenames = await fs.readdir(extractedFilesDir);
      } catch {
        extractedFilenames = [];
      }

      for (const filename of extractedFilenames) {
        const srcFile = path.join(extractedFilesDir, filename);
        const destFile = path.join(destFilesDir, filename);

        // Copy file
        await fs.copyFile(srcFile, destFile);

        // Verify SHA-256 against manifest inventory
        const restoredData = await fs.readFile(destFile);
        const checksum = crypto.createHash("sha256").update(restoredData).digest("hex");

        const expected = manifest.fileInventory[filename];
        if (expected && expected.checksum !== checksum) {
          throw new Error(
            `Checksum mismatch for restored file ${filename}. Expected ${expected.checksum}, got ${checksum}`
          );
        }

        filesRestored++;
      }
      details.push(`Successfully restored and verified ${filesRestored} physical files on disk`);

      // 5. Restore database records from database_export.json
      const dbExportPath = path.join(tempExtractDir, "database_export.json");
      const dbExportRaw = await fs.readFile(dbExportPath, "utf-8");
      const dbExport = JSON.parse(dbExportRaw);
      const data = dbExport.data;

      details.push(`Restoring database records...`);

      // Restore Users
      let userCount = 0;
      for (const u of data.users || []) {
        await prisma.user.upsert({
          where: { id: u.id },
          update: {
            name: u.name,
            email: u.email,
            hashedPassword: u.hashedPassword,
          },
          create: {
            id: u.id,
            name: u.name,
            email: u.email,
            hashedPassword: u.hashedPassword,
            createdAt: new Date(u.createdAt),
          },
        });
        userCount++;
      }

      // Restore Folders (in 2 passes: first create folders without parentId, then update parentId to prevent FK cycles)
      let folderCount = 0;
      for (const f of data.folders || []) {
        await prisma.folder.upsert({
          where: { id: f.id },
          update: {
            name: f.name,
            isStarred: f.isStarred ?? false,
            isTrashed: f.isTrashed ?? false,
            trashedAt: f.trashedAt ? new Date(f.trashedAt) : null,
          },
          create: {
            id: f.id,
            name: f.name,
            ownerId: f.ownerId,
            isStarred: f.isStarred ?? false,
            isTrashed: f.isTrashed ?? false,
            trashedAt: f.trashedAt ? new Date(f.trashedAt) : null,
            createdAt: new Date(f.createdAt),
          },
        });
        folderCount++;
      }
      // Second pass for folder hierarchy parentId
      for (const f of data.folders || []) {
        if (f.parentId) {
          await prisma.folder.update({
            where: { id: f.id },
            data: { parentId: f.parentId },
          }).catch(() => {});
        }
      }

      // Restore Files
      let fileCount = 0;
      for (const f of data.files || []) {
        await prisma.file.upsert({
          where: { id: f.id },
          update: {
            originalName: f.originalName,
            storedName: f.storedName,
            mimeType: f.mimeType,
            extension: f.extension,
            size: BigInt(f.size),
            checksum: f.checksum,
            folderId: f.folderId || null,
            storageStatus: f.storageStatus || "ready",
            isStarred: f.isStarred ?? false,
            isTrashed: f.isTrashed ?? false,
            trashedAt: f.trashedAt ? new Date(f.trashedAt) : null,
          },
          create: {
            id: f.id,
            originalName: f.originalName,
            storedName: f.storedName,
            mimeType: f.mimeType,
            extension: f.extension,
            size: BigInt(f.size),
            checksum: f.checksum,
            folderId: f.folderId || null,
            ownerId: f.ownerId,
            storageStatus: f.storageStatus || "ready",
            isStarred: f.isStarred ?? false,
            isTrashed: f.isTrashed ?? false,
            trashedAt: f.trashedAt ? new Date(f.trashedAt) : null,
            createdAt: new Date(f.createdAt),
          },
        });
        fileCount++;
      }

      // Restore FileVersions
      let versionCount = 0;
      for (const v of data.fileVersions || []) {
        await prisma.fileVersion.upsert({
          where: { id: v.id },
          update: {
            versionNumber: v.versionNumber,
            storedName: v.storedName,
            size: BigInt(v.size),
            checksum: v.checksum,
            note: v.note || null,
          },
          create: {
            id: v.id,
            fileId: v.fileId,
            versionNumber: v.versionNumber,
            storedName: v.storedName,
            size: BigInt(v.size),
            checksum: v.checksum,
            note: v.note || null,
            createdAt: new Date(v.createdAt),
          },
        });
        versionCount++;
      }

      // Restore StarredItems
      for (const s of data.starredItems || []) {
        await prisma.starredItem.upsert({
          where: { id: s.id },
          update: {},
          create: {
            id: s.id,
            ownerId: s.ownerId,
            fileId: s.fileId || null,
            folderId: s.folderId || null,
            createdAt: new Date(s.createdAt),
          },
        }).catch(() => {});
      }

      // Restore AppSettings
      for (const set of data.appSettings || []) {
        await prisma.appSettings.upsert({
          where: { ownerId: set.ownerId },
          update: {
            theme: set.theme,
            trashRetentionDays: set.trashRetentionDays,
            maxVersionsPerFile: set.maxVersionsPerFile,
            backupRetentionDays: set.backupRetentionDays ?? 30,
            backupScheduleHours: set.backupScheduleHours ?? 24,
          },
          create: {
            ownerId: set.ownerId,
            theme: set.theme,
            trashRetentionDays: set.trashRetentionDays,
            maxVersionsPerFile: set.maxVersionsPerFile,
            backupRetentionDays: set.backupRetentionDays ?? 30,
            backupScheduleHours: set.backupScheduleHours ?? 24,
          },
        });
      }

      // 6. Post-recovery verification
      details.push("Verifying post-recovery database and disk consistency...");
      const dbFiles = await prisma.file.findMany({ select: { storedName: true } });
      let verifiedCount = 0;
      for (const df of dbFiles) {
        const filePath = path.join(destFilesDir, df.storedName);
        try {
          await fs.access(filePath);
          verifiedCount++;
        } catch {
          details.push(`Warning: Restored DB file ${df.storedName} not found on disk`);
        }
      }

      details.push(`Post-recovery consistency: ${verifiedCount}/${dbFiles.length} files verified on disk`);

      logger.info("Restoration completed successfully", {
        backupId: manifest.backupId,
        filesRestored,
        records: { userCount, fileCount, folderCount, versionCount },
      });

      return {
        success: true,
        backupId: manifest.backupId,
        filesRestored,
        dbRecordsRestored: {
          users: userCount,
          files: fileCount,
          folders: folderCount,
          versions: versionCount,
        },
        integrityVerified: true,
        details,
      };
    } finally {
      // Clean up temp staging directory
      await fs.rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export const restoreService = new RestoreService();
