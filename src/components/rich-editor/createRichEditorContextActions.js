function replaceMarkWithText(mark, text, normalizeParent = false) {
  const textNode = document.createTextNode(text);
  const parent = mark.parentNode;
  parent.replaceChild(textNode, mark);
  if (normalizeParent) {
    parent?.normalize?.();
  }
}

function getSelectedText(ctxMenu) {
  return ctxMenu?.range
    ? ctxMenu.range.toString().trim()
    : (ctxMenu?.mark?.textContent || '').trim();
}

function insertMarkIntoContext(ctxMenu, mark) {
  if (ctxMenu?.range) {
    const range = ctxMenu.range;
    try {
      range.surroundContents(mark);
    } catch {
      const fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
    }
    return;
  }

  if (ctxMenu?.mark) {
    ctxMenu.mark.parentNode.replaceChild(mark, ctxMenu.mark);
    mark.textContent = getSelectedText(ctxMenu);
  }
}

function createPdMark({ className, pdId, originalText }) {
  const mark = document.createElement('mark');
  mark.className = className;
  mark.dataset.pdId = pdId;
  mark.dataset.original = originalText;
  mark.contentEditable = 'false';
  return mark;
}

function closeMenu(setCtxMenu) {
  setCtxMenu(null);
}

export function createRichEditorContextActions({
  ctxMenu,
  notifyChange,
  setCtxMenu,
  onUncertainResolved,
  onRemoveAmbiguousMark,
  onRemovePdMark,
  onAttachPdMark,
  onAddPdMark,
}) {
  return {
    removeUncertainMark() {
      if (!ctxMenu?.mark) return;
      replaceMarkWithText(ctxMenu.mark, ctxMenu.mark.textContent, true);
      notifyChange();
      closeMenu(setCtxMenu);
      onUncertainResolved?.();
    },

    applyUncertainSuggestion() {
      if (!ctxMenu?.mark) return;
      const suggestion = ctxMenu.mark.dataset.suggestion;
      if (!suggestion) return;
      replaceMarkWithText(ctxMenu.mark, suggestion, true);
      notifyChange();
      closeMenu(setCtxMenu);
      onUncertainResolved?.();
    },

    removeAmbiguousMark() {
      if (!ctxMenu?.mark) return;
      const ambiguousMark = ctxMenu.mark;
      replaceMarkWithText(ambiguousMark, ambiguousMark.textContent, true);
      notifyChange();
      closeMenu(setCtxMenu);
      onRemoveAmbiguousMark?.(ambiguousMark);
    },

    removePdMark() {
      if (!ctxMenu?.mark) return;
      const pdMark = ctxMenu.mark;
      const pdId = pdMark.dataset.pdId;
      const restoredText = pdMark.dataset.original || pdMark.textContent;
      replaceMarkWithText(pdMark, restoredText);
      notifyChange();
      closeMenu(setCtxMenu);
      onRemovePdMark?.(pdId);
    },

    attachPdMark(id) {
      const selectedText = getSelectedText(ctxMenu);
      const mark = createPdMark({
        className: 'pd priv',
        pdId: id,
        originalText: selectedText,
      });

      insertMarkIntoContext(ctxMenu, mark);
      notifyChange();
      closeMenu(setCtxMenu);
      onAttachPdMark?.(id, mark, ctxMenu?.type === 'ambiguous' ? ctxMenu?.mark : null);
    },

    addNewPdMark(pdData) {
      const selectedText = getSelectedText(ctxMenu);
      const categoryClassName =
        pdData.category === 'professional'
          ? 'prof'
          : pdData.category === 'other'
            ? 'oth'
            : 'priv';
      const mark = createPdMark({
        className: `pd ${categoryClassName}`,
        pdId: '__new__',
        originalText: selectedText,
      });

      insertMarkIntoContext(ctxMenu, mark);
      notifyChange();
      closeMenu(setCtxMenu);
      onAddPdMark?.(pdData, selectedText, mark, ctxMenu?.type === 'ambiguous' ? ctxMenu?.mark : null);
    },
  };
}
