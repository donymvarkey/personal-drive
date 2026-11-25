import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { Readable } from "stream";

export const runtime = "nodejs";

export async function GET(
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

    const exists = await storageService.fileExists(version.storedName);
    if (!exists) {
      return NextResponse.json(
        { error: "Version binary is missing from physical storage volume." },
        { status: 404 }
      );
    }

    const nodeStream = await storageService.getReadStream(version.storedName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webStream = Readable.toWeb(nodeStream) as any;

    const dotIdx = file.originalName.lastIndexOf(".");
    const baseName = dotIdx > 0 ? file.originalName.slice(0, dotIdx) : file.originalName;
    const ext = dotIdx > 0 ? file.originalName.slice(dotIdx) : "";
    const downloadFilename = `${baseName}_v${version.versionNumber}${ext}`;

    const headers = new Headers();
    headers.set("Content-Type", file.mimeType || "application/octet-stream");
    headers.set("Content-Length", version.size.toString());
    headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(downloadFilename)}"`
    );
    headers.set("ETag", `"${version.checksum}"`);

    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
