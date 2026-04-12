const NO_SPACE_BEFORE_MARK = /[\s([«"']/;
const NO_SPACE_AFTER_MARK = /^[\s)\].,!?:;»"'\u2026\u2013\u2014]/;

export function ensureSpaceAroundMark(mark) {
  const prev = mark.previousSibling;
  if (prev && prev.nodeType === 3) {
    const text = prev.textContent;
    if (text && !NO_SPACE_BEFORE_MARK.test(text.slice(-1))) {
      prev.textContent = `${text} `;
    }
  }

  const next = mark.nextSibling;
  if (next && next.nodeType === 3) {
    const text = next.textContent;
    if (text && !NO_SPACE_AFTER_MARK.test(text)) {
      next.textContent = ` ${text}`;
    }
  }
}

export function patchPdMarks(editorEl, id, isAnon, letter, replacement) {
  if (!editorEl) return;

  const marks = editorEl.querySelectorAll(`mark[data-pd-id="${id}"]`);
  marks.forEach((mark) => {
    const wasAnon = mark.classList.contains('anon');
    if (isAnon && !wasAnon) {
      mark.textContent = letter || replacement || '?';
      mark.classList.add('anon');
      mark.title = 'Нажмите, чтобы показать';
      ensureSpaceAroundMark(mark);
      return;
    }

    if (!isAnon && wasAnon) {
      mark.textContent = mark.dataset.original || mark.textContent;
      mark.classList.remove('anon');
      mark.title = 'Нажмите, чтобы обезличить';
      ensureSpaceAroundMark(mark);
    }
  });
}

export function initPdMarkOriginals(editorEl) {
  if (!editorEl) return;

  editorEl.querySelectorAll('mark[data-pd-id]').forEach((mark) => {
    if (!mark.dataset.original) {
      mark.dataset.original = mark.textContent;
    }
    mark.contentEditable = 'false';
  });
}
