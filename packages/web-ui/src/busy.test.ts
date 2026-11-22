import { describe, expect, it } from 'vitest';
import { busyFor } from './Busy';

describe('busyFor', () => {
  it('holds only the row a change is working on', () => {
    const row = { id: 'a' };
    expect(busyFor({ isPending: true, variables: 'a' }, 'a')).toBe(true);
    expect(busyFor({ isPending: true, variables: 'a' }, 'b')).toBe(false);
    expect(busyFor({ isPending: true, variables: { id: 'a', yes: true } }, 'a')).toBe(true);
    expect(busyFor({ isPending: true, variables: { row, decision: 'approve' } }, row)).toBe(true);
    expect(busyFor({ isPending: true, variables: { row, decision: 'approve' } }, { id: 'a' })).toBe(false);
    expect(busyFor({ isPending: false, variables: 'a' }, 'a')).toBe(false);
  });
});
