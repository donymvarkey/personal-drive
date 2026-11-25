import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import * as path from "path";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const file = await prisma.file.findUnique({
      where: { id },
    });

    if (!file || file.deletedAt) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      // 1. Permanently delete from physical storage
      await storageService.deletePhysicalFile(file.storedName);
      // 2. Delete database record
      await prisma.file.delete({
        where: { id },
      });
      return NextResponse.json({ success: true, permanent: true });
    } else {
      // Soft-delete: move to .personal-drive/trash on external SSD
      let trashedStoredName = file.storedName;
      let originalPath = file.storedName;
      try {
        const moveRes = await storageService.moveToTrash(file.storedName);
        trashedStoredName = moveRes.trashedStoredName;
        originalPath = moveRes.originalPath;
      } catch {
        // Fallback to DB soft-delete if physical move fails
      }

      const updated = await prisma.file.update({
        where: { id },
        data: {
          isTrashed: true,
          trashedAt: new Date(),
          storedName: trashedStoredName,
          trashedFrom: originalPath,
        },
      });
      return NextResponse.json({ success: true, trashed: true, file: updated });
    }
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const file = await prisma.file.findUnique({
      where: { id },
    });

    if (!file || file.deletedAt) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, isStarred, restore, folderId } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};

    if (name && typeof name === "string") {
      const { safeName, extension } = storageService.sanitizeFilename(name);
      data.originalName = safeName;
      data.extension = extension;

      if (file.isExternal && !file.isTrashed) {
        try {
          const oldAbs = storageService.resolveStoredPath(file.storedName);
          const dir = path.dirname(file.storedName);
          const newRel = dir === "." ? safeName : path.join(dir, safeName);
          const newAbs = storageService.resolveFilePath(newRel);
          await storageService.movePhysicalFile(oldAbs, newAbs);
          data.storedName = newRel;
        } catch {
          // ignore rename failure
        }
      }
    }

    if (folderId !== undefined) {
      let destFolderPath: string | null = null;
      if (folderId === null || folderId === "" || folderId === "root") {
        data.folderId = null;
      } else {
        const destFolder = await prisma.folder.findFirst({
          where: { id: folderId, ownerId: session.user.id },
        });
        if (!destFolder) {
          return NextResponse.json({ error: "Destination folder not found" }, { status: 404 });
        }
        data.folderId = folderId;
        destFolderPath = destFolder.path;
      }

      if (file.isExternal && !file.isTrashed) {
        try {
          const oldAbs = storageService.resolveStoredPath(file.storedName);
          const fileName = path.basename(file.storedName);
          const targetDir = destFolderPath || "";
          const newRel = targetDir ? path.join(targetDir, fileName) : fileName;
          const newAbs = storageService.resolveFilePath(newRel);
          await storageService.movePhysicalFile(oldAbs, newAbs);
          data.storedName = newRel;
        } catch {
          // ignore
        }
      }
    }

    if (typeof isStarred === "boolean") {
      data.isStarred = isStarred;
    }

    if (restore === true) {
      let restoredStoredName = file.storedName;
      if (file.trashedFrom) {
        try {
          restoredStoredName = await storageService.restoreFromTrash(
            file.storedName,
            file.trashedFrom
          );
        } catch {
          restoredStoredName = file.trashedFrom;
        }
      }
      data.isTrashed = false;
      data.trashedAt = null;
      data.storedName = restoredStoredName;
      data.trashedFrom = null;
    }

    const updated = await prisma.file.update({
      where: { id },
      data,
    });

    return NextResponse.json({
      success: true,
      file: {
        ...updated,
        size: Number(updated.size),
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
