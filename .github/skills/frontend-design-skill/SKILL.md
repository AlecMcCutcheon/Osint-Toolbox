---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with deep discovery, research, and intentional design decisions. Use this skill for components, pages, apps, and UI systems. Avoid generic output by researching first, asking focused questions when context is missing, and grounding visual choices in user, product, and domain realities.
license: Complete terms in LICENSE.txt
---

# Frontend Design

Do not jump straight into aesthetics. Earn the visual direction through discovery, research, and clear reasoning.

This skill is for building frontend components, screens, flows, pages, and small applications with strong visual quality and UX discipline. It exists to prevent generic, under-researched, context-free design output.

Read this file first, then load the relevant supporting files.

## Core rule

Before proposing a polished design direction or writing substantial UI code, determine whether the prompt contains enough information about:
- user
- goal
- content
- context of use
- technical constraints
- platform or viewport priority
- brand or tone

If it does not, ask focused clarifying questions first.

## Required workflow

1. Read the prompt and identify the job: component, screen, flow, page, dashboard, landing page, content site, internal tool, mobile-first app, or design system task.
2. Run discovery using `discovery.md`.
3. Run research using `research.md` for any non-trivial request.
4. If ambiguity is still material, ask questions before locking a direction.
5. Synthesize 2-3 viable directions using `direction.md`.
6. Recommend one direction with tradeoffs and explicit assumptions.
7. Build only after the direction is justified.
8. Review against `validation.md` before finalizing.

## Mandatory behavior

- Do not treat the first plausible aesthetic as the correct one.
- Do not invent user needs when the request is underspecified.
- Do not produce a single unqualified direction when multiple reasonable directions exist.
- Do not rely on generic SaaS or “AI-generated” section patterns.
- Do not use placeholder strategy as a substitute for product thinking.
- Do not present assumptions as facts.

## Ask questions when

You must ask clarifying questions before major design decisions if any of these are unknown:
- primary user
- primary task or conversion goal
- whether this is marketing, product UI, content, or hybrid
- device priority: mobile, desktop, or balanced
- existing brand constraints or style system
- content source or realism requirements
- technical stack constraints that affect implementation
- whether clarity, trust, speed, density, delight, or expressiveness is the priority

If more than two of the above are unknown, do not proceed to a final visual direction. Ask questions first.

## Required output format before implementation

For non-trivial design work, structure the planning response in this order:
1. What is known
2. What is missing
3. Assumptions that are safe to make
4. Research findings
5. Candidate directions
6. Recommended direction
7. UX risks and mitigations
8. Implementation plan

## File routing

Read these files as needed:
- `discovery.md` — context gathering, ambiguity handling, clarifying questions
- `research.md` — competitor review, pattern review, reference gathering, domain conventions
- `direction.md` — converting findings into concrete design directions and recommendations
- `validation.md` — anti-generic checks, UX QA, accessibility, responsiveness, content realism
- `project-types/marketing.md` — landing pages, homepages, conversion-first sites
- `project-types/product-ui.md` — dashboards, SaaS, tools, settings, data-heavy interfaces
- `project-types/content.md` — docs, portfolios, editorial, article and gallery-driven experiences

## Design philosophy

Distinctiveness is not randomness. A strong interface is memorable because it is appropriate, intentional, and deeply tied to the product, audience, and task.

Creativity is encouraged, but it must be justified. Typography, spacing, layout, color, motion, density, and interaction patterns should be traceable to one or more of:
- explicit user-provided context
- research findings
- domain conventions
- clearly labeled assumptions

## Non-negotiables

- Ground major design decisions in evidence or explicit assumptions.
- Use realistic content structure whenever possible.
- Cover empty, loading, error, success, and edge states.
- Consider accessibility and responsive behavior from the start, not at the end.
- If the user asks for implementation, produce working code, not just design commentary.
- If the user asks for ideas only, still provide rationale and tradeoffs.
