import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";

/**
 * Traverses parent pointers to verify that moving folderId to targetParentId
 * does NOT create a circular hierarchy loop.
 */
async function wouldCreateCycle(
  folderId: string,
  targetParentId: string,
  ownerId: string
): Promise<boolean> {
  if (folderId === targetParentId) return true;

  let currentId: string | null = targetParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === folderId) {
      return true; // Cycle detected: target is a descendant of folderId
    }
    if (visited.has(currentId)) {
      return true; // Malformed loop in tree
    }
    visited.add(currentId);

    const parentFolder: { parentId: string | null } | null = await prisma.folder.findFirst({
      where: { id: currentId, ownerId },
      select: { parentId: true },
    });

    if (!parentFolder) break;
    currentId = parentFolder.parentId;
  }

  return false;
}

/**
 * Builds breadcrumbs hierarchy from root down to current folder.
 */
async function getBreadcrumbs(folderId: string, ownerId: string) {
  const crumbs: Array<{ id: string; name: string }> = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const f: { id: string; name: string; parentId: string | null } | null = await prisma.folder.findFirst({
      where: { id: currentId, ownerId },
      select: { id: true, name: true, parentId: true },
    });
    if (!f) break;
    crumbs.unshift({ id: f.id, name: f.name });
    currentId = f.parentId;
  }

  return crumbs;
}

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
    const folder = await prisma.folder.findFirst({
      where: { id, ownerId: session.user.id },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const breadcrumbs = await getBreadcrumbs(id, session.user.id);

    return NextResponse.json({
      folder,
      breadcrumbs,
    });
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
    const folder = await prisma.folder.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, parentId, isStarred, restore } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};

    // 1. Rename
    if (name && typeof name === "string") {
      const { safeName } = storageService.sanitizeFilename(name.trim());
      updateData.name = safeName;

      if (folder.isExternal && folder.path) {
        try {
          const oldPath = folder.path;
          const parentDir = path.dirname(oldPath);
          const newRelPath = parentDir === "." ? safeName : path.join(parentDir, safeName);
          const oldAbs = storageService.resolveFilePath(oldPath);
          const newAbs = storageService.resolveFilePath(newRelPath);

          if (fs.existsSync(oldAbs)) {
            await storageService.movePhysicalFile(oldAbs, newAbs);
            updateData.path = newRelPath;

            // Cascade update child folder paths
            const childFolders = await prisma.folder.findMany({
              where: {
                ownerId: session.user.id,
                path: { startsWith: oldPath + "/" },
              },
            });
            for (const cf of childFolders) {
              if (cf.path) {
                const updatedChildPath = newRelPath + cf.path.slice(oldPath.length);
                await prisma.folder.update({
                  where: { id: cf.id },
                  data: { path: updatedChildPath },
                });
              }
            }

            // Cascade update child file storedNames
            const childFiles = await prisma.file.findMany({
              where: {
                ownerId: session.user.id,
                isExternal: true,
                storedName: { startsWith: oldPath + "/" },
              },
            });
            for (const cfile of childFiles) {
              const updatedStoredName = newRelPath + cfile.storedName.slice(oldPath.length);
              await prisma.file.update({
                where: { id: cfile.id },
                data: { storedName: updatedStoredName },
              });
            }
          }
        } catch {
          // ignore physical move error and preserve DB rename
        }
      }
    }

    // 2. Move (with circular dependency protection!)
    if (parentId !== undefined) {
      const targetParentId = parentId === "" || parentId === "root" ? null : parentId;

      if (targetParentId) {
        // Validate target parent exists and belongs to owner
        const targetParent = await prisma.folder.findFirst({
          where: { id: targetParentId, ownerId: session.user.id },
        });
        if (!targetParent) {
          return NextResponse.json({ error: "Destination folder not found" }, { status: 404 });
        }

        // Circular loop verification!
        const isCycle = await wouldCreateCycle(id, targetParentId, session.user.id);
        if (isCycle) {
          return NextResponse.json(
            {
              error:
                "Invalid move: Circular folder dependency. A folder cannot be moved into itself or one of its subfolders.",
            },
            { status: 400 }
          );
        }
      }

      updateData.parentId = targetParentId;
    }

    // 3. Star toggle
    if (typeof isStarred === "boolean") {
      updateData.isStarred = isStarred;
      if (isStarred) {
        await prisma.starredItem.upsert({
          where: { ownerId_folderId: { ownerId: session.user.id, folderId: id } },
          create: { ownerId: session.user.id, folderId: id },
          update: {},
        });
      } else {
        await prisma.starredItem.deleteMany({
          where: { ownerId: session.user.id, folderId: id },
        });
      }
    }

    // 4. Restore from trash
    if (restore === true) {
      updateData.isTrashed = false;
      updateData.trashedAt = null;
    }

    const updated = await prisma.folder.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, folder: updated });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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
    const folder = await prisma.folder.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    // Helper: collect all descendant folder IDs recursively
    async function collectDescendantFolderIds(rootId: string): Promise<string[]> {
      const ids: string[] = [rootId];
      let queue: string[] = [rootId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = await prisma.folder.findMany({
          where: { parentId: current, ownerId: session?.user?.id },
          select: { id: true },
        });
        const childIds = children.map((c) => c.id);
        ids.push(...childIds);
        queue.push(...childIds);
      }
      return ids;
    }

    const allFolderIds = await collectDescendantFolderIds(id);

    if (permanent) {
      // Find all files in these folders to delete their physical files
      const filesToDelete = await prisma.file.findMany({
        where: { folderId: { in: allFolderIds }, ownerId: session.user.id },
        select: { storedName: true },
      });

      for (const file of filesToDelete) {
        await storageService.deletePhysicalFile(file.storedName);
      }

      // Delete files from DB
      await prisma.file.deleteMany({
        where: { folderId: { in: allFolderIds }, ownerId: session.user.id },
      });

      // Delete folders from DB (bottom-up or in bulk)
      await prisma.folder.deleteMany({
        where: { id: { in: allFolderIds }, ownerId: session.user.id },
      });

      return NextResponse.json({
        success: true,
        permanent: true,
        deletedFoldersCount: allFolderIds.length,
        deletedFilesCount: filesToDelete.length,
      });
    } else {
      // Soft-delete folder and all nested files and subfolders
      const now = new Date();
      await prisma.folder.updateMany({
        where: { id: { in: allFolderIds }, ownerId: session.user.id },
        data: { isTrashed: true, trashedAt: now },
      });

      await prisma.file.updateMany({
        where: { folderId: { in: allFolderIds }, ownerId: session.user.id },
        data: { isTrashed: true, trashedAt: now },
      });

      return NextResponse.json({
        success: true,
        trashed: true,
        trashedFoldersCount: allFolderIds.length,
      });
    }
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
