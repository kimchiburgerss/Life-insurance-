"use server";

import { redirect } from "next/navigation";
import { requestIp } from "@/lib/auth/session";
import { optOutByToken } from "@/lib/outreach/service";
import { isOptOutToken } from "@/lib/outreach/util";

export async function optOutAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (isOptOutToken(token)) await optOutByToken(token, await requestIp());
  redirect(`/u/${encodeURIComponent(token)}?done=1`);
}
