import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { Readable } from "stream";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const backup = await prisma.backupRecord.findUnique({
    where: { id },
  });

  if (!backup) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }

  try {
    await fs.access(backup.archivePath);
    const stat = await fs.stat(backup.archivePath);
    const nodeStream = createReadStream(backup.archivePath);
    const webStream = Readable.toWeb(nodeStream);

    const filename = path.basename(backup.archivePath);

    return new Response(webStream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": stat.size.toString(),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Backup file is missing from backup storage." },
      { status: 404 }
    );
  }
}
