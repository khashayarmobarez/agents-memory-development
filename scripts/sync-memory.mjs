#!/usr/bin/env node
/**
 * Moves the memory graph between the Aura database (source of truth) and the
 * local Docker Neo4j (weekly mirror and archive target).
 *
 *   push            local  -> Aura   (initial migration, local-primary recovery)
 *   pull            Aura   -> timestamped archive, then atomically replaces local
 *   restore <file>  archive -> local (disaster recovery)
 *   ping            one query against Aura, so a Free instance never auto-pauses
 *
 * Credentials arrive through --env-file flags, e.g.:
 *   node --env-file=.env.aura --env-file=.env.localdb scripts/sync-memory.mjs pull
 *
 * The pull never touches local data it has not first archived, refuses to run
 * against an empty remote, and swaps the local graph inside one transaction.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import neo4j from "neo4j-driver";

const LABELS = ["Workspace", "Project", "Decision", "Source", "Proposal"];
const REL_TYPES = ["CONTAINS", "HAS_DECISION", "SUPPORTED_BY"];
const CONSTRAINED_LABELS = ["Workspace", "Project", "Decision", "Source"];

const command = process.argv[2];
const arg = process.argv[3];
const allowEmpty = process.env.ALLOW_EMPTY === "1";

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function endpoint(prefix) {
  const uri = process.env[`${prefix}_URI`];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  const database = process.env[`${prefix}_DATABASE`] ?? "neo4j";

  if (!uri || !username || !password) {
    fail(
      `${prefix}_URI/${prefix}_USERNAME/${prefix}_PASSWORD missing — ` +
        `pass the right --env-file (see the header of this script)`,
    );
  }

  return { uri, username, password, database };
}

function open({ uri, username, password, database }) {
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  return { driver, session: driver.session({ database }) };
}

async function close(target) {
  await target.session.close();
  await target.driver.close();
}

async function readGraph(session, side) {
  const nodes = [];
  const nodesResult = await session.run(
    "MATCH (n) RETURN labels(n)[0] AS label, properties(n) AS props",
  );
  for (const record of nodesResult.records) {
    const label = record.get("label");
    const props = record.get("props");
    if (!LABELS.includes(label)) {
      console.warn(`warning: ${side}: skipping node with unknown label ${String(label)}`);
      continue;
    }
    if (props.id == null) {
      console.warn(`warning: ${side}: skipping ${label} without id`);
      continue;
    }
    nodes.push({ label, id: props.id, props });
  }

  const rels = [];
  const relsResult = await session.run(
    `MATCH (a)-[r]->(b)
     RETURN type(r) AS type, properties(r) AS props,
            labels(a)[0] AS fromLabel, a.id AS from,
            labels(b)[0] AS toLabel, b.id AS to`,
  );
  for (const record of relsResult.records) {
    const type = record.get("type");
    if (!REL_TYPES.includes(type)) {
      console.warn(`warning: ${side}: skipping unknown relationship ${String(type)}`);
      continue;
    }
    rels.push({
      type,
      props: record.get("props"),
      fromLabel: record.get("fromLabel"),
      from: record.get("from"),
      toLabel: record.get("toLabel"),
      to: record.get("to"),
    });
  }

  return { nodes, rels };
}

function counts(graph) {
  const byLabel = {};
  for (const node of graph.nodes) {
    byLabel[node.label] = (byLabel[node.label] ?? 0) + 1;
  }
  const byType = {};
  for (const rel of graph.rels) {
    byType[rel.type] = (byType[rel.type] ?? 0) + 1;
  }
  return {
    nodes: graph.nodes.length,
    relationships: graph.rels.length,
    byLabel,
    byType,
  };
}

function printCounts(title, summary) {
  console.log(`${title}: ${summary.nodes} nodes, ${summary.relationships} relationships`);
  console.log(`  nodes: ${JSON.stringify(summary.byLabel)}`);
  console.log(`  rels:  ${JSON.stringify(summary.byType)}`);
}

async function ensureConstraints(session) {
  for (const label of CONSTRAINED_LABELS) {
    await session.run(
      `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS
       FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
    );
  }
}

async function writeGraph(tx, graph) {
  for (const label of LABELS) {
    const rows = graph.nodes.filter((node) => node.label === label);
    if (rows.length > 0) {
      await tx.run(
        `UNWIND $rows AS row
         MERGE (n:${label} {id: row.id})
         SET n = row.props`,
        { rows: rows.map(({ id, props }) => ({ id, props })) },
      );
    }
  }

  const groups = new Map();
  for (const rel of graph.rels) {
    const key = `${rel.type}\u0000${rel.fromLabel}\u0000${rel.toLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rel);
  }
  for (const [key, rows] of groups) {
    const [type, fromLabel, toLabel] = key.split("\u0000");
    await tx.run(
      `UNWIND $rows AS row
       MATCH (a:${fromLabel} {id: row.from}), (b:${toLabel} {id: row.to})
       MERGE (a)-[r:${type}]->(b)
       SET r = row.props`,
      { rows: rows.map(({ from, to, props }) => ({ from, to, props })) },
    );
  }
}

async function replaceLocal(session, graph) {
  await ensureConstraints(session);
  await session.executeWrite(async (tx) => {
    await tx.run("MATCH (n) DETACH DELETE n");
    await writeGraph(tx, graph);
  });
}

function dateTimeToIso(value) {
  if (typeof value.toStandardDate === "function") {
    return value.toStandardDate().toISOString();
  }
  return new Date(value.toString()).toISOString();
}

function serializeProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && typeof value === "object" && neo4j.isDateTime(value)) {
      out[key] = { $datetime: dateTimeToIso(value) };
    } else {
      out[key] = value;
    }
  }
  return out;
}

function deserializeProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && typeof value === "object" && "$datetime" in value) {
      out[key] = neo4j.types.DateTime.fromStandardDate(new Date(value.$datetime));
    } else {
      out[key] = value;
    }
  }
  return out;
}

function archiveDir() {
  const dir = process.env.BACKUP_DIR;
  if (!dir) fail("BACKUP_DIR missing — set it in .env.aura");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pruneArchives(dir) {
  const keep = Number(process.env.KEEP ?? "12");
  const files = readdirSync(dir)
    .filter((name) => /^memory-.*\.json$/.test(name))
    .sort();
  const excess = files.slice(0, Math.max(0, files.length - keep));
  for (const name of excess) {
    unlinkSync(join(dir, name));
    console.log(`pruned old archive: ${name}`);
  }
}

function writeArchive(graph) {
  const dir = archiveDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `memory-${stamp}.json`);
  const payload = {
    exportedAt: new Date().toISOString(),
    source: "aura",
    counts: counts(graph),
    nodes: graph.nodes.map((node) => ({
      label: node.label,
      id: node.id,
      props: serializeProps(node.props),
    })),
    rels: graph.rels.map((rel) => ({ ...rel, props: serializeProps(rel.props) })),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  pruneArchives(dir);
  return file;
}

function readArchive(file) {
  const archive = JSON.parse(readFileSync(file, "utf8"));
  return {
    nodes: archive.nodes.map((node) => ({
      label: node.label,
      id: node.id,
      props: deserializeProps(node.props),
    })),
    rels: archive.rels.map((rel) => ({ ...rel, props: deserializeProps(rel.props) })),
  };
}

async function run() {
  if (!command) fail("usage: sync-memory.mjs <push|pull|restore <file>|ping>");

  if (command === "ping") {
    const aura = open(endpoint("AURA"));
    try {
      const result = await aura.session.run("RETURN 1 AS one");
      if (result.records.length !== 1) fail("unexpected ping result");
      console.log(`aura ok at ${new Date().toISOString()}`);
    } finally {
      await close(aura);
    }
    return;
  }

  if (command === "restore") {
    if (!arg) fail("restore needs an archive file path");
    const graph = readArchive(arg);
    const local = open(endpoint("LOCAL"));
    try {
      await replaceLocal(local.session, graph);
      printCounts("local after restore", counts(graph));
    } finally {
      await close(local);
    }
    return;
  }

  const auraEndpoint = endpoint("AURA");
  const localEndpoint = endpoint("LOCAL");

  if (auraEndpoint.uri === localEndpoint.uri) {
    fail("refusing to mirror a database onto itself (AURA_URI === LOCAL_URI)");
  }

  if (command === "push") {
    const local = open(localEndpoint);
    const aura = open(auraEndpoint);
    try {
      const graph = await readGraph(local.session, "local");
      if (graph.nodes.length === 0 && !allowEmpty) {
        fail("local graph is empty — refusing to push (set ALLOW_EMPTY=1 to force)");
      }
      printCounts("local", counts(graph));

      await ensureConstraints(aura.session);
      await aura.session.executeWrite((tx) => writeGraph(tx, graph));

      const after = await readGraph(aura.session, "aura");
      printCounts("aura after push", counts(after));
    } finally {
      await close(local);
      await close(aura);
    }
    return;
  }

  if (command === "pull") {
    const aura = open(auraEndpoint);
    let graph;
    try {
      graph = await readGraph(aura.session, "aura");
    } finally {
      await close(aura);
    }

    if (graph.nodes.length === 0 && !allowEmpty) {
      fail("aura graph is empty — refusing to archive/mirror (set ALLOW_EMPTY=1 to force)");
    }
    printCounts("aura", counts(graph));

    const file = writeArchive(graph);
    console.log(`archive: ${file}`);

    const local = open(localEndpoint);
    try {
      await replaceLocal(local.session, graph);
      const after = await readGraph(local.session, "local");
      printCounts("local after mirror", counts(after));
    } catch (error) {
      console.error(
        `archive saved, but local mirror FAILED: ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
    } finally {
      await close(local);
    }
    return;
  }

  fail(`unknown command: ${command}`);
}

run().catch((error) => {
  console.error(`fatal: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
