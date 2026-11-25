import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity, ActivityAction } from "@/lib/activity";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const action = searchParams.get("action");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ownerId: session.user.id,
    };

    if (action && action !== "all") {
      where.action = action;
    }

    const activities = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        file: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            extension: true,
            size: true,
            isStarred: true,
            isTrashed: true,
          },
        },
      },
    });

    const serialized = activities.map((act) => ({
      id: act.id,
      action: act.action,
      itemName: act.itemName,
      fileId: act.fileId,
      folderId: act.folderId,
      details: act.details,
      createdAt: act.createdAt,
      file: act.file
        ? {
            ...act.file,
            size: Number(act.file.size),
          }
        : null,
    }));

    return NextResponse.json({ activities: serialized });
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
    const { action, itemName, fileId, folderId, details } = body;

    if (!action || !itemName) {
      return NextResponse.json(
        { error: "action and itemName are required" },
        { status: 400 }
      );
    }

    const activity = await logActivity({
      ownerId: session.user.id,
      action: action as ActivityAction,
      itemName,
      fileId,
      folderId,
      details,
    });

    return NextResponse.json({ success: true, activity });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
