import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmImportMapping, createImportBatch } from "@/lib/import/upload";
import { enqueueImport, getBoss } from "@/lib/jobs/queue";
import { startWorker } from "@/lib/jobs/worker";
import { makeUser } from "../helpers/factories";

afterAll(async () => {
  await (await getBoss()).stop({ graceful: false, timeout: 5000 });
  await prisma.$disconnect();
});

describe("background import job (pg-boss)", () => {
  it("processes a queued import end to end", async () => {
    const { user } = await makeUser("RESEARCHER");
    const id = `JOB${Date.now().toString(36).toUpperCase()}`;
    const csv = `Property ID,Owner Name,Zip,Property Type,Amount,Date Remitted\n${id}-1,ESTATE OF ADA LOVELACE,89501,IN03,1000,2020-01-15\n`;
    const batch = await createImportBatch({
      fileName: "job.csv",
      data: new TextEncoder().encode(csv),
      source: "test",
      createdById: user.id,
    });
    await confirmImportMapping({ batchId: batch.id, mapping: batch.columnMapping, actorId: user.id });

    await startWorker();
    await enqueueImport(batch.id);
    await enqueueImport(batch.id); // duplicate enqueue is ignored (singletonKey)

    const deadline = Date.now() + 25_000;
    let status = "QUEUED";
    while (Date.now() < deadline) {
      status = (await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status;
      if (status === "COMPLETED" || status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status).toBe("COMPLETED");
    expect(await prisma.property.count({ where: { statePropertyId: `${id}-1` } })).toBe(1);
  });
});
