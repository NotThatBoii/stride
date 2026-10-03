import { defaults } from "../../models";
import { enqueueOperation, type StrideDatabase } from "../local-database";
import { assertAccountDatabase } from "./conflicts";
import type { SyncGuard } from "./types";

// Old account caches may contain rows without an outbox entry. Link only
// after the complete first pull has reconciled same-ID cloud records.
export async function bootstrapAccount(db: StrideDatabase, guard: SyncGuard) {
  guard();
  await assertAccountDatabase(db);
  await db.transaction(
    "rw",
    [
      db.subjects,
      db.sessions,
      db.slices,
      db.preferences,
      db.pendingOperations,
      db.recordRevisions,
      db.conflicts,
      db.syncMetadata,
    ],
    async () => {
      guard();
      if ((await db.syncMetadata.get("account_cache_linked"))?.value === "1")
        return;
      const pending = await db.pendingOperations.toArray();
      const revisions = await db.recordRevisions.toArray();
      const conflicts = await db.conflicts
        .filter((c) => !c.resolved_at)
        .toArray();
      const known = new Set(
        [...pending, ...revisions, ...conflicts].map(
          (row) => `${row.entity}:${row.record_id}`,
        ),
      );
      const subjects = await db.subjects.toArray();
      const sessions = await db.sessions.toArray();
      for (const subject of subjects) {
        guard();
        if (!known.has(`subject:${subject.id}`))
          await enqueueOperation(db, "subject", subject.id, "upsert", subject);
      }
      for (const session of sessions) {
        guard();
        if (!known.has(`session:${session.id}`))
          await enqueueOperation(db, "session", session.id, "upsert", {
            session,
            slices: await db.slices
              .where("session_id")
              .equals(session.id)
              .toArray(),
          });
      }
      const settings = (await db.preferences.get(1)) ?? { ...defaults };
      if (
        (subjects.length ||
          sessions.length ||
          settings.minimum !== defaults.minimum ||
          settings.goal !== defaults.goal ||
          settings.presets !== defaults.presets ||
          settings.weekStart !== defaults.weekStart) &&
        !known.has("settings:settings")
      )
        await enqueueOperation(db, "settings", "settings", "upsert", settings);
      guard();
      await db.syncMetadata.put({ key: "account_cache_linked", value: "1" });
    },
  );
}
