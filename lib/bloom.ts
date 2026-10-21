import { isDate, isDateTime, isDuration, isInt, isLocalDateTime, isLocalTime, isPoint, isTime } from "neo4j-driver";

import { withSession } from "@/lib/neo4j";

// A hard ceiling per draw. Bloom is a browsing tool, not an export; a scene
// beyond this size is a query problem, and the snapshot keeps the canvas honest.
export const NODE_LIMIT = 600;
export const RELATIONSHIP_LIMIT = 1200;

export interface BloomNode {
  /** elementId(n) — the database identity of this node. */
  id: string;
  label: string;
  /** The human caption for this node: a title where one exists, else the id. */
  caption: string;
  /** Every stored property, verbatim, stringified for the wire. */
  properties: Record<string, string>;
}

export interface BloomRelationship {
  id: string;
  type: string;
  from: string;
  to: string;
  properties: Record<string, string>;
}

export interface BloomGraph {
  nodes: BloomNode[];
  relationships: BloomRelationship[];
  /** Label -> count, across the whole database (not just the snapshot). */
  labelCounts: Record<string, number>;
  truncated: boolean;
}

/** Driver values arrive as Temporal objects and Integers; the graph ships as plain strings. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (
    isInt(value) ||
    isDate(value) ||
    isDateTime(value) ||
    isDuration(value) ||
    isLocalDateTime(value) ||
    isLocalTime(value) ||
    isTime(value) ||
    isPoint(value)
  ) {
    return value.toString();
  }
  if (Array.isArray(value)) return JSON.stringify(value.map(stringify));
  if (typeof value === "object") {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          stringify(entry),
        ]),
      ),
    );
  }
  return String(value);
}

function stringifyProperties(properties: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, stringify(value)]),
  );
}

/** The caption rules, per label — what Bloom would print under a node. */
function captionFor(label: string, properties: Record<string, string>): string {
  if (properties.title) return properties.title;
  if (properties.reference) return properties.reference;
  return properties.id ?? "";
}

/**
 * A read-only snapshot of everything the database holds: nodes, relationships,
 * and label census. Three queries, one session, one unit of work — the page
 * and the API route both draw through here, so the view and its JSON twin can
 * never disagree.
 */
export async function getBloomGraph(): Promise<BloomGraph> {
  return withSession(async (session) => {
    // Sequential, not Promise.all: a driver session refuses concurrent work.
    // Same pattern as getProjectContext — one session, one query at a time.
    const nodeRows = await session.run(
      `MATCH (n)
       WITH n, labels(n)[0] AS label
       ORDER BY label
       WITH n, label
       LIMIT ${NODE_LIMIT}
       RETURN elementId(n) AS id,
              label,
              properties(n) AS properties`,
    );
    const relationshipRows = await session.run(
      `MATCH ()-[r]->()
       WITH r LIMIT ${RELATIONSHIP_LIMIT}
       RETURN elementId(r) AS id,
              type(r) AS type,
              elementId(startNode(r)) AS from,
              elementId(endNode(r)) AS to,
              properties(r) AS properties`,
    );
    const countRows = await session.run(
      `MATCH (n)
       RETURN labels(n)[0] AS label, count(*) AS count
       ORDER BY count DESC`,
    );

    const nodes: BloomNode[] = nodeRows.records.map((record) => {
      const label = record.get("label") as string;
      const properties = stringifyProperties(record.get("properties") as object);
      return {
        id: record.get("id") as string,
        label,
        caption: captionFor(label, properties),
        properties,
      };
    });

    const relationships: BloomRelationship[] = relationshipRows.records.map(
      (record) => ({
        id: record.get("id") as string,
        type: record.get("type") as string,
        from: record.get("from") as string,
        to: record.get("to") as string,
        properties: stringifyProperties(record.get("properties") as object),
      }),
    );

    const labelCounts: Record<string, number> = {};
    for (const row of countRows.records) {
      labelCounts[row.get("label") as string] = (
        row.get("count") as { toNumber(): number }
      ).toNumber();
    }

    // A truncated snapshot still shows counts for the whole database, so the
    // legend stays honest about what is off-screen.
    const truncated =
      nodes.length >= NODE_LIMIT || relationships.length >= RELATIONSHIP_LIMIT;

    return { nodes, relationships, labelCounts, truncated };
  });
}
