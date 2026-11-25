import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService, StreamWriteResult } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { rateLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import busboy from "busboy";
import * as crypto from "crypto";

// Maximum upload size limit in megabytes (default 10GB)
const MAX_UPLOAD_SIZE_MB = parseInt(
  process.env.DRIVE_MAX_UPLOAD_SIZE_MB || "10240",
  10
);
const MAX_UPLOAD_SIZE_BYTES = BigInt(MAX_UPLOAD_SIZE_MB) * BigInt(1024 * 1024);

export const runtime = "nodejs";

interface PendingFile {
  safeName: string;
  extension: string;
  fileUuid: string;
  storedName: string;
  savePromise: Promise<StreamWriteResult>;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required to upload files." },
        { status: 401 }
      );
    }
    const ownerId = session.user.id;

    // Rate limit: max 60 upload requests per 60 seconds per user
    const uploadRate = rateLimiter.check(`upload:${ownerId}`, 60, 60);
    if (!uploadRate.success) {
      logger.warn("Upload rate limit exceeded", { ownerId, resetSeconds: uploadRate.resetSeconds });
      return NextResponse.json(
        {
          error: `Upload rate limit reached. Please wait ${uploadRate.resetSeconds}s before starting new uploads.`,
        },
        { status: 429, headers: { "Retry-After": uploadRate.resetSeconds.toString() } }
      );
    }

    // 2. Validate physical storage availability (never fall back silently)
    const storageStatus = await storageService.validateStoragePath();
    if (!storageStatus.valid) {
      return NextResponse.json(
        {
          error:
            storageStatus.error ||
            "Configured physical storage is unavailable or unmounted. Uploads paused.",
        },
        { status: 503 }
      );
    }

    // 3. Check if storage migration is currently write-locked for final sync
    const activeMigration = await prisma.storageMigration.findFirst({
      where: { writeLocked: true },
    });
    if (activeMigration) {
      return NextResponse.json(
        {
          error:
            "Storage migration is currently finalizing (sync in progress). Writes are temporarily paused.",
        },
        { status: 503 }
      );
    }

    // 4. Validate Content-Type
    const contentType = request.headers.get("content-type");
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Invalid Content-Type. Expected multipart/form-data." },
        { status: 400 }
      );
    }

    if (!request.body) {
      return NextResponse.json(
        { error: "Empty request body received." },
        { status: 400 }
      );
    }

    // 5. Parse multipart body using Busboy for true streaming (no RAM buffering limit)
    let folderId: string | null = null;
    const pendingFiles: PendingFile[] = [];
    let fileTooLargeError: string | null = null;

    const bb = busboy({
      headers: { "content-type": contentType },
      limits: {
        fileSize: Number(MAX_UPLOAD_SIZE_BYTES),
      },
    });

    // Handle client abort / disconnect
    request.signal.addEventListener("abort", () => {
      bb.destroy(new Error("Client cancelled upload."));
    });

    const parsePromise = new Promise<{
      pending: PendingFile[];
      folderId: string | null;
    }>((resolve, reject) => {
      bb.on("field", (name, val) => {
        if (name === "folderId" && val) {
          folderId = String(val).trim() || null;
        }
      });

      bb.on("file", (fieldname, fileStream, info) => {
        if (!info.filename) {
          fileStream.resume(); // drain empty part
          return;
        }

        fileStream.on("limit", () => {
          fileTooLargeError = `File "${info.filename}" exceeds the maximum upload limit of ${MAX_UPLOAD_SIZE_MB}MB.`;
        });

        const { safeName, extension } = storageService.sanitizeFilename(info.filename);
        const fileUuid = crypto.randomUUID();
        const storedName = `${fileUuid}.${extension}`;

        // Directly stream incoming chunks into atomic physical file on disk
        const savePromise = storageService.saveStreamAtomic(
          storedName,
          fileStream,
          extension
        );
        // Prevent unhandled rejections if parser errors before awaiting savePromise
        savePromise.catch(() => {});

        pendingFiles.push({
          safeName,
          extension,
          fileUuid,
          storedName,
          savePromise,
        });
      });

      bb.on("error", (err: unknown) => {
        reject(err);
      });

      bb.on("close", () => {
        resolve({ pending: pendingFiles, folderId });
      });
    });

    // Convert Web ReadableStream to Node Readable and pipe into Busboy
    const nodeStream = Readable.fromWeb(
      request.body as unknown as WebReadableStream<Uint8Array>
    );
    nodeStream.on("error", (err) => {
      bb.destroy(err);
    });
    nodeStream.pipe(bb);

    let parseResult: { pending: PendingFile[]; folderId: string | null };
    try {
      parseResult = await parsePromise;
    } catch (parseErr: unknown) {
      const pErr = parseErr as Error;
      // Clean up any files created before parse error
      for (const item of pendingFiles) {
        try {
          const res = await item.savePromise;
          await storageService.deletePhysicalFile(res.storedName);
        } catch {
          // ignore
        }
      }
      return NextResponse.json(
        { error: `Upload stream failed: ${pErr.message}` },
        { status: 400 }
      );
    }

    const { pending, folderId: finalFolderId } = parseResult;

    if (fileTooLargeError) {
      // Clean up any successfully written files
      for (const item of pending) {
        try {
          const res = await item.savePromise;
          await storageService.deletePhysicalFile(res.storedName);
        } catch {
          // ignore
        }
      }
      return NextResponse.json({ error: fileTooLargeError }, { status: 413 });
    }

    if (pending.length === 0) {
      return NextResponse.json(
        { error: "No files provided for upload." },
        { status: 400 }
      );
    }

    // 6. Finalize files and insert database records
    const uploadResults = [];

    for (const item of pending) {
      let streamResult: StreamWriteResult;
      try {
        streamResult = await item.savePromise;
      } catch (err: unknown) {
        const error = err as Error;
        return NextResponse.json(
          { error: `Storage error while writing "${item.safeName}": ${error.message}` },
          { status: 500 }
        );
      }

      // Duplicate detection using SHA-256
      const existingDuplicate = await prisma.file.findFirst({
        where: {
          ownerId,
          checksum: streamResult.checksum,
          deletedAt: null,
          isTrashed: false,
        },
      });

      // Insert metadata record into PostgreSQL with safe physical file cleanup on failure
      let dbRecord;
      try {
        dbRecord = await prisma.file.create({
          data: {
            id: item.fileUuid,
            originalName: item.safeName,
            storedName: streamResult.storedName,
            mimeType: streamResult.detectedMimeType,
            extension: item.extension,
            size: streamResult.size,
            checksum: streamResult.checksum,
            folderId: finalFolderId,
            ownerId,
            storageStatus: "ready",
          },
        });
      } catch (dbError) {
        // Safe rollback: delete physical file if database insertion fails
        await storageService.deletePhysicalFile(streamResult.storedName);
        console.error("Database record insertion failed, physical file cleaned up:", dbError);
        return NextResponse.json(
          { error: "Database transaction failed while registering uploaded file." },
          { status: 500 }
        );
      }

      // Log upload activity
      logActivity({
        ownerId,
        action: "upload",
        fileId: dbRecord.id,
        itemName: dbRecord.originalName,
        details: { size: Number(dbRecord.size), mimeType: dbRecord.mimeType },
      }).catch(() => {});

      uploadResults.push({
        id: dbRecord.id,
        originalName: dbRecord.originalName,
        size: Number(dbRecord.size),
        mimeType: dbRecord.mimeType,
        checksum: dbRecord.checksum,
        isDuplicate: Boolean(existingDuplicate),
        duplicateOf: existingDuplicate?.originalName || null,
        createdAt: dbRecord.createdAt,
      });
    }

    return NextResponse.json(
      {
        success: true,
        count: uploadResults.length,
        files: uploadResults,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Unhandled upload error:", err);
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during upload." },
      { status: 500 }
    );
  }
}
