import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + database check for the host's health probe. Returns no data. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
