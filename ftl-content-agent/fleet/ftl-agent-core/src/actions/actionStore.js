import { resolveAutonomyLevel } from '../autonomy/ceilings.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   agentId: string,
 *   kind: string,
 *   payload: object,
 *   autonomyLevel?: string,
 *   gateChannelId?: string,
 * }} args
 */
export async function createAgentAction(supabase, args) {
  const dbLevel = args.autonomyLevel ?? 'shadow';
  const level = resolveAutonomyLevel(args.kind, dbLevel);

  const row = {
    agent_id: args.agentId,
    kind: args.kind,
    payload: args.payload,
    autonomy_level: level,
    status: 'pending',
    gate_channel_id: args.gateChannelId ?? null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('agent_actions')
    .insert(row)
    .select('id, autonomy_level')
    .single();

  if (error) throw new Error(`createAgentAction failed: ${error.message}`);
  return data;
}
