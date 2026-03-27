import { z } from 'zod';

/**
 * Plain objects only — no .transform() or .default() on fields used with OpenAI
 * structured outputs (`response_format` / `Output.object`). Transforms break
 * `required`-on-all-properties rules and trigger "Invalid schema for response_format".
 */
const questionOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

const clarifyingQuestionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: z.enum(['single', 'multiple', 'multiple_with_other', 'text']),
    options: z.array(questionOptionSchema),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.type === 'text') {
      if (q.options.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'text questions must have empty options',
          path: ['options'],
        });
      }
      return;
    }
    if (q.options.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'choice questions require at least one option',
        path: ['options'],
      });
    }
  });

export const inferQuestionsResponseSchema = z
  .object({
    questions: z.array(clarifyingQuestionSchema).min(3).max(8),
  })
  .strict();

export type InferQuestionsResponse = z.infer<typeof inferQuestionsResponseSchema>;
