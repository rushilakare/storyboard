import { z } from 'zod';

export const issueStatusValues = [
  'open',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
] as const;
export type IssueStatusValue = (typeof issueStatusValues)[number];

export const issuePriorityValues = ['lowest', 'low', 'medium', 'high', 'highest'] as const;
export type IssuePriorityValue = (typeof issuePriorityValues)[number];

const optionalDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .optional();

const successMetricSchema = z.object({
  type: z.enum(['primary', 'guardrail', 'counter']),
  metric: z.string(),
  baseline: z.string(),
  target: z.string(),
});

const personaSchema = z.object({
  name: z.string(),
  role: z.string(),
  pain_point: z.string(),
});

const riskSchema = z.object({
  description: z.string(),
  mitigation: z.string(),
});

export const generatedEpicSchema = z.object({
  title: z.string().min(1),
  problem_statement: z.string(),
  goals: z.array(z.string()),
  non_goals: z.array(z.string()),
  personas: z.array(personaSchema),
  success_metrics: z.array(successMetricSchema),
  assumptions: z.array(z.string()),
  risks: z.array(riskSchema),
  open_questions: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  definition_of_done: z.array(z.string()),
  description: z.string(),
  acceptance_criteria: z.array(z.string()),
  due_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
});

export type GeneratedEpic = z.infer<typeof generatedEpicSchema>;

const generatedStorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  persona: z.string(),
  narrative: z.string(),
  description: z.string(),
  acceptance_criteria: z.array(z.string()).min(3),
  dependencies: z.array(z.string()),
  notes: z.string(),
  due_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
  status: z.enum(issueStatusValues as unknown as [IssueStatusValue, ...IssueStatusValue[]]),
  priority: z.enum(issuePriorityValues as unknown as [IssuePriorityValue, ...IssuePriorityValue[]]),
});

export type GeneratedStory = z.infer<typeof generatedStorySchema>;

export const generatedIssueSchema = z.object({
  epic: generatedEpicSchema,
  stories: z.array(generatedStorySchema).min(1),
});

export type GeneratedIssuePayload = z.infer<typeof generatedIssueSchema>;

/** Collapses PRD-level epic fields into one markdown document for \`feature_issues.description\`. */
export function formatEpicMarkdownForStorage(epic: GeneratedEpic): string {
  const blocks: string[] = [];

  blocks.push('## Problem statement\n\n' + epic.problem_statement.trim());

  if (epic.goals.length) {
    blocks.push('\n\n## Goals\n\n' + epic.goals.map((g) => `- ${g}`).join('\n'));
  }
  if (epic.non_goals.length) {
    blocks.push('\n\n## Non-goals\n\n' + epic.non_goals.map((g) => `- ${g}`).join('\n'));
  }
  if (epic.personas.length) {
    const personaMd = epic.personas
      .map((p) => `### ${p.name} (${p.role})\n\n${p.pain_point}`)
      .join('\n\n');
    blocks.push('\n\n## Personas\n\n' + personaMd);
  }
  if (epic.success_metrics.length) {
    const rows = epic.success_metrics
      .map(
        (m) =>
          `| ${m.type} | ${m.metric} | ${m.baseline} | ${m.target} |`,
      )
      .join('\n');
    blocks.push(
      '\n\n## Success metrics\n\n| Type | Metric | Baseline | Target |\n| --- | --- | --- | --- |\n' +
        rows,
    );
  }
  if (epic.assumptions.length) {
    blocks.push('\n\n## Assumptions\n\n' + epic.assumptions.map((a) => `- ${a}`).join('\n'));
  }
  if (epic.risks.length) {
    const riskMd = epic.risks
      .map((r) => `- **Risk:** ${r.description}\n  - **Mitigation:** ${r.mitigation}`)
      .join('\n');
    blocks.push('\n\n## Risks\n\n' + riskMd);
  }
  if (epic.open_questions.length) {
    blocks.push('\n\n## Open questions\n\n' + epic.open_questions.map((q) => `- ${q}`).join('\n'));
  }
  if (epic.out_of_scope.length) {
    blocks.push('\n\n## Out of scope\n\n' + epic.out_of_scope.map((o) => `- ${o}`).join('\n'));
  }
  if (epic.definition_of_done.length) {
    blocks.push(
      '\n\n## Definition of done\n\n' + epic.definition_of_done.map((d) => `- ${d}`).join('\n'),
    );
  }

  blocks.push('\n\n## Solution approach\n\n' + epic.description.trim());

  return blocks.join('').trim();
}

export function parseIssueGenerationJson(raw: string):
  | {
      ok: true;
      data: GeneratedIssuePayload;
    }
  | {
      ok: false;
      error: string;
    } {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (fence) {
    text = fence[1].trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'Model output was not valid JSON.' };
  }
  const result = generatedIssueSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => {
        const path = i.path.length ? i.path.join(".") : "root";
        return `${path}: ${i.message}`;
      })
      .join("; ");
    return { ok: false, error: msg || result.error.message };
  }
  return { ok: true, data: result.data };
}
