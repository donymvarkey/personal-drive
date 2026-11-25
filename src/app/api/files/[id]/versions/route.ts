import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService, StreamWriteResult } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import busboy from "busboy";
import * as crypto from "crypto";

export const runtime = "nodejs";

// 1. List all versions for a file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const file = await prisma.file.findFirst({
      where: { id, ownerId: session.user.id },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const serializedVersions = file.versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      size: Number(v.size),
      checksum: v.checksum,
      note: v.note,
      createdAt: v.createdAt,
    }));

    return NextResponse.json({
      current: {
        id: file.id,
        originalName: file.originalName,
        size: Number(file.size),
        checksum: file.checksum,
        updatedAt: file.updatedAt,
      },
      versions: serializedVersions,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// 2. Upload a new version for a file
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const file = await prisma.file.findFirst({
      where: { id, ownerId: session.user.id },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
        },
      },
    });

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Check write lock
    const activeMigration = await prisma.storageMigration.findFirst({
      where: { writeLocked: true },
    });
    if (activeMigration) {
      return NextResponse.json(
        { error: "Storage migration sync is in progress. Version uploads are temporarily paused." },
        { status: 503 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data") || !request.body) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with file" },
        { status: 400 }
      );
    }

    // Determine current version number sequence
    const latestVersionNum = file.versions.length > 0 ? file.versions[0].versionNumber : 1;

    // If file has no existing versions recorded yet, record the current active state as v1
    if (file.versions.length === 0) {
      const v1StoredName = `${file.id}-v1-${Date.now()}.${file.extension}`;
      await storageService.copyPhysicalFile(file.storedName, v1StoredName);

      await prisma.fileVersion.create({
        data: {
          fileId: file.id,
          storedName: v1StoredName,
          size: file.size,
          checksum: file.checksum,
          versionNumber: 1,
          note: "Initial uploaded version",
          createdAt: file.createdAt,
        },
      });
    }

    // Stream the new version using Busboy
    const newVersionNum = latestVersionNum + 1;
    const newStoredName = `${crypto.randomUUID()}.${file.extension}`;
    let note: string | null = null;
    let savePromise: Promise<StreamWriteResult> | null = null;

    const bb = busboy({ headers: { "content-type": contentType } });

    const parsePromise = new Promise<void>((resolve, reject) => {
      bb.on("field", (name, val) => {
        if (name === "note" && val) {
          note = String(val).trim() || null;
        }
      });

      bb.on("file", (_fieldname, fileStream) => {
        savePromise = storageService.saveStreamAtomic(
          newStoredName,
          fileStream,
          file.extension
        );
        savePromise.catch(() => {});
      });

      bb.on("error", reject);
      bb.on("close", () => resolve());
    });

    const nodeStream = Readable.fromWeb(
      request.body as unknown as WebReadableStream<Uint8Array>
    );
    nodeStream.on("error", (err) => {
      bb.destroy(err);
    });
    nodeStream.pipe(bb);

    try {
      await parsePromise;
    } catch (parseErr: unknown) {
      const pErr = parseErr as Error;
      const errCandidate = savePromise as Promise<StreamWriteResult> | null;
      if (errCandidate) {
        try {
          const res = await errCandidate;
          await storageService.deletePhysicalFile(res.storedName);
        } catch {
          // ignore
        }
      }
      return NextResponse.json(
        { error: `Version upload stream failed: ${pErr.message}` },
        { status: 400 }
      );
    }

    const activeSavePromise = savePromise as Promise<StreamWriteResult> | null;
    if (!activeSavePromise) {
      return NextResponse.json({ error: "No file provided in version upload." }, { status: 400 });
    }

    const streamResult: StreamWriteResult = await activeSavePromise;

    // Create FileVersion record for the new version
    const newVersion = await prisma.fileVersion.create({
      data: {
        fileId: file.id,
        storedName: streamResult.storedName,
        size: streamResult.size,
        checksum: streamResult.checksum,
        versionNumber: newVersionNum,
        note: note || `Uploaded version ${newVersionNum}`,
      },
    });

    // Update active File record to point to this new version
    await prisma.file.update({
      where: { id: file.id },
      data: {
        storedName: streamResult.storedName,
        size: streamResult.size,
        checksum: streamResult.checksum,
        mimeType: streamResult.detectedMimeType,
        updatedAt: new Date(),
      },
    });

    // Check version retention limit from user settings
    const settings = await prisma.appSettings.findUnique({
      where: { ownerId: session.user.id },
    });
    const maxVersions = settings?.maxVersionsPerFile ?? 10;

    if (maxVersions > 0) {
      const allVersions = await prisma.fileVersion.findMany({
        where: { fileId: file.id },
        orderBy: { versionNumber: "desc" },
      });

      if (allVersions.length > maxVersions) {
        const excessVersions = allVersions.slice(maxVersions);
        for (const excess of excessVersions) {
          await storageService.deletePhysicalFile(excess.storedName);
          await prisma.fileVersion.delete({ where: { id: excess.id } });
        }
      }
    }

    await logActivity({
      ownerId: session.user.id,
      action: "upload",
      fileId: file.id,
      itemName: `${file.originalName} (v${newVersionNum})`,
      details: { versionNumber: newVersionNum, size: Number(streamResult.size) },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: newVersion.id,
        versionNumber: newVersion.versionNumber,
        size: Number(newVersion.size),
        checksum: newVersion.checksum,
        note: newVersion.note,
        createdAt: newVersion.createdAt,
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("New version upload error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
