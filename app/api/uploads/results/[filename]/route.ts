import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const RESULTS_DIR = path.join(process.cwd(), "public", "uploads", "results");

export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  try {
    const filename = params.filename;
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return new NextResponse("Bad Request", { status: 400 });
    }
    const file = await readFile(path.join(RESULTS_DIR, filename));
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
