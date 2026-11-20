import type { ClaudeClient, ClaudeRequest } from "@/lib/job-service";

/**
 * Scripted stand-in for Claude. Each call to `complete` returns the next
 * scripted response, in order. Tests never make real API calls.
 */
export class FakeClaudeClient implements ClaudeClient {
  readonly calls: ClaudeRequest[] = [];
  private readonly script: string[];

  constructor(script: string[] = []) {
    this.script = [...script];
  }

  /** Add more scripted responses after construction. */
  enqueue(...responses: string[]): void {
    this.script.push(...responses);
  }

  async complete(request: ClaudeRequest): Promise<string> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error(`FakeClaudeClient: no scripted response left for call #${this.calls.length}`);
    }
    return next;
  }
}

/** Builders for scripted responses, following the assistant contract in spec.md. */
export const claudeSays = {
  ask(question: string): string {
    return JSON.stringify({ type: "ask", question });
  },

  summary(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: "summary",
      trade: "plumbing",
      issue_summary: "Leaking tap under the kitchen sink",
      severity: 2,
      confidence: 0.9,
      safety_flag: false,
      price: {
        low: { min: 120, max: 160 },
        medium: { min: 160, max: 220 },
        high: { min: 240, max: 320 },
      },
      price_reason: "Standard tap washer replacement, about one hour of labour",
      ...overrides,
    });
  },

  safety(overrides: Record<string, unknown> = {}): string {
    return claudeSays.summary({ safety_flag: true, severity: 5, ...overrides });
  },

  malformed(): string {
    return "Sorry, I can't format that as JSON {";
  },
};
