/**
 * Seed: jurisdiction rules (always) + FAKE demo data (never in production).
 *
 *   npm run db:seed          # rules + demo data
 *   SEED_DEMO=false npm run db:seed   # rules only (use this in production)
 *
 * Every person, address, obituary and insurer below is invented. Emails use
 * the reserved example.com domain and phone numbers use the fictional
 * 555-01xx range.
 */
import { faker } from "@faker-js/faker";
import { writeAudit } from "@/lib/audit";
import { provisionOperator } from "@/lib/auth/provision";
import { transitionCase, refreshEligibleContractDate } from "@/lib/case/transitions";
import { blindIndex, encryptPii } from "@/lib/crypto/pii";
import { prisma } from "@/lib/db";
import { addDays, addMonths, formatDateOnly, todayIn } from "@/lib/dates";
import type { CaseStage, PropertyCategory, Relationship } from "@/lib/generated/prisma/enums";
import { ownerMatchKeys } from "@/lib/match/owner";
import { normalizeAddress } from "@/lib/normalize/address";
import { hasDeceasedMarker, parseOwnerName } from "@/lib/normalize/name";
import { createDraft } from "@/lib/outreach/service";
import { getBusinessProfile, saveBusinessProfile } from "@/lib/outreach/settings";
import { NEVADA_RULES, PLACEHOLDER_RULES } from "@/lib/rules/jurisdictions";
import { parseDateOnly } from "@/lib/dates";
import { rescoreCases } from "@/lib/screening/service";

export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const DEMO_ACCOUNTS = [
  { email: "owner@example.com", name: "Demo Owner", role: "OWNER", password: "demo-owner-password" },
  { email: "researcher@example.com", name: "Demo Researcher", role: "RESEARCHER", password: "demo-researcher-password" },
  { email: "viewer@example.com", name: "Demo Viewer", role: "VIEWER", password: "demo-viewer-password" },
] as const;

const FICTIONAL_HOLDERS = [
  { name: "Silver Sage Mutual Life Insurance Co.", lifeInsurer: true, category: "LIFE_INSURANCE" },
  { name: "Great Basin National Life Assurance", lifeInsurer: true, category: "LIFE_INSURANCE" },
  { name: "Red Rock Annuity & Life Company", lifeInsurer: true, category: "ANNUITY" },
  { name: "Sierra Pines Fraternal Benefit Society", lifeInsurer: true, category: "LIFE_INSURANCE" },
  { name: "Desert Bloom Credit Union", lifeInsurer: false, category: "ESTATE" },
  { name: "Tahoe Trust Bank (fictional)", lifeInsurer: false, category: "OTHER" },
] as const;

const NV_CITIES = ["Las Vegas", "Henderson", "Reno", "Sparks", "Carson City", "Elko", "Mesquite", "Boulder City"];

async function seedRules() {
  for (const rule of [...NEVADA_RULES, ...PLACEHOLDER_RULES]) {
    await prisma.jurisdictionRule.upsert({
      where: {
        stateCode_ruleType_version: { stateCode: rule.stateCode, ruleType: rule.ruleType, version: rule.version },
      },
      // Never overwrite a rule the founder has edited/verified.
      update: {},
      create: {
        stateCode: rule.stateCode,
        ruleType: rule.ruleType,
        version: rule.version,
        params: rule.params,
        effectiveFrom: parseDateOnly(rule.effectiveFrom),
        enabled: rule.enabled,
        sourceCitation: rule.sourceCitation,
        sourceUrl: rule.sourceUrl,
        notes: rule.notes,
      },
    });
  }
  console.log(`✓ ${NEVADA_RULES.length} Nevada rules + ${PLACEHOLDER_RULES.length} disabled placeholders`);
}

type Plan = { stage: CaseStage | null; monthsAgoDelivered: [number, number]; unknownDate?: boolean };

/** 15 demo cases at various stages + 25 owners not yet screened into a case. */
const CASE_PLANS: Plan[] = [
  { stage: "IMPORTED", monthsAgoDelivered: [30, 50] },
  { stage: "IMPORTED", monthsAgoDelivered: [30, 40], unknownDate: true },
  { stage: "SCREENED", monthsAgoDelivered: [40, 70] },
  { stage: "SCREENED", monthsAgoDelivered: [8, 14] },
  { stage: "OWNER_VERIFIED_DECEASED", monthsAgoDelivered: [26, 34] },
  { stage: "HEIRS_RESEARCHING", monthsAgoDelivered: [62, 90] },
  { stage: "HEIRS_RESEARCHING", monthsAgoDelivered: [10, 18] },
  { stage: "HEIRS_IDENTIFIED", monthsAgoDelivered: [36, 48] },
  { stage: "WAITING_PERIOD", monthsAgoDelivered: [20, 23] },
  { stage: "WAITING_PERIOD", monthsAgoDelivered: [12, 16] },
  { stage: "WAITING_PERIOD", monthsAgoDelivered: [3, 6] },
  { stage: "READY_FOR_OUTREACH", monthsAgoDelivered: [28, 40] },
  { stage: "READY_FOR_OUTREACH", monthsAgoDelivered: [64, 80] },
  { stage: "CONTACTED", monthsAgoDelivered: [30, 44] },
  { stage: "CLOSED_SELF_CLAIMED", monthsAgoDelivered: [14, 20] },
];

/** Stage path each plan walks through (all via the real transition service). */
const PATHS: Partial<Record<CaseStage, CaseStage[]>> = {
  IMPORTED: [],
  SCREENED: ["SCREENED"],
  OWNER_VERIFIED_DECEASED: ["SCREENED", "OWNER_VERIFIED_DECEASED"],
  HEIRS_RESEARCHING: ["SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING"],
  HEIRS_IDENTIFIED: ["SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED"],
  WAITING_PERIOD: ["SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", "WAITING_PERIOD"],
  READY_FOR_OUTREACH: ["SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", "READY_FOR_OUTREACH"],
  CONTACTED: ["SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", "READY_FOR_OUTREACH", "CONTACTED"],
  CLOSED_SELF_CLAIMED: [
    "SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", "WAITING_PERIOD", "CLOSED_SELF_CLAIMED",
  ],
};

const PROPERTY_COUNTS = [3, 7, 4, 6, 5]; // repeats → 40 owners × avg 5 = 200 properties

function fakeOwnerName() {
  const first = faker.person.firstName();
  const middle = faker.string.alpha({ length: 1, casing: "upper" });
  const last = faker.person.lastName();
  return { first, middle, last, full: `${first} ${middle}. ${last}` };
}

function rawOwnerName(n: { first: string; middle: string; last: string }) {
  return faker.helpers.arrayElement([
    `ESTATE OF ${n.first} ${n.middle} ${n.last}`.toUpperCase(),
    `${n.last} ${n.first} ${n.middle} DECD`.toUpperCase(),
    `${n.last}, ${n.first} ${n.middle}`.toUpperCase(),
    `${n.first} ${n.last} C/O ${faker.person.lastName()}`.toUpperCase(),
  ]);
}

function fakeAddress() {
  return {
    line1: `${faker.number.int({ min: 100, max: 9999 })} ${faker.location.street()}`,
    city: faker.helpers.arrayElement(NV_CITIES),
    state: "NV",
    postalCode: `89${faker.string.numeric(3)}`,
  };
}

function fakeAmountCents(): number | null {
  if (faker.number.float() < 0.15) return null; // state didn't disclose
  const dollars = faker.helpers.weightedArrayElement([
    { weight: 5, value: faker.number.int({ min: 50, max: 2_000 }) },
    { weight: 3, value: faker.number.int({ min: 2_000, max: 25_000 }) },
    { weight: 2, value: faker.number.int({ min: 25_000, max: 250_000 }) },
  ]);
  return dollars * 100;
}

const HEIR_RELATIONSHIPS: Relationship[] = ["SPOUSE", "CHILD", "CHILD", "SIBLING", "NIECE_NEPHEW", "GRANDCHILD"];

async function seedDemo() {
  if ((await prisma.case.count()) > 0) {
    console.log("Demo data already present — skipping. Run `npm run db:reset` for a fresh demo database.");
    return;
  }
  faker.seed(20261126);
  const today = todayIn();

  // Operators (TOTP pre-enrolled with the published demo secret — demo only!)
  const users = [];
  for (const a of DEMO_ACCOUNTS) {
    users.push(await provisionOperator(prisma, { ...a, totpSecretBase32: DEMO_TOTP_SECRET, createdBy: "seed" }));
  }
  const owner = users[0]!;
  const actor = { type: "USER" as const, id: owner.id, role: "OWNER" as const };

  // Fictional business profile so letters can be drafted in the demo (never overwrites a real one).
  if (!(await getBusinessProfile())) {
    await saveBusinessProfile(
      { id: owner.id, role: "OWNER" },
      {
        legalName: "Demo Heir Recovery LLC",
        contactName: "Demo Owner",
        contactTitle: "Founder",
        mailingAddress: { line1: "123 Example Ave", line2: "Suite 100", city: "Las Vegas", state: "NV", zip: "89101" },
        phone: "702-555-0100",
        email: "owner@example.com",
        website: "",
      },
    );
  }

  const batch = await prisma.importBatch.create({
    data: {
      fileName: "demo-nevada-unclaimed-property.csv",
      source: "DEMO DATA — fictional records",
      fileType: "csv",
      fileSha256: "demo-seed",
      status: "COMPLETED",
      completedAt: new Date(),
      createdById: owner.id,
    },
  });

  let propertySeq = 0;
  let caseCount = 0;
  const allCaseIds: string[] = [];
  for (let i = 0; i < 40; i++) {
    const plan: Plan = CASE_PLANS[i] ?? { stage: null, monthsAgoDelivered: [6, 120] };
    const name = fakeOwnerName();
    const address = fakeAddress();
    const normalizedAddress = normalizeAddress({
      kind: "parts", line1: address.line1, city: address.city, state: address.state, zip: address.postalCode,
    });
    const normalizedName = `${name.first} ${name.middle} ${name.last}`.toUpperCase();
    const dateOfDeath = addDays(today, -faker.number.int({ min: 400, max: 4000 }));
    const ownerRow = await prisma.owner.create({
      data: {
        fullName: name.full,
        normalizedName,
        aliases: [`${name.first} ${name.last}`.toUpperCase()],
        dateOfBirth: addDays(dateOfDeath, -faker.number.int({ min: 60 * 365, max: 95 * 365 })),
        lastKnownAddresses: [normalizedAddress],
        matchKeys: ownerMatchKeys(parseOwnerName(normalizedName, "FIRST_LAST").tokens),
      },
    });

    const baseMonthsAgo = faker.number.int({ min: plan.monthsAgoDelivered[0], max: plan.monthsAgoDelivered[1] });
    const propertyIds: string[] = [];
    let total = 0;
    const count = PROPERTY_COUNTS[i % PROPERTY_COUNTS.length]!;
    for (let p = 0; p < count; p++) {
      const holder = faker.helpers.arrayElement(FICTIONAL_HOLDERS);
      // Properties of one owner were delivered within a couple of months of each other.
      const delivered = addMonths(today, -(baseMonthsAgo - (p % 2)), "clamp");
      const amount = fakeAmountCents();
      total += amount ?? 0;
      const raw = rawOwnerName(name);
      const parsedRaw = parseOwnerName(raw);
      const prop = await prisma.property.create({
        data: {
          statePropertyId: `NV-DEMO-${String(++propertySeq).padStart(6, "0")}`,
          ownerNameRaw: raw,
          ownerNameNormalized: ownerRow.normalizedName,
          ownerAddressRaw: `${address.line1}, ${address.city}, NV ${address.postalCode}`.toUpperCase(),
          ownerAddressNormalized: normalizedAddress,
          ownerNameParsed: { first: parsedRaw.first, middle: parsedRaw.middle, last: parsedRaw.last, suffix: parsedRaw.suffix },
          flags: [...parsedRaw.flags, ...(plan.unknownDate && p === 0 ? ["DELIVERY_DATE_MISSING"] : [])],
          holderName: holder.name,
          propertyTypeCode: holder.category === "LIFE_INSURANCE" ? "IN01" : holder.category === "ANNUITY" ? "IN04" : "MS16",
          category: holder.category as PropertyCategory,
          reportedAmountCents: amount,
          datePresumedAbandoned: addMonths(delivered, -faker.number.int({ min: 6, max: 14 }), "clamp"),
          dateDeliveredToState: plan.unknownDate && p === 0 ? null : delivered,
          dateDeliveredPrecision: plan.unknownDate && p === 0 ? null : "DAY",
          hasDeceasedMarker: hasDeceasedMarker(parsedRaw),
          holderIsLifeInsurer: holder.lifeInsurer,
          rawRecord: { demo: true, OWNER_NAME: raw, HOLDER: holder.name, AMOUNT: amount === null ? "N/D" : (amount / 100).toFixed(2) },
          importBatchId: batch.id,
          ownerId: ownerRow.id,
        },
      });
      propertyIds.push(prop.id);
    }

    if (!plan.stage) {
      // Freshly imported owner: an IMPORTED case waiting in the screening queue.
      const imported = await prisma.case.create({
        data: { ownerId: ownerRow.id, estimatedValueCents: total || null, properties: { connect: propertyIds.map((id) => ({ id })) } },
      });
      allCaseIds.push(imported.id);
      await writeAudit(prisma, {
        actor: { type: "SYSTEM", id: "seed" },
        action: "case.created",
        entityType: "Case",
        entityId: imported.id,
        after: { stage: "IMPORTED", propertyCount: propertyIds.length },
      });
      continue;
    }

    // ── Create the case and walk it through the pipeline ──
    caseCount++;
    const c = await prisma.case.create({
      data: {
        ownerId: ownerRow.id,
        estimatedValueCents: total || null,
        assignedUserId: owner.id,
        properties: { connect: propertyIds.map((id) => ({ id })) },
      },
    });
    allCaseIds.push(c.id);
    await refreshEligibleContractDate(prisma, c.id, today);
    await writeAudit(prisma, {
      actor: { type: "SYSTEM", id: "seed" },
      action: "case.created",
      entityType: "Case",
      entityId: c.id,
      after: { stage: "IMPORTED", propertyCount: propertyIds.length },
    });

    for (const to of PATHS[plan.stage] ?? []) {
      if (to === "OWNER_VERIFIED_DECEASED") await addObituary(c.id, name, dateOfDeath, address.city, owner.id);
      if (to === "HEIRS_IDENTIFIED") await addHeirs(c.id, name.last, owner.id);
      if (to === "CONTACTED") await addSentLetter(c.id, owner.id);
      const needsOverride = to === "READY_FOR_OUTREACH" || to === "CONTACTED";
      await transitionCase({
        caseId: c.id,
        to,
        actor,
        today,
        override: needsOverride,
        reason: needsOverride
          ? "Demo data: seeded before the founder has verified the Nevada rules."
          : to === "CLOSED_SELF_CLAIMED"
            ? "Heir told us they filed directly with the Treasurer (demo)."
            : undefined,
      });
    }
  }

  await rescoreCases(prisma, allCaseIds, today);
  console.log(
    `✓ ${propertySeq} properties, 40 owners, ${allCaseIds.length} cases ` +
      `(${caseCount} worked to various stages + ${allCaseIds.length - caseCount} awaiting screening) — demo data`,
  );
  console.log("\nDemo logins (TOTP secret for all three: %s)", DEMO_TOTP_SECRET);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.email}  /  ${a.password}`);
  console.log("  Current 6-digit code: npm run demo:totp\n");
}

async function addObituary(
  caseId: string,
  name: { first: string; middle: string; last: string; full: string },
  dateOfDeath: Date,
  city: string,
  userId: string,
) {
  const spouse = `${faker.person.firstName()} ${name.last}`;
  const kids = [`${faker.person.firstName()} ${name.last}`, `${faker.person.firstName()} ${faker.person.lastName()}`];
  const text =
    `${name.full}, ${faker.number.int({ min: 68, max: 96 })}, of ${city}, Nevada, passed away peacefully on ` +
    `${formatDateOnly(dateOfDeath)}. ${name.first} worked for many years as a ${faker.person.jobTitle().toLowerCase()} ` +
    `and loved ${faker.word.noun()} and family gatherings. ${name.first} is survived by spouse ${spouse}; ` +
    `children ${kids[0]} and ${kids[1]}. ${name.first} was predeceased by a brother, ${faker.person.firstName()} ${name.last}. ` +
    `(FICTIONAL OBITUARY — DEMO DATA)`;
  await prisma.evidence.create({
    data: {
      caseId,
      sourceType: "OBITUARY",
      title: `Obituary — ${name.full} (fictional)`,
      url: `https://obituaries.example.com/${name.first.toLowerCase()}-${name.last.toLowerCase()}`,
      supportsDeath: true,
      addedByUserId: userId,
      rawText: text,
      extractedFacts: {
        text,
        deceasedName: name.full,
        dateOfDeath: formatDateOnly(dateOfDeath),
        city,
        survivedBy: [
          { name: spouse, relationship: "SPOUSE" },
          { name: kids[0], relationship: "CHILD" },
          { name: kids[1], relationship: "CHILD" },
        ],
        predeceasedBy: [{ relationship: "SIBLING" }],
      },
    },
  });
  await prisma.owner.updateMany({
    where: { cases: { some: { id: caseId } } },
    data: { dateOfDeath, deathVerified: true, deathVerificationNote: "Fictional obituary (demo)" },
  });
}

async function addHeirs(caseId: string, lastName: string, userId: string) {
  const evidence = await prisma.evidence.findFirstOrThrow({ where: { caseId, supportsDeath: true } });
  const n = faker.number.int({ min: 1, max: 3 });
  for (let h = 0; h < n; h++) {
    const first = faker.person.firstName();
    const fullName = `${first} ${h === 0 ? lastName : faker.person.lastName()}`;
    const email = `${first.toLowerCase()}.${faker.string.alphanumeric(5).toLowerCase()}@example.com`;
    const addr = fakeAddress();
    await prisma.person.create({
      data: {
        caseId,
        fullName,
        normalizedName: fullName.toUpperCase(),
        relationship: faker.helpers.arrayElement(HEIR_RELATIONSHIPS),
        relationshipConfidence: faker.number.float({ min: 0.62, max: 0.97, fractionDigits: 2 }),
        status: h === 0 ? "CONFIRMED" : "CANDIDATE",
        emailEnc: encryptPii(email),
        emailHash: blindIndex(email),
        phoneEnc: encryptPii(`702-555-01${faker.string.numeric(2)}`),
        mailingAddressEnc: encryptPii(`${addr.line1}, ${addr.city}, NV ${addr.postalCode}`),
        sourceEvidenceIds: [evidence.id],
      },
    });
  }
  await writeAudit(prisma, {
    actor: { type: "USER", id: userId },
    action: "person.candidates_added",
    entityType: "Case",
    entityId: caseId,
    after: { count: n },
  });
}

/**
 * A first letter drafted by the real pipeline (templates, mock AI note, tone
 * check, checklist). Demo shortcut: it is marked approved and mailed (mock)
 * 18 days ago without the live checklist, because the demo ships with the
 * Nevada rules unverified. Real approvals go through the approval screen.
 */
async function addSentLetter(caseId: string, userId: string) {
  const person = await prisma.person.findFirstOrThrow({ where: { caseId, status: "CONFIRMED" } });
  const draft = await createDraft({ id: userId, role: "OWNER" }, { caseId, personId: person.id, channel: "MAIL" });
  const comm = await prisma.communication.findUniqueOrThrow({ where: { id: draft.id } });
  const approval = await prisma.approval.create({
    data: {
      subjectType: "COMMUNICATION",
      subjectId: comm.id,
      decision: "APPROVED",
      contentHash: comm.contentHash!,
      contentSnapshot: comm.textContent ?? "",
      checklist: ((comm.checklist as { items?: unknown } | null)?.items ?? []) as never,
      reason: "Demo data: seeded without the live checklist (demo rules are unverified).",
      approvedById: userId,
    },
  });
  await prisma.communication.update({ where: { id: comm.id }, data: { status: "APPROVED", approvalId: approval.id } });
  await prisma.communication.update({
    where: { id: comm.id },
    data: {
      status: "SENT",
      sentAt: addDays(todayIn(), -18),
      provider: "mock-mail",
      providerMessageId: `mock_ltr_${comm.id}`,
      deliveryStatus: "sent",
      events: [{ at: new Date().toISOString(), type: "sent", detail: "Mock mail (demo seed)" }],
    },
  });
  await prisma.notification.deleteMany({ where: { caseId, kind: "APPROVAL_NEEDED" } });
  await writeAudit(prisma, {
    actor: { type: "USER", id: userId },
    action: "communication.approved_and_sent",
    entityType: "Communication",
    entityId: comm.id,
    after: { approvalId: approval.id, contentHash: comm.contentHash, channel: "MAIL", provider: "mock-mail", demo: true },
  });
}

async function main() {
  await seedRules();
  const isProd = process.env.NODE_ENV === "production";
  if (process.env.SEED_DEMO === "false" || (isProd && process.env.ALLOW_DEMO_SEED !== "true")) {
    console.log("Skipping demo data (production or SEED_DEMO=false).");
    return;
  }
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
