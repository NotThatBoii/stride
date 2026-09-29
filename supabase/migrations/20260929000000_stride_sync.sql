-- Stride cloud schema. The existing Dexie database remains the local source of truth.
-- This migration contains no data import, authentication UI, or sync client.

CREATE SCHEMA IF NOT EXISTS stride_private;

CREATE TABLE public.stride_subjects (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (pg_catalog.char_length(id) BETWEEN 1 AND 200),
  name text NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (pg_catalog.char_length(description) <= 500),
  icon text NOT NULL CHECK (pg_catalog.char_length(icon) <= 20),
  color text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz NOT NULL,
  archived integer NOT NULL CHECK (archived IN (0, 1)),
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE public.stride_sessions (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (pg_catalog.char_length(id) BETWEEN 1 AND 200),
  subject_id text NOT NULL CHECK (pg_catalog.char_length(subject_id) BETWEEN 1 AND 200),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_seconds double precision NOT NULL
    CHECK (duration_seconds > 0 AND duration_seconds < 'Infinity'::double precision),
  session_title text NOT NULL CHECK (pg_catalog.char_length(session_title) <= 160),
  notes text NOT NULL CHECK (pg_catalog.char_length(notes) <= 4000),
  mode text NOT NULL CHECK (mode IN ('stopwatch', 'countdown')),
  completed integer NOT NULL CHECK (completed = 1),
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, subject_id)
    REFERENCES public.stride_subjects(owner_id, id) ON DELETE CASCADE,
  CHECK (ended_at >= started_at),
  CHECK (duration_seconds <= pg_catalog.date_part('epoch', ended_at - started_at) + 0.01)
);

CREATE INDEX stride_sessions_owner_subject_idx
  ON public.stride_sessions (owner_id, subject_id);

CREATE TABLE public.stride_allocations (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL CHECK (pg_catalog.char_length(session_id) BETWEEN 1 AND 200),
  day date NOT NULL,
  seconds double precision NOT NULL
    CHECK (seconds >= 0 AND seconds < 'Infinity'::double precision),
  PRIMARY KEY (owner_id, session_id, day),
  FOREIGN KEY (owner_id, session_id)
    REFERENCES public.stride_sessions(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.stride_preferences (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  minimum integer NOT NULL CHECK (minimum BETWEEN 1 AND 1440),
  goal integer NOT NULL CHECK (goal BETWEEN 1 AND 1440),
  presets text NOT NULL,
  week_start integer NOT NULL CHECK (week_start IN (0, 1))
);

-- Private tables are not in PostgREST's exposed schema. Every row is still
-- scoped to an auth user and RLS is enabled as a second line of defense.
CREATE TABLE stride_private.stride_record_versions (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('subject', 'session', 'settings')),
  record_id text NOT NULL CHECK (pg_catalog.char_length(record_id) BETWEEN 1 AND 200),
  revision bigint NOT NULL CHECK (revision > 0),
  deleted boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (owner_id, entity, record_id),
  CHECK (entity <> 'settings' OR record_id = 'settings')
);

CREATE TABLE stride_private.stride_sync_clocks (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);

CREATE TABLE stride_private.stride_sync_changes (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  entity text NOT NULL CHECK (entity IN ('subject', 'session', 'settings')),
  record_id text NOT NULL CHECK (pg_catalog.char_length(record_id) BETWEEN 1 AND 200),
  action text NOT NULL CHECK (action IN ('upsert', 'delete')),
  payload jsonb,
  revision bigint NOT NULL CHECK (revision > 0),
  operation_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (owner_id, sequence),
  CHECK ((action = 'delete' AND payload IS NULL) OR
         (action = 'upsert' AND payload IS NOT NULL))
);

CREATE TABLE stride_private.stride_sync_operations (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  request_hash bytea NOT NULL CHECK (pg_catalog.octet_length(request_hash) = 32),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (owner_id, operation_id)
);

ALTER TABLE public.stride_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stride_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stride_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stride_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE stride_private.stride_record_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stride_private.stride_sync_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stride_private.stride_sync_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stride_private.stride_sync_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY stride_subjects_read_own ON public.stride_subjects
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY stride_sessions_read_own ON public.stride_sessions
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY stride_allocations_read_own ON public.stride_allocations
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY stride_preferences_read_own ON public.stride_preferences
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- Supabase grants broad defaults in public. Remove them explicitly: all writes
-- must pass through the transactional RPC, even for the row's owner.
REVOKE ALL ON public.stride_subjects, public.stride_sessions,
  public.stride_allocations, public.stride_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stride_subjects, public.stride_sessions,
  public.stride_allocations, public.stride_preferences TO authenticated;
REVOKE ALL ON SCHEMA stride_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA stride_private FROM PUBLIC, anon, authenticated;

-- A deferred check protects sessions even if a future privileged code path
-- accidentally writes a session without matching daily allocations.
CREATE FUNCTION stride_private.assert_allocation_total(p_owner uuid, p_session text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_duration double precision;
  v_total double precision;
BEGIN
  SELECT s.duration_seconds INTO v_duration
    FROM public.stride_sessions AS s
    WHERE s.owner_id = p_owner AND s.id = p_session;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(pg_catalog.sum(a.seconds), 0) INTO v_total
    FROM public.stride_allocations AS a
    WHERE a.owner_id = p_owner AND a.session_id = p_session;
  IF pg_catalog.abs(v_total - v_duration) > 0.01 THEN
    RAISE EXCEPTION 'Session allocations do not match duration'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION stride_private.check_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'stride_sessions' THEN
    IF TG_OP <> 'INSERT' THEN
      PERFORM stride_private.assert_allocation_total(OLD.owner_id, OLD.id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM stride_private.assert_allocation_total(NEW.owner_id, NEW.id);
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      PERFORM stride_private.assert_allocation_total(OLD.owner_id, OLD.session_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      PERFORM stride_private.assert_allocation_total(NEW.owner_id, NEW.session_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER stride_sessions_allocation_total
  AFTER INSERT OR UPDATE OR DELETE ON public.stride_sessions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stride_private.check_allocation_total();
CREATE CONSTRAINT TRIGGER stride_allocations_total
  AFTER INSERT OR UPDATE OR DELETE ON public.stride_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stride_private.check_allocation_total();

-- Called only while the owning user's clock row is locked. It allocates a
-- contiguous per-user sequence within the caller's transaction.
CREATE FUNCTION stride_private.append_change(
  p_owner uuid, p_entity text, p_record_id text, p_action text,
  p_payload jsonb, p_revision bigint, p_operation_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sequence bigint;
BEGIN
  UPDATE stride_private.stride_sync_clocks
    SET sequence = sequence + 1
    WHERE owner_id = p_owner
    RETURNING sequence INTO v_sequence;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing synchronization clock' USING ERRCODE = '23514';
  END IF;
  INSERT INTO stride_private.stride_sync_changes
    (owner_id, sequence, entity, record_id, action, payload, revision, operation_id)
  VALUES
    (p_owner, v_sequence, p_entity, p_record_id, p_action,
     p_payload, p_revision, p_operation_id);
  RETURN v_sequence;
END;
$$;

-- The authenticated role may execute this core but cannot choose an owner.
-- The schema is deliberately absent from Supabase's exposed API schemas.
CREATE FUNCTION stride_private.apply_sync_operation_core(
  p_operation_id uuid,
  p_entity text,
  p_record_id text,
  p_action text,
  p_payload jsonb,
  p_expected_revision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_hash bytea;
  v_receipt stride_private.stride_sync_operations%ROWTYPE;
  v_existing_revision bigint;
  v_existing_deleted boolean;
  v_expected bigint;
  v_current jsonb;
  v_revision bigint;
  v_sequence bigint;
  v_result jsonb;
  v_child record;
  v_slice jsonb;
  v_day date;
  v_seconds double precision;
  v_total double precision := 0;
  v_started timestamptz;
  v_ended timestamptz;
  v_duration double precision;
  v_presets text[];
  v_preset text;
  v_number integer;
  v_numbers integer[] := ARRAY[]::integer[];
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR p_entity IS NULL
     OR p_entity NOT IN ('subject', 'session', 'settings')
     OR p_action IS NULL OR p_action NOT IN ('upsert', 'delete')
     OR p_record_id IS NULL OR pg_catalog.char_length(p_record_id) NOT BETWEEN 1 AND 200
     OR (p_entity = 'settings' AND p_record_id <> 'settings') THEN
    RAISE EXCEPTION 'Invalid sync operation envelope' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NOT NULL THEN
    IF p_expected_revision !~ '^[1-9][0-9]*$'
       OR pg_catalog.char_length(p_expected_revision) > 19 THEN
      RAISE EXCEPTION 'Invalid expected revision' USING ERRCODE = '22023';
    END IF;
    v_expected := p_expected_revision::bigint;
  END IF;
  IF p_action = 'delete' AND p_payload IS NOT NULL THEN
    RAISE EXCEPTION 'Delete payload must be null' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'upsert' AND
     (p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object') THEN
    RAISE EXCEPTION 'Upsert payload must be an object' USING ERRCODE = '22023';
  END IF;

  v_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'entity', p_entity, 'record_id', p_record_id,
      'action', p_action, 'payload', p_payload,
      'expected_revision', p_expected_revision
    )::text, 'UTF8'));

  INSERT INTO stride_private.stride_sync_clocks(owner_id, sequence)
    VALUES (v_owner, 0) ON CONFLICT (owner_id) DO NOTHING;
  -- This row lock serializes revisions, idempotency, and change sequences for
  -- every device connected to one account.
  PERFORM 1 FROM stride_private.stride_sync_clocks
    WHERE owner_id = v_owner FOR UPDATE;

  SELECT * INTO v_receipt
    FROM stride_private.stride_sync_operations
    WHERE owner_id = v_owner AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'Operation ID reused with different request'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT rv.revision, rv.deleted
    INTO v_existing_revision, v_existing_deleted
    FROM stride_private.stride_record_versions AS rv
    WHERE rv.owner_id = v_owner
      AND rv.entity = p_entity AND rv.record_id = p_record_id;
  IF v_existing_revision IS DISTINCT FROM v_expected THEN
    IF NOT COALESCE(v_existing_deleted, false) THEN
      IF p_entity = 'subject' THEN
        SELECT pg_catalog.to_jsonb(s) - 'owner_id' INTO v_current
          FROM public.stride_subjects AS s
          WHERE s.owner_id = v_owner AND s.id = p_record_id;
      ELSIF p_entity = 'session' THEN
        SELECT pg_catalog.jsonb_build_object(
          'session', pg_catalog.to_jsonb(s) - 'owner_id',
          'slices', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'session_id', a.session_id,
              'day', pg_catalog.to_char(a.day, 'YYYY-MM-DD'),
              'seconds', a.seconds) ORDER BY a.day)
            FROM public.stride_allocations AS a
            WHERE a.owner_id = v_owner AND a.session_id = s.id
          ), '[]'::jsonb)) INTO v_current
          FROM public.stride_sessions AS s
          WHERE s.owner_id = v_owner AND s.id = p_record_id;
      ELSE
        SELECT pg_catalog.jsonb_build_object(
          'minimum', sp.minimum, 'goal', sp.goal,
          'presets', sp.presets, 'weekStart', sp.week_start)
          INTO v_current
          FROM public.stride_preferences AS sp
          WHERE sp.owner_id = v_owner;
      END IF;
    END IF;
    v_result := pg_catalog.jsonb_build_object(
      'status', 'conflict', 'entity', p_entity, 'record_id', p_record_id,
      'current_revision', v_existing_revision::text,
      'deleted', COALESCE(v_existing_deleted, false),
      'current_snapshot', v_current);
    INSERT INTO stride_private.stride_sync_operations
      (owner_id, operation_id, request_hash, result)
      VALUES (v_owner, p_operation_id, v_hash, v_result);
    RETURN v_result;
  END IF;

  -- A second delete with a new operation ID and the current tombstone
  -- revision is already satisfied. Store its receipt without another change.
  IF p_action = 'delete' AND COALESCE(v_existing_deleted, false) THEN
    SELECT c.sequence INTO v_sequence
      FROM stride_private.stride_sync_clocks AS c
      WHERE c.owner_id = v_owner;
    v_result := pg_catalog.jsonb_build_object(
      'status', 'applied', 'entity', p_entity, 'record_id', p_record_id,
      'action', p_action, 'revision', v_existing_revision::text,
      'cursor', v_sequence::text);
    INSERT INTO stride_private.stride_sync_operations
      (owner_id, operation_id, request_hash, result)
      VALUES (v_owner, p_operation_id, v_hash, v_result);
    RETURN v_result;
  END IF;

  v_revision := COALESCE(v_existing_revision, 0) + 1;
  IF p_action = 'upsert' THEN
    IF p_entity = 'subject' THEN
      IF NOT (p_payload ?& ARRAY['id','name','description','icon','color','created_at','archived'])
         OR p_payload - ARRAY['id','name','description','icon','color','created_at','archived'] <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(p_payload->'id') <> 'string'
         OR p_payload->>'id' <> p_record_id
         OR pg_catalog.jsonb_typeof(p_payload->'name') <> 'string'
         OR pg_catalog.char_length(pg_catalog.btrim(p_payload->>'name')) NOT BETWEEN 1 AND 80
         OR pg_catalog.jsonb_typeof(p_payload->'description') <> 'string'
         OR pg_catalog.char_length(p_payload->>'description') > 500
         OR pg_catalog.jsonb_typeof(p_payload->'icon') <> 'string'
         OR pg_catalog.char_length(p_payload->>'icon') > 20
         OR pg_catalog.jsonb_typeof(p_payload->'color') <> 'string'
         OR (p_payload->>'color') !~ '^#[0-9a-fA-F]{6}$'
         OR pg_catalog.jsonb_typeof(p_payload->'created_at') <> 'string'
         OR (p_payload->>'created_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR pg_catalog.jsonb_typeof(p_payload->'archived') <> 'number'
         OR p_payload->>'archived' NOT IN ('0', '1') THEN
        RAISE EXCEPTION 'Invalid subject payload' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.stride_subjects
        (owner_id, id, name, description, icon, color, created_at, archived)
      VALUES (v_owner, p_record_id, p_payload->>'name', p_payload->>'description',
        p_payload->>'icon', p_payload->>'color',
        (p_payload->>'created_at')::timestamptz,
        (p_payload->>'archived')::integer)
      ON CONFLICT (owner_id, id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description,
        icon = EXCLUDED.icon, color = EXCLUDED.color,
        created_at = EXCLUDED.created_at, archived = EXCLUDED.archived;

    ELSIF p_entity = 'session' THEN
      IF NOT (p_payload ?& ARRAY['session','slices'])
         OR p_payload - ARRAY['session','slices'] <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(p_payload->'session') <> 'object'
         OR pg_catalog.jsonb_typeof(p_payload->'slices') <> 'array' THEN
        RAISE EXCEPTION 'Invalid session envelope' USING ERRCODE = '22023';
      END IF;
      v_current := p_payload->'session';
      IF NOT (v_current ?& ARRAY['id','subject_id','started_at','ended_at',
                                    'duration_seconds','session_title','notes','mode','completed'])
         OR v_current - ARRAY['id','subject_id','started_at','ended_at',
                              'duration_seconds','session_title','notes','mode','completed'] <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(v_current->'id') <> 'string'
         OR v_current->>'id' <> p_record_id
         OR pg_catalog.jsonb_typeof(v_current->'subject_id') <> 'string'
         OR pg_catalog.char_length(v_current->>'subject_id') NOT BETWEEN 1 AND 200
         OR pg_catalog.jsonb_typeof(v_current->'started_at') <> 'string'
         OR (v_current->>'started_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR pg_catalog.jsonb_typeof(v_current->'ended_at') <> 'string'
         OR (v_current->>'ended_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR pg_catalog.jsonb_typeof(v_current->'duration_seconds') <> 'number'
         OR pg_catalog.jsonb_typeof(v_current->'session_title') <> 'string'
         OR pg_catalog.char_length(v_current->>'session_title') > 160
         OR pg_catalog.jsonb_typeof(v_current->'notes') <> 'string'
         OR pg_catalog.char_length(v_current->>'notes') > 4000
         OR pg_catalog.jsonb_typeof(v_current->'mode') <> 'string'
         OR v_current->>'mode' NOT IN ('stopwatch', 'countdown')
         OR pg_catalog.jsonb_typeof(v_current->'completed') <> 'number'
         OR v_current->>'completed' <> '1' THEN
        RAISE EXCEPTION 'Invalid session payload' USING ERRCODE = '22023';
      END IF;
      v_started := (v_current->>'started_at')::timestamptz;
      v_ended := (v_current->>'ended_at')::timestamptz;
      v_duration := (v_current->>'duration_seconds')::double precision;
      IF v_duration <= 0 OR v_duration >= 'Infinity'::double precision
         OR v_ended < v_started
         OR v_duration > pg_catalog.date_part('epoch', v_ended - v_started) + 0.01 THEN
        RAISE EXCEPTION 'Inconsistent session duration' USING ERRCODE = '22023';
      END IF;
      -- Dexie accepts a much larger backup-wide array, but one completed
      -- session spanning more than 1,000 distinct local days is outside the
      -- practical study-session contract and would amplify deferred checks.
      IF pg_catalog.jsonb_array_length(p_payload->'slices') > 1000 THEN
        RAISE EXCEPTION 'Too many allocations' USING ERRCODE = '22023';
      END IF;
      FOR v_slice IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'slices') LOOP
        IF pg_catalog.jsonb_typeof(v_slice) <> 'object'
           OR NOT (v_slice ?& ARRAY['session_id','day','seconds'])
           OR v_slice - ARRAY['session_id','day','seconds'] <> '{}'::jsonb
           OR pg_catalog.jsonb_typeof(v_slice->'session_id') <> 'string'
           OR v_slice->>'session_id' <> p_record_id
           OR pg_catalog.jsonb_typeof(v_slice->'day') <> 'string'
           OR (v_slice->>'day') !~ '^\d{4}-\d{2}-\d{2}$'
           OR pg_catalog.jsonb_typeof(v_slice->'seconds') <> 'number' THEN
          RAISE EXCEPTION 'Invalid daily allocation' USING ERRCODE = '22023';
        END IF;
        v_day := (v_slice->>'day')::date;
        v_seconds := (v_slice->>'seconds')::double precision;
        IF v_seconds < 0 OR v_seconds >= 'Infinity'::double precision THEN
          RAISE EXCEPTION 'Invalid daily allocation' USING ERRCODE = '22023';
        END IF;
        -- The compound allocation primary key rejects duplicate days when
        -- the validated rows are inserted below, rolling back the RPC.
        v_total := v_total + v_seconds;
      END LOOP;
      IF v_total >= 'Infinity'::double precision
         OR pg_catalog.abs(v_total - v_duration) > 0.01 THEN
        RAISE EXCEPTION 'Daily allocations do not match session duration'
          USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.stride_subjects AS s
        WHERE s.owner_id = v_owner AND s.id = v_current->>'subject_id'
      ) THEN
        RAISE EXCEPTION 'Session subject does not belong to this account'
          USING ERRCODE = '23503';
      END IF;
      INSERT INTO public.stride_sessions
        (owner_id, id, subject_id, started_at, ended_at, duration_seconds,
         session_title, notes, mode, completed)
      VALUES (v_owner, p_record_id, v_current->>'subject_id', v_started,
              v_ended, v_duration, v_current->>'session_title',
              v_current->>'notes', v_current->>'mode', 1)
      ON CONFLICT (owner_id, id) DO UPDATE SET
        subject_id = EXCLUDED.subject_id,
        started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
        duration_seconds = EXCLUDED.duration_seconds,
        session_title = EXCLUDED.session_title, notes = EXCLUDED.notes,
        mode = EXCLUDED.mode, completed = EXCLUDED.completed;
      DELETE FROM public.stride_allocations
        WHERE owner_id = v_owner AND session_id = p_record_id;
      FOR v_slice IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'slices') LOOP
        INSERT INTO public.stride_allocations(owner_id, session_id, day, seconds)
          VALUES (v_owner, p_record_id,
                  (v_slice->>'day')::date,
                  (v_slice->>'seconds')::double precision);
      END LOOP;

    ELSE
      IF NOT (p_payload ?& ARRAY['minimum','goal','presets','weekStart'])
         OR p_payload - ARRAY['minimum','goal','presets','weekStart'] <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(p_payload->'minimum') <> 'number'
         OR (p_payload->>'minimum') !~ '^[0-9]+$'
         OR pg_catalog.jsonb_typeof(p_payload->'goal') <> 'number'
         OR (p_payload->>'goal') !~ '^[0-9]+$'
         OR pg_catalog.jsonb_typeof(p_payload->'presets') <> 'string'
         OR pg_catalog.jsonb_typeof(p_payload->'weekStart') <> 'number'
         OR p_payload->>'weekStart' NOT IN ('0', '1') THEN
        RAISE EXCEPTION 'Invalid settings payload' USING ERRCODE = '22023';
      END IF;
      IF (p_payload->>'minimum')::integer NOT BETWEEN 1 AND 1440
         OR (p_payload->>'goal')::integer NOT BETWEEN 1 AND 1440 THEN
        RAISE EXCEPTION 'Invalid study goals' USING ERRCODE = '22023';
      END IF;
      v_presets := pg_catalog.string_to_array(p_payload->>'presets', ',');
      IF pg_catalog.cardinality(v_presets) NOT BETWEEN 1 AND 6 THEN
        RAISE EXCEPTION 'Invalid timer presets' USING ERRCODE = '22023';
      END IF;
      FOREACH v_preset IN ARRAY v_presets LOOP
        v_preset := pg_catalog.btrim(v_preset);
        IF v_preset !~ '^[0-9]{1,4}$' THEN
          RAISE EXCEPTION 'Invalid timer preset' USING ERRCODE = '22023';
        END IF;
        v_number := v_preset::integer;
        IF v_number NOT BETWEEN 1 AND 1440 OR v_number = ANY(v_numbers) THEN
          RAISE EXCEPTION 'Invalid or duplicate timer preset' USING ERRCODE = '22023';
        END IF;
        v_numbers := pg_catalog.array_append(v_numbers, v_number);
      END LOOP;
      INSERT INTO public.stride_preferences(owner_id, minimum, goal, presets, week_start)
        VALUES (v_owner, (p_payload->>'minimum')::integer,
                (p_payload->>'goal')::integer, p_payload->>'presets',
                (p_payload->>'weekStart')::integer)
      ON CONFLICT (owner_id) DO UPDATE SET
        minimum = EXCLUDED.minimum, goal = EXCLUDED.goal,
        presets = EXCLUDED.presets, week_start = EXCLUDED.week_start;
    END IF;
  ELSE
    IF p_entity = 'subject' THEN
      -- Emit each dependent tombstone first so a pull never presents a live
      -- session whose subject has already been deleted.
      FOR v_child IN
        SELECT s.id FROM public.stride_sessions AS s
        WHERE s.owner_id = v_owner AND s.subject_id = p_record_id
        ORDER BY s.id
      LOOP
        DELETE FROM public.stride_sessions AS s
          WHERE s.owner_id = v_owner AND s.id = v_child.id;
        INSERT INTO stride_private.stride_record_versions
          (owner_id, entity, record_id, revision, deleted)
          VALUES (v_owner, 'session', v_child.id, 1, true)
          ON CONFLICT (owner_id, entity, record_id) DO UPDATE SET
            revision = stride_private.stride_record_versions.revision + 1,
            deleted = true, updated_at = pg_catalog.now()
          RETURNING revision INTO v_existing_revision;
        PERFORM stride_private.append_change(v_owner, 'session', v_child.id,
          'delete', NULL, v_existing_revision, p_operation_id);
      END LOOP;
      DELETE FROM public.stride_subjects AS s
        WHERE s.owner_id = v_owner AND s.id = p_record_id;
    ELSIF p_entity = 'session' THEN
      DELETE FROM public.stride_sessions AS s
        WHERE s.owner_id = v_owner AND s.id = p_record_id;
    ELSE
      DELETE FROM public.stride_preferences AS sp
        WHERE sp.owner_id = v_owner;
    END IF;
  END IF;

  INSERT INTO stride_private.stride_record_versions
    (owner_id, entity, record_id, revision, deleted)
    VALUES (v_owner, p_entity, p_record_id, v_revision, p_action = 'delete')
    ON CONFLICT (owner_id, entity, record_id) DO UPDATE SET
      revision = EXCLUDED.revision, deleted = EXCLUDED.deleted,
      updated_at = pg_catalog.now();
  v_sequence := stride_private.append_change(v_owner, p_entity, p_record_id,
    p_action, p_payload, v_revision, p_operation_id);
  v_result := pg_catalog.jsonb_build_object(
    'status', 'applied', 'entity', p_entity, 'record_id', p_record_id,
    'action', p_action, 'revision', v_revision::text,
    'cursor', v_sequence::text);
  INSERT INTO stride_private.stride_sync_operations
    (owner_id, operation_id, request_hash, result)
    VALUES (v_owner, p_operation_id, v_hash, v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION stride_private.get_sync_changes_core(
  p_after text DEFAULT '0',
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_after bigint;
  v_latest bigint;
  v_cursor bigint;
  v_changes jsonb;
  v_more boolean;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NULL OR p_after !~ '^(0|[1-9][0-9]*)$'
     OR pg_catalog.char_length(p_after) > 19
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid synchronization page request' USING ERRCODE = '22023';
  END IF;
  v_after := p_after::bigint;
  SELECT COALESCE(c.sequence, 0) INTO v_latest
    FROM stride_private.stride_sync_clocks AS c
    WHERE c.owner_id = v_owner;
  v_latest := COALESCE(v_latest, 0);
  IF v_after > v_latest THEN
    RAISE EXCEPTION 'Synchronization cursor is ahead of this account'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'sequence', page.sequence::text,
      'entity', page.entity,
      'record_id', page.record_id,
      'action', page.action,
      'payload', page.payload,
      'revision', page.revision::text,
      'operation_id', page.operation_id::text)
    ORDER BY page.sequence), '[]'::jsonb),
    COALESCE(pg_catalog.max(page.sequence), v_after)
    INTO v_changes, v_cursor
    FROM (
      SELECT c.sequence, c.entity, c.record_id, c.action,
             c.payload, c.revision, c.operation_id
      FROM stride_private.stride_sync_changes AS c
      WHERE c.owner_id = v_owner AND c.sequence > v_after
      ORDER BY c.sequence
      LIMIT p_limit
    ) AS page;
  SELECT EXISTS (
    SELECT 1 FROM stride_private.stride_sync_changes AS c
    WHERE c.owner_id = v_owner AND c.sequence > v_cursor
  ) INTO v_more;
  RETURN pg_catalog.jsonb_build_object(
    'changes', v_changes, 'cursor', v_cursor::text, 'has_more', v_more);
END;
$$;

-- Public entry points are invokers. The only elevation occurs in the private
-- cores, which use auth.uid() and explicit owner predicates for every query.
CREATE FUNCTION public.apply_sync_operation(
  p_operation_id uuid,
  p_entity text,
  p_record_id text,
  p_action text,
  p_payload jsonb,
  p_expected_revision text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT stride_private.apply_sync_operation_core(
    p_operation_id, p_entity, p_record_id, p_action, p_payload,
    p_expected_revision);
$$;

CREATE FUNCTION public.get_sync_changes(
  p_after text DEFAULT '0',
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT stride_private.get_sync_changes_core(p_after, p_limit);
$$;

REVOKE ALL ON FUNCTION stride_private.assert_allocation_total(uuid, text),
  stride_private.check_allocation_total(),
  stride_private.append_change(uuid, text, text, text, jsonb, bigint, uuid),
  stride_private.apply_sync_operation_core(uuid, text, text, text, jsonb, text),
  stride_private.get_sync_changes_core(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_sync_operation(uuid, text, text, text, jsonb, text),
  public.get_sync_changes(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA stride_private TO authenticated;
GRANT EXECUTE ON FUNCTION
  stride_private.apply_sync_operation_core(uuid, text, text, text, jsonb, text),
  stride_private.get_sync_changes_core(text, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.apply_sync_operation(uuid, text, text, text, jsonb, text),
  public.get_sync_changes(text, integer)
  TO authenticated;
