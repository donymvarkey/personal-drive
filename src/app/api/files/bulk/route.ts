import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, fileIds = [], folderIds = [], targetFolderId, permanent = false } = body;

    const ownerId = session.user.id;

    // Validate target folder if moving
    if (action === "move") {
      const destinationId = targetFolderId === "root" || targetFolderId === "" ? null : targetFolderId;

      if (destinationId) {
        const destFolder = await prisma.folder.findFirst({
          where: { id: destinationId, ownerId, isTrashed: false },
        });
        if (!destFolder) {
          return NextResponse.json({ error: "Target folder does not exist" }, { status: 404 });
        }
      }

      // 1. Move files
      if (fileIds.length > 0) {
        await prisma.file.updateMany({
          where: { id: { in: fileIds }, ownerId },
          data: { folderId: destinationId },
        });
      }

      // 2. Move folders (check cycles for each)
      if (folderIds.length > 0) {
        for (const fId of folderIds) {
          if (destinationId === fId) {
            return NextResponse.json(
              { error: "A folder cannot be moved into itself." },
              { status: 400 }
            );
          }
          if (destinationId) {
            // Check ancestry
            let currentId: string | null = destinationId;
            while (currentId) {
              if (currentId === fId) {
                return NextResponse.json(
                  { error: "Circular dependency: folder cannot be moved into a subfolder." },
                  { status: 400 }
                );
              }
              const p: { parentId: string | null } | null = await prisma.folder.findFirst({
                where: { id: currentId, ownerId },
                select: { parentId: true },
              });
              currentId = p?.parentId || null;
            }
          }

          await prisma.folder.update({
            where: { id: fId },
            data: { parentId: destinationId },
          });
        }
      }

      return NextResponse.json({ success: true, movedFiles: fileIds.length, movedFolders: folderIds.length });
    }

    if (action === "delete") {
      if (permanent) {
        // Physical file deletion
        const files = await prisma.file.findMany({
          where: { id: { in: fileIds }, ownerId },
          select: { storedName: true },
        });
        for (const file of files) {
          await storageService.deletePhysicalFile(file.storedName);
        }

        // Delete from DB
        await prisma.file.deleteMany({
          where: { id: { in: fileIds }, ownerId },
        });

        // Delete folders
        if (folderIds.length > 0) {
          await prisma.folder.deleteMany({
            where: { id: { in: folderIds }, ownerId },
          });
        }

        return NextResponse.json({ success: true, permanent: true });
      } else {
        const now = new Date();
        if (fileIds.length > 0) {
          await prisma.file.updateMany({
            where: { id: { in: fileIds }, ownerId },
            data: { isTrashed: true, trashedAt: now },
          });
        }
        if (folderIds.length > 0) {
          await prisma.folder.updateMany({
            where: { id: { in: folderIds }, ownerId },
            data: { isTrashed: true, trashedAt: now },
          });
        }

        return NextResponse.json({ success: true, trashed: true });
      }
    }

    if (action === "restore") {
      if (fileIds.length > 0) {
        await prisma.file.updateMany({
          where: { id: { in: fileIds }, ownerId },
          data: { isTrashed: false, trashedAt: null },
        });
      }
      if (folderIds.length > 0) {
        await prisma.folder.updateMany({
          where: { id: { in: folderIds }, ownerId },
          data: { isTrashed: false, trashedAt: null },
        });
      }

      return NextResponse.json({ success: true, restored: true });
    }

    return NextResponse.json({ error: `Unknown bulk action "${action}"` }, { status: 400 });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
