import { describe, expect, it } from 'vitest';
import {
  initialTicketState,
  markTicketConsumed,
  reserveNextTicketFromState,
  type TicketState,
} from './ticket-ledger';

describe('fixed Starter ticket allocator', () => {
  it('allocates strictly increasing indices and never reuses a reservation', () => {
    const first = reserveNextTicketFromState(initialTicketState());
    const second = reserveNextTicketFromState(first.state);

    expect(first.index).toBe(0);
    expect(second.index).toBe(1);
    expect(second.state.reserved).toEqual([0, 1]);
  });

  it('marks a successful ticket consumed and removes it from reservations', () => {
    const reserved = reserveNextTicketFromState(initialTicketState());
    const consumed = markTicketConsumed(reserved.state, reserved.index);

    expect(consumed.reserved).toEqual([]);
    expect(consumed.consumed).toEqual([0]);
  });

  it('skips a crash-reserved ticket instead of returning it', () => {
    let state: TicketState = initialTicketState();
    state = reserveNextTicketFromState(state).state;
    const next = reserveNextTicketFromState(state);

    expect(next.index).toBe(1);
    expect(next.state.reserved).toEqual([0, 1]);
  });

  it('rejects the 101st allocation', () => {
    let state = initialTicketState();
    for (let i = 0; i < 100; i += 1) {
      state = reserveNextTicketFromState(state).state;
    }

    expect(() => reserveNextTicketFromState(state)).toThrow('No Starter tickets remain');
  });
});
