# How the memory works

Concepts only. For the code, see `how-the-implementation-works.md`.

## The problem

An agent working on a project today has no memory of the decision you made last week. So
it re-derives, or contradicts, or asks again. Context windows end; sessions end; the
reasoning that produced a decision is gone.

The obvious fix is to let agents write to a store. That fix has a failure mode worse than
forgetting: agents are wrong confidently, at volume. An agent that can write memory
directly will, within a week, be retrieving its own mistaken guesses as established fact,
with the same confidence as things you verified yourself. You cannot tell them apart
afterwards, because the memory layer recorded no difference.

So the design problem isn't storage. It's **admitting knowledge without becoming
untrustworthy**.

## Three ideas

**1. Agents propose, they don't write.** An agent's output enters the system as a
*proposal* — explicitly pending, explicitly not knowledge. Nothing an agent does can
produce a fact on its own.

**2. A human is the gate.** You approve or reject. Not a confidence score, not a second
model. A person, at a moment when the context is fresh.

**3. Memory is a graph, not a table.** A decision belongs to a project, and it is
supported by a source. A table row flattens that. You end up able to retrieve *what* was
decided but not *why*, or *where*, or *as part of what*. The relationships are most of
the value.

## The lifecycle of one memory

```
   agent or human
         │
         │  POST /api/memory/proposals
         ▼
   ┌─────────────┐
   │  Proposal   │   status: pending
   │  (staging)  │   invisible to search
   └─────────────┘
         │
         ├── reject ──> status: rejected   (kept, not deleted — you can ask why later)
         │
         └── approve
                 │
                 ▼
        ┌──────────────────────────────────────┐
        │  Decision ──SUPPORTED_BY──> Source   │
        │      ▲                                │
        │      │ HAS_DECISION                   │
        │  Project ──CONTAINS──> Workspace      │
        └──────────────────────────────────────┘
                 │
                 ▼
        visible to /api/memory/search
```

Rejection keeps the record. A rejected proposal is evidence about what the agent thought,
which is useful when you're tuning it. Deleting it throws that away.

## The node model

```
Workspace
    │ CONTAINS
    ▼
  Project
    ├── USES ──────────> Technology        (not implemented yet)
    └── HAS_DECISION ──> Decision
                            │ SUPPORTED_BY
                            ▼
                          Source
```

Example, concretely:

```
Workspace: personal
    └── Project: memory-system
            ├── USES -> Next.js
            ├── USES -> Neo4j
            └── HAS_DECISION -> "Use Next.js App Router"
                                    │ SUPPORTED_BY
                                    ▼
                                  Source: "initial architecture discussion"
```

Only four labels so far: `Workspace`, `Project`, `Decision`, `Source`, plus `Proposal`
for staging. `Technology` and `USES` are in the model but not yet written by any code
path.

## Choosing the type

Every `Decision` carries a `type`: `decision`, `convention` or `note`. It is a filing
label, not a behavior. All three are stored the same way, gated the same way, and are
equally reachable from search. The type does exactly two things: `getProjectContext`
groups a project's memory under it, so it is the first structure an agent sees at the
start of a session, and the queue and list views style it as a chip.

Nothing enforces the distinction — which is why it has to be written down. File a note
as a decision and the system will happily stamp it; the human gate can reject the
content, but no code catches a misfiled label. Pick by what the record is *for*, not by
its tone or its length.

**`decision`** — a choice made once, where the reasoning has to outlive the session and
the alternatives were real.

- Test: read six months later, does it answer *why* without you in the room? If it were
  reversed, would work have to be redone?
- Carry the rationale, the options rejected, and the measurement that settled it.
- Examples: `Use Next.js App Router`; `Do not put an LLM in the trade-decision loop`;
  `Ship reveals with no animation library — motion measured at 38 KB gzipped`.

**`convention`** — a standing rule about how work is done here. It binds every future
change and has no decision point left in it.

- Test: does it apply to every future commit? Is violating it a bug rather than a
  rethink?
- Write it short and imperative. A rule that needs a paragraph of justification is
  probably a decision.
- Examples: `Pin exact Docker image tags`; `Never commit .env.local`; `Theme tokens
  only — never hardcode hex in components`.

**`note`** — descriptive context: what something is, what is known, what is still open.
Nothing is bound by it, and it is expected to rot.

- Test: can it become false next month without anyone changing their behavior? Then it
  is a note. Date it when it is time-sensitive.
- Examples: `Known flaws: dollar buckets, in-sample filter, score is not P&L`;
  `mobarrez.com launch blockers checklist (as of 2026-07-28)`.

Two edges that come up in practice:

- **decision vs convention.** `Use Next.js App Router` is a decision because the Pages
  Router was a live alternative and the comparison matters. `Pin exact Docker image
  tags` is a convention because there is no argument left, only the rule. If the *why*
  must survive, it is a decision even when it reads like a rule.
- **convention vs note.** `Dark text on the accent for primary buttons` constrains
  future design work, so it is a convention. `Web UI design language: archival dossier`
  describes an aesthetic; the binding part of it — tokens only — is the convention.

`deletion` is a fourth value, but only at the proposal level: `type: "deletion"`
requests the removal of an approved memory and never becomes a `Decision`.

## The invariant that does the work

`Proposal` and `Decision` are **different labels**, not two values of a `status` field.

That choice is the load-bearing one. The alternative — one label with a status — means
every read query carries `WHERE status = 'approved'`. Every query becomes a place you can
forget the clause, and the failure is silent: an agent's unapproved guess served back as
fact, looking exactly like a verified decision.

With separate labels, search traverses `(Project)-[:HAS_DECISION]->(Decision)`, and that
relationship only exists after approval. Unapproved memory isn't *excluded* from search.
It isn't **reachable** from it.

The general principle: when an invariant matters, encode it in the schema rather than in
the discipline of everyone who writes a query later.

## What this buys you

An agent with `memory.search()` asks "what did we decide about X" and gets the real
answer, with provenance, from a store that only ever contains things a human confirmed.

Across sessions. Across models. Across everyone working on the project.

## What it deliberately doesn't do

- **No automatic extraction.** An LLM reading a transcript and silently writing memories
  is the exact failure this design exists to prevent. Extraction can come later, as a
  *proposal generator* — it proposes, you still gate.
- **No embeddings or similarity search.** Start with retrieval you can explain. Add
  vector search when keyword search demonstrably fails, not before.
- **No confidence scores.** A number between 0 and 1 doesn't tell you whether to trust a
  claim about your own architecture. You do.
- **No automatic conflict resolution.** Two decisions that disagree should both be
  visible, so a human can see the contradiction.

## The rules, collected

1. Proposals, not direct writes. Agents propose, you approve.
2. Prove the infrastructure before adding intelligence.
3. Pin versions.
4. One connection point (`lib/neo4j.ts`).
5. Small steps, each verified.
6. Unapproved memory is unreachable, not filtered.
7. File by what the record is for: a decision keeps its reasoning, a convention binds
   future work, a note just describes.
