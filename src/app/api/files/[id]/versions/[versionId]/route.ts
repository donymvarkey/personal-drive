import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";

export const runtime = "nodejs";

export async function DELETE(
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
    });
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const version = await prisma.fileVersion.findFirst({
      where: { id: versionId, fileId: id },
    });
    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Safety check: Cannot delete version if it shares storedName with currently active file
    if (file.storedName === version.storedName) {
      return NextResponse.json(
        { error: "Cannot delete the version currently active in the file explorer." },
        { status: 400 }
      );
    }

    // Delete physical binary from storage disk
    await storageService.deletePhysicalFile(version.storedName);

    // Delete database record
    await prisma.fileVersion.delete({
      where: { id: versionId },
    });

    return NextResponse.json({
      success: true,
      message: `Version ${version.versionNumber} deleted successfully.`,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
