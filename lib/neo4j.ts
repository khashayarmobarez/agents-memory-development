import neo4j, {
  type Driver,
  type Integer,
  type Record as Neo4jRecord,
  type Session,
} from "neo4j-driver";

const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = process.env;

if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  throw new Error("Missing Neo4j env vars — see web/.env.local");
}

export const DATABASE = NEO4J_DATABASE ?? "neo4j";

// HMR re-evaluates this module on every edit. Without a global cache, each
// reload leaks a driver together with its connection pool.
const cache = globalThis as typeof globalThis & { __neo4jDriver?: Driver };

export const driver: Driver =
  cache.__neo4jDriver ??
  neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));

if (process.env.NODE_ENV !== "production") {
  cache.__neo4jDriver = driver;
}

/** Run work in a session, always closing it. Use when a unit of work spans queries. */
export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const session = driver.session({ database: DATABASE });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/** Single-query convenience. `map` defaults to `record.toObject()`. */
export async function query<T>(
  cypher: string,
  params: Record<string, unknown> = {},
  map: (record: Neo4jRecord) => T = (record) => record.toObject() as T,
): Promise<T[]> {
  return withSession(async (session) => {
    const { records } = await session.run(cypher, params);
    return records.map(map);
  });
}

/** Neo4j returns Integer objects for anything integral; unwrap at the boundary. */
export function toNumber(value: unknown): number {
  return neo4j.isInt(value) ? (value as Integer).toNumber() : Number(value);
}
