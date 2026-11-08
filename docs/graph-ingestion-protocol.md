# AI Capital Intelligence — Phase G.1: Convex-to-TypeDB Append-Only Projection Protocol

## 1. Design Principles

1. **Convex Remains the Immutable Durability Ledger**:
   - No AI agent or external collector can write directly to TypeDB. All candidate research is staged in Convex, validated against prompt injection and provenance rules, and gated by human `reviewer` authority.
2. **Append-Only Outbox Pattern**:
   - Approved relationships are written to Convex’s `graphProjectionOutbox` table ([`convex/schema.ts`](../convex/schema.ts), [`convex/graph.ts`](../convex/graph.ts)) with monotonic per-owner sequence numbers (`sequence = 1, 2, ...`).
3. **Deterministic Idempotency (`projectionKey`)**:
   - Every outbox item carries a deterministic SHA-256 `projectionKey` (`computeDeterministicProjectionKey` in [`lib/graph/projection-engine.ts`](../lib/graph/projection-engine.ts)):
     ```
     proj:<sha256(owner | visibility | schemaVersion | relationshipId | relationshipVersion | participants | sources | publishedAtMs | receivedAtMs)>
     ```
   - Re-enqueueing or replaying the same relationship version is a strict no-op (`deduplicated: true`) in Convex and executes idempotent `put` statements in TypeDB 3.14.

---

## 2. Convex Outbox & Checkpoint Schema (`convex/schema.ts`)

### 2.1 `graphProjectionOutbox`
- `owner`: Clerk `tokenIdentifier`
- `visibility`: `'public_research' | 'private_tenant'`
- `sequence`: Monotonic sequence number per owner
- `projectionKey`: Deterministic SHA-256 key (indexed by `by_projection_key`)
- `sourceTable` & `sourceRecordId`: Pointer to the originating Convex evidence record
- `sourceEvidenceIds`: Array of immutable `source_doc_id` keys
- `graphSchemaVersion`: `'macro-intelligence-graph-3.14-v1'`
- `relationshipId`: Canonical `relationship_id`
- `payloadJson`: Canonical JSON of `MacroRelationship`
- `typeqlJson`: Pre-compiled array of idempotent TypeQL 3.14 `put` statements
- `reviewer`: Reviewer `tokenIdentifier` who authorised promotion
- `status`: `'pending' | 'projected' | 'retrying' | 'dead_letter'`
- `attemptCount`, `maxAttempts`, `nextAttemptAtMs`, `lastError`, `projectedAtMs`
- `executionAuthority`: `'none'`

### 2.2 `graphProjectionCheckpoints`
- Tracks `lastProjectedSequence`, `lastProjectionKey`, `projectedCount`, `pendingCount`, `retryingCount`, `deadLetterCount`, `maxProjectionLagMs`, and `replayedAtMs`.

### 2.3 `graphQueryAudit`
- Records every read-only graph query (`queryType`, `parametersJson`, `asOfMs`, `nodeCount`, `edgeCount`, `backendMode`, `latencyMs`, `atMs`, `executionAuthority: 'none'`).

---

## 3. Worker Execution & Failure Recovery

### 3.1 TypeScript & Python Projection Workers
- **TypeScript HTTP Projection Engine**: [`lib/graph/projection-engine.ts`](../lib/graph/projection-engine.ts) + [`lib/graph/typedb-driver-adapter.ts`](../lib/graph/typedb-driver-adapter.ts) using `@typedb/driver-http@3.14.0`.
- **Python gRPC Projection Worker**: [`worker/graph_projection.py`](../worker/graph_projection.py) using `typedb-driver==3.14.0`:
  ```bash
  # Dry-run compilation & outbox verification
  python -m worker.graph_projection --dry-run

  # Live gRPC projection into TypeDB 3.14.2 (127.0.0.1:1729)
  python -m worker.graph_projection --live
  ```

### 3.2 Exponential Backoff, Dead-Letter Queue & Checkpoint Replay
1. **Retry Backoff (`computeRetryBackoffMs`)**:
   - Transient TypeDB errors increment `attemptCount`, set `status = "retrying"`, and schedule `nextAttemptAtMs = nowMs + min(2000 * 2^(attempt - 1), 300000)`.
2. **Dead-Letter Transition**:
   - Once `attemptCount >= maxAttempts`, `status` transitions to `"dead_letter"` and `lastError` is preserved for operator inspection.
3. **Deterministic Checkpoint Replay (`replayFromCheckpoint` / `replayOutboxFromCheckpoint`)**:
   - Any sequence range `sequence > fromSequence` can be reset to `pending` and re-projected into a fresh or recovered TypeDB 3.14 database with zero duplicate nodes or edges.
