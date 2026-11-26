/**
 * Turn one spreadsheet row into a normalized property record (or an error
 * message for the import report). Pure — no database access.
 */
import { normalizeAddress, hasUsableAddress, type NormalizedAddress } from "@/lib/normalize/address";
import { hasDeceasedMarker, parseOwnerName, type ParsedName } from "@/lib/normalize/name";
import { cleanText, isBlank } from "@/lib/normalize/text";
import {
  classifyCategory,
  isLifeInsurer,
  parseAmountCell,
  parseDateCell,
  type ParsedDate,
} from "@/lib/normalize/values";
import type { PropertyCategory } from "@/lib/generated/prisma/enums";
import type { ImportFieldKey, ImportMapping } from "./fields";

export type NormalizedRecord = {
  rowNumber: number;
  statePropertyId: string;
  ownerNameRaw: string;
  name: ParsedName;
  address: NormalizedAddress | null;
  addressRaw: string | null;
  holderName: string | null;
  holderIsLifeInsurer: boolean;
  propertyTypeCode: string | null;
  category: PropertyCategory;
  amountCents: number | null;
  amountIsMinimum: boolean;
  delivered: ParsedDate | null;
  presumedAbandoned: ParsedDate | null;
  hasDeceasedMarker: boolean;
  flags: string[];
  raw: Record<string, unknown>;
};

export type RowResult = { ok: true; record: NormalizedRecord } | { ok: false; rowNumber: number; error: string };

function jsonSafe(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  return out;
}

export function normalizeRow(
  row: Record<string, unknown>,
  mapping: ImportMapping,
  rowNumber: number,
  stateCode = "NV",
  today = new Date(),
): RowResult {
  const get = (key: ImportFieldKey): unknown => {
    const header = mapping.fields[key];
    return header ? row[header] : undefined;
  };
  const fail = (error: string): RowResult => ({ ok: false, rowNumber, error });

  const statePropertyId = cleanText(get("statePropertyId"), "-_/.").replace(/ /g, "");
  if (!statePropertyId) return fail("Missing state property ID.");

  // Owner name: a full-name column, or separate parts joined as "LAST, FIRST MIDDLE".
  let ownerNameRaw: string;
  let name: ParsedName;
  if (!isBlank(get("ownerLastName"))) {
    const last = String(get("ownerLastName")).trim();
    const firstMiddle = [get("ownerFirstName"), get("ownerMiddleName")].filter((v) => !isBlank(v)).join(" ");
    ownerNameRaw = firstMiddle ? `${last}, ${firstMiddle}` : last;
    name = parseOwnerName(ownerNameRaw, "LAST_FIRST");
  } else {
    ownerNameRaw = String(get("ownerName") ?? "").trim();
    name = parseOwnerName(ownerNameRaw, mapping.options.nameOrder);
  }
  if (!ownerNameRaw) return fail("Missing owner name.");

  // Address: separate columns preferred, else a single-line column.
  let address: NormalizedAddress | null = null;
  let addressRaw: string | null = null;
  if (mapping.fields.addressLine1 || mapping.fields.zip || mapping.fields.city) {
    const parts = ["addressLine1", "addressLine2", "city", "state", "zip"].map((k) => get(k as ImportFieldKey));
    addressRaw = parts.filter((v) => !isBlank(v)).join(", ") || null;
    address = normalizeAddress({ kind: "parts", line1: parts[0], line2: parts[1], city: parts[2], state: parts[3], zip: parts[4] });
  } else if (!isBlank(get("fullAddress"))) {
    addressRaw = String(get("fullAddress")).trim();
    address = normalizeAddress({ kind: "single", value: addressRaw });
  }
  if (address && !hasUsableAddress(address)) address = null;

  let delivered: ParsedDate | null;
  let presumedAbandoned: ParsedDate | null;
  let amount: ReturnType<typeof parseAmountCell>;
  try {
    delivered = parseDateCell(get("dateDeliveredToState"), mapping.options.dateOrder);
    presumedAbandoned = parseDateCell(get("datePresumedAbandoned"), mapping.options.dateOrder);
    amount = parseAmountCell(get("amount"));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (delivered && delivered.date.getTime() > today.getTime()) {
    return fail(`Date delivered to the state is in the future (${delivered.date.toISOString().slice(0, 10)}).`);
  }

  const holderName = isBlank(get("holderName")) ? null : String(get("holderName")).trim();
  const propertyTypeCode = isBlank(get("propertyTypeCode")) ? null : cleanText(get("propertyTypeCode")).replace(/ /g, "");
  const category = classifyCategory(get("propertyTypeCode"), get("propertyTypeDescription"));

  const flags: string[] = [...name.flags];
  if (delivered && delivered.precision !== "DAY") flags.push("DATE_APPROXIMATE");
  if (!delivered) flags.push("DELIVERY_DATE_MISSING");
  if (amount.isMinimum) flags.push("AMOUNT_MINIMUM");
  if (!address) flags.push("NO_ADDRESS");
  else if (address.state && address.state !== stateCode) flags.push("OUT_OF_STATE");

  return {
    ok: true,
    record: {
      rowNumber,
      statePropertyId,
      ownerNameRaw,
      name,
      address,
      addressRaw,
      holderName,
      holderIsLifeInsurer: isLifeInsurer(holderName),
      propertyTypeCode,
      category,
      amountCents: amount.cents,
      amountIsMinimum: amount.isMinimum,
      delivered,
      presumedAbandoned,
      hasDeceasedMarker: hasDeceasedMarker(name),
      flags,
      raw: jsonSafe(row),
    },
  };
}
