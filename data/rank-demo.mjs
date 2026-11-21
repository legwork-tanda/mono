#!/usr/bin/env node
// Runs Will's two algorithms (Legwork_Matching_Algorithms.pdf) against
// data/legwork-demo.json, as a way of proving the mock data actually feeds the
// engine rather than just filling a screen.
//
//   node data/rank-demo.mjs            # every demo job
//   node data/rank-demo.mjs demo-01    # one job
//
// Algorithm 1 = who gets invited to bid (eligibility gate, then a ranking).
// Algorithm 2 = of the Pros who bid, who wins.
//
// The PDF names the signals but not the weights, so the weights below are a
// starting proposal, kept in one object at the top of each function. Change
// them in one place when Will or the judges push back.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "legwork-demo.json"), "utf8"));
const byId = new Map(data.tradies.map((t) => [t.id, t]));

const ALGO1 = { fit: 0.3, reputation: 0.2, reliability: 0.25, availability: 0.15, propensity: 0.1 };
const ALGO2 = { price: 0.3, fit: 0.2, reputation: 0.15, reliability: 0.2, availability: 0.1, bidQuality: 0.05 };

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const rand = (s) => hash(s) / 2 ** 32;

// ------------------------------------------------------- Algorithm 1 ------
// Eligibility: the gate. Fails here and the Pro is never ranked.
function eligible(tradie, job) {
  const fails = [];
  if (!tradie.trades.includes(job.writeUp.trade)) fails.push("trade");
  if (job.writeUp.severity > tradie.maxSeverity) fails.push("severity");
  if (!tradie.licence?.number) fails.push("licence");
  const postcode = job.customerSuburb;
  if (!tradie.serviceAreas.includes(postcode)) fails.push("area");
  if (job.tier === "high" && !tradie.availableNow) fails.push("not free now");
  return fails;
}

// Job fit: does this Pro do this exact kind of work, not just the trade.
const stem = (s) => s.toLowerCase().replace(/s\b/g, "");
function jobFit(tradie, job) {
  // Match on the head noun of each skill against the job text, both directions,
  // so "lockouts" matches "locked out" and "dishwashers" matches "dishwasher".
  const words = stem(`${job.writeUp.title} ${job.writeUp.summary}`);
  const hits = tradie.skills.filter((s) => {
    const head = stem(s.split(/[\s/]+/)[0]);
    return head.length > 3 && (words.includes(head) || words.includes(stem(s.split(/[\s/]+/).at(-1))));
  });
  const skillScore = clamp01(hits.length / 2);
  const expScore = clamp01(tradie.experienceYears / 20);
  return 0.7 * skillScore + 0.3 * expScore;
}

// Reputation: Google first, shrunk toward the market mean so 6 five-star
// reviews cannot outrank 180 at 4.8 (the PDF says exactly this).
function reputation(tradie) {
  const { google, googleReviews } = tradie.reputation;
  const C = 4.3;
  const m = 20;
  const shrunk = (googleReviews * google + m * C) / (googleReviews + m);
  return clamp01((shrunk - 3.5) / 1.5);
}

function reliability(tradie) {
  const r = tradie.reliability;
  const exposure = clamp01(r.jobsCompleted / 200);
  const bad = clamp01((r.cancellations + r.noShows * 2 + r.disputes) / Math.max(20, r.jobsCompleted * 0.1));
  return clamp01(0.5 * (r.onTimePct / 100) + 0.4 * (r.quoteAccuracyPct / 100) + 0.1 * exposure - 0.35 * bad);
}

function availability(tradie, job) {
  const hours = job.tier === "high" ? 0 : job.tier === "medium" ? 24 : 72;
  const start = tradie.earliestStartHours;
  if (hours === 0) return tradie.availableNow ? 1 : 0;
  return clamp01(1 - start / (hours * 2));
}

function algo1(tradie, job) {
  const parts = {
    fit: jobFit(tradie, job),
    reputation: reputation(tradie),
    reliability: reliability(tradie),
    availability: availability(tradie, job),
    propensity: tradie.bidPropensity,
  };
  const score = Object.entries(ALGO1).reduce((n, [k, w]) => n + w * parts[k], 0);
  return { parts, score };
}

// ------------------------------------------------------- Algorithm 2 ------
// How a bid reads against a private price anchor (the middle of the range the
// customer saw). A bid far under the anchor is not automatically good: the PDF
// says to check it for a scope mismatch instead.
function priceScore(quote, anchor) {
  const mid = (anchor.min + anchor.max) / 2;
  const ratio = quote / mid;
  if (ratio < 0.8) return { score: 0.45, note: "under anchor — confirm the scope covers the whole job" };
  if (ratio <= 1.05) return { score: 1, note: "in line with the anchor" };
  if (ratio <= 1.25) return { score: 0.75, note: "above the anchor" };
  return { score: clamp01(1 - (ratio - 1.25)), note: "well above the anchor" };
}

// A simulated bid. Real Pros choose; this stands in until the Pro app exists.
function bid(tradie, job, index) {
  const anchor = job.writeUp.prices[job.tier];
  const position = { cheap: 0.93, mid: 1.0, premium: 1.08 }[tradie.pricePosition];
  const jitter = 0.97 + rand(`${job.id}:${tradie.id}:bid`) * 0.06;
  const quote = Math.round((((anchor.min + anchor.max) / 2) * position * jitter) / 5) * 5;
  const clarity = 0.7 + rand(`${job.id}:${tradie.id}:quality`) * 0.3;
  const delayMin = 1 + Math.round(rand(`${job.id}:${tradie.id}:delay`) * 12);
  return { tradie, quote, clarity, delayMin, index };
}

function algo2(b, job) {
  const a1 = algo1(b.tradie, job);
  const price = priceScore(b.quote, job.writeUp.prices[job.tier]);
  const parts = {
    price: price.score,
    fit: a1.parts.fit,
    reputation: a1.parts.reputation,
    reliability: a1.parts.reliability,
    availability: a1.parts.availability,
    bidQuality: b.clarity,
  };
  const score = Object.entries(ALGO2).reduce((n, [k, w]) => n + w * parts[k], 0);
  return { parts, score, note: price.note };
}

// ------------------------------------------------------------------ run ---
const wanted = process.argv[2];
const jobs = data.jobs.filter((j) => !wanted || j.id === wanted);

for (const job of jobs) {
  const customer = data.customers.find((c) => c.id === job.customerId);
  const withSuburb = { ...job, customerSuburb: customer.suburb };
  const tradies = data.tradies.map((t) => ({ t, fails: eligible(t, withSuburb) }));
  const pool = tradies
    .filter((x) => x.fails.length === 0)
    .map((x) => ({ tradie: x.t, ...algo1(x.t, withSuburb) }))
    .sort((a, b) => b.score - a.score);

  console.log(`\n=== ${job.id} · ${job.writeUp.title}`);
  console.log(`    ${customer.name}, ${customer.suburb} · ${job.writeUp.trade} · severity ${job.writeUp.severity} · ${job.tier} · ${job.requiredDate}`);
  const p = job.writeUp.prices[job.tier];
  console.log(`    quoted range $${p.min}–$${p.max} (${job.writeUp.priceReason})`);
  console.log(`    gate: ${pool.length} eligible / ${tradies.length} in the network`);

  console.log("  Algorithm 1 — who gets invited (top 4):");
  for (const r of pool.slice(0, 4)) {
    const x = r.parts;
    console.log(
      `    ${r.tradie.business.padEnd(28)} ${r.score.toFixed(3)}  fit ${x.fit.toFixed(2)} rep ${x.reputation.toFixed(2)} rel ${x.reliability.toFixed(2)} avail ${x.availability.toFixed(2)} bid ${x.propensity.toFixed(2)}`,
    );
  }

  const invited = pool.slice(0, 4);
  const bids = invited.filter((r) => rand(`${job.id}:${r.tradie.id}:accept`) < r.tradie.bidPropensity * 0.9);
  const ranked = bids.map((b, i) => ({ ...bid(b.tradie, withSuburb, i), ...algo2(bid(b.tradie, withSuburb, i), withSuburb) }))
    .sort((a, b) => b.score - a.score);

  console.log(`  Algorithm 2 — ${ranked.length} of ${invited.length} bid:`);
  for (const r of ranked) {
    console.log(
      `    ${r.tradie.business.padEnd(28)} $${String(r.quote).padEnd(5)} ${r.score.toFixed(3)}  price ${r.parts.price.toFixed(2)} rel ${r.parts.reliability.toFixed(2)} fit ${r.parts.fit.toFixed(2)}  · ${r.note}`,
    );
  }
  if (ranked[0]) {
    const w = ranked[0];
    const why = [];
    if (w.parts.reliability >= 0.8) why.push("strongest delivery record");
    if (w.parts.price >= 1) why.push("quote in line with the anchor");
    if (w.parts.fit >= 0.5) why.push("does this exact work");
    console.log(`  → match: ${w.tradie.name} (${w.tradie.business}) at $${w.quote}, ${w.tradie.responseMinutes} min typical reply — ${why.join(", ") || "best overall combination"}`);
  } else {
    console.log("  → no valid bids: widen the wave or move tier up");
  }

  // Only same-trade rejections are interesting: they are the Pros who could
  // have done the job but failed the gate for a reason worth showing.
  const sameTrade = tradies.filter((x) => x.t.trades.includes(job.writeUp.trade));
  const excluded = sameTrade.filter((x) => x.fails.length);
  console.log(
    `  same-trade gate: ${sameTrade.length - excluded.length}/${sameTrade.length} pass` +
      (excluded.length ? ` — rejected: ${excluded.map((x) => `${x.t.business} (${x.fails.join(", ")})`).join("; ")}` : ""),
  );
}
