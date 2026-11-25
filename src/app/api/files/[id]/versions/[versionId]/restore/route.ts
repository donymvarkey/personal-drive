import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, versionId } = await params;

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

    const targetVersion = await prisma.fileVersion.findFirst({
      where: { id: versionId, fileId: id },
    });
    if (!targetVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Verify target binary exists on physical disk
    const exists = await storageService.fileExists(targetVersion.storedName);
    if (!exists) {
      return NextResponse.json(
        { error: "Target version binary is missing on storage disk." },
        { status: 404 }
      );
    }

    // Copy target version's physical binary to create the newly restored active binary
    const newActiveStoredName = `${file.id}-restored-v${targetVersion.versionNumber}-${Date.now()}.${file.extension}`;
    await storageService.copyPhysicalFile(targetVersion.storedName, newActiveStoredName);

    // Update active File record
    const updatedFile = await prisma.file.update({
      where: { id: file.id },
      data: {
        storedName: newActiveStoredName,
        size: targetVersion.size,
        checksum: targetVersion.checksum,
        updatedAt: new Date(),
      },
    });

    // Create a new version entry noting the restoration
    const latestVersionNum = file.versions.length > 0 ? file.versions[0].versionNumber : 1;
    const restoredVersionEntry = await prisma.fileVersion.create({
      data: {
        fileId: file.id,
        storedName: newActiveStoredName,
        size: targetVersion.size,
        checksum: targetVersion.checksum,
        versionNumber: latestVersionNum + 1,
        note: `Restored from version ${targetVersion.versionNumber}`,
      },
    });

    await logActivity({
      ownerId: session.user.id,
      action: "restore",
      fileId: file.id,
      itemName: `${file.originalName} (Restored v${targetVersion.versionNumber})`,
      details: {
        restoredFromVersion: targetVersion.versionNumber,
        newVersionNumber: restoredVersionEntry.versionNumber,
      },
    });

    return NextResponse.json({
      success: true,
      message: `File restored to version ${targetVersion.versionNumber}.`,
      file: {
        id: updatedFile.id,
        originalName: updatedFile.originalName,
        size: Number(updatedFile.size),
        checksum: updatedFile.checksum,
        updatedAt: updatedFile.updatedAt,
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
