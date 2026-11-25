import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerId = session.user.id;

    const [files, folders] = await Promise.all([
      prisma.file.findMany({
        where: {
          ownerId,
          isStarred: true,
          isTrashed: false,
          deletedAt: null,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.folder.findMany({
        where: {
          ownerId,
          isStarred: true,
          isTrashed: false,
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: {
              files: { where: { isTrashed: false, deletedAt: null } },
              children: { where: { isTrashed: false, deletedAt: null } },
            },
          },
        },
      }),
    ]);

    const serializedFiles = files.map((f) => ({
      ...f,
      size: Number(f.size),
    }));

    const serializedFolders = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      isStarred: true,
      filesCount: f._count.files,
      childrenCount: f._count.children,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));

    return NextResponse.json({
      files: serializedFiles,
      folders: serializedFolders,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ownerId = session.user.id;
    const body = await request.json();
    const { fileId, folderId, starred = true } = body;

    if (!fileId && !folderId) {
      return NextResponse.json(
        { error: "Must specify either fileId or folderId" },
        { status: 400 }
      );
    }

    if (fileId) {
      const file = await prisma.file.findFirst({
        where: { id: fileId, ownerId },
      });
      if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

      await prisma.file.update({
        where: { id: fileId },
        data: { isStarred: starred },
      });

      if (starred) {
        await prisma.starredItem.upsert({
          where: { ownerId_fileId: { ownerId, fileId } },
          create: { ownerId, fileId },
          update: {},
        });
      } else {
        await prisma.starredItem.deleteMany({
          where: { ownerId, fileId },
        });
      }
    }

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, ownerId },
      });
      if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

      await prisma.folder.update({
        where: { id: folderId },
        data: { isStarred: starred },
      });

      if (starred) {
        await prisma.starredItem.upsert({
          where: { ownerId_folderId: { ownerId, folderId } },
          create: { ownerId, folderId },
          update: {},
        });
      } else {
        await prisma.starredItem.deleteMany({
          where: { ownerId, folderId },
        });
      }
    }

    return NextResponse.json({ success: true, starred });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
