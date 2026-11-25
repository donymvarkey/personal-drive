import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import * as crypto from "crypto";

export const runtime = "nodejs";

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
    const sourceFile = await prisma.file.findFirst({
      where: { id, ownerId: session.user.id, deletedAt: null },
    });

    if (!sourceFile) {
      return NextResponse.json({ error: "Source file not found" }, { status: 404 });
    }

    // Verify source exists physically
    const exists = await storageService.fileExists(sourceFile.storedName);
    if (!exists) {
      return NextResponse.json(
        { error: "Source physical file is missing from storage" },
        { status: 404 }
      );
    }

    // Generate new UUID and physical filename
    const newFileUuid = crypto.randomUUID();
    const newStoredName = `${newFileUuid}.${sourceFile.extension}`;

    // Determine target name (e.g., "Copy of report.pdf" or custom name from body)
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetFolderId = (body as any).folderId !== undefined ? (body as any).folderId : sourceFile.folderId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customName = (body as any).name?.trim();

    let newOriginalName = customName || `Copy of ${sourceFile.originalName}`;
    const sanitized = storageService.sanitizeFilename(newOriginalName);
    newOriginalName = sanitized.safeName;

    // 1. Copy physical file on disk
    try {
      await storageService.copyPhysicalFile(sourceFile.storedName, newStoredName);
    } catch (err: unknown) {
      const error = err as Error;
      return NextResponse.json(
        { error: `Failed to copy physical file on storage: ${error.message}` },
        { status: 500 }
      );
    }

    // 2. Insert new database record with failure rollback
    let newRecord;
    try {
      newRecord = await prisma.file.create({
        data: {
          id: newFileUuid,
          originalName: newOriginalName,
          storedName: newStoredName,
          mimeType: sourceFile.mimeType,
          extension: sourceFile.extension,
          size: sourceFile.size,
          checksum: sourceFile.checksum,
          folderId: targetFolderId,
          ownerId: session.user.id,
          storageStatus: "ready",
        },
      });
    } catch (dbErr) {
      // Rollback physical copy if database insert fails
      await storageService.deletePhysicalFile(newStoredName);
      console.error("Database error while creating file copy record:", dbErr);
      return NextResponse.json(
        { error: "Failed to create database record for copied file" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      file: {
        ...newRecord,
        size: Number(newRecord.size),
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
