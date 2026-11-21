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

The default is **`google/gemini-3.5-flash-lite`** (`DEFAULT_SCREEN_MODEL`, and `SCREEN_MODEL` in `wrangler.jsonc`). It was the only model at 38/38 in both runs with a p95 under 1.6s. GLM-5.3 Flash tied on accuracy at a slightly higher p95 and is the fallback if cost becomes a concern, since it's about 8× cheaper per token. Jev was accurate on the outcomes that matter but slower and less consistent, and as a router its price and behaviour vary from request to request.

The API gives the classifier 4 seconds (`SCREEN_TIMEOUT_MS`), well above the chosen model's p95. A timeout or malformed reply ends the round with a retryable error and approves nothing.

To re-run the evaluation: `DEV_VARS=/path/to/apps/api/.dev.vars node apps/api/scripts/eval-screen.ts`. The key is read from the file and never printed.
