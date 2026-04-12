import { useCallback } from 'react';
import {
  appendMentionValues,
  collectMarkCounts,
  getMarkText,
  replaceMarksWithOriginalText,
  setPdMarkAppearance,
  updatePdCollections,
} from '../../utils/editorPdDomUtils';

function clearCleanupTimer(pdCleanupTimerRef) {
  if (!pdCleanupTimerRef.current) return;
  clearTimeout(pdCleanupTimerRef.current);
  pdCleanupTimerRef.current = null;
}

function removePdFromNavState(id, pdNavTimerRef, pdNavIndexRef, setPdNavState) {
  if (pdNavTimerRef.current[id]) {
    clearTimeout(pdNavTimerRef.current[id]);
    delete pdNavTimerRef.current[id];
  }
  delete pdNavIndexRef.current[id];
  setPdNavState((prev) => {
    if (!prev[id]) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });
}

export function useEditorPdMarkActions({
  editorDomRef,
  editorHtml,
  personalData,
  setEditorHtml,
  setPersonalData,
  anonymized,
  setAnonymized,
  pdRef,
  anonRef,
  pdCleanupTimerRef,
  currentProjectId,
  setPdIdsInDoc,
  pdNavTimerRef,
  pdNavIndexRef,
  setPdNavState,
  removeAmbiguousEntry,
  normalizePdText,
  dedupeMentions,
  alphaPrivate,
  otherPdTypesMap,
  patchPdMarks,
  pushSnap,
  replaceTopSnap,
  syncHtmlAndPushSnapshot,
  syncHtmlAndReplaceSnapshot,
} = {}) {
  const handlePdClick = useCallback((id) => {
    const nextAnon = { ...anonRef.current, [id]: !anonRef.current[id] };
    anonRef.current = nextAnon;

    const person = personalData.persons?.find((item) => item.id === id);
    const otherItem = personalData.otherPD?.find((item) => item.id === id);
    patchPdMarks(editorDomRef.current, id, nextAnon[id], person?.letter, otherItem?.replacement);

    setAnonymized(() => nextAnon);
    syncHtmlAndPushSnapshot();
  }, [
    anonRef,
    editorDomRef,
    patchPdMarks,
    personalData.otherPD,
    personalData.persons,
    setAnonymized,
    syncHtmlAndPushSnapshot,
  ]);

  const anonymizeAllByCategory = useCallback((category) => {
    const { persons = [], otherPD = [] } = personalData;
    const nextAnon = { ...anonRef.current };
    const items = (category === 'private' || category === 'professional')
      ? persons.filter((item) => item.category === category)
      : otherPD.filter((item) => item.type === category);
    const targetState = !items.every((item) => nextAnon[item.id]);

    items.forEach((item) => {
      nextAnon[item.id] = targetState;
      const person = persons.find((entry) => entry.id === item.id);
      const otherItem = otherPD.find((entry) => entry.id === item.id);
      patchPdMarks(editorDomRef.current, item.id, targetState, person?.letter, otherItem?.replacement);
    });

    anonRef.current = nextAnon;
    setAnonymized(() => nextAnon);
    syncHtmlAndPushSnapshot();
  }, [
    anonRef,
    editorDomRef,
    patchPdMarks,
    personalData,
    setAnonymized,
    syncHtmlAndPushSnapshot,
  ]);

  const handleEditorHtmlChange = useCallback((html) => {
    setEditorHtml(html);
    pushSnap({ html, pd: pdRef.current, anon: anonRef.current });

    clearCleanupTimer(pdCleanupTimerRef);
    pdCleanupTimerRef.current = setTimeout(() => {
      const markCounts = collectMarkCounts(editorDomRef.current);
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
    clearCleanupTimer(pdCleanupTimerRef);
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
    clearCleanupTimer(pdCleanupTimerRef);

    replaceMarksWithOriginalText(editorDomRef.current, id);

    const nextPd = {
      ...pdRef.current,
      persons: (pdRef.current.persons || []).filter((item) => item.id !== id),
      otherPD: (pdRef.current.otherPD || []).filter((item) => item.id !== id),
    };
    const nextAnon = { ...anonRef.current };
    delete nextAnon[id];

    removePdFromNavState(id, pdNavTimerRef, pdNavIndexRef, setPdNavState);

    pdRef.current = nextPd;
    anonRef.current = nextAnon;
    setPersonalData(nextPd);
    setAnonymized(nextAnon);
    setPdIdsInDoc((prev) => {
      if (!prev || !prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    setEditorHtml(editorDomRef.current?.innerHTML ?? editorHtml);
    pushSnap({
      html: editorDomRef.current?.innerHTML ?? editorHtml,
      pd: nextPd,
      anon: nextAnon,
    });
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
    const attachedText = normalizePdText(getMarkText(markEl));

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
    syncHtmlAndReplaceSnapshot('');
  }, [
    anonymized,
    dedupeMentions,
    normalizePdText,
    pdRef,
    personalData.otherPD,
    personalData.persons,
    removeAmbiguousEntry,
    setPersonalData,
    syncHtmlAndReplaceSnapshot,
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
    syncHtmlAndReplaceSnapshot('');
  }, [
    alphaPrivate,
    otherPdTypesMap,
    pdRef,
    dedupeMentions,
    removeAmbiguousEntry,
    setPersonalData,
    syncHtmlAndReplaceSnapshot,
  ]);

  const handleRemoveAmbiguousMark = useCallback((markEl) => {
    clearCleanupTimer(pdCleanupTimerRef);
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

  return {
    handlePdClick,
    anonymizeAllByCategory,
    handleEditorHtmlChange,
    handleRemovePdMark,
    handleDeletePdEntry,
    handleAttachPdMark,
    handleAddPdMark,
    handleRemoveAmbiguousMark,
  };
}
