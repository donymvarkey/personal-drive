import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get("parentId");
    const isTrashed = searchParams.get("trashed") === "true";
    const all = searchParams.get("all") === "true";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ownerId: session.user.id,
      deletedAt: null,
      isTrashed,
    };

    if (!all) {
      if (parentId === "root" || parentId === "" || parentId === null) {
        where.parentId = null;
      } else {
        where.parentId = parentId;
      }
    }

    const folders = await prisma.folder.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            files: { where: { isTrashed: false, deletedAt: null } },
            children: { where: { isTrashed: false, deletedAt: null } },
          },
        },
        starredItems: {
          where: { ownerId: session.user.id },
          select: { id: true },
        },
      },
    });

    const serialized = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      isStarred: f.starredItems.length > 0 || f.isStarred,
      isTrashed: f.isTrashed,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      filesCount: f._count.files,
      childrenCount: f._count.children,
    }));

    return NextResponse.json({ folders: serialized });
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

    const body = await request.json();
    const rawName = body.name?.trim();
    const parentId = body.parentId || null;

    if (!rawName) {
      return NextResponse.json({ error: "Folder name is required." }, { status: 400 });
    }

    const { safeName } = storageService.sanitizeFilename(rawName);

    // Validate parent folder if specified
    if (parentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: parentId },
      });
      if (!parent || parent.ownerId !== session.user.id || parent.isTrashed) {
        return NextResponse.json({ error: "Parent folder not found." }, { status: 404 });
      }
    }

    // Check for duplicate folder name in same parent
    const existing = await prisma.folder.findFirst({
      where: {
        ownerId: session.user.id,
        parentId,
        name: safeName,
        isTrashed: false,
        deletedAt: null,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: `A folder named "${safeName}" already exists in this location.` },
        { status: 409 }
      );
    }

    const folder = await prisma.folder.create({
      data: {
        name: safeName,
        parentId,
        ownerId: session.user.id,
      },
    });

    return NextResponse.json({ success: true, folder }, { status: 201 });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
