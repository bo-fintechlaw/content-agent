/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   fromAgent: string,
 *   toAgent: string,
 *   kind: string,
 *   payload: object,
 *   dueAt?: string,
 * }} args
 */
export async function delegateToAgent(supabase, args) {
  const row = {
    from_agent_id: args.fromAgent,
    to_agent_id: args.toAgent,
    kind: args.kind,
    payload: args.payload,
    status: 'pending',
    due_at: args.dueAt ?? null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('agent_tasks')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(`delegate_to_agent failed: ${error.message}`);
  return { task_id: data.id };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ taskId: string, result: object, status?: string }} args
 */
export async function reportBack(supabase, args) {
  const { error } = await supabase
    .from('agent_tasks')
    .update({
      status: args.status ?? 'done',
      result: args.result,
      completed_at: new Date().toISOString(),
    })
    .eq('id', args.taskId);

  if (error) throw new Error(`report_back failed: ${error.message}`);
  return { ok: true };
}
