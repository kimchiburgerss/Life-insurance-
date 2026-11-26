import { describe, expect, it } from "vitest";
import { normalizeAddress } from "@/lib/normalize/address";
import { parseOwnerName } from "@/lib/normalize/name";
import { areNicknameEquivalent } from "@/lib/match/nicknames";
import { ownerMatchKeys, scoreOwnerMatch, type MatchableOwner } from "@/lib/match/owner";
import { jaroWinkler, soundex } from "@/lib/match/similarity";

function owner(name: string, address?: string): MatchableOwner {
  const n = parseOwnerName(name);
  return {
    tokens: n.tokens,
    suffix: n.suffix,
    address: address ? normalizeAddress({ kind: "single", value: address }) : null,
  };
}

describe("string similarity primitives", () => {
  it("Jaro-Winkler reference values", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("DWAYNE", "DUANE")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("SMITH", "SMITH")).toBe(1);
    expect(jaroWinkler("", "ABC")).toBe(0);
  });

  it("Soundex reference values", () => {
    expect(soundex("ROBERT")).toBe("R163");
    expect(soundex("RUPERT")).toBe("R163");
    expect(soundex("ASHCRAFT")).toBe("A261");
    expect(soundex("TYMCZAK")).toBe("T522");
    expect(soundex("PFISTER")).toBe("P236");
  });

  it("nicknames", () => {
    expect(areNicknameEquivalent("BILL", "WILLIAM")).toBe(true);
    expect(areNicknameEquivalent("PEGGY", "MARGARET")).toBe(true);
    expect(areNicknameEquivalent("BILL", "ROBERT")).toBe(false);
  });
});

describe("blocking keys", () => {
  it("are order-insensitive and nickname-canonical", () => {
    const a = ownerMatchKeys(parseOwnerName("SMITH WILLIAM J").tokens);
    const b = ownerMatchKeys(parseOwnerName("BILL SMITH").tokens);
    expect(a.some((k) => b.includes(k))).toBe(true);
  });
});

describe("owner matching", () => {
  const ADDR = "123 Main St, Las Vegas, NV 89101";

  it("auto-merges the same name in reversed order at the same address", () => {
    const r = scoreOwnerMatch(owner("ESTATE OF JOHN A SMITH", ADDR), owner("SMITH JOHN A DECD", "123 MAIN STREET LAS VEGAS NV 89101"));
    expect(r.decision).toBe("AUTO");
    expect(r.reasons).toContain("same street address");
  });

  it("sends nickname matches in the same ZIP to human review (never auto)", () => {
    const r = scoreOwnerMatch(owner("WILLIAM R JONES", ADDR), owner("BILL JONES", "9 Elm St, Las Vegas, NV 89101"));
    expect(r.decision).toBe("REVIEW");
    expect(r.reasons.join(" ")).toMatch(/nickname (BILL ≈ WILLIAM|WILLIAM ≈ BILL)/);
  });

  it("auto-merges an exact name in the same ZIP even at a different street", () => {
    const r = scoreOwnerMatch(owner("JOHN A SMITH", ADDR), owner("SMITH, JOHN A", "9 Elm St, Las Vegas, NV 89101"));
    expect(r.decision).toBe("AUTO");
  });

  it("never auto-merges without address agreement", () => {
    const r = scoreOwnerMatch(owner("JOHN A SMITH", ADDR), owner("JOHN A SMITH"));
    expect(r.decision).toBe("REVIEW");
    expect(r.reasons).toContain("address missing on one side");
  });

  it("JR vs SR at the same address is not merged automatically", () => {
    const r = scoreOwnerMatch(owner("JOHN SMITH JR", ADDR), owner("JOHN SMITH SR", ADDR));
    expect(r.decision).not.toBe("AUTO");
    expect(r.reasons.join(" ")).toMatch(/parent and child/);
  });

  it("different middle initials are a conflict", () => {
    const r = scoreOwnerMatch(owner("JOHN A SMITH", ADDR), owner("JOHN B SMITH", ADDR));
    expect(r.decision).not.toBe("AUTO");
  });

  it("small typos still match for review", () => {
    const r = scoreOwnerMatch(owner("KATHERINE MCDONALD", ADDR), owner("KATHERINE MCDONALDS", "77 Oak Ave, Reno, NV 89501"));
    expect(r.decision).toBe("REVIEW");
  });

  it("different people do not match", () => {
    expect(scoreOwnerMatch(owner("JOHN SMITH", ADDR), owner("MARIA GARCIA", ADDR)).decision).toBe("NONE");
    expect(scoreOwnerMatch(owner("JOHN SMITH", ADDR), owner("JANE SMITH", "4 Pine Rd, Elko, NV 89801")).decision).toBe("NONE");
  });
});
