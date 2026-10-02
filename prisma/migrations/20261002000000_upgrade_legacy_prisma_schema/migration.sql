DO $$
BEGIN
  IF to_regclass('public."User"') IS NOT NULL THEN
    IF to_regclass('public.users') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public."User" and public.users exist; refusing an ambiguous migration';
    END IF;
    ALTER TABLE public."User" RENAME TO users;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."User_email_key"') IS NOT NULL THEN
    ALTER INDEX public."User_email_key" RENAME TO users_email_key;
  END IF;
  IF to_regclass('public."User_username_key"') IS NOT NULL THEN
    ALTER INDEX public."User_username_key" RENAME TO users_username_key;
  END IF;
  IF to_regclass('public."User_pkey"') IS NOT NULL THEN
    ALTER INDEX public."User_pkey" RENAME TO users_pkey;
  END IF;
END $$;

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('users', 'role', 'user'),
      ('users', 'verification', 'standard'),
      ('posts', 'visibility', 'public'),
      ('channels', 'visibility', 'public'),
      ('reports', 'status', 'open'),
      ('ai_change_log', 'status', 'proposed')
    ) AS legacy_fields(table_name, column_name, default_value)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = item.table_name
        AND column_name = item.column_name AND data_type = 'USER-DEFINED'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT', item.table_name, item.column_name);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE TEXT USING %I::text', item.table_name, item.column_name, item.column_name);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT %L', item.table_name, item.column_name, item.default_value);
  END LOOP;
END $$;

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE TIMESTAMPTZ(6) USING %I AT TIME ZONE ''UTC''',
      item.table_name, item.column_name, item.column_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users', 'auth_identities', 'sessions', 'devices', 'login_history', 'email_tokens',
    'posts', 'comments', 'channels', 'messages', 'notifications', 'reports', 'moderation_logs', 'ai_change_log'
  ] LOOP
     IF to_regclass(format('public.%I', target_table)) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=target_table AND c.column_name='id' AND c.udt_name='uuid') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', target_table);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_role_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'moderator', 'owner')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_verification_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_verification_check CHECK (verification IN ('standard', 'yellow', 'gold')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_status_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'needs_profile_setup', 'pending')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='users_tier_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_tier_check CHECK (tier IN ('normal', 'yellow', 'gold')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.posts'::regclass AND conname='posts_visibility_check') THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_visibility_check CHECK (visibility IN ('public', 'followers', 'private')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.channels'::regclass AND conname='channels_visibility_check') THEN
    ALTER TABLE public.channels ADD CONSTRAINT channels_visibility_check CHECK (visibility IN ('public', 'private')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reports'::regclass AND conname='reports_status_check') THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_status_check CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_change_log'::regclass AND conname='ai_change_log_status_check') THEN
    ALTER TABLE public.ai_change_log ADD CONSTRAINT ai_change_log_status_check CHECK (status IN ('proposed', 'accepted', 'rejected')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.users VALIDATE CONSTRAINT users_role_check;
ALTER TABLE public.users VALIDATE CONSTRAINT users_verification_check;
ALTER TABLE public.users VALIDATE CONSTRAINT users_status_check;
ALTER TABLE public.users VALIDATE CONSTRAINT users_tier_check;
ALTER TABLE public.posts VALIDATE CONSTRAINT posts_visibility_check;
ALTER TABLE public.channels VALIDATE CONSTRAINT channels_visibility_check;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_status_check;
ALTER TABLE public.ai_change_log VALIDATE CONSTRAINT ai_change_log_status_check;

CREATE INDEX IF NOT EXISTS devices_user_id_last_seen_at_idx ON public.devices (user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS login_history_user_id_created_at_idx ON public.login_history (user_id, created_at DESC);
ALTER TABLE public.users ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER INDEX IF EXISTS public.email_tokens_user_id_type_idx RENAME TO email_tokens_user_type_idx;

DROP TYPE IF EXISTS "UserRole";
DROP TYPE IF EXISTS "Verification";
DROP TYPE IF EXISTS "Visibility";
DROP TYPE IF EXISTS "ChannelVisibility";
DROP TYPE IF EXISTS "ReportStatus";
DROP TYPE IF EXISTS "ProposalStatus";
