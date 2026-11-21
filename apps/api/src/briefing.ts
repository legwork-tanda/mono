import type { TradeId } from "@legwork/shared";

// The briefing protocol: what a tradie asks before they'll put a price on a job.
//
// The intake model plans its own questions, and it is good at the odd ones
// ("Is the leak at the base or the spout?"). What it was bad at was the boring
// ones every tradie asks: a painter quoting a bedroom wants to know how big the
// room is, which surfaces, and whether the walls need patching, and the model
// would cheerfully skip all three and write the job up.
//
// So each trade carries a quote sheet. The model sees every sheet (it is in the
// cached system prompt). For the trade it picks, each item has to be settled
// one of three ways: already known (a fact under the sheet's label), asked (a
// question that `covers` the label), or not needed for this job. Any required
// item it leaves open is asked here, from the sheet, with fixed tap answers and
// no extra model call. The model asks what's specific; the sheet guarantees the
// basics.

export type SheetItem = {
  /** The fact label, used exactly in `known`, `missing`, `covers` and `not_needed`. */
  label: string;
  /** The question a customer can answer at a glance, asked when the model leaves this open. */
  prompt: string;
  options: string[];
  multi?: boolean;
  /** Changes the price enough that a tradie won't quote without it. Only required items are backstopped. */
  required: boolean;
  /** When set, the item only applies to jobs whose words match. Without it, it applies to every job in the trade. */
  match?: RegExp;
  /** The item doesn't apply when the job's words match this (e.g. room sizes on an outside-only paint job). */
  unless?: RegExp;
  /** For the model: why a tradie asks, in a few words. */
  why: string;
};

const INSIDE = /\b(inside|interior|internal|room|rooms|bedroom|lounge|living|kitchen|bathroom|hall|hallway|study|ceiling|walls?|unit|apartment|flat|townhouse)\b/i;
const OUTSIDE_ONLY = /\b(outside only|exterior only|just the outside)\b|^\s*outside\s*$/im;
const OUTSIDE = /\b(outside|exterior|external|eaves|fascia|weatherboards?|render|front of the house|facade)\b/i;
const HOT_WATER = /\b(hot water|hws|water heater|heater unit|no hot)\b/i;
const DRAIN = /\b(block(ed|age)?|clog(ged)?|drain(s|ing)?|slow to drain|backing up|overflow(ing)?|sewer)\b/i;
const LEAK = /\b(leak(s|ing)?|drip(s|ping)?|burst|water (coming|pouring|everywhere)|flood(ed|ing)?)\b/i;
const FITTINGS = /\b(lights?|downlights?|power ?points?|gpos?|outlets?|sockets?|switch(es)?|fans?|ceiling fans?|smoke alarms?|smoke detectors?)\b/i;
const OVERHEAD = /\b(lights?|downlights?|fans?|ceiling fans?|smoke alarms?|smoke detectors?|antenna)\b/i;
const POWER_FAULT = /\b(no power|power(s)? (out|off|gone)|trip(s|ped|ping)?|safety switch|outage|blackout|fault|half the house)\b/i;
const FENCE = /\b(fenc(e|es|ing)|gate)\b/i;
const YARD = /\b(lawns?|gardens?|yards?|mow(ing)?|turf|hedges?|landscap(e|ing)|weeds?|green waste)\b/i;
const GUTTER = /\b(gutters?|downpipes?)\b/i;
const LOCKED_OUT = /\b(locked out|lock(ed)? (myself|my keys)|lost (my |the )?keys?|can'?t get (in|inside))\b/i;
const REKEY = /\b(re-?key(ing)?|change (the |all )?locks?|new locks?|replace (the |a )?locks?)\b/i;
const COOKING = /\b(oven|cooktop|stove|hob|range)\b/i;
const ASSEMBLY = /\b(assembl(e|y)|flat ?pack|ikea)\b/i;

export const QUOTE_SHEETS: Record<TradeId, SheetItem[]> = {
  plumbing: [
    { label: "Fixture", prompt: "What needs the plumber?", options: ["Tap", "Toilet", "Drain", "Hot water", "Pipe"], required: true, why: "which job it is" },
    { label: "Leaking now", prompt: "Is water leaking right now?", options: ["Yes", "No", "Not sure"], required: true, match: LEAK, why: "same-day or scheduled" },
    { label: "Hot water type", prompt: "What kind of hot water system?", options: ["Electric", "Gas", "Solar", "Heat pump", "Not sure"], required: true, match: HOT_WATER, why: "licence, parts and price differ by type" },
    { label: "Household size", prompt: "How many people live there?", options: ["1–2", "3–4", "5 or more"], required: true, match: HOT_WATER, why: "sizes a replacement tank" },
    { label: "Drains affected", prompt: "Is it one drain or several?", options: ["One drain", "Several drains", "Not sure"], required: true, match: DRAIN, why: "several means the main line, a bigger job" },
  ],
  electrical: [
    { label: "Job", prompt: "What do you need the electrician for?", options: ["Lights", "Power points", "Fault or no power", "Fans", "Smoke alarms"], required: true, why: "which job it is" },
    { label: "Quantity", prompt: "How many need doing?", options: ["1", "2–3", "4–6", "More than 6"], required: true, match: FITTINGS, why: "price is per fitting" },
    { label: "Storeys", prompt: "Single or double storey?", options: ["Single storey", "Double storey"], required: true, match: OVERHEAD, why: "roof-space access for cabling" },
    { label: "Power out", prompt: "Is any power out right now?", options: ["Some of the house", "All of it", "No"], required: true, match: POWER_FAULT, why: "an outage is urgent and changes the callout" },
    { label: "Wiring in place", prompt: "Replacing old ones or all new?", options: ["Replacing", "New", "Not sure"], required: false, match: FITTINGS, why: "new runs take far longer than swaps" },
  ],
  painting: [
    { label: "Inside or outside", prompt: "Inside or outside?", options: ["Inside", "Outside", "Both"], required: true, why: "different prep, gear and paint" },
    { label: "Rooms", prompt: "How many rooms?", options: ["1 room", "2–3 rooms", "4–6 rooms", "Whole house"], required: true, unless: OUTSIDE_ONLY, why: "the main driver of time" },
    { label: "Room size", prompt: "How big are the rooms?", options: ["Small, like a bedroom", "Medium, like a lounge", "Large or open plan", "A mix"], required: true, unless: OUTSIDE_ONLY, why: "paint and hours scale with area" },
    { label: "Surfaces", prompt: "What needs painting?", options: ["Walls", "Ceilings", "Doors and trim", "Skirting boards"], multi: true, required: true, why: "each surface is priced separately" },
    { label: "Wall condition", prompt: "Any cracks, holes or peeling?", options: ["None", "A few", "Lots"], required: true, why: "patching and prep time" },
    { label: "Colour change", prompt: "Same colour or a change?", options: ["Similar colour", "Going lighter", "Going darker", "Not sure"], required: true, why: "a big change needs extra coats" },
    { label: "Storeys", prompt: "Single or double storey?", options: ["Single storey", "Double storey"], required: true, match: OUTSIDE, why: "scaffold or ladders" },
    { label: "Ceiling height", prompt: "Are the ceilings high?", options: ["Standard", "High or raked"], required: false, unless: OUTSIDE_ONLY, why: "high ceilings need a scaffold" },
    { label: "Furniture", prompt: "Will the rooms be empty?", options: ["Empty", "Furniture in"], required: false, unless: OUTSIDE_ONLY, why: "moving and covering time" },
  ],
  carpentry_handyman: [
    { label: "Job count", prompt: "One job or a list?", options: ["One job", "A few small jobs", "A long list"], required: true, why: "half-day versus full-day booking" },
    { label: "Parts supplied", prompt: "Do you have the parts?", options: ["Yes", "No", "Not sure"], required: true, why: "who buys materials" },
    { label: "Items to assemble", prompt: "How many items to put together?", options: ["1", "2–3", "4 or more"], required: true, match: ASSEMBLY, why: "price is per item" },
    { label: "Size", prompt: "Roughly how big is it?", options: ["Small", "Medium", "Large"], required: false, why: "time and materials" },
  ],
  roofing_gutters: [
    { label: "Storeys", prompt: "Single or double storey?", options: ["Single storey", "Double storey", "Higher"], required: true, why: "height safety gear and time" },
    { label: "Roof type", prompt: "What's the roof made of?", options: ["Tiles", "Metal", "Not sure"], required: true, why: "different repair methods and parts" },
    { label: "Leaking now", prompt: "Is it leaking inside now?", options: ["Yes", "No", "Only in heavy rain"], required: true, match: LEAK, why: "same-day or scheduled" },
    { label: "Gutter length", prompt: "How much guttering?", options: ["One side", "Two sides", "Whole house"], required: true, match: GUTTER, why: "priced by the metre" },
  ],
  tiling: [
    { label: "Room", prompt: "Which room?", options: ["Bathroom", "Kitchen", "Laundry", "Outside", "Other room"], required: true, why: "wet areas need waterproofing" },
    { label: "Area size", prompt: "Roughly how big is the area?", options: ["A few tiles", "Splashback size", "Bathroom size", "A whole room or more"], required: true, why: "priced by the square metre" },
    { label: "Old tiles", prompt: "Are old tiles coming up?", options: ["Yes", "No", "Not sure"], required: true, why: "removal is a day on its own" },
    { label: "Tiles supplied", prompt: "Do you have the tiles?", options: ["Yes", "Not yet", "Need help choosing"], required: true, why: "who buys materials" },
  ],
  locksmith: [
    { label: "Locked out", prompt: "Are you locked out now?", options: ["Yes", "No"], required: true, match: LOCKED_OUT, why: "emergency callout" },
    { label: "Lock location", prompt: "Where's the lock?", options: ["Front door", "Sliding door", "Window", "Garage", "Safe or other"], required: true, why: "lock types and parts differ" },
    { label: "Lock count", prompt: "How many locks?", options: ["1", "2–3", "4 or more"], required: true, match: REKEY, why: "price is per lock" },
  ],
  appliance_repair: [
    { label: "Appliance", prompt: "Which appliance?", options: ["Washing machine", "Dishwasher", "Oven or cooktop", "Fridge", "Dryer"], required: true, why: "which technician" },
    { label: "Age", prompt: "How old is it?", options: ["Under 5 years", "5–10 years", "Over 10 years", "Not sure"], required: true, why: "repair or replace" },
    { label: "Fuel", prompt: "Gas or electric?", options: ["Gas", "Electric", "Induction", "Not sure"], required: true, match: COOKING, why: "gas work needs a gas licence" },
    { label: "Built in", prompt: "Is it built in?", options: ["Built in", "Freestanding"], required: false, why: "removal time" },
  ],
  plastering: [
    { label: "Wall or ceiling", prompt: "Wall or ceiling?", options: ["Wall", "Ceiling", "Both"], required: true, why: "ceilings take longer and need gear" },
    { label: "Damage size", prompt: "How big is the damage?", options: ["Fist-sized", "Up to a metre", "A whole wall", "A whole ceiling"], required: true, why: "patch versus new sheet" },
    { label: "Spots", prompt: "How many spots?", options: ["One", "2–3", "Lots"], required: true, why: "each spot is a patch" },
    { label: "Painting after", prompt: "Painted afterwards too?", options: ["Yes", "No", "Not sure"], required: true, why: "a painter may be needed after" },
  ],
  fencing_landscaping: [
    { label: "Fence length", prompt: "How long is the fence?", options: ["Under 10 m", "10–30 m", "Over 30 m", "Not sure"], required: true, match: FENCE, why: "priced by the metre" },
    { label: "Fence material", prompt: "What kind of fence?", options: ["Colorbond", "Timber", "Pool fence", "Not sure"], required: true, match: FENCE, why: "materials and method differ" },
    { label: "Old fence removal", prompt: "Is an old fence coming out?", options: ["Yes", "No"], required: true, match: FENCE, why: "removal and disposal" },
    { label: "Yard size", prompt: "How big is the yard?", options: ["Small", "Medium", "Large"], required: true, match: YARD, why: "hours on site" },
    { label: "Green waste", prompt: "Take the green waste away?", options: ["Yes", "No"], required: false, match: YARD, why: "tip fees" },
    { label: "Access", prompt: "Can a trailer get in?", options: ["Yes", "No", "Not sure"], required: false, why: "barrowing everything takes longer" },
  ],
};

/** Most questions a planning round may ask in all, the model's own plus the sheet's. */
export const BRIEF_MAX = 6;

/** Case- and punctuation-blind label key, so "Room size" and "room size:" match. */
export const labelKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The sheet items that apply to this job, given everything said about it. */
export function applicableItems(trade: TradeId, jobText: string): SheetItem[] {
  return (QUOTE_SHEETS[trade] ?? []).filter((item) => (!item.match || item.match.test(jobText)) && !(item.unless && item.unless.test(jobText)));
}

/**
 * The required items still open after the model's planning: not known, not
 * asked, and not declared unneeded. In sheet order, which is the order a
 * tradie would ask them.
 */
export function openItems(trade: TradeId | null | undefined, jobText: string, settled: Iterable<string>): SheetItem[] {
  if (!trade) return [];
  const done = new Set([...settled].map(labelKey));
  return applicableItems(trade, jobText).filter((item) => item.required && !done.has(labelKey(item.label)));
}

/** The sheets as a compact block for the system prompt. */
export function sheetsForPrompt(): string {
  return Object.entries(QUOTE_SHEETS)
    .map(([trade, items]) => {
      const rows = items.map((i) => {
        const scope = i.match ? ` (only when relevant)` : i.unless ? ` (not for outside-only jobs)` : "";
        return `  - ${i.label}${i.required ? "" : " [nice to have]"}${scope}: ${i.why}`;
      });
      return `${trade}:\n${rows.join("\n")}`;
    })
    .join("\n");
}
