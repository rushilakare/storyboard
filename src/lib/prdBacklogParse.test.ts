import { describe, expect, it } from 'vitest';
import { prdBacklogParse, SPEQTR_STORIES_END, SPEQTR_STORIES_START } from './prdBacklogParse';

const CANONICAL = `# Checkout

## Problem
Buyers abandon cart.

${SPEQTR_STORIES_START}

## User stories

### EP-01 — Guest checkout

**Story ID:** EP-01
**Title:** Guest checkout
**Persona:** Shopper
**User story narrative:** As a shopper, I want to check out as a guest, so that I do not need an account.

**Acceptance criteria**
1. Given no account, When I checkout, Then I see guest path.
2. Given guest path, When I pay, Then order is created.

**Notes:** None

### EP-02 — Save cart

**Story ID:** EP-02
**Title:** Save cart
**Persona:** Shopper
**User story narrative:** As a shopper, I want my cart saved, so that I can return later.

**Acceptance criteria**
1. Cart persists for 7 days.

${SPEQTR_STORIES_END}
`;

describe('prdBacklogParse', () => {
  it('parses canonical PRD with speqtr markers', () => {
    const r = prdBacklogParse(CANONICAL);
    expect(r.warnings.length).toBe(0);
    expect(r.epicMarkdown).toContain('## Problem');
    expect(r.epicMarkdown).not.toContain('User stories');
    expect(r.stories).toHaveLength(2);
    expect(r.stories[0].externalRef).toBe('EP-01');
    expect(r.stories[0].title).toBe('Guest checkout');
    expect(r.stories[0].narrative).toContain('As a shopper');
    expect(r.stories[0].acceptanceCriteria).toHaveLength(2);
    expect(r.stories[1].externalRef).toBe('EP-02');
  });

  it('parses without markers using ## User stories heading', () => {
    const md = `# X

Body here.

## User stories

### EP-99 — One story

**Story ID:** EP-99
**Title:** One story
**Persona:** P
**User story narrative:** As a user, I want x, so that y.

**Acceptance criteria**
1. First condition.
`;
    const r = prdBacklogParse(md);
    expect(r.stories).toHaveLength(1);
    expect(r.stories[0].externalRef).toBe('EP-99');
    expect(r.epicMarkdown).toContain('Body here');
  });

  it('returns empty stories and warning when no user stories section', () => {
    const r = prdBacklogParse('# Only epic\n\nNo stories block.');
    expect(r.stories).toHaveLength(0);
    expect(r.warnings.some((w) => /User stories/i.test(w))).toBe(true);
  });
});
