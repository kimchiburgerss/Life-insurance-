import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Badge, Button, Card } from "@/components/ui";
import { requireOperator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const op = await requireOperator("case:read");
  await prisma.notification.updateMany({ where: { userId: op.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const operator = await requireOperator("case:read");
  const items = await prisma.notification.findMany({ where: { userId: operator.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        {unread > 0 ? (
          <form action={markAllRead}>
            <Button type="submit" variant="secondary">
              Mark all {unread} as read
            </Button>
          </form>
        ) : null}
      </div>
      <Card>
        {items.length === 0 ? (
          <p className="text-sm text-slate-600">No notifications.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {items.map((n) => (
              <li key={n.id} className={`py-2 ${n.readAt ? "text-slate-600" : ""}`}>
                <span className="flex flex-wrap items-center gap-2">
                  {!n.readAt ? <Badge tone="warn">new</Badge> : null}
                  <Badge tone={n.kind === "CASE_UNLOCKED" ? "good" : n.kind === "UNLOCK_BLOCKED" ? "bad" : "neutral"}>
                    {n.kind.toLowerCase().replaceAll("_", " ")}
                  </Badge>
                  {n.caseId ? (
                    <Link href={`/cases/${n.caseId}`} className="font-medium underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{n.title}</span>
                  )}
                  <span className="text-xs text-slate-500">{n.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                </span>
                {n.body ? <p className="mt-1">{n.body}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
