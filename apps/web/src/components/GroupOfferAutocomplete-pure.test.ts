import { describe, it, expect } from 'bun:test';
import {
  filterGroups,
  isMaxed,
  nextHighlightIndex,
  composeKeyDownAction,
  MAX_SELECTION,
  type GroupItem,
} from './GroupOfferAutocomplete-pure.ts';

const sample: GroupItem[] = [
  { jid: 'a@g.us', name: 'Alpha' },
  { jid: 'b@g.us', name: 'Beta' },
  { jid: 'c@g.us', name: 'Gamma' },
  { jid: 'd@g.us', name: 'Delta' },
];

describe('GroupOfferAutocomplete-pure', () => {
  it('MAX_SELECTION is 3', () => {
    expect(MAX_SELECTION).toBe(3);
  });

  describe('filterGroups', () => {
    it('empty query returns all minus selected', () => {
      expect(filterGroups(sample, [], '')).toEqual(sample);
      const r = filterGroups(sample, [sample[0]!, sample[2]!], '');
      expect(r.map((g) => g.jid)).toEqual(['b@g.us', 'd@g.us']);
    });

    it('filters by substring case-insensitive', () => {
      const r = filterGroups(sample, [], 'TA');
      expect(r.map((g) => g.jid).sort()).toEqual(['b@g.us', 'd@g.us']);
    });

    it('whitespace-only query returns all', () => {
      expect(filterGroups(sample, [], '   ')).toEqual(sample);
    });

    it('no match returns []', () => {
      expect(filterGroups(sample, [], 'xyz')).toEqual([]);
    });

    it('selected filtered before query match', () => {
      expect(filterGroups(sample, [sample[0]!], 'alpha')).toEqual([]);
    });

    it('empty groups returns []', () => {
      expect(filterGroups([], [], '')).toEqual([]);
      expect(filterGroups([], [], 'any')).toEqual([]);
    });
  });

  describe('isMaxed', () => {
    it('0/1/2 selected -> false', () => {
      expect(isMaxed([])).toBe(false);
      expect(isMaxed([sample[0]!])).toBe(false);
      expect(isMaxed([sample[0]!, sample[1]!])).toBe(false);
    });
    it('3 selected -> true', () => {
      expect(isMaxed([sample[0]!, sample[1]!, sample[2]!])).toBe(true);
    });
    it('4 selected -> true (over cap)', () => {
      expect(isMaxed(sample)).toBe(true);
    });
  });

  describe('nextHighlightIndex', () => {
    it('ArrowDown increments within bounds', () => {
      expect(nextHighlightIndex(0, 1, 4)).toBe(1);
      expect(nextHighlightIndex(2, 1, 4)).toBe(3);
    });
    it('ArrowDown saturates at length-1', () => {
      expect(nextHighlightIndex(3, 1, 4)).toBe(3);
      expect(nextHighlightIndex(10, 1, 4)).toBe(3);
    });
    it('ArrowUp decrements within bounds', () => {
      expect(nextHighlightIndex(3, -1, 4)).toBe(2);
      expect(nextHighlightIndex(1, -1, 4)).toBe(0);
    });
    it('ArrowUp saturates at 0', () => {
      expect(nextHighlightIndex(0, -1, 4)).toBe(0);
      expect(nextHighlightIndex(-5, -1, 4)).toBe(0);
    });
    it('length=0 returns -1', () => {
      expect(nextHighlightIndex(0, 1, 0)).toBe(-1);
      expect(nextHighlightIndex(0, -1, 0)).toBe(-1);
    });
    it('length=1 always returns 0', () => {
      expect(nextHighlightIndex(0, 1, 1)).toBe(0);
      expect(nextHighlightIndex(0, -1, 1)).toBe(0);
    });
  });

  describe('composeKeyDownAction closed dropdown', () => {
    const ctx = {
      isOpen: false,
      filteredLength: 3,
      highlightIndex: 0,
      query: '',
      selectedLength: 0,
    };
    it('ArrowDown opens with 0', () => {
      expect(composeKeyDownAction('ArrowDown', ctx)).toEqual({ type: 'open', highlightIndex: 0 });
    });
    it('Enter opens with 0', () => {
      expect(composeKeyDownAction('Enter', ctx)).toEqual({ type: 'open', highlightIndex: 0 });
    });
    it('ArrowUp is noop', () => {
      expect(composeKeyDownAction('ArrowUp', ctx)).toEqual({ type: 'noop' });
    });
    it('Escape is noop', () => {
      expect(composeKeyDownAction('Escape', ctx)).toEqual({ type: 'noop' });
    });
    it('Backspace without selected is noop', () => {
      expect(composeKeyDownAction('Backspace', ctx)).toEqual({ type: 'noop' });
    });
    it('Tab is noop', () => {
      expect(composeKeyDownAction('Tab', ctx)).toEqual({ type: 'noop' });
    });
  });

  describe('composeKeyDownAction open dropdown', () => {
    const base = {
      isOpen: true,
      filteredLength: 3,
      highlightIndex: 0,
      query: '',
      selectedLength: 0,
    };
    it('ArrowDown increments highlight', () => {
      expect(composeKeyDownAction('ArrowDown', base)).toEqual({
        type: 'highlight',
        index: 1,
        preventDefault: true,
      });
    });
    it('ArrowUp decrements highlight', () => {
      expect(composeKeyDownAction('ArrowUp', { ...base, highlightIndex: 2 })).toEqual({
        type: 'highlight',
        index: 1,
        preventDefault: true,
      });
    });
    it('Enter selects highlighted', () => {
      expect(composeKeyDownAction('Enter', { ...base, highlightIndex: 1 })).toEqual({
        type: 'select',
        index: 1,
        preventDefault: true,
      });
    });
    it('Enter with highlight=-1 still returns select', () => {
      const a = composeKeyDownAction('Enter', { ...base, highlightIndex: -1 });
      expect(a.type).toBe('select');
      if (a.type === 'select') expect(a.index).toBe(-1);
    });
    it('Escape closes', () => {
      expect(composeKeyDownAction('Escape', base)).toEqual({ type: 'close' });
    });
    it('Tab closes', () => {
      expect(composeKeyDownAction('Tab', base)).toEqual({ type: 'close' });
    });
    it('Backspace with empty query and selected removes last', () => {
      expect(composeKeyDownAction('Backspace', { ...base, selectedLength: 2 })).toEqual({
        type: 'removeLast',
        preventDefault: false,
      });
    });
    it('Backspace with query non-empty is noop', () => {
      expect(
        composeKeyDownAction('Backspace', { ...base, query: 'busca', selectedLength: 2 }),
      ).toEqual({
        type: 'noop',
      });
    });
    it('Backspace without selected is noop', () => {
      expect(composeKeyDownAction('Backspace', { ...base, selectedLength: 0 })).toEqual({
        type: 'noop',
      });
    });
    it('unknown keys are noop', () => {
      expect(composeKeyDownAction('a', base)).toEqual({ type: 'noop' });
      expect(composeKeyDownAction('Space', base)).toEqual({ type: 'noop' });
    });
    it('ArrowDown saturates at length-1', () => {
      const a = composeKeyDownAction('ArrowDown', { ...base, highlightIndex: 2 });
      expect(a.type).toBe('highlight');
      if (a.type === 'highlight') expect(a.index).toBe(2);
    });
    it('ArrowUp saturates at 0', () => {
      const a = composeKeyDownAction('ArrowUp', { ...base, highlightIndex: 0 });
      expect(a.type).toBe('highlight');
      if (a.type === 'highlight') expect(a.index).toBe(0);
    });
    it('ArrowDown with empty list returns highlight=-1', () => {
      const a = composeKeyDownAction('ArrowDown', { ...base, filteredLength: 0 });
      expect(a.type).toBe('highlight');
      if (a.type === 'highlight') expect(a.index).toBe(-1);
    });
  });
});
