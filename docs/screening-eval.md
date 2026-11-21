# Screening model evaluation (#98)

Before intake plans or prices a job, a small classifier checks that the request describes work for a tradie (`apps/api/src/screen.ts`). It returns `work`, `unclear` (ask "What would you like fixed or installed?") or `invalid` (spam, nonsense, or "everything works, just testing", which keeps pricing and matching blocked).

## Method

- Labelled set: `apps/api/test/fixtures/screen-requests.json`, 38 requests. 21 are genuine (terse ones, Australian slang, symptoms only, and trades we don't cover such as pools and pest control), 5 are unclear, and 12 are invalid (spam, keyboard mashing, explicit no-work, prompt injection, off-topic questions, and "my plumbing is fine, nothing leaks"). Three are two-turn cases: an unclear request plus the reply to the clarifying question.
- Script: `node apps/api/scripts/eval-screen.ts [model ...]`. It uses the same system prompt, strict JSON schema and OpenRouter request as the API (`reasoning: minimal`, `provider: { sort: "latency", require_parameters: true }`), sends 4 requests at a time, and makes one warm-up call per model first. Latency is the full round trip measured by the client.
- Candidates were the issue's Jev (`typesafe/jev-router`) plus four fast, cheap models from the OpenRouter catalogue that support structured outputs. The models were checked on 2026-11-21.

## Results

Run 1 (all candidates):

| Model | Correct | Missed invalid | Genuine blocked | Genuine asked to clarify | Unclear asked | Errors | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `google/gemini-3.5-flash-lite` | 38/38 | 0/12 | 0/21 | 0 | 5/5 | 0 | 1001 | 1577 |
| `z-ai/glm-5.3-flash` | 38/38 | 0/12 | 0/21 | 0 | 5/5 | 0 | 897 | 1387 |
| `openai/gpt-6-luna` | 38/38 | 0/12 | 0/21 | 0 | 5/5 | 0 | 1239 | 4433 |
| `typesafe/jev-router` (Jev) | 37/38 | 0/12 | 0/21 | 0 | 5/5 | 0 | 1717 | 3645 |
| `anthropic/claude-haiku-5.5` | 36/38 | 0/12 | 0/21 | 1 | 5/5 | 0 | 1523 | 1797 |

Run 2 (the top four again):

| Model | Correct | Missed invalid | Genuine blocked | Genuine asked to clarify | Unclear asked | Errors | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `google/gemini-3.5-flash-lite` | 38/38 | 0/12 | 0/21 | 0 | 5/5 | 0 | 721 | 944 |
| `z-ai/glm-5.3-flash` | 38/38 | 0/12 | 0/21 | 0 | 5/5 | 0 | 917 | 1557 |
| `openai/gpt-6-luna` | 37/38 | 0/12 | 0/21 | 1 | 5/5 | 0 | 685 | 1519 |
| `typesafe/jev-router` (Jev) | 36/38 | 0/12 | 0/21 | 1 | 5/5 | 0 | 1045 | 1986 |

The misses were all mild:
- Jev twice read "my fence" followed by "nah all good" as `unclear` instead of `invalid`. Both outcomes keep the job blocked, because a second `unclear` asks for the job again.
- Jev, Luna and Haiku each sometimes asked to clarify "fix this" with photos attached. The API treats `unclear` as `work` when photos are attached, so in practice this costs nothing.
- Haiku once read "lol" as `unclear`.

No model let an invalid request through, and none blocked a genuine one.

## Choice

The default is **`google/gemini-3.5-flash-lite`** (`DEFAULT_SCREEN_MODEL`, and `SCREEN_MODEL` in `wrangler.jsonc`). It was the only model at 38/38 in both runs with a p95 under 1.6s. GLM-5.3 Flash tied on accuracy at a slightly higher p95 and is the fallback if cost becomes a concern, since it's about 8× cheaper per token. Jev was accurate on the outcomes that matter but slower and less consistent, and as a router its price and behaviour vary from request to request. That verdict was measured through OpenRouter's `typesafe/jev-router` and is superseded by the native-API measurements at the end of this file.

The API gives the classifier 4 seconds (`SCREEN_TIMEOUT_MS`), well above the chosen model's p95. A timeout or malformed reply ends the round with a retryable error and approves nothing.

To re-run the evaluation: `DEV_VARS=/path/to/apps/api/.dev.vars node apps/api/scripts/eval-screen.ts`. The key is read from the file and never printed.

# The scope gate on Jev (#98, second cut)

The screen above answers one question: is this work a tradie does? It deliberately passes work Legwork does *not* cover — "another check handles that" — and no such check existed. So a pool clean, a pest job or a whole-house rewire reached intake, was priced against the nearest trade's price book, and became a job no tradie on the platform could bid on.

The scope gate (`apps/api/src/scope.ts`) is that check. It asks eight questions of one Jev request and returns four outcomes: `work`, `unclear`, `invalid`, `out_of_scope`.

## Why one Jev request, not one small model call

Jev answers every question in a request in parallel, so the second through eighth questions are nearly free in time and tokens. Measured on this machine, `jev-latest` over eight questions: **median 216 ms, p95 285 ms** — against 986 ms / 1138 ms for one `google/gemini-3.5-flash-lite` call through OpenRouter. The earlier note in this file that Jev was "slower and less consistent" was measured through OpenRouter's `typesafe/jev-router`, which adds a router hop; the native API is a different picture.

## Method

Labelled set: the original 38 in `test/fixtures/screen-requests.json` plus 30 boundary cases in `test/fixtures/scope-cases.json` — unsupported trades, covered trades past their price ceiling, commercial and landlord work, paperwork about finished work, emergencies, an address with no job, a price question with no job, a vague request with photos. Three of the original 38 are restated in the scope file with a different expectation, because this gate resolves what their notes deferred; the script merges on text and reply, so the scope file wins.

Script: `npx tsx apps/api/scripts/eval-scope.ts` runs both gates over the merged 65 cases, four at a time, one warm-up call each.

## Results

| Gate | Exact | Genuine blocked | Invalid let through | Out of scope caught | Errors | Median ms | p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `google/gemini-3.5-flash-lite` (3-way, OpenRouter) | 50/65 | 0/29 | 0/13 | 0/14 | 0 | 986 | 1138 |
| `jev-latest` (4-way, TypeSafe) | 61–62/65 | 0/29 | 0/13 | 14/14 | 0 | 216 | 285 |

Neither gate blocked a genuine request or let spam through. The whole difference is the fourteen jobs the three-way gate cannot express a refusal for.

Three misses on the Jev side, all known and all cheap:

- `"my fence"` answered `"nah all good"` reads `unclear` where `invalid` is right. Benign: a second `unclear` asks for the job again, which is the same outcome as a refusal.
- `"whats the sparkys licence number"` reads `out_of_scope` (paperwork) where the label said `invalid`. Arguably the better answer: the customer is told we book new work and that licences show on every bid.
- `"can you come have a look at the place"` reads `work` where the label said `unclear`. Benign: intake's own first question is what needs doing.

The exact score moves by one case between runs (62/65, then 61/65 on a re-run) — the same `"my fence"` two-turn case. The outcomes that carry cost did not move: zero genuine requests blocked, zero spam through, and out of scope caught in every run.

## What the questions taught

- **Content claims are reliable; intent claims are not.** "Does the message name something broken" scores cleanly. "Does the customer want a tradie" does not.
- **A choice beats a single yes/no.** "Is this work no listed trade does" scored 0.41–0.53 on pool cleaning, pest control and a two-tonne car service. The same cases scored 0.99–1.00 as the `no_listed_trade` option of an eleven-way trade choice. Competing options give a probability something to be weighed against.
- **Examples calibrate a question; abstraction does not.** A Noul phrased "the message asks for physical work at a property, done by a tradesperson" returned 0.58 on "tap wont stop dripping".
- **Never let one signal block.** "not a request" alone scored 0.83 on the bare noun "my fence". The rule needs it *and* "only names a thing" before it refuses anyone.
- **Danger is a flag, not a verdict.** A gas smell is the platform's most urgent job, not a reason to send the customer elsewhere: `safety` rides along and sets the tier.

## Thresholds

Each sits between the two nearest measured scores, never on one: `not_a_request` 0.55 (nearest real invalid 0.83, nearest genuine 0.60), `too_big` 0.6 (big project 0.98, biggest single job 0.17), `no_listed_trade` 0.6 (unlisted 0.99, biggest listed 0.47), `about_finished_work` 0.6 (0.93 against 0.11), a job at 0.5 on either content signal.

## Wiring

`apps/api/src/scope.ts` returns the verdict, the trade and the safety flag; `jobs.ts` asks `OUT_OF_SCOPE_QUESTION` once when the verdict is `out_of_scope`, and the answer is gated again as a new request.

**No new secret is needed.** Jev is reachable through OpenRouter as `typesafe/jev-router`, so the gate rides on the `OPENROUTER_API_KEY` the Worker already holds. `scopeClassifier()` picks the route:

1. `TYPESAFE_API_KEY` set → the native TypeSafe API (`jev-latest`). The faster path; the 216 ms and 62/65 above are measured on it.
2. Otherwise `OPENROUTER_API_KEY` set → OpenRouter's `jev-router`, through the adapter in `src/jev.ts`. Same questions, same rule, one structured chat completion instead of the native typed-question body.
3. Neither → the three-way screen, as before.

The router path is the one that runs on the deployed Worker today. It costs a router hop — the earlier 38-case run put `jev-router` at 1045–1717 ms against 721–1001 ms for gemini-flash-lite on the same harness — and the probabilities come from the model's own calibration rather than a calibrated head, so its accuracy on this set is **not yet measured**: there was no working OpenRouter key on the machine when this landed. The adapter is unit-tested against a stubbed provider (`test/jev.test.ts`); to close the gap, put a key in `apps/api/.dev.vars` and run the third gate:

```sh
OPENROUTER_API_KEY=… TYPESAFE_API_KEY=… npx tsx apps/api/scripts/eval-scope.ts
```

That prints all three gates side by side, including `jev-router`. If it lands far below the native number, set `TYPESAFE_API_KEY` as a Worker secret and the gate switches route without a code change.
