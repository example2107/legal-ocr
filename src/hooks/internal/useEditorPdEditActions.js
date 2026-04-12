import { useCallback } from 'react';
import {
  appendMentionValues,
  buildWhitespacePattern,
  collectTextMatches,
  filterOverlappingMatches,
  getMarkText,
  replaceTextNodeWithMarks,
  updatePdCollections,
  walkAndAnnotate,
} from '../../utils/editorPdDomUtils';

export function useEditorPdEditActions({
  editorDomRef,
  editorHtml,
  personalData,
  setEditorHtml,
  setPersonalData,
  anonymized,
  pdRef,
  anonRef,
  setEditingPdId,
  editingPdFragment,
  setEditingPdFragment,
  buildPdMatchPattern,
  patchPdMarks,
  normalizePdText,
  dedupeMentions,
  getPersonMentions,
  getOtherPdMentions,
  buildCanonicalPersonMentions,
  pushSnap,
  syncHtmlAndPushSnapshot,
} = {}) {
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
      const element = document.createElement('mark');
      const isAnon = !!anonRef.current[targetId];
      const isPerson = !!targetPerson;
      element.className = `pd ${isPerson ? (targetPerson.category === 'professional' ? 'prof' : 'priv') : 'oth'}${isAnon ? ' anon' : ''}`;
      element.dataset.pdId = targetId;
      element.dataset.original = match.text;
      element.contentEditable = 'false';
      element.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
      element.textContent = isAnon
        ? (isPerson ? targetPerson.letter : targetOther.replacement || '[ПД]')
        : match.text;
      return element;
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
    setEditingPdFragment({
      id,
      text: normalizePdText(getMarkText(markEl)),
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
      || marks.find((mark) => normalizePdText(getMarkText(mark)) === normalizePdText(editingPdFragment?.text))
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
    syncHtmlAndPushSnapshot(editorHtml);
  }, [
    dedupeMentions,
    editorHtml,
    normalizePdText,
    pdRef,
    setPersonalData,
    syncHtmlAndPushSnapshot,
  ]);

  const handleUncertainResolved = useCallback(() => {
    const dom = editorDomRef.current;
    if (!dom) return;

    const otherItems = pdRef.current.otherPD || [];
    if (otherItems.length === 0) return;

    const markedIds = new Set();
    dom.querySelectorAll('mark[data-pd-id]').forEach((element) => markedIds.add(element.dataset.pdId));
    const unmarked = otherItems.filter((item) => !markedIds.has(item.id));
    if (unmarked.length === 0) return;

    let changed = false;

    const createMarkElement = (match) => {
      const element = document.createElement('mark');
      const isAnon = !!anonRef.current[match.item.id];
      element.className = `pd oth${isAnon ? ' anon' : ''}`;
      element.dataset.pdId = match.item.id;
      element.dataset.original = match.text;
      element.contentEditable = 'false';
      element.title = isAnon ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы обезличить';
      element.textContent = isAnon ? match.item.replacement : match.text;
      return element;
    };

    const annotateTextNode = (node) => {
      const allMatches = [];
      for (const item of unmarked) {
        const values = getOtherPdMentions(item);
        const itemMatches = collectTextMatches(node.textContent, values, buildWhitespacePattern)
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
      const html = dom.innerHTML;
      setEditorHtml(html);
      pushSnap({ html, pd: pdRef.current, anon: anonRef.current });
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
    annotatePdMentionsInEditor,
    openPdEditor,
    openPdFragmentEditor,
    handleSavePdEdit,
    handleSavePdFragmentEdit,
    handleApplyPdCanonicalText,
    handleUncertainResolved,
  };
}
