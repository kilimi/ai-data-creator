import { describe, it, expect } from 'vitest';
import { reducer } from './use-toast';

type ToasterToast = { id: string; open?: boolean; title?: string };
type State = { toasts: ToasterToast[] };

describe('toast reducer', () => {
  const emptyState: State = { toasts: [] };

  describe('ADD_TOAST', () => {
    it('adds a toast to empty state', () => {
      const toast = { id: '1', title: 'Hello' } as ToasterToast;
      const result = reducer(emptyState, { type: 'ADD_TOAST', toast });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe('1');
    });

    it('limits toast count to 1 (TOAST_LIMIT)', () => {
      const state: State = {
        toasts: [{ id: '1', title: 'First' } as ToasterToast],
      };
      const newToast = { id: '2', title: 'Second' } as ToasterToast;
      const result = reducer(state, { type: 'ADD_TOAST', toast: newToast });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe('2');
    });

    it('prepends new toast (most recent first)', () => {
      const state: State = { toasts: [] };
      const result1 = reducer(state, {
        type: 'ADD_TOAST',
        toast: { id: '1', title: 'First' } as ToasterToast,
      });
      const result2 = reducer(result1, {
        type: 'ADD_TOAST',
        toast: { id: '2', title: 'Second' } as ToasterToast,
      });
      expect(result2.toasts[0].id).toBe('2');
    });
  });

  describe('UPDATE_TOAST', () => {
    it('updates matching toast by id', () => {
      const state: State = {
        toasts: [{ id: '1', title: 'Old' } as ToasterToast],
      };
      const result = reducer(state, {
        type: 'UPDATE_TOAST',
        toast: { id: '1', title: 'New' },
      });
      expect(result.toasts[0].title).toBe('New');
    });

    it('does not affect non-matching toasts', () => {
      const state: State = {
        toasts: [{ id: '1', title: 'Keep' } as ToasterToast],
      };
      const result = reducer(state, {
        type: 'UPDATE_TOAST',
        toast: { id: '99', title: 'Updated' },
      });
      expect(result.toasts[0].title).toBe('Keep');
    });
  });

  describe('DISMISS_TOAST', () => {
    it('sets open=false for a specific toast', () => {
      const state: State = {
        toasts: [{ id: '1', open: true } as ToasterToast],
      };
      const result = reducer(state, { type: 'DISMISS_TOAST', toastId: '1' });
      expect(result.toasts[0].open).toBe(false);
    });

    it('dismisses all toasts when no toastId provided', () => {
      const state: State = {
        toasts: [
          { id: '1', open: true } as ToasterToast,
        ],
      };
      const result = reducer(state, { type: 'DISMISS_TOAST' });
      expect(result.toasts.every((t) => t.open === false)).toBe(true);
    });
  });

  describe('REMOVE_TOAST', () => {
    it('removes a specific toast by id', () => {
      const state: State = {
        toasts: [{ id: '1' } as ToasterToast],
      };
      const result = reducer(state, { type: 'REMOVE_TOAST', toastId: '1' });
      expect(result.toasts).toHaveLength(0);
    });

    it('clears all toasts when no toastId', () => {
      const state: State = {
        toasts: [
          { id: '1' } as ToasterToast,
          { id: '2' } as ToasterToast,
        ],
      };
      const result = reducer(state, { type: 'REMOVE_TOAST' });
      expect(result.toasts).toHaveLength(0);
    });

    it('does not remove non-matching toasts', () => {
      const state: State = {
        toasts: [
          { id: '1' } as ToasterToast,
          { id: '2' } as ToasterToast,
        ],
      };
      const result = reducer(state, { type: 'REMOVE_TOAST', toastId: '1' });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe('2');
    });
  });
});
