import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { INFERENCE_CLARIFYING_JSON_RULES, INFERENCE_OUTPUT_DISCIPLINE } from '@/lib/agent-prompts';
import { assembleFeatureContext } from '@/lib/context';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { featureId, name, purpose, requirements, revision } = body;

    if (featureId) {
      const context = await assembleFeatureContext(featureId, 'inference', {
        userQuery: revision || undefined,
        enableRetrieval: !!revision,
      });

      const { textStream } = streamText({
        model: openai("gpt-5.4-2026-03-05"),
        system: context.systemPrompt,
        messages: context.messages,
      });

      return new Response(textStream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    let prompt = `You are an expert product management assistant simulating an inference agent for a linear-inspired tool.
The user is requesting a new product feature with the following details:
Feature Name: ${name || "N/A"}
Core Problem to Solve: ${purpose || "Not specified"}
Key Capabilities: ${requirements || "None"}

${INFERENCE_OUTPUT_DISCIPLINE}

${INFERENCE_CLARIFYING_JSON_RULES}`;

    if (revision) {
      prompt += `\n\nThe user also provided additional feedback/revision: "${revision}". Please update your inference based on this.`;
    }

    const { textStream } = streamText({
      model: openai("gpt-5.4-2026-03-05"),
      prompt,
    });

    return new Response(textStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to infer feature" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
