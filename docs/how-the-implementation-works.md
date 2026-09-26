# How the implementation works

For the concepts, see `how-memory-works.md`. This file is about the code.

## The layers

```
HTTP request
     │
     ▼
app/api/**/route.ts        validate input, call the domain, map errors to status codes
     │
     ▼
lib/memory.ts              domain operations — all Cypher lives here
     │
     ▼
lib/neo4j.ts               driver singleton, session lifecycle, result mapping
     │
     ▼
neo4j-driver  ──Bolt :7687──>  Neo4j container
```

Route handlers are thin on purpose. They answer HTTP questions — is this body valid,
what status code, what JSON shape. They never contain Cypher. That means the domain
operations are testable without an HTTP server, and there's exactly one place to look
when a query is wrong.

## lib/neo4j.ts — the connection layer

**One driver per process.** `neo4j.driver()` creates a connection *pool*, not a
connection. It's meant to live for the process lifetime and be closed on shutdown. In
Next's dev server, HMR re-evaluates the module graph on every file save — module scope
is recreated, `globalThis` is not. So the driver is cached on `globalThis` (in
non-production only) to avoid leaking a pool per edit. The symptom when you get this
wrong is connection storms and "too many sessions" errors that look like a database
problem.

**Sessions are borrowed, and always returned.** A session holds a connection from the
pool. `withSession` wraps the work and closes the session in `finally`, which is the
structural fix for the most common bug with this driver.

**`query()` is the single-query convenience**, with a `map` callback so the driver's
result shape and your domain shape stay decoupled. Default mapping is
`record.toObject()`.

**`toNumber()` unwraps integers.** Every integral value coming back from Neo4j is an
`Integer` object rather than a JS number, because Neo4j integers are 64-bit and JS
numbers lose precision past 2^53. Unwrap at the boundary. The driver also accepts
`disableLosslessIntegers: true` or `useBigInt: true` as config, if you'd rather change it
globally.

Type gotcha, worth knowing because the driver's own docs get it wrong: its typings
declare the default export as a `const`, so `neo4j.Record` is not usable in a *type*
position — you get `TS2503: Cannot find namespace 'neo4j'`. Import the types by name
instead, aliasing `Record` because TypeScript has a built-in `Record<K, V>` utility type
that a bare import would shadow:

```ts
import neo4j, {
  type Driver,
  type Integer,
  type Record as Neo4jRecord,
  type Session,
} from "neo4j-driver";
```

## lib/memory.ts — the domain

All Cypher lives here. Four operations: `createProposal`, `listProposals`,
`approveProposal` / `rejectProposal`, `searchMemory`.

**Aliased RETURN + `toObject()`.** The read queries alias each returned field to match
the TypeScript interface exactly:

```cypher
RETURN p.id AS id, p.type AS type, ..., toString(p.createdAt) AS createdAt
```

which lets the mapper be `(record) => record.toObject() as Proposal` — no per-field
`.get()` calls, and no second place to update when the interface changes.

**Approval is one statement, therefore atomic.** Neo4j wraps each statement in a
transaction, so there is no state where a Decision exists unlinked, or a proposal reads
`approved` with nothing behind it. It runs through `session.executeWrite(...)` — the
managed-transaction form — because that retries on transient failures such as deadlocks,
which matters when an agent loop is hammering it.

**`MERGE` versus `CREATE`** inside that statement:

- `MERGE (project:Project {id: p.projectId})` — match-or-create, so a second decision in
  the same project reuses the Project instead of duplicating it. With the uniqueness
  constraint on `Project.id`, this is an index seek.
- `MERGE (workspace)-[:CONTAINS]->(project)` — same idea for the edge, so repeated
  approvals don't stack duplicate relationships.
- `CREATE (decision:Decision { ... })` — always new, and correctly so: approving two
  proposals with the same title is two separate acts of judgement.

**Idempotency lives in the query.** `WHERE p.status = 'pending'` means a second approve
matches zero rows, so the route returns 404 and no duplicate Decision is created. Doing
that check in JavaScript instead would introduce a read-then-write window. Note the
limit honestly: this is verified for *sequential* calls. Two truly simultaneous approvals
can both evaluate the predicate against the same snapshot, and read-committed isolation
won't re-evaluate it after the lock wait — so a duplicate Decision is possible. A
uniqueness constraint on the approval, or an explicit node lock, is the fix.

## Route handlers

`app/api/memory/proposals/route.ts` exports `POST` and `GET`. In the App Router, the file
path defines the URL and the exported function name defines the method. `route.ts` is a
reserved filename. Any other export is not a route, and Next validates the module's shape.

Every route here declares:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

`dynamic` is the one people get bitten by. Route Handlers that read no request data are
candidates for static evaluation — this one could be evaluated once at build time and
that answer served forever. For a health check that means a green light long after the
database died. `force-dynamic` pins each route to per-request execution. Invisible in dev,
essential under `next build`.

`runtime = "nodejs"` is explicit because `neo4j-driver` needs Node built-ins (`net`,
`tls`) and the edge runtime is a constrained V8 isolate without them. `nodejs` is already
the default; stating it prevents a later project-wide runtime change from silently
breaking every route.

**Dynamic segments are async.** Since Next 15, `params` is a Promise:

```ts
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
```

Older tutorials read `params.id` directly, which now yields a Promise.

## Status codes

| Code | When                                                  |
| ---- | ----------------------------------------------------- |
| 200  | success                                                |
| 201  | proposal created                                       |
| 400  | body isn't valid JSON, or validation failed            |
| 404  | no *pending* proposal with that id (also double-approve) |
| 503  | the database is unreachable, not the route's fault     |

503 rather than 500 is the deliberate one: the app is healthy, its dependency isn't, and
that's the signal an uptime monitor should act on.

## Validation

Hand-rolled in `parseProposal` — no dependency. Two choices worth naming:

- It collects **every** failure and returns them as an array, rather than stopping at the
  first. When the caller is an LLM fixing its own payload, one round trip beats four.
- Missing `workspaceId` and `source` get defaults (`"personal"`, `"manual"`) instead of an
  error. Arguable: the graph model says every Decision is `SUPPORTED_BY` a Source, so
  defaulting provenance slightly undermines recording it. Requiring `source` is the
  stricter option.

## Errors

`lib/http.ts` holds the mapping, so the shape of an error response is defined once:
`messageOf` narrows the caught `unknown` (under `strict`, `useUnknownInCatchVariables`
means you cannot touch `.message` without narrowing), and `badRequest` / `notFound` /
`unavailable` produce the responses.

`unavailable` currently returns `error.message` to the client. That's an information
disclosure habit — fine locally, worth gating behind `NODE_ENV` before this faces the
internet.

## Verifying it works

The order matters, and the third check is the one that proves the design:

```bash
API=http://localhost:3000/api

# 1. create -> status pending
curl -s -X POST $API/memory/proposals -H "Content-Type: application/json" -d '{...}'

# 2. it is listed as pending
curl -s $API/memory/proposals

# 3. GATE CHECK: search must return 0 — unapproved memory is unreachable
curl -s $API/memory/search

# 4. approve
curl -s -X POST $API/memory/proposals/<id>/approve

# 5. now search returns it
curl -s $API/memory/search

# 6. approving again -> 404
curl -s -X POST $API/memory/proposals/<id>/approve
```

Then look at the graph itself rather than trusting the API:

```bash
docker exec memory-neo4j cypher-shell -u neo4j -p <password> \
  "MATCH (w:Workspace)-[:CONTAINS]->(p:Project)-[:HAS_DECISION]->(d:Decision)-[:SUPPORTED_BY]->(s:Source)
   RETURN w.id, p.id, d.title, s.reference"
```

Expected after one approval and one rejection: 2 Proposals, 1 Decision, 1 Project,
1 Source, 1 Workspace. If Decision count exceeds approvals, the gate is leaking.

Or use Neo4j Browser at <http://localhost:7474> — `MATCH (n) RETURN n` renders the actual
graph, which is more convincing than a row count.

## Debugging reference

| Symptom                                          | Cause                                                    | Fix                                              |
| ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| `Cannot find namespace 'neo4j'`                  | Using the default import in a type position               | Named type imports, alias `Record`               |
| `Constraint validation failed` on a node          | Duplicate value for a constrained property                | The constraint working. Use `MERGE`, not `CREATE` |
| `Cannot delete node, because it still has relationships` | Plain `DELETE` on a connected node                | `DETACH DELETE`                                  |
| "too many sessions" / connection storm            | Driver not cached across HMR reloads                      | The `globalThis` cache                           |
| `params.id` is a Promise                          | Next 15+ async dynamic APIs                               | `const { id } = await params`                    |
| Route fails only in production builds             | Static evaluation caching a DB read                       | `export const dynamic = "force-dynamic"`         |
| Integers arrive as objects, not numbers           | 64-bit lossless integers by default                       | `toNumber()` at the boundary                     |
| Random `503`s under load                          | Pool exhausted by leaked sessions                         | Always close sessions — use `withSession`        |

## What's next

- `getProjectContext(projectId)` — grouped decisions per project, for the third agent tool.
- Auth on the write endpoints, so "a human approves" is enforced and not merely assumed.
- A full-text index to replace `CONTAINS`.
- Deduplication on proposal create.
- `Technology` + `USES` in the model, currently unused.
