# Buddy Command Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the first-class `/buddy` user command for the existing companion system so the default `mya` build can hatch, inspect, pet, and mute a companion.

**Architecture:** Add a small `src/commands/buddy/` command module around the already-existing `src/buddy/` runtime. Keep the command logic mostly pure so Bun tests can cover hatch/pet/mute behavior without relying on the full REPL, then wire the command into the default build by enabling `BUDDY`.

**Tech Stack:** Bun, TypeScript, existing command framework, existing companion config/state.

---

### Task 1: Lock behavior with failing tests

**Files:**
- Create: `src/commands/buddy/buddy.test.ts`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run `bun test src/commands/buddy/buddy.test.ts` and confirm the module is missing**

### Task 2: Implement the local `/buddy` command

**Files:**
- Create: `src/commands/buddy/index.ts`
- Create: `src/commands/buddy/buddy.ts`

- [ ] **Step 1: Add the command descriptor**
- [ ] **Step 2: Add pure action logic for hatch, pet, mute, unmute, status, help**
- [ ] **Step 3: Add the command wrapper that reads/writes global config and updates `companionPetAt`**
- [ ] **Step 4: Re-run `bun test src/commands/buddy/buddy.test.ts`**

### Task 3: Make the default build include the command

**Files:**
- Modify: `scripts/build.ts`

- [ ] **Step 1: Add `BUDDY` to the default feature set**
- [ ] **Step 2: Rebuild with `bun run build`**
- [ ] **Step 3: Verify `./cli --help` now shows `/buddy`**

### Task 4: End-to-end sanity check

**Files:**
- Verify only

- [ ] **Step 1: Run `./cli --help | rg buddy`**
- [ ] **Step 2: Run a small non-interactive invocation or interactive smoke test against `mya`**
- [ ] **Step 3: Report exact status and any remaining gaps**
