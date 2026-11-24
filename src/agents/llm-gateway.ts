// LLMGateway: the one place app code reaches a language model. Today it routes to the
// app's inline agent connector; every call is timed so agents can report what they spent.
import { invokeInlineAgent, type InlineAgentAnswer } from "@/connectors/inline-agent";

export interface LlmResult {
  text: string;
  ms: number;
  answer: InlineAgentAnswer;
}

export async function complete(prompt: string): Promise<LlmResult> {
  const t0 = performance.now();
  const answer = await invokeInlineAgent(prompt);
  return { text: answer.message ?? "", ms: Math.round(performance.now() - t0), answer };
}

/** For chat UIs that render the raw answer (files, activities) themselves. */
export function chat(prompt: string): Promise<InlineAgentAnswer> {
  return invokeInlineAgent(prompt);
}

/** Pull the first JSON object out of a model answer (fenced or bare). */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1]] : [];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  return null;
}
