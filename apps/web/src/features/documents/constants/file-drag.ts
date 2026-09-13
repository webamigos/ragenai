/**
 * Dragging files *within* the knowledge base, as opposed to dropping files
 * into it from the desktop.
 *
 * The two gestures land on the same page and look identical to a `dragover`
 * handler unless something tells them apart. A private MIME type does: the
 * browser exposes `dataTransfer.types` during the drag — before any drop —
 * so the upload drop zone can see that this is one of its own rows moving
 * and decline to light up as if a file were arriving from outside.
 *
 * The payload is only read on `drop`. `getData` returns an empty string
 * during `dragover` in every browser, by design, so nothing here may depend
 * on the ids being readable before then.
 */
export const RAGEN_FILE_DRAG_TYPE = 'application/x-ragen-file';

/**
 * Marks a drag as carrying knowledge-base files, and puts their ids on it.
 *
 * `effectAllowed = 'move'` so the cursor says move rather than copy — this
 * gesture files a document somewhere else, it does not duplicate it.
 */
export function setDraggedFileIds(
  dataTransfer: DataTransfer,
  fileIds: readonly string[],
): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(RAGEN_FILE_DRAG_TYPE, JSON.stringify(fileIds));
}

/** Whether this drag is knowledge-base rows rather than files from the OS. */
export function isFileDrag(dataTransfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dataTransfer.types).includes(RAGEN_FILE_DRAG_TYPE);
}

/**
 * The ids on a drop, or an empty list if this drop is not ours or is
 * malformed. Malformed rather than throwing: `dataTransfer` is shaped by
 * whatever started the drag, which on a cross-window drop is not necessarily
 * this application.
 */
export function readDraggedFileIds(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData(RAGEN_FILE_DRAG_TYPE);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}
