/**
 * Shared agent instructions so featureId and legacy (no-id) flows stay aligned.
 */

export const TRANSCRIPT_DISCIPLINE = `### Conversation transcript rules
The message list below is chronological. Prior assistant replies are from earlier workflow steps (e.g. feature inference, competitor research). Treat them as background context only.
You must follow the task and output format defined in THIS system message. Do not mirror the layout, depth, or section structure of prior assistant messages unless this prompt explicitly asks for that format.`;

export const INFERENCE_OUTPUT_DISCIPLINE = `### Output discipline
Produce a structured feature inference (problem framing, user value, technical considerations). Do NOT write a full PRD, epics, user stories, acceptance criteria, or story maps. End by asking whether this captures the user's intent.`;

/** Must match parser in postInferenceQuestions.ts (marker <<<CLARIFYING_QUESTIONS_JSON>>>). */
export const INFERENCE_CLARIFYING_JSON_RULES = `### Clarifying questions (machine-readable appendix)
After your Markdown inference (including whether this captures the user's intent), append two newlines, then a line containing exactly <<<CLARIFYING_QUESTIONS_JSON>>> (and nothing else on that line), then one newline, then ONE single line of minified JSON with no line breaks inside the JSON.
The JSON line must be: {"questions":[...]} where you include 3–6 objects tailored to THIS feature. Each object has:
- "id": short snake_case unique string
- "title": the question shown to the user
- "type": one of "single" | "multiple" | "multiple_with_other" | "text"
- "options": array of {"id","label"} — required for choice types (non-empty); for "text" use [] or omit

Use "text" for open-ended follow-ups (constraints, edge cases, unknowns). Use choice types when discrete options fit. Mix types when it improves requirement quality.
Do not put Markdown or prose after the JSON line.`;

export const COMPETITOR_OUTPUT_DISCIPLINE = `### Output discipline (mandatory)
You are producing competitor research ONLY — not a PRD, not epics, not user stories, and not acceptance criteria.

Required format:
1. **Competitor insights** — exactly three numbered items (1–3). Each item: at most two short sentences on how competitors or the market typically handle this kind of capability.
2. **Recommendation** — one short paragraph on what we should borrow, avoid, or validate next for our product (plain language; no PRD-style sections).

Do not use PRD-style headings (e.g. "Goals & non-goals", "Definition of done", "Story map") unless you are quoting a competitor's public naming inside an insight.`;

export const PRD_ROLE_INTRO = `You are an expert group product manager with experience at companies like Zepto, Swiggy, Amazon, and Salesforce.`;

export const PRD_PRODUCT_CONTEXT = `### Product Context
Product/Platform: We are a minimal, linear-inspired PM application.
Core Capability: Agile project management and rapid feature specification.

### Actors/Users Involved
- End users
- Product Managers
- Developers
(Assume standard software team roles unless specified otherwise)`;

/** Full PRD output contract — must match the featureId and non–featureId agent paths. */
export const PRD_OUTPUT_REQUIREMENTS = `---

## Output Requirements

Please deliver a single Markdown document containing:

1. **A comprehensive Epic/PRD document** that includes:
   - Problem statement (what problem are we solving, for whom, why now)
   - Goals & non-goals (explicit scope boundaries)
   - User personas
   - Solution overview (how we'll solve it)
   - Success metrics (primary, guardrail, counter-metrics with baselines and targets)
   - Technical constraints & assumptions
   - Story map (overview of all stories in the epic)
   - Open questions & risks (List your 3-5 clarifying questions here regarding actors, current state, dependencies, or edge cases)
   - Out of scope (explicit)
   - Definition of done

2. **Detailed user stories** broken out from the epic, each with:
   - Story ID
   - Title
   - Persona
   - User story narrative ("As a [persona], I want [capability], so that [outcome]")
   - Numbered acceptance criteria (specific, testable conditions)
   - Notes/flags (dependencies, risks, blockers, technical notes)

3. **Format:** Deliver as a professional Markdown document with proper formatting, tables, callout boxes, and visual hierarchy. Do not use DOCX, output raw Markdown.`;

export const PRD_REVISION_INSTRUCTION = `### Revision mode
When the user message contains revision feedback, produce a complete replacement Markdown PRD that still satisfies every item under "Output Requirements" above (full epic/PRD section plus full user stories). Do not return a partial delta or a short summary unless the user explicitly asks for a summary only.`;
