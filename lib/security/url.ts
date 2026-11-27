import { z } from "zod";

/**
 * A web address we may render as a link: http(s) only. `z.string().url()`
 * alone accepts `javascript:` and `data:` URLs.
 */
export const webUrl = (message = "Enter a full web address (https://…)") =>
  z
    .string()
    .trim()
    .url(message)
    .refine((u) => /^https?:\/\//i.test(u), message);
