import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { Readable } from "stream";

export const runtime = "nodejs";

// MIME types that can execute active scripts/code in browser context
const ACTIVE_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
];

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
        { error: "Authentication required to preview files." },
        { status: 401 }
      );
    }

    // 2. Query file and verify ownership
    const file = await prisma.file.findUnique({
      where: { id },
    });

    if (!file || file.deletedAt) {
      return NextResponse.json(
        { error: "File not found or has been deleted." },
        { status: 404 }
      );
    }

    if (file.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: "Unauthorized: You do not have permission to view this file." },
        { status: 403 }
      );
    }

    // 3. Verify physical storage file exists
    const exists = await storageService.fileExists(file.storedName);
    if (!exists) {
      return NextResponse.json(
        { error: "Physical file is not present on storage volume." },
        { status: 404 }
      );
    }

    // 4. Log preview activity (asynchronous, non-blocking)
    logActivity({
      ownerId: session.user.id,
      action: "preview",
      fileId: file.id,
      itemName: file.originalName,
      details: { mimeType: file.mimeType, size: Number(file.size) },
    }).catch(() => {});

    // Determine safe Content-Type: neutralize executable content
    let safeMimeType = file.mimeType || "application/octet-stream";
    const isDangerousType = ACTIVE_CONTENT_TYPES.some((t) =>
      safeMimeType.toLowerCase().startsWith(t)
    );
    if (isDangerousType) {
      // Force text/plain to avoid XSS execution inside application origin
      safeMimeType = "text/plain; charset=utf-8";
    }

    const totalSize = Number(file.size);
    const rangeHeader = request.headers.get("range");

    // Standard security headers
    const baseHeaders = new Headers();
    baseHeaders.set("Content-Type", safeMimeType);
    baseHeaders.set("Accept-Ranges", "bytes");
    baseHeaders.set("X-Content-Type-Options", "nosniff");
    // Sandboxed CSP protects app origin from malicious uploaded content
    baseHeaders.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );
    baseHeaders.set(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(file.originalName)}"`
    );
    baseHeaders.set("ETag", `"${file.checksum}"`);
    baseHeaders.set("Cache-Control", "private, no-transform, max-age=3600");

    // 5. Handle HTTP Range Requests (Essential for Video/Audio seeking & streaming)
    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const rawStart = parts[0];
      const rawEnd = parts[1];

      let start = rawStart ? parseInt(rawStart, 10) : 0;
      let end = rawEnd ? parseInt(rawEnd, 10) : totalSize - 1;

      // Handle suffix range (e.g. bytes=-500: last 500 bytes)
      if (!rawStart && rawEnd) {
        start = Math.max(0, totalSize - parseInt(rawEnd, 10));
        end = totalSize - 1;
      }

      // Check range validity
      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 0 ||
        start >= totalSize ||
        end >= totalSize ||
        start > end
      ) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const nodeStream = await storageService.getReadStream(file.storedName, {
        start,
        end,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webStream = Readable.toWeb(nodeStream) as any;

      baseHeaders.set("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      baseHeaders.set("Content-Length", chunkSize.toString());

      return new Response(webStream, {
        status: 206,
        headers: baseHeaders,
      });
    }

    // 6. Handle standard full stream (no Range header)
    const nodeStream = await storageService.getReadStream(file.storedName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webStream = Readable.toWeb(nodeStream) as any;

    baseHeaders.set("Content-Length", totalSize.toString());

    return new Response(webStream, {
      status: 200,
      headers: baseHeaders,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Preview endpoint error:", err);
    return NextResponse.json(
      { error: "Failed to render preview." },
      { status: 500 }
    );
  }
}
