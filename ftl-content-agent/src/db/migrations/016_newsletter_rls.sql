-- 016: RLS policies for newsletter domain tables (fleet Supabase).

ALTER TABLE newsletter_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_metrics ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; anon/authenticated have no direct access.
CREATE POLICY newsletter_issues_service_all ON newsletter_issues
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY subscribers_service_all ON subscribers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY subscription_events_service_all ON subscription_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY issue_metrics_service_all ON issue_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);
