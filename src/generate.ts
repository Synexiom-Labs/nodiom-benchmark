import fs from "node:fs/promises";

function project(id: number): string {
  const n = String(id).padStart(3, "0");

  return `# Project ${n}

## Overview

Project ${n} is an internal analytics platform used by the engineering
organization. It processes operational events from several services and
exposes the resulting information through a versioned API.

The system is designed around reliability, observability, predictable
performance, and straightforward operational maintenance. The project
documentation is maintained in Markdown so that engineers and automated
agents can update it without requiring a separate database.

## Goals

- Reduce event processing latency
- Improve reliability
- Simplify deployment
- Improve documentation
- Reduce operational overhead
- Improve monitoring coverage
- Establish clear ownership boundaries

## Tasks

- [ ] Design ingestion pipeline
- [ ] Implement event processor
- [ ] Add integration tests
- [ ] Update deployment documentation
- [ ] Review monitoring configuration
- [ ] Document failure recovery procedures
- [ ] Review database indexes
- [ ] Add operational dashboards

## Architecture

### Backend

The backend is implemented using Node.js and PostgreSQL. Services
communicate through versioned HTTP APIs and asynchronous background
workers.

The service layer is intentionally divided into small components so that
individual responsibilities can be tested independently. Background
processing is isolated from request handling to prevent long-running
operations from blocking API traffic.

### Frontend

The frontend uses React and TypeScript. The application communicates
with the backend through a versioned REST API.

The frontend is deployed independently from the backend and consumes
only documented API contracts.

### Storage

PostgreSQL is the primary datastore. Object storage is used for large
immutable artifacts and generated reports.

Database migrations are reviewed alongside application changes.

### Observability

Services emit structured logs and application metrics. Operational
dashboards track request latency, error rates, queue depth, and database
health.

## Decisions

We selected PostgreSQL because the workload requires relational queries
and transactional guarantees.

The team decided against introducing additional infrastructure until the
operational need is demonstrated through measurements.

Architecture changes should be documented here so that future engineers
and automated agents can understand why a particular technology was
selected.

## Notes

The team is currently evaluating whether Redis should be introduced.

Any caching layer must have clear invalidation semantics, monitoring,
capacity planning, and an explicit failure strategy.

The current implementation does not depend on Redis.

## Risks

The primary risks are database growth, increasing event volume, and
operational complexity as the number of customers increases.

The team should periodically review these risks and update the mitigation
plan when assumptions change.

## Operational Notes

Deployments should be performed through the standard CI pipeline.

Emergency changes must be documented after the incident has been
resolved.

## References

- Internal API documentation
- Deployment runbook
- Database migration guide
- Monitoring dashboard
- Incident response procedure

`;
}

function buildDocument(targetBytes: number): string {
  let output = `# Engineering Knowledge Base

This document contains project documentation used by the engineering
organization.

It intentionally contains many independent Markdown sections so that
structured editing approaches can be compared with whole-file editing.

`;

  let projectNumber = 1;

  while (Buffer.byteLength(output) < targetBytes) {
    output += project(projectNumber);
    projectNumber++;
  }

  return output;
}

async function main() {
  const targets = [
    { name: "10kb", bytes: 10 * 1024 },
    { name: "50kb", bytes: 50 * 1024 },
    { name: "250kb", bytes: 250 * 1024 },
    { name: "1mb", bytes: 1024 * 1024 }
  ];

  /* corpus/ is generated and gitignored, so a fresh clone has no such
   * directory yet. */
  await fs.mkdir("corpus", { recursive: true });

  for (const target of targets) {
    const content = buildDocument(target.bytes);
    const path = `corpus/${target.name}.md`;

    await fs.writeFile(path, content);

    const bytes = Buffer.byteLength(content);

    console.log(
      `${target.name}: ${bytes.toLocaleString()} bytes`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
