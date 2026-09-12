import { describe, it, expect } from 'vitest';

import {
  RAGEN_FILE_DRAG_TYPE,
  isFileDrag,
  readDraggedFileIds,
  setDraggedFileIds,
} from '../file-drag';

/**
 * A stand-in for `DataTransfer`, which jsdom does not implement. Only the
 * three members this module touches.
 */
function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    effectAllowed: 'uninitialized' as string,
    get types() {
      return Array.from(store.keys());
    },
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? '';
    },
  };
}

describe('file-drag', () => {
  it('carries the ids on a private type, so a drop target can tell whose drag this is', () => {
    const dt = fakeDataTransfer();

    setDraggedFileIds(dt as unknown as DataTransfer, ['a', 'b']);

    expect(dt.types).toContain(RAGEN_FILE_DRAG_TYPE);
    expect(readDraggedFileIds(dt as unknown as DataTransfer)).toEqual([
      'a',
      'b',
    ]);
  });

  it('says move, not copy — this files a document elsewhere, it does not duplicate it', () => {
    const dt = fakeDataTransfer();

    setDraggedFileIds(dt as unknown as DataTransfer, ['a']);

    expect(dt.effectAllowed).toBe('move');
  });

  /**
   * `types` is the only thing readable during `dragover`; `getData` returns
   * an empty string until the drop. So telling an internal move apart from a
   * file arriving off the desktop has to be possible from the type list
   * alone — which is what lets the upload zone decline to light up.
   */
  it('recognises its own drag from the type list alone', () => {
    expect(isFileDrag(fakeDataTransfer({ [RAGEN_FILE_DRAG_TYPE]: '' }))).toBe(
      true,
    );
  });

  it('does not mistake a file dragged in from the desktop for one of its own', () => {
    expect(isFileDrag(fakeDataTransfer({ Files: '' }))).toBe(false);
    expect(isFileDrag(fakeDataTransfer())).toBe(false);
  });

  it('reads nothing out of a drop that is not ours', () => {
    expect(
      readDraggedFileIds(
        fakeDataTransfer({ 'text/plain': 'hello' }) as unknown as DataTransfer,
      ),
    ).toEqual([]);
  });

  it('reads nothing out of a malformed payload rather than throwing', () => {
    // The payload is shaped by whatever started the drag, which on a
    // cross-window drop need not be this application.
    for (const payload of ['not json', '{"a":1}', '"a"', 'null']) {
      expect(
        readDraggedFileIds(
          fakeDataTransfer({
            [RAGEN_FILE_DRAG_TYPE]: payload,
          }) as unknown as DataTransfer,
        ),
      ).toEqual([]);
    }
  });

  it('drops non-string entries out of a mixed array', () => {
    expect(
      readDraggedFileIds(
        fakeDataTransfer({
          [RAGEN_FILE_DRAG_TYPE]: '["a",1,null,"b"]',
        }) as unknown as DataTransfer,
      ),
    ).toEqual(['a', 'b']);
  });
});
