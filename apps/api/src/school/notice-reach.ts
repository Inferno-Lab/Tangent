// Who a notice reaches, as SQL: shared by the notices themselves and by the files attached to them.

/**
 * Whether student `s` is one a notice is for: its one class, and any of its targets (classes, year groups, houses; none of a
 * kind: every one). `c` and `g` are the notice's class and targets, as columns or parameters.
 */
export const forStudent = (c: string, g: string) => `(${c} is null or s.class_id = ${c})
  and (coalesce(jsonb_array_length(${g}->'classes'), 0) = 0 or s.class_id in (select jsonb_array_elements_text(${g}->'classes')))
  and (coalesce(jsonb_array_length(${g}->'grades'), 0) = 0 or (select cl.grade::text from classes cl where cl.id = s.class_id) in (select jsonb_array_elements_text(${g}->'grades')))
  and (coalesce(jsonb_array_length(${g}->'houses'), 0) = 0 or lower(coalesce(s.house, '')) in (select lower(jsonb_array_elements_text(${g}->'houses'))))`;
/** A notice aimed at some students' classes, years or houses does not go to staff; staff can be narrowed to some roles. */
export const forStaff = (c: string, g: string) => `${c} is null and coalesce(jsonb_array_length(${g}->'classes'), 0) = 0 and coalesce(jsonb_array_length(${g}->'grades'), 0) = 0
  and coalesce(jsonb_array_length(${g}->'houses'), 0) = 0
  and (coalesce(jsonb_array_length(${g}->'roles'), 0) = 0 or exists (select 1 from user_roles ur join roles ro on ro.id = ur.role_id where ur.user_id = u.id and ro.key in (select jsonb_array_elements_text(${g}->'roles'))))`;

/** The people a notice reaches, as SQL over users (parents, students, staff), for counts and messages alike. */
export const reachSql = (a = 'n.audience', c = 'n.class_id', g = 'n.targets') => `
  select distinct u.id, u.phone from users u
  where u.status = 'active' and (
    (${a} in ('everyone','parents','class') and u.id in (select g.user_id from guardians g join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id
      where s.status = 'active' and ${forStudent(c, g)}))
    or (${a} in ('everyone','students','class') and u.id in (select s.user_id from students s where s.status = 'active' and ${forStudent(c, g)}))
    or (${a} in ('everyone','staff') and u.kind = 'staff' and ${forStaff(c, g)}))`;
