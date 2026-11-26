import { describe, expect, it } from "vitest";
import { parseDateOnly } from "@/lib/dates";
import { assessDeathMatch } from "@/lib/research/death";
import { fmt, suggestIntestateHeirs, totalShare, type FamilyMember } from "@/lib/research/intestate";
import { extractObituaryHeuristic, quoteAppears, toPersonRelationship } from "@/lib/research/obituary";
import { NEVADA_RULES } from "@/lib/rules/jurisdictions";
import { IntestateSuccessionParams } from "@/lib/rules/schemas";
import { scoreCase } from "../../evals/obituary-extraction/score";

const NV = IntestateSuccessionParams.parse(NEVADA_RULES.find((r) => r.ruleType === "INTESTATE_SUCCESSION")!.params);
let n = 0;
const p = (name: string, relationship: FamilyMember["relationship"], extra: Partial<FamilyMember> = {}): FamilyMember => ({
  id: `p${++n}`, name, relationship, isPredeceased: false, rejected: false, parentPersonId: null, ...extra,
});
const shares = (r: ReturnType<typeof suggestIntestateHeirs>) => Object.fromEntries(r.heirs.map((h) => [h.name, fmt(h.share)]));

describe("Nevada intestate helper (research aid)", () => {
  it("spouse + one child: 1/2 each", () => {
    const r = suggestIntestateHeirs([p("Mary", "SPOUSE"), p("Tom", "CHILD")], NV);
    expect(shares(r)).toEqual({ Mary: "1/2", Tom: "1/2" });
    expect(r.notes.join(" ")).toMatch(/not legal advice/);
    expect(r.notes.join(" ")).toMatch(/community property/);
  });

  it("spouse + three children: spouse 1/3, children 2/9 each", () => {
    const r = suggestIntestateHeirs([p("Mary", "SPOUSE"), p("A", "CHILD"), p("B", "CHILD"), p("C", "CHILD")], NV);
    expect(shares(r)).toEqual({ Mary: "1/3", A: "2/9", B: "2/9", C: "2/9" });
    expect(fmt(totalShare(r.heirs))).toBe("1");
  });

  it("predeceased child's share goes to their children (per stirpes)", () => {
    const tom = p("Tom", "CHILD", { isPredeceased: true });
    const r = suggestIntestateHeirs(
      [p("Ann", "CHILD"), tom, p("Amy", "GRANDCHILD", { parentPersonId: tom.id }), p("Ben", "GRANDCHILD", { parentPersonId: tom.id })],
      NV,
    );
    expect(shares(r)).toEqual({ Ann: "1/2", Amy: "1/4", Ben: "1/4" });
  });

  it("a predeceased child with no known descendants drops out but is flagged for research", () => {
    const r = suggestIntestateHeirs([p("Ann", "CHILD"), p("Tom", "CHILD", { isPredeceased: true })], NV);
    expect(shares(r)).toEqual({ Ann: "1" });
    expect(r.needsResearch.join(" ")).toMatch(/whether Tom \(predeceased\) left children/);
  });

  it("spouse, no children, living parent: 1/2 and 1/2", () => {
    const r = suggestIntestateHeirs([p("Mary", "SPOUSE"), p("Dad", "PARENT"), p("Sis", "SIBLING")], NV);
    expect(shares(r)).toEqual({ Mary: "1/2", Dad: "1/2" });
  });

  it("spouse, no children or parents, siblings: spouse 1/2, siblings share 1/2", () => {
    const r = suggestIntestateHeirs([p("Mary", "SPOUSE"), p("Mom", "PARENT", { isPredeceased: true }), p("S1", "SIBLING"), p("S2", "SIBLING")], NV);
    expect(shares(r)).toEqual({ Mary: "1/2", S1: "1/4", S2: "1/4" });
  });

  it("spouse alone takes everything", () => {
    expect(shares(suggestIntestateHeirs([p("Mary", "SPOUSE")], NV))).toEqual({ Mary: "1" });
  });

  it("no spouse: children, then parents, then siblings (with nieces/nephews by representation)", () => {
    expect(shares(suggestIntestateHeirs([p("A", "CHILD"), p("Dad", "PARENT")], NV))).toEqual({ A: "1" });
    expect(shares(suggestIntestateHeirs([p("Mom", "PARENT"), p("Dad", "PARENT"), p("S", "SIBLING")], NV))).toEqual({ Mom: "1/2", Dad: "1/2" });
    const late = p("Late Sis", "SIBLING", { isPredeceased: true });
    expect(shares(suggestIntestateHeirs([p("Bro", "SIBLING"), late, p("Niece", "NIECE_NEPHEW", { parentPersonId: late.id })], NV))).toEqual({
      Bro: "1/2",
      Niece: "1/2",
    });
  });

  it("a living named beneficiary comes first", () => {
    const r = suggestIntestateHeirs([p("Ben", "NAMED_BENEFICIARY"), p("Mary", "SPOUSE")], NV);
    expect(r.mode).toBe("BENEFICIARY");
    expect(shares(r)).toEqual({ Ben: "1" });
  });

  it("rejected candidates are ignored; nothing found → unresolved", () => {
    const r = suggestIntestateHeirs([p("X", "CHILD", { rejected: true }), p("Cuz", "COUSIN")], NV);
    expect(r.mode).toBe("UNRESOLVED");
    expect(r.heirs).toEqual([]);
  });
});

describe("death match assessment", () => {
  const owner = {
    fullName: "Harold P Winslow",
    aliases: ["WINSLOW HAROLD P DECD"],
    dateOfBirth: parseDateOnly("1937-02-01"),
    cities: ["LAS VEGAS"],
    latestPropertyDate: parseDateOnly("2022-04-12"),
  };

  it("strong when name, city, age and timing all fit", () => {
    const ext = extractObituaryHeuristic(
      "Harold P. Winslow, 84, of Las Vegas, Nevada, passed away on March 3, 2021. He is survived by his wife, Margaret Winslow.",
    );
    const r = assessDeathMatch(owner, ext);
    expect(r.verdict).toBe("STRONG");
    expect(r.factors.map((f) => f.label).join(" | ")).toMatch(/lived in Las Vegas/);
  });

  it("weak when the age contradicts the birth year and the city differs", () => {
    const ext = extractObituaryHeuristic("Harold P. Winslow, 41, of Boise, Idaho, passed away on March 3, 2021.");
    expect(assessDeathMatch(owner, ext).verdict).not.toBe("STRONG");
  });

  it("not an obituary → weak with a reason", () => {
    const r = assessDeathMatch(owner, extractObituaryHeuristic("Garden club meets on Tuesday."));
    expect(r).toMatchObject({ confidence: 0, verdict: "WEAK" });
  });
});

describe("obituary helpers", () => {
  it("reads names whose middle initial has no period", () => {
    const e = extractObituaryHeuristic(
      "Harold P Winslow, 80, of Las Vegas, Nevada, passed away on November 2, 2016. Harold is survived by his spouse, Doris J Winslow; and sibling, Ruth Winslow.",
    );
    expect(e.deceased.fullName).toBe("Harold P Winslow");
    expect(e.relatives.map((r) => r.name)).toEqual(["Doris J Winslow", "Ruth Winslow"]);
  });

  it("maps extracted relationships to heir categories", () => {
    expect(toPersonRelationship("CHILD")).toBe("CHILD");
    expect(toPersonRelationship("GREAT_GRANDCHILD")).toBe("GRANDCHILD");
    expect(toPersonRelationship("IN_LAW")).toBe("OTHER");
    expect(toPersonRelationship("STEP_CHILD")).toBe("OTHER");
  });

  it("checks that evidence quotes really occur in the text", () => {
    const text = "He is survived by his wife, Margaret Winslow; his son, David.";
    expect(quoteAppears("his wife, Margaret Winslow", text)).toBe(true);
    expect(quoteAppears("his daughter, Ellen", text)).toBe(false);
  });

  it("eval scorer gives partial credit and lists misses", () => {
    const s = scoreCase(
      { isObituary: true, fullName: "A B", dateOfDeath: "2020-01-01", residenceCity: "Reno", relatives: [{ name: "C D", relationship: "CHILD", status: "SURVIVING" }] },
      { isObituary: true, deceased: { fullName: "A B", dateOfDeath: null, residenceCity: "Reno" }, relatives: [] },
    );
    expect(s.score).toBeCloseTo(0.25);
    expect(s.details).toMatch(/missed: C D/);
  });
});
