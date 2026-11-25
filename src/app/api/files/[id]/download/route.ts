import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { Readable } from "stream";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required to download files." },
        { status: 401 }
      );
    }

    // 2. Query database record & check authorization
    const file = await prisma.file.findUnique({
      where: { id },
    });

    if (!file || file.deletedAt) {
      return NextResponse.json(
        { error: "Requested file was not found or has been deleted." },
        { status: 404 }
      );
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Unauthorized access: you do not have permission to access this file." },
        { status: 403 }
      );
    }

    // 3. Verify physical file exists on disk
    const exists = await storageService.fileExists(file.storedName);
    if (!exists) {
      console.error(
        `Consistency error: File record ${file.id} exists in DB but storedName "${file.storedName}" is missing on physical disk.`
      );
      return NextResponse.json(
        { error: "File binary is missing from the physical storage volume." },
        { status: 404 }
      );
    }

    // 4. Log download activity
    logActivity({
      ownerId: session.user.id,
      action: "download",
      fileId: file.id,
      itemName: file.originalName,
      details: { size: Number(file.size), mimeType: file.mimeType },
    }).catch(() => {});

    // 5. Retrieve readable file stream
    const nodeStream = await storageService.getReadStream(file.storedName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webStream = Readable.toWeb(nodeStream) as any;

    // 5. Construct safe headers (RFC 5987 / RFC 6266 encoding for UTF-8 filenames)
    const isInline = request.nextUrl.searchParams.get("inline") === "true";
    const dispositionType = isInline ? "inline" : "attachment";
    const asciiFilename = file.originalName.replace(/[^\x20-\x7E]/g, "_");
    const encodedFilename = encodeURIComponent(file.originalName);

    const headers = new Headers();
    headers.set("Content-Type", file.mimeType || "application/octet-stream");
    headers.set("Content-Length", file.size.toString());
    headers.set(
      "Content-Disposition",
      `${dispositionType}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    headers.set("ETag", `"${file.checksum}"`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-transform, max-age=86400");

    // 6. Return streamed response
    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("File download error:", err);
    return NextResponse.json(
      { error: "Failed to stream file from storage." },
      { status: 500 }
    );
  }
}
