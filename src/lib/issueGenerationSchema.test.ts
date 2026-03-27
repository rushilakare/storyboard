import { describe, expect, it } from 'vitest';
import { formatEpicMarkdownForStorage, parseIssueGenerationJson } from './issueGenerationSchema';

const MINIMAL_VALID = `{
  "epic": {
    "title": "Checkout resilience",
    "problem_statement": "Buyers abandon when errors occur.",
    "goals": ["Reduce errors", "Improve recovery"],
    "non_goals": ["Rewrite payments rail"],
    "personas": [{ "name": "Buyer", "role": "Customer", "pain_point": "Unclear failures" }],
    "success_metrics": [
      { "type": "primary", "metric": "Completion rate", "baseline": "TBD — needs measurement sprint", "target": "95%" }
    ],
    "assumptions": ["PCI scope unchanged"],
    "risks": [{ "description": "Third-party outage", "mitigation": "Retries" }],
    "open_questions": ["SLA with processor?"],
    "out_of_scope": ["Crypto"],
    "definition_of_done": ["Metrics dashboard live"],
    "description": "Harden checkout with clear errors and retry paths.",
    "acceptance_criteria": ["Given a timeout, when user retries, then order completes or rolls back cleanly."],
    "due_date": null
  },
  "stories": [
    {
      "id": "US-001",
      "title": "Surface processor errors",
      "persona": "Buyer",
      "narrative": "As a buyer, I want a clear message when payment fails, so that I can fix my card or try again.",
      "description": "Map API codes to user-safe copy and log correlation IDs server-side.",
      "acceptance_criteria": [
        "Given a declined card, when checkout fails, then the UI shows a specific reason and a retry action.",
        "Given any failure, when the user opens support, then the correlation ID is visible.",
        "Given success, when the page loads, then no error banner is shown."
      ],
      "dependencies": [],
      "notes": "",
      "due_date": null,
      "status": "open",
      "priority": "high"
    }
  ]
}`;

describe('parseIssueGenerationJson', () => {
  it('parses minimal valid payload', () => {
    const r = parseIssueGenerationJson(MINIMAL_VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.epic.title).toBe('Checkout resilience');
    expect(r.data.stories).toHaveLength(1);
    expect(r.data.stories[0].id).toBe('US-001');
  });

  it('strips a single json fence', () => {
    const r = parseIssueGenerationJson('```json\n' + MINIMAL_VALID + '\n```');
    expect(r.ok).toBe(true);
  });
});

describe('formatEpicMarkdownForStorage', () => {
  it('includes key sections', () => {
    const r = parseIssueGenerationJson(MINIMAL_VALID);
    if (!r.ok) throw new Error('parse failed');
    const md = formatEpicMarkdownForStorage(r.data.epic);
    expect(md).toContain('## Problem statement');
    expect(md).toContain('## Solution approach');
    expect(md).toContain('Harden checkout');
  });
});
