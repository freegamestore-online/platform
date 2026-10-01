/** OpenRouter adapter — OpenAI-compatible chat completions at openrouter.ai.
 *  Models are namespaced by vendor (e.g. "anthropic/claude-sonnet-4"); tool
 *  calls and streaming follow the OpenAI format, so the OpenAI adapter's
 *  request + SSE handling apply unchanged. */

import { OpenAIAdapter } from "./openai";
import type { ProviderAdapter } from "./types";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterAdapter extends OpenAIAdapter implements ProviderAdapter {
  constructor(apiKey: string, model: string, temperature = 0.7, maxTokens = 16384) {
    super(apiKey, model, OPENROUTER_CHAT_URL, temperature, maxTokens);
  }
}
