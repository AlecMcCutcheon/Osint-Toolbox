# Discovery

Discovery is mandatory before any serious frontend design recommendation.

The goal is to avoid shallow output by understanding what is being designed, for whom, why now, and under what constraints.

## Discovery checklist

Identify the following before settling on art direction or layout strategy:

### Product and business
- What is the product, feature, or page?
- What business outcome matters most: conversion, trust, engagement, retention, speed to task, comprehension, activation?
- What counts as success?
- Is this a new concept, redesign, extension of an existing product, or visual refresh?

### User and context
- Who is the primary user?
- Who is the secondary user, if any?
- What problem are they trying to solve?
- What is their likely level of expertise?
- In what context will they use this: at work, on the go, under time pressure, casually, repeatedly, rarely?

### Core tasks
- What are the top 1-3 actions the interface must support?
- Which action deserves the strongest visual emphasis?
- What must feel fast, safe, trustworthy, clear, or delightful?

### Content
- What content will actually exist here?
- Is the content structured, editorial, transactional, visual, data-heavy, or form-heavy?
- Is there real content, sample data, or only vague placeholders?
- If real content is missing, what realistic surrogate content should be used?

### Brand and tone
- Is there an existing brand system, palette, type system, logo, or voice?
- Should the interface feel sober, premium, playful, technical, editorial, experimental, calm, energetic, etc.?
- What should users feel in the first 5 seconds?

### Technical constraints
- Framework or stack?
- Performance sensitivity?
- Accessibility requirements?
- Browser or device support constraints?
- Does this need to fit into an existing component library or design system?

### Platform and layout constraints
- Mobile-first, desktop-first, or responsive balance?
- Is the interface dense or spacious by necessity?
- Are there nav, sidebar, modal, table, chart, onboarding, or authentication requirements?

## Ambiguity handling

Treat the request as ambiguous if it is missing enough context that multiple design directions would be equally reasonable.

Common ambiguity examples:
- “Make me a dashboard” with no user, data, or task context
- “Design a landing page” with no audience or offer
- “Improve this component” without knowing where it lives or what problem it solves
- “Make it more modern” without knowing what the brand should signal

## Question rules

Ask the fewest questions needed to reduce ambiguity meaningfully.

Prioritize questions in this order:
1. Who is it for?
2. What is the main action or job-to-be-done?
3. What kind of interface is it: marketing, product UI, content, or hybrid?
4. Is mobile or desktop more important?
5. Are there brand or technical constraints?

Do not ask broad catch-all questions like “Any preferences?” if you can ask something sharper.

## Good clarifying questions

- Who is the primary user for this interface?
- What is the single most important action you want the user to take?
- Is this meant to feel more conversion-focused, editorial, or product-utility driven?
- Should I optimize this primarily for mobile or desktop?
- Do you want this to align with an existing brand system or should I establish a fresh direction?

## Safe assumptions

Only make assumptions without asking when they are low-risk and unlikely to change the core structure.

Usually safe:
- standard accessibility expectations
- responsive behavior
- realistic placeholder content instead of lorem ipsum
- sensible defaults for focus states, empty states, and error handling

Usually not safe:
- target audience
- business goal
- trust vs delight vs density tradeoff
- mobile vs desktop priority
- tone direction
- whether the product is consumer, prosumer, enterprise, or internal

## Discovery output

Summarize discovery in a compact format:
- Known facts
- Missing facts
- Assumptions
- Most important unresolved risk

If the unresolved risk would significantly change the design, ask questions before continuing.
