---
name: ui-audit
description: 'Conduct a comprehensive audit of a JUCE user interface for premium aesthetics, layout, and UX. Use when: reviewing UI code, polishing the user interface, improving workflow efficiency.'
argument-hint: 'Specify the component or view to audit'
user-invocable: true
disable-model-invocation: false
---

# UI Audit (JUCE 8.0.8)

## When to Use
- Reviewing a new UI component for aesthetic alignment.
- Polishing an existing interface to a "Boutique/High-End" standard.
- Checking for UI/UX workflow efficiency and component hierarchy.

## Approach
Evaluate visual identity, signal flow visualization, modern minimalism, tactility, and technical implementation (CustomLookAndFeel integrity). 
Prioritize visual excellence and authoritative guidance. Provide specific, code-ready design fixes rather than vague suggestions.

## Procedure
1. **Visual Identity Audit**: Check glassmorphism, glows (20% opacity), modern minimalism, and breathing room.
2. **Color Palette & Typography**: Ensure harmony, deep charcoal/slate-blue bases, and MANDATORY use of `GMarketSans` font. No hardcoded colors; use `CustomLookAndFeel`.
3. **Signal Flow & Layout**: Ensure UI layout follows audio signal path. Verify ADSR grouping and "Three-Click" rule for deep settings.
4. **Interaction**: Verify knob response, micro-animations, and clear parameter value displays.
5. **Technical Integrity**: Verify no allocations in `paint()`, use of vector paths, and semantic naming in LookAndFeel.

## Output
Produce a detailed UI Audit report with:
1. The Flaw (why it looks cheap/uncorroborated)
2. The "Correct Way" (authoritative, specific design fix)
3. Severity (High, Medium, Low)
4. Reference (JUCE best practice or premium VST standard)
Save the audit log to `MIDITOOLS/Summaries/`.
