import { PERMISSIONS, tx, type RoleDefSave } from '@tangent/contracts';
import { newId } from './ids.js';

type Q = { query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }> };
export class RoleError extends Error {
  constructor(readonly code: 'validation' | 'conflict' | 'not_found', message: string, readonly fields?: Record<string, string>) { super(message); }
}
const KNOWN = new Set<string>(PERMISSIONS);

/**
 * Makes or changes a role (D4: the school makes its own roles from its admin; Tangent can too, from the console). Every
 * permission must exist and, where `allowed` is given, be one the school's plan includes. The principal's role always has
 * everything and is not changed. People in the role get the change within about half a minute (their token version moves).
 */
export async function saveRole(q: Q, actor: { id: string | null; name: string }, id: string | null, body: RoleDefSave, allowed?: (permission: string) => boolean): Promise<string> {
  const bad = body.permissions.find((p) => !KNOWN.has(p));
  if (bad) throw new RoleError('validation', tx('There is no permission called {bad}.', { bad }));
  const outside = allowed ? body.permissions.find((p) => !allowed(p)) : undefined;
  if (outside) throw new RoleError('validation', tx('{permission} is not part of the school’s plan.', { permission: outside }));
  if (id) {
    const cur = (await q.query<{ locked: boolean }>('select locked from roles where id = $1', [id])).rows[0];
    if (!cur) throw new RoleError('not_found', tx('That role was not found.'));
    if (cur.locked) throw new RoleError('conflict', tx('The principal role always has everything and cannot be changed.'));
    if ((await q.query('select 1 from roles where lower(name) = lower($1) and id <> $2', [body.name, id])).rowCount) throw new RoleError('validation', tx('There is already a role with that name.'), { name: tx('Already used.') });
    await q.query('update roles set name = $2, description = $3, permissions = $4 where id = $1', [id, body.name, body.description, JSON.stringify(body.permissions)]);
  } else {
    const key = `custom_${body.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || newId('r').slice(-6)}`;
    id = `role_${key}`;
    if ((await q.query('select 1 from roles where id = $1 or lower(name) = lower($2)', [id, body.name])).rowCount) throw new RoleError('validation', tx('There is already a role with that name.'), { name: tx('Already used.') });
    await q.query('insert into roles (id, key, name, description, permissions, locked) values ($1,$2,$3,$4,$5,false)', [id, key, body.name, body.description, JSON.stringify(body.permissions)]);
  }
  await q.query('update users set token_version = token_version + 1 where id in (select user_id from user_roles where role_id = $1)', [id]);
  await q.query('insert into audit_log (id, actor_id, actor_name, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5,$6,$7)',
    [newId('aud'), actor.id, actor.name, 'role.saved', 'role', id, JSON.stringify({ name: body.name, permissions: body.permissions.length })]);
  return id;
}

/** Removes a role nobody holds (the principal's never). */
export async function deleteRole(q: Q, actor: { id: string | null; name: string }, id: string): Promise<void> {
  const r = (await q.query<{ name: string; locked: boolean; people: string }>('select name, locked, (select count(*) from user_roles ur where ur.role_id = roles.id) people from roles where id = $1', [id])).rows[0];
  if (!r) throw new RoleError('not_found', tx('That role was not found.'));
  if (r.locked) throw new RoleError('conflict', tx('The principal role cannot be deleted.'));
  const people = Number(r.people);
  if (people) throw new RoleError('conflict', tx('{people, plural, one {# person has} other {# people have}} this role. Move them to another role first.', { people }));
  await q.query('delete from roles where id = $1', [id]);
  await q.query('insert into audit_log (id, actor_id, actor_name, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5,$6,$7)',
    [newId('aud'), actor.id, actor.name, 'role.removed', 'role', id, JSON.stringify({ name: r.name })]);
}
