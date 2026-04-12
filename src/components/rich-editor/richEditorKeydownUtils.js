export function findAdjacentPdMark(range, key) {
  const node = range.startContainer;
  const offset = range.startOffset;

  if (key === 'Backspace') {
    if (node.nodeType === 3 && offset === 0) {
      const prev = node.previousSibling;
      return prev?.matches?.('mark[data-pd-id]') ? prev : null;
    }
    if (node.nodeType === 1) {
      const prev = node.childNodes[offset - 1];
      return prev?.matches?.('mark[data-pd-id]') ? prev : null;
    }
    return null;
  }

  if (key === 'Delete') {
    if (node.nodeType === 3 && offset === node.textContent.length) {
      const next = node.nextSibling;
      return next?.matches?.('mark[data-pd-id]') ? next : null;
    }
    if (node.nodeType === 1) {
      const next = node.childNodes[offset];
      return next?.matches?.('mark[data-pd-id]') ? next : null;
    }
  }

  return null;
}
