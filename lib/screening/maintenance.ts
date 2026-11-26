import "server-only";
import type { DbClient } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { TERMINAL_STAGES } from "@/lib/case/stateMachine";
import { rescoreCases } from "./service";

/** Re-score every open case (scores and eligibility move with the calendar). */
export async function rescoreOpenCases(db: DbClient, today: Date = todayIn()): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await db.case.findMany({
      where: { stage: { notIn: [...TERMINAL_STAGES] } },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true },
    });
    if (page.length === 0) break;
    total += await rescoreCases(db, page.map((c) => c.id), today);
    cursor = page[page.length - 1]!.id;
  }
  return total;
}
