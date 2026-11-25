import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { storageService } from "@/lib/storage";
import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "stream";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { fileIds = [] } = body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json(
        { error: "Please select at least one file to download." },
        { status: 400 }
      );
    }

    const files = await prisma.file.findMany({
      where: {
        id: { in: fileIds },
        ownerId: session.user.id,
        isTrashed: false,
        deletedAt: null,
      },
    });

    if (files.length === 0) {
      return NextResponse.json(
        { error: "None of the requested files were found." },
        { status: 404 }
      );
    }

    // Create zip archive stream
    const archive = new ZipArchive({
      zlib: { level: 5 },
    });

    const passThrough = new PassThrough();
    archive.pipe(passThrough);

    // Track used names in zip to handle name collisions gracefully
    const nameCounts: Record<string, number> = {};

    // Pipe files asynchronously
    (async () => {
      try {
        for (const file of files) {
          const exists = await storageService.fileExists(file.storedName);
          if (!exists) continue;

          let entryName = file.originalName;
          if (nameCounts[entryName] !== undefined) {
            nameCounts[entryName]++;
            const dotIdx = entryName.lastIndexOf(".");
            if (dotIdx > 0) {
              entryName = `${entryName.slice(0, dotIdx)} (${nameCounts[entryName]})${entryName.slice(dotIdx)}`;
            } else {
              entryName = `${entryName} (${nameCounts[entryName]})`;
            }
          } else {
            nameCounts[entryName] = 0;
          }

          const fileStream = await storageService.getReadStream(file.storedName);
          archive.append(fileStream, { name: entryName });
        }
        await archive.finalize();
      } catch (err) {
        archive.destroy(err as Error);
      }
    })();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webStream = Readable.toWeb(passThrough) as any;

    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set(
      "Content-Disposition",
      `attachment; filename="drive-bundle-${Date.now()}.zip"`
    );
    headers.set("Cache-Control", "no-cache");

    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
