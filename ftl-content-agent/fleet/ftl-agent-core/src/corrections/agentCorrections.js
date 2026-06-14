/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   actionId: string,
 *   kind: string,
 *   proposed: object,
 *   corrected: object,
 *   editorId?: string,
 * }} args
 */
export async function writeAgentCorrection(supabase, args) {
  const row = {
    action_id: args.actionId,
    kind: args.kind,
    proposed_payload: args.proposed,
    corrected_payload: args.corrected,
    editor_id: args.editorId ?? null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('agent_corrections')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(`writeAgentCorrection failed: ${error.message}`);
  return data;
}
