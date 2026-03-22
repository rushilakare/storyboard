import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { COMPETITOR_OUTPUT_DISCIPLINE } from '@/lib/agent-prompts';
import { assembleFeatureContext } from '@/lib/context';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { featureId, name, purpose, requirements, revision } = body;

    if (featureId) {
      const context = await assembleFeatureContext(featureId, 'competitor', {
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

    let prompt = `You are an expert product management assistant simulating a Competitor Research Agent.
The user's feature:
Feature Name: ${name || "N/A"}
Purpose: ${purpose || "Not specified"}
Requirements: ${requirements || "None"}

Simulate a quick industry / competitive scan (no live web access) for this domain.

${COMPETITOR_OUTPUT_DISCIPLINE}`;

    if (revision) {
      prompt += `\n\nUser revision: "${revision}". Please update your research accordingly.`;
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
      JSON.stringify({ success: false, error: "Failed to search competitors" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
