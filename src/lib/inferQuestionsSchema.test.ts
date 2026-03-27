import { describe, expect, it } from 'vitest';
import { inferQuestionsResponseSchema } from './inferQuestionsSchema';

describe('inferQuestionsResponseSchema', () => {
  it('accepts 3 mixed questions', () => {
    const parsed = inferQuestionsResponseSchema.parse({
      questions: [
        { id: 'who', title: 'Primary persona?', type: 'single', options: [{ id: 'a', label: 'A' }] },
        { id: 'plat', title: 'Platforms?', type: 'multiple', options: [{ id: 'web', label: 'Web' }] },
        { id: 'notes', title: 'Constraints?', type: 'text', options: [] },
      ],
    });
    expect(parsed.questions).toHaveLength(3);
  });

  it('rejects fewer than 3 questions', () => {
    expect(() =>
      inferQuestionsResponseSchema.parse({
        questions: [
          { id: 'a', title: 'Q1', type: 'text', options: [] },
          { id: 'b', title: 'Q2', type: 'text', options: [] },
        ],
      }),
    ).toThrow();
  });

  it('rejects text question with options', () => {
    expect(() =>
      inferQuestionsResponseSchema.parse({
        questions: [
          { id: 'a', title: 'Q1', type: 'text', options: [{ id: 'x', label: 'bad' }] },
          { id: 'b', title: 'Q2', type: 'text', options: [] },
          { id: 'c', title: 'Q3', type: 'text', options: [] },
        ],
      }),
    ).toThrow();
  });

  it('rejects single without options', () => {
    expect(() =>
      inferQuestionsResponseSchema.parse({
        questions: [
          { id: 'a', title: 'Q1', type: 'single', options: [] },
          { id: 'b', title: 'Q2', type: 'text', options: [] },
          { id: 'c', title: 'Q3', type: 'text', options: [] },
        ],
      }),
    ).toThrow();
  });
});
