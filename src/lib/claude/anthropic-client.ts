import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient, ClaudeRequest } from "@/lib/job-service";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 1024;

/**
 * Real Claude client. Server-only, so the API key never reaches the browser.
 * Not used until the chat ticket; tests use FakeClaudeClient instead.
 */
export class AnthropicClaudeClient implements ClaudeClient {
  private readonly client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: ClaudeRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "text" as const, text: part.text }
            : { type: "image" as const, source: { type: "url" as const, url: part.url } },
        ),
      })),
    });
    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}
