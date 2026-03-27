import { z } from 'zod';

const questionOptionSchema = z.object({
  id: z.string().min(1).transform((s) => s.trim()),
  label: z.string().min(1).transform((s) => s.trim()),
});

const clarifyingQuestionSchema = z
  .object({
    id: z.string().min(1).transform((s) => s.trim()),
    title: z.string().min(1).transform((s) => s.trim()),
    type: z.enum(['single', 'multiple', 'multiple_with_other', 'text']),
    options: z.array(questionOptionSchema).default([]),
  })
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

export const inferQuestionsResponseSchema = z.object({
  questions: z.array(clarifyingQuestionSchema).min(3).max(8),
});

export type InferQuestionsResponse = z.infer<typeof inferQuestionsResponseSchema>;
