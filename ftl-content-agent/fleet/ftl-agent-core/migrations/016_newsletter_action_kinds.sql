-- 016: Register newsletter action kinds + seed shadow autonomy.
-- Apply to fleet Supabase (ftl-agents). Requires existing agent_actions / agent_autonomy_rules tables.

-- Extend kind check (adjust IN list to include all existing kinds in your deployment).
ALTER TABLE agent_actions DROP CONSTRAINT IF EXISTS agent_actions_kind_check;

-- NOTE: merge with your full kind list before applying in production.
ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_kind_check CHECK (
  kind IN (
    'newsletter_issue_draft',
    'newsletter_social_post'
  )
);

INSERT INTO agent_autonomy_rules (kind, level, gate_channel_id)
VALUES
  ('newsletter_issue_draft', 'shadow', 'C0BB9U7AN0Y'),
  ('newsletter_social_post', 'shadow', 'C0BB9U7AN0Y')
ON CONFLICT (kind) DO UPDATE SET
  level = EXCLUDED.level,
  gate_channel_id = EXCLUDED.gate_channel_id;
