import { useCallback } from 'react';

function updatePdCollections(pdState, id, mapPerson, mapOther) {
  return {
    ...pdState,
    persons: (pdState.persons || []).map((item) => (item.id === id ? mapPerson(item) : item)),
    otherPD: (pdState.otherPD || []).map((item) => (item.id === id ? mapOther(item) : item)),
  };
}

function appendMentionValues(dedupeMentions, baseValues, extraValues) {
  return dedupeMentions([...(baseValues || []), ...(extraValues || [])]);
}

function setPdMarkAppearance(markEl, { id, person, other, isAnon, originalText, fallbackText }) {
  if (!markEl) return;

  const categoryClass = person
    ? (person.category === 'professional' ? 'prof' : 'priv')
    : 'oth';
  if (!markEl.dataset.original) {
    markEl.dataset.original = originalText || fallbackText || markEl.textContent;
  }
  markEl.className = `pd ${categoryClass}`;
  markEl.contentEditable = 'false';
  markEl.dataset.pdId = id;

  if (isAnon && person) {
    markEl.textContent = person.letter;
    markEl.classList.add('anon');
  } else if (isAnon && other) {
    markEl.textContent = other.replacement || '[ПД]';
    markEl.classList.add('anon');
  }
}

function isAnnotatableElement(node) {
  return node.nodeType === 1 && !['mark', 'script', 'style'].includes(node.tagName.toLowerCase());
}

function collectTextMatches(text, values, buildPattern) {
  const allMatches = [];

  for (const value of values) {
    if (!value || value.length < 2) continue;
    try {
      const re = new RegExp(buildPattern(value), 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        allMatches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      }
    } catch {}
  }

  return allMatches;
}

function filterOverlappingMatches(matches, sorter = (a, b) => a.start - b.start || b.end - a.end) {
  const sorted = [...matches].sort(sorter);
  const filtered = [];
  let lastEnd = 0;

  for (const match of sorted) {
    if (match.start >= lastEnd) {
      filtered.push(match);
      lastEnd = match.end;
    }
  }

  return filtered;
}

function replaceTextNodeWithMarks(node, matches, createMarkElement) {
  if (matches.length === 0) return false;

  const text = node.textContent;
  const fragment = document.createDocumentFragment();
  let lastIdx = 0;

  for (const match of matches) {
    if (match.start > lastIdx) {
      fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.start)));
    }
    fragment.appendChild(createMarkElement(match));
    lastIdx = match.end;
  }

  if (lastIdx < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
  }
  node.parentNode.replaceChild(fragment, node);
  return true;
}

function walkAndAnnotate(node, annotateTextNode) {
  if (node.nodeType === 3) {
    annotateTextNode(node);
    return;
  }

  if (isAnnotatableElement(node)) {
    Array.from(node.childNodes).forEach((child) => walkAndAnnotate(child, annotateTextNode));
  }
}

export function useEditorPdActions({
  editorDomRef,
  editorHtml,
  setEditorHtml,
  personalData,
  setPersonalData,
  anonymized,
  setAnonymized,
  pdRef,
  anonRef,
  undoStackRef,
  undoIndexRef,
  maxUndo = 80,
  pdCleanupTimerRef,
  currentProjectId,
  setPdIdsInDoc,
  pdNavTimerRef,
  pdNavIndexRef,
  setPdNavState,
  setEditingPdId,
  editingPdFragment,
  setEditingPdFragment,
  removeAmbiguousEntry,
  buildPdMatchPattern,
  patchPdMarks,
  initPdMarkOriginals,
  normalizePdText,
  dedupeMentions,
  getPersonMentions,
  getOtherPdMentions,
  buildCanonicalPersonMentions,
  alphaPrivate,
  otherPdTypesMap,
} = {}) {
  const pushSnap = useCallback((snapshot) => {
    const stack = undoStackRef.current;
    const index = undoIndexRef.current;
    const next = stack.slice(0, index + 1);
    next.push(snapshot);
    if (next.length > maxUndo) next.shift();
    undoStackRef.current = next;
    undoIndexRef.current = next.length - 1;
  }, [maxUndo, undoIndexRef, undoStackRef]);

  const replaceTopSnap = useCallback((snapshot) => {
    const stack = undoStackRef.current;
    const index = undoIndexRef.current;
    if (index >= 0) stack[index] = snapshot;
  }, [undoIndexRef, undoStackRef]);

  const applySnap = useCallback((snapshot) => {
    if (editorDomRef.current) {
      editorDomRef.current.innerHTML = snapshot.html;
      initPdMarkOriginals(editorDomRef.current);
    }
    setEditorHtml(snapshot.html);
    pdRef.current = snapshot.pd;
    anonRef.current = snapshot.anon;
    setPersonalData(snapshot.pd);
    setAnonymized(snapshot.anon);
  }, [
    anonRef,
    editorDomRef,
    initPdMarkOriginals,
    pdRef,
    setAnonymized,
    setEditorHtml,
    setPersonalData,
  ]);

  const performUndo = useCallback(() => {
    const index = undoIndexRef.current;
    if (index <= 0) return;
    undoIndexRef.current = index - 1;
    applySnap(undoStackRef.current[index - 1]);
  }, [applySnap, undoIndexRef, undoStackRef]);

  const performRedo = useCallback(() => {
    const stack = undoStackRef.current;
    const index = undoIndexRef.current;
    if (index >= stack.length - 1) return;
    undoIndexRef.current = index + 1;
    applySnap(stack[index + 1]);
  }, [applySnap, undoIndexRef, undoStackRef]);

  const countUncertain = useCallback(() => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('mark.uncertain').length;
  }, [editorDomRef]);

  const countPageSeparators = useCallback(() => {
    if (!editorDomRef.current) return 0;
    return editorDomRef.current.querySelectorAll('.part-separator').length;
  }, [editorDomRef]);

  const handlePdClick = useCallback((id) => {
    const nextAnon = { ...anonRef.current, [id]: !anonRef.current[id] };
    anonRef.current = nextAnon;
    const isAnon = nextAnon[id];
    const person = personalData.persons?.find((item) => item.id === id);
    const otherItem = personalData.otherPD?.find((item) => item.id === id);
    patchPdMarks(editorDomRef.current, id, isAnon, person?.letter, otherItem?.replacement);
    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    setAnonymized(() => nextAnon);
    pushSnap({ html: newHtml, pd: pdRef.current, anon: nextAnon });
  }, [
    anonRef,
    editorDomRef,
    patchPdMarks,
    pdRef,
    personalData,
    pushSnap,
    setAnonymized,
    setEditorHtml,
  ]);

  const anonymizeAllByCategory = useCallback((category) => {
    const { persons = [], otherPD = [] } = personalData;
    const nextAnon = { ...anonRef.current };
    const items = (category === 'private' || category === 'professional')
      ? persons.filter((item) => item.category === category)
      : otherPD.filter((item) => item.type === category);
    const allAnon = items.every((item) => nextAnon[item.id]);
    const targetState = !allAnon;

    items.forEach((item) => {
      nextAnon[item.id] = targetState;
      const person = persons.find((personEntry) => personEntry.id === item.id);
      const otherItem = otherPD.find((otherEntry) => otherEntry.id === item.id);
      patchPdMarks(editorDomRef.current, item.id, targetState, person?.letter, otherItem?.replacement);
    });

    anonRef.current = nextAnon;
    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    setAnonymized(() => nextAnon);
    pushSnap({ html: newHtml, pd: pdRef.current, anon: nextAnon });
  }, [
    anonRef,
    editorDomRef,
    patchPdMarks,
    pdRef,
    personalData,
    pushSnap,
    setAnonymized,
    setEditorHtml,
  ]);

  const handleEditorHtmlChange = useCallback((html) => {
    setEditorHtml(html);
    pushSnap({ html, pd: pdRef.current, anon: anonRef.current });

    if (pdCleanupTimerRef.current) clearTimeout(pdCleanupTimerRef.current);
    pdCleanupTimerRef.current = setTimeout(() => {
      if (!editorDomRef.current) return;

      const markCounts = {};
      editorDomRef.current.querySelectorAll('mark[data-pd-id]').forEach((el) => {
        const id = el.dataset.pdId;
        markCounts[id] = (markCounts[id] || 0) + 1;
      });

      if (currentProjectId) {
        setPdIdsInDoc(new Set(Object.keys(markCounts)));
      }
    }, 1000);
  }, [
    anonRef,
    currentProjectId,
    editorDomRef,
    pdCleanupTimerRef,
    pdRef,
    pushSnap,
    setEditorHtml,
    setPdIdsInDoc,
  ]);

  const handleRemovePdMark = useCallback((id) => {
    if (pdCleanupTimerRef.current) {
      clearTimeout(pdCleanupTimerRef.current);
      pdCleanupTimerRef.current = null;
    }
    setPersonalData((prev) => {
      const remaining = editorDomRef.current
        ? editorDomRef.current.querySelectorAll(`mark[data-pd-id="${id}"]`).length
        : 0;
      if (remaining > 0) return prev;
      const next = {
        ...prev,
        persons: prev.persons.filter((item) => item.id !== id),
        otherPD: prev.otherPD.filter((item) => item.id !== id),
      };
      pdRef.current = next;
      replaceTopSnap({ html: editorDomRef.current?.innerHTML ?? '', pd: next, anon: anonRef.current });
      return next;
    });
  }, [
    anonRef,
    editorDomRef,
    pdCleanupTimerRef,
    pdRef,
    replaceTopSnap,
    setPersonalData,
  ]);

  const handleDeletePdEntry = useCallback((id) => {
    if (!id) return;
    if (pdCleanupTimerRef.current) {
      clearTimeout(pdCleanupTimerRef.current);
      pdCleanupTimerRef.current = null;
    }

    const dom = editorDomRef.current;
    if (dom) {
      dom.querySelectorAll(`mark[data-pd-id="${id}"]`).forEach((mark) => {
        const text = document.createTextNode(mark.dataset.original || mark.textContent || '');
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(text, mark);
        parent.normalize?.();
      });
    }

    const nextPd = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).filter((item) => item.id !== id),
      otherPD: (pdRef.current.otherPD || []).filter((item) => item.id !== id),
    };
    const nextAnon = { ...anonRef.current };
    delete nextAnon[id];

    if (pdNavTimerRef.current[id]) {
      clearTimeout(pdNavTimerRef.current[id]);
      delete pdNavTimerRef.current[id];
    }
    delete pdNavIndexRef.current[id];

    pdRef.current = nextPd;
    anonRef.current = nextAnon;
    setPersonalData(nextPd);
    setAnonymized(nextAnon);
    setPdNavState((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPdIdsInDoc((prev) => {
      if (!prev || !prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    const newHtml = dom?.innerHTML ?? editorHtml;
    setEditorHtml(newHtml);
    pushSnap({ html: newHtml, pd: nextPd, anon: nextAnon });
  }, [
    anonRef,
    editorDomRef,
    editorHtml,
    pdCleanupTimerRef,
    pdNavIndexRef,
    pdNavTimerRef,
    pdRef,
    pushSnap,
    setAnonymized,
    setEditorHtml,
    setPdIdsInDoc,
    setPdNavState,
    setPersonalData,
  ]);

  const handleAttachPdMark = useCallback((id, markEl, ambiguousMarkEl) => {
    const person = personalData.persons.find((item) => item.id === id);
    const other = personalData.otherPD.find((item) => item.id === id);
    const attachedText = normalizePdText(markEl?.dataset?.original || markEl?.textContent || '');

    setPdMarkAppearance(markEl, {
      id,
      person,
      other,
      isAnon: anonymized[id],
      originalText: person?.fullName || other?.value,
    });

    const nextPdBase = updatePdCollections(
      pdRef.current,
      id,
      (item) => ({
        ...item,
        mentions: appendMentionValues(dedupeMentions, item.mentions, [attachedText, item.fullName]),
      }),
      (item) => ({
        ...item,
        mentions: appendMentionValues(dedupeMentions, item.mentions, [attachedText, item.value]),
      }),
    );
    const nextPd = removeAmbiguousEntry(nextPdBase, ambiguousMarkEl);
    pdRef.current = nextPd;
    setPersonalData(() => nextPd);

    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    replaceTopSnap({ html: newHtml, pd: nextPd, anon: anonRef.current });
  }, [
    anonymized,
    anonRef,
    dedupeMentions,
    editorDomRef,
    normalizePdText,
    pdRef,
    personalData,
    removeAmbiguousEntry,
    replaceTopSnap,
    setEditorHtml,
    setPersonalData,
  ]);

  const handleAddPdMark = useCallback((pdData, selectedText, markEl, ambiguousMarkEl) => {
    const newId = `manual_${Date.now()}`;
    let newPersons = pdRef.current.persons;
    let newOtherPD = pdRef.current.otherPD;

    if (pdData.category === 'private' || pdData.category === 'professional') {
      const privateCount = pdRef.current.persons.filter((item) => item.category === 'private').length;
      const profCount = pdRef.current.persons.filter((item) => item.category === 'professional').length;
      const letter = pdData.category === 'private'
        ? (alphaPrivate[privateCount] !== undefined ? alphaPrivate[privateCount] : `Л-${privateCount + 1}`)
        : `[ФИО ${profCount + 1}]`;

      newPersons = [...pdRef.current.persons, {
        id: newId,
        fullName: pdData.fullName,
        role: pdData.role || '',
        category: pdData.category,
        letter,
        mentions: dedupeMentions([pdData.fullName, selectedText]),
      }];
      setPdMarkAppearance(markEl, {
        id: newId,
        person: { category: pdData.category, letter },
        other: null,
        isAnon: false,
        originalText: selectedText,
      });
    } else {
      const typeLabel = otherPdTypesMap[pdData.type] || pdData.type;
      newOtherPD = [...pdRef.current.otherPD, {
        id: newId,
        type: pdData.type,
        value: selectedText,
        replacement: `[${typeLabel}]`,
        mentions: dedupeMentions([selectedText]),
      }];
      if (markEl) {
        setPdMarkAppearance(markEl, {
          id: newId,
          person: null,
          other: { replacement: `[${typeLabel}]` },
          isAnon: false,
          originalText: selectedText,
        });
        markEl.dataset.original = selectedText;
      }
    }

    const nextPd = removeAmbiguousEntry({
      persons: newPersons,
      otherPD: newOtherPD,
      ambiguousPersons: pdRef.current.ambiguousPersons || [],
    }, ambiguousMarkEl);
    pdRef.current = nextPd;
    setPersonalData(() => nextPd);

    const newHtml = editorDomRef.current?.innerHTML ?? '';
    setEditorHtml(newHtml);
    replaceTopSnap({ html: newHtml, pd: nextPd, anon: anonRef.current });
  }, [
    alphaPrivate,
    anonRef,
    dedupeMentions,
    editorDomRef,
    otherPdTypesMap,
    pdRef,
    removeAmbiguousEntry,
    replaceTopSnap,
    setEditorHtml,
    setPersonalData,
  ]);

  const handleRemoveAmbiguousMark = useCallback((markEl) => {
    if (pdCleanupTimerRef.current) {
      clearTimeout(pdCleanupTimerRef.current);
      pdCleanupTimerRef.current = null;
    }
    setPersonalData((prev) => {
      const next = removeAmbiguousEntry(prev, markEl);
      pdRef.current = next;
      replaceTopSnap({ html: editorDomRef.current?.innerHTML ?? '', pd: next, anon: anonRef.current });
      return next;
    });
  }, [
    anonRef,
    editorDomRef,
    pdCleanupTimerRef,
    pdRef,
    removeAmbiguousEntry,
    replaceTopSnap,
    setPersonalData,
  ]);

  const annotatePdMentionsInEditor = useCallback((pdState, targetId) => {
    const dom = editorDomRef.current;
    if (!dom) return false;

    const targetPerson = (pdState.persons || []).find((item) => item.id === targetId);
    const targetOther = (pdState.otherPD || []).find((item) => item.id === targetId);
    const target = targetPerson || targetOther;
    if (!target) return false;

    const mentions = targetPerson ? getPersonMentions(target) : getOtherPdMentions(target);
    if (mentions.length === 0) return false;

    let changed = false;

    const createMarkElement = (match) => {
      const el = document.createElement('mark');
      const isAnon = !!anonRef.current[targetId];
      const isPerson = !!targetPerson;
      el.className = `pd ${isPerson ? (targetPerson.category === 'professional' ? 'prof' : 'priv') : 'oth'}${isAnon ? ' anon' : ''}`;
      el.dataset.pdId = targetId;
      el.dataset.original = match.text;
      el.contentEditable = 'false';
      el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
      el.textContent = isAnon
        ? (isPerson ? targetPerson.letter : targetOther.replacement || '[ПД]')
        : match.text;
      return el;
    };

    const annotateTextNode = (node) => {
      const matches = filterOverlappingMatches(
        collectTextMatches(node.textContent, mentions, (mention) => (
          buildPdMatchPattern(mention, targetPerson ? 'person' : 'other', targetOther?.type)
        )),
      );
      if (!matches.length) return;
      if (replaceTextNodeWithMarks(node, matches, createMarkElement)) {
        changed = true;
      }
    };

    Array.from(dom.childNodes).forEach((node) => walkAndAnnotate(node, annotateTextNode));
    return changed;
  }, [
    anonRef,
    buildPdMatchPattern,
    editorDomRef,
    getOtherPdMentions,
    getPersonMentions,
  ]);

  const openPdEditor = useCallback((id) => {
    if (!id) return;
    const exists = pdRef.current.persons.some((item) => item.id === id)
      || pdRef.current.otherPD.some((item) => item.id === id);
    if (exists) setEditingPdId(id);
  }, [pdRef, setEditingPdId]);

  const openPdFragmentEditor = useCallback((id, markEl) => {
    if (!id || !markEl) return;
    const fragmentText = normalizePdText(markEl.dataset.original || markEl.textContent || '');
    setEditingPdFragment({
      id,
      text: fragmentText,
      markEl,
    });
  }, [normalizePdText, setEditingPdFragment]);

  const handleSavePdEdit = useCallback((payload) => {
    if (!payload?.id) return;

    const nextPd = updatePdCollections(
      pdRef.current,
      payload.id,
      (person) => {
        const fullName = normalizePdText(payload.fullName || person.fullName);
        return {
          ...person,
          fullName,
          role: payload.role ?? person.role ?? '',
          mentions: appendMentionValues(
            dedupeMentions,
            person.mentions,
            buildCanonicalPersonMentions(fullName),
          ),
        };
      },
      (item) => {
        const value = normalizePdText(payload.value || item.value);
        return {
          ...item,
          value,
          mentions: appendMentionValues(dedupeMentions, item.mentions, [value]),
        };
      },
    );

    pdRef.current = nextPd;
    setPersonalData(nextPd);
    setEditingPdId(null);

    const updatedItem = nextPd.otherPD.find((item) => item.id === payload.id);
    if (updatedItem && anonRef.current[payload.id]) {
      patchPdMarks(editorDomRef.current, payload.id, true, null, updatedItem.replacement);
    }
    annotatePdMentionsInEditor(nextPd, payload.id);

    const finalHtml = editorDomRef.current?.innerHTML ?? editorHtml;
    setEditorHtml(finalHtml);
    pushSnap({ html: finalHtml, pd: nextPd, anon: anonRef.current });
  }, [
    annotatePdMentionsInEditor,
    anonRef,
    buildCanonicalPersonMentions,
    dedupeMentions,
    editorDomRef,
    editorHtml,
    normalizePdText,
    patchPdMarks,
    pdRef,
    pushSnap,
    setEditingPdId,
    setEditorHtml,
    setPersonalData,
  ]);

  const handleSavePdFragmentEdit = useCallback((payload) => {
    if (!payload?.id) return;
    const dom = editorDomRef.current;
    if (!dom) return;

    const nextText = normalizePdText(payload.text);
    if (!nextText) return;

    const directMark = editingPdFragment?.markEl;
    const marks = Array.from(dom.querySelectorAll(`mark[data-pd-id="${payload.id}"]`));
    const targetMark = (directMark && directMark.isConnected ? directMark : null)
      || marks.find((mark) => (
        normalizePdText(mark.dataset.original || mark.textContent)
        === normalizePdText(editingPdFragment?.text)
      ))
      || marks[0];
    if (!targetMark) return;

    targetMark.dataset.original = nextText;
    if (!targetMark.classList.contains('anon')) {
      targetMark.textContent = nextText;
    }

    const nextPd = updatePdCollections(
      pdRef.current,
      payload.id,
      (item) => ({
        ...item,
        mentions: appendMentionValues(dedupeMentions, item.mentions, [nextText, item.fullName]),
      }),
      (item) => ({
        ...item,
        mentions: appendMentionValues(dedupeMentions, item.mentions, [nextText, item.value]),
      }),
    );

    pdRef.current = nextPd;
    setPersonalData(nextPd);
    setEditingPdFragment(null);

    const html = dom.innerHTML;
    setEditorHtml(html);
    pushSnap({ html, pd: nextPd, anon: anonRef.current });
  }, [
    anonRef,
    dedupeMentions,
    editingPdFragment,
    editorDomRef,
    normalizePdText,
    pdRef,
    pushSnap,
    setEditingPdFragment,
    setEditorHtml,
    setPersonalData,
  ]);

  const handleApplyPdCanonicalText = useCallback((id, markEl) => {
    if (!id || !markEl) return;

    const person = (pdRef.current.persons || []).find((item) => item.id === id) || null;
    const other = (pdRef.current.otherPD || []).find((item) => item.id === id) || null;
    const canonicalText = normalizePdText(person?.fullName || other?.value || '');
    if (!canonicalText) return;

    markEl.dataset.original = canonicalText;
    if (!markEl.classList.contains('anon')) {
      markEl.textContent = canonicalText;
    }

    const nextPd = updatePdCollections(
      pdRef.current,
      id,
      (item) => ({
        ...item,
        mentions: appendMentionValues(dedupeMentions, item.mentions, [canonicalText, item.fullName]),
      }),
      (item) => ({
        ...item,
        mentions: appendMentionValues(dedupeMentions, item.mentions, [canonicalText, item.value]),
      }),
    );

    pdRef.current = nextPd;
    setPersonalData(nextPd);

    const html = editorDomRef.current?.innerHTML ?? editorHtml;
    setEditorHtml(html);
    pushSnap({ html, pd: nextPd, anon: anonRef.current });
  }, [
    anonRef,
    dedupeMentions,
    editorDomRef,
    editorHtml,
    normalizePdText,
    pdRef,
    pushSnap,
    setEditorHtml,
    setPersonalData,
  ]);

  const handleUncertainResolved = useCallback(() => {
    if (!editorDomRef.current) return;
    const dom = editorDomRef.current;
    const otherItems = pdRef.current.otherPD || [];
    if (otherItems.length === 0) return;

    const markedIds = new Set();
    dom.querySelectorAll('mark[data-pd-id]').forEach((el) => markedIds.add(el.dataset.pdId));
    const unmarked = otherItems.filter((item) => !markedIds.has(item.id));
    if (unmarked.length === 0) return;

    const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const buildPattern = (value) => {
      const parts = value.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return escapeRegex(value);
      return parts.map((part) => escapeRegex(part)).join('[\\s\\n]+');
    };

    let changed = false;

    const createMarkElement = (match) => {
      const el = document.createElement('mark');
      const isAnon = !!anonRef.current[match.item.id];
      el.className = `pd oth${isAnon ? ' anon' : ''}`;
      el.dataset.pdId = match.item.id;
      el.dataset.original = match.text;
      el.contentEditable = 'false';
      el.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
      el.textContent = isAnon ? match.item.replacement : match.text;
      return el;
    };

    const annotateTextNode = (node) => {
      const allMatches = [];
      for (const item of unmarked) {
        const values = getOtherPdMentions(item);
        const itemMatches = collectTextMatches(node.textContent, values, buildPattern)
          .map((match) => ({ ...match, item }));
        allMatches.push(...itemMatches);
      }

      const matches = filterOverlappingMatches(allMatches, (a, b) => a.start - b.start);
      if (!matches.length) return;
      if (replaceTextNodeWithMarks(node, matches, createMarkElement)) {
        changed = true;
      }
    };

    Array.from(dom.childNodes).forEach((node) => walkAndAnnotate(node, annotateTextNode));

    if (changed) {
      const newHtml = dom.innerHTML;
      setEditorHtml(newHtml);
      pushSnap({ html: newHtml, pd: pdRef.current, anon: anonRef.current });
    }
  }, [
    anonRef,
    editorDomRef,
    getOtherPdMentions,
    pdRef,
    pushSnap,
    setEditorHtml,
  ]);

  return {
    performUndo,
    performRedo,
    countUncertain,
    countPageSeparators,
    handlePdClick,
    anonymizeAllByCategory,
    handleEditorHtmlChange,
    handleRemovePdMark,
    handleDeletePdEntry,
    handleAttachPdMark,
    handleAddPdMark,
    handleRemoveAmbiguousMark,
    openPdEditor,
    openPdFragmentEditor,
    handleSavePdEdit,
    handleSavePdFragmentEdit,
    handleApplyPdCanonicalText,
    handleUncertainResolved,
  };
}
