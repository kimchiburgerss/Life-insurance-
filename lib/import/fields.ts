/**
 * The Property fields a spreadsheet column can be mapped to, with header
 * aliases used to pre-fill the mapping screen.
 */
import { z } from "zod";

export const IMPORT_FIELDS = [
  { key: "statePropertyId", label: "State property ID", required: true, aliases: ["property id", "property number", "prop id", "propertyid", "property no", "claim id", "record id", "unclaimed property id", "up id", "id"] },
  { key: "ownerName", label: "Owner name (full)", required: false, aliases: ["owner name", "reported owner", "owner", "name", "full name", "payee", "owner full name", "owner_name"] },
  { key: "ownerLastName", label: "Owner last name", required: false, aliases: ["last name", "owner last name", "lname", "last", "surname", "owner last"] },
  { key: "ownerFirstName", label: "Owner first name", required: false, aliases: ["first name", "owner first name", "fname", "first", "owner first", "given name"] },
  { key: "ownerMiddleName", label: "Owner middle name / initial", required: false, aliases: ["middle name", "middle", "mi", "middle initial", "owner middle"] },
  { key: "addressLine1", label: "Address line 1", required: false, aliases: ["address", "address 1", "address1", "street", "owner address", "addr1", "address line 1", "street address", "owner address 1"] },
  { key: "addressLine2", label: "Address line 2", required: false, aliases: ["address 2", "address2", "addr2", "address line 2", "owner address 2"] },
  { key: "city", label: "City", required: false, aliases: ["city", "owner city"] },
  { key: "state", label: "State", required: false, aliases: ["state", "st", "owner state"] },
  { key: "zip", label: "ZIP code", required: false, aliases: ["zip", "zip code", "zipcode", "postal code", "owner zip", "zip5"] },
  { key: "fullAddress", label: "Full address (single column)", required: false, aliases: ["full address", "mailing address", "last known address", "owner full address"] },
  { key: "holderName", label: "Holder (company that reported it)", required: false, aliases: ["holder", "holder name", "reported by", "reporting company", "company", "holder_name", "remitter"] },
  { key: "propertyTypeCode", label: "Property type code", required: false, aliases: ["property type", "property type code", "prop type", "type code", "naupa code", "property code", "type"] },
  { key: "propertyTypeDescription", label: "Property description", required: false, aliases: ["property description", "description", "property type description", "type description", "prop desc"] },
  { key: "amount", label: "Amount", required: false, aliases: ["amount", "cash reported", "cash amount", "reported amount", "amount reported", "value", "balance", "property value", "cash"] },
  { key: "dateDeliveredToState", label: "Date delivered (remitted) to the state", required: false, aliases: ["date remitted", "remit date", "remitted date", "date delivered", "delivered date", "date received", "received date", "date reported", "report date", "reported date", "year reported", "report year"] },
  { key: "datePresumedAbandoned", label: "Date presumed abandoned", required: false, aliases: ["date presumed abandoned", "presumed abandoned", "date of last contact", "last activity date", "last contact date", "dormancy date"] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export const IMPORT_FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportFieldKey, ...ImportFieldKey[]];

export const ImportMappingSchema = z
  .object({
    fields: z.partialRecord(z.enum(IMPORT_FIELD_KEYS), z.string().min(1)),
    options: z.object({
      nameOrder: z.enum(["AUTO", "LAST_FIRST", "FIRST_LAST"]).default("AUTO"),
      dateOrder: z.enum(["MDY", "DMY", "YMD"]).default("MDY"),
    }),
  })
  .refine((m) => Boolean(m.fields.statePropertyId), { message: "Map a column to “State property ID”." })
  .refine((m) => Boolean(m.fields.ownerName || m.fields.ownerLastName), {
    message: "Map a column to “Owner name (full)” or to “Owner last name”.",
  });

export type ImportMapping = z.infer<typeof ImportMappingSchema>;

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pre-fill a mapping from header names (exact alias first, then "contains"). */
export function suggestMapping(headers: string[]): ImportMapping["fields"] {
  const result: ImportMapping["fields"] = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  for (const pass of ["exact", "contains"] as const) {
    for (const field of IMPORT_FIELDS) {
      if (result[field.key]) continue;
      const hit = normalized.find(
        (h) =>
          !used.has(h.raw) &&
          field.aliases.some((a) => (pass === "exact" ? h.n === a : a.length > 3 && h.n.includes(a))),
      );
      if (hit) {
        result[field.key] = hit.raw;
        used.add(hit.raw);
      }
    }
  }
  return result;
}

/** Headers mapped to the delivery date that look like a *report* date need a human check. */
export function deliveryDateNeedsConfirmation(header: string | undefined): boolean {
  return Boolean(header && /report/i.test(header));
}
