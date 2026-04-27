---
name: build-error-fix
description: 'Investigate and resolve build, CMake, compilation, or linker errors in JUCE C++ projects'
argument-hint: 'Paste the build error message or compiler output'
user-invocable: true
disable-model-invocation: false
---

# Build Error Fix

## When to Use
- The project fails to compile.
- There are linker errors or missing symbols.
- CMake configure or generation fails.
- CI/CD build failures occur.

## Approach
Trace the exact error message to its root cause in the code, build system, or JUCE module configuration. Check for breaking changes if upgrading JUCE versions.

## Procedure
1. **Analyze Error**: Identify the specific file, line number, and error code.
2. **Root Cause Identification**: Determine if it's a syntax error, API change (e.g. JUCE 8 breaking change), missing `#include`, or missing CMake linkage.
3. **JUCE 8 Documentation**: Check if the identifier/class was changed in JUCE 8 (e.g. `LadderFilterMode::LPF24` instead of `LP24`).
4. **Solution Formulation**: Write the correct code or CMake configuration to resolve the issue.
5. **Verification Check**: Verify against JUCE documentation that the new usage is correct.

## Example Scenario
**Error**: `C2065 'LP24': undeclared identifier`
**Root Cause**: In `juce::dsp::LadderFilterMode` (JUCE 8.0.8), the enumerators include an 'F' (e.g., `LPF24`).
**Fix**: Update to `filter.setMode(juce::dsp::LadderFilterMode::LPF24);`
