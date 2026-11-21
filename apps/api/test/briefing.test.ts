import { describe, expect, it } from "vitest";
import { applicableItems, BRIEF_MAX, openItems, QUOTE_SHEETS } from "../src/briefing";
import { streamIntakeRound, type NextQuestion } from "../src/intake";
import { choice, fakeClaude, plan } from "./fake-claude";

const fact = (label: string, value: string) => ({ label, value, source: "given" as const });
const run = async (reply: object, description: string) => {
  const claude = fakeClaude(reply);
  const asked: NextQuestion[] = [];
  const result = await streamIntakeRound(claude.model, { description, steps: [], photos: [] }, "planning", async (q) => {
    asked.push(q);
  });
  return { claude, asked, result };
};

describe("the briefing protocol: what a tradie asks before quoting", () => {
  it("asks a painter's basics the model skipped, room size included", async () => {
    const reply = { ...plan([fact("Inside or outside", "Inside"), fact("Rooms", "1 room")], []), trade: "painting", not_needed: [] };
    const { asked, result } = await run(reply, "Repaint my bedroom");
    expect(asked.map((q) => q.prompt)).toEqual(["How big are the rooms?", "What needs painting?", "Any cracks, holes or peeling?", "Same colour or a change?"]);
    expect(asked[1]!.type).toBe("multi_choice");
    expect(result.kind === "questions" && result.count).toBe(4);
    // The write-up is told these are essentials to account for.
    expect(result.kind === "questions" && result.essentials?.missing).toEqual(["Room size", "Surfaces", "Wall condition", "Colour change"]);
  });

  it("doesn't repeat what the model asked itself or declared not needed", async () => {
    const own = { ...choice("Bedroom size?", ["Small", "Medium", "Large"]), covers: "Room size" };
    const reply = {
      ...plan([fact("Inside or outside", "Inside"), fact("Rooms", "1 room"), fact("Surfaces", "Walls")], [], own),
      trade: "painting",
      not_needed: ["Colour change"],
    };
    const { asked } = await run(reply, "Paint the walls in my bedroom");
    expect(asked.map((q) => q.prompt)).toEqual(["Bedroom size?", "Any cracks, holes or peeling?"]);
  });

  it("leaves room sizes off an outside-only paint job and asks about storeys", () => {
    // Facts reach the matcher as values, one per line: the answer to "Inside or outside?".
    const text = "Paint the house\nOutside";
    const labels = applicableItems("painting", text).map((i) => i.label);
    expect(labels).toContain("Storeys");
    expect(labels).not.toContain("Room size");
  });

  it("only asks trade items that fit the job", () => {
    expect(openItems("plumbing", "Kitchen tap drips", ["Fixture"]).map((i) => i.label)).toEqual(["Leaking now"]);
    expect(openItems("plumbing", "Hot water died", ["Fixture"]).map((i) => i.label)).toEqual(["Hot water type", "Household size"]);
    expect(openItems(null, "anything", [])).toEqual([]);
  });

  it("keeps the photos question last and holds the round cap", async () => {
    const photos = { type: "photos", prompt: "Add a photo of the walls", helper: null, options: [], placeholder: null, covers: null };
    const reply = { ...plan([], [], photos), trade: "painting", not_needed: [] };
    const { asked } = await run(reply, "Need some painting done");
    expect(asked.at(-1)!.type).toBe("photos");
    expect(asked.length).toBeLessThanOrEqual(BRIEF_MAX + 1);
  });

  it("drops sheet labels that don't fit the job from what's missing", async () => {
    const reply = { ...plan([fact("Job", "Lights"), fact("Quantity", "4–6"), fact("Storeys", "Single storey")], ["Power out", "Wiring in place", "Switch type"]), trade: "electrical", not_needed: [] };
    const { result } = await run(reply, "Install downlights in the kitchen");
    expect(result.kind === "questions" && result.essentials?.missing).toEqual(["Wiring in place", "Switch type"]);
  });

  it("asks nothing extra when the trade isn't clear yet", async () => {
    const { asked } = await run({ ...plan([], []), trade: null, not_needed: [] }, "Something's broken");
    expect(asked).toEqual([]);
  });

  it("gives every trade a sheet with answerable questions", () => {
    for (const items of Object.values(QUOTE_SHEETS)) {
      for (const item of items) {
        expect(item.options.length).toBeGreaterThanOrEqual(2);
        expect(item.prompt.split(" ").length).toBeLessThanOrEqual(8);
      }
    }
  });
});
