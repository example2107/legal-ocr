export function updatePdCollections(pdState, id, mapPerson, mapOther) {
  return {
    ...pdState,
    persons: (pdState.persons || []).map((item) => (item.id === id ? mapPerson(item) : item)),
    otherPD: (pdState.otherPD || []).map((item) => (item.id === id ? mapOther(item) : item)),
  };
}

export function appendMentionValues(dedupeMentions, baseValues, extraValues) {
  return dedupeMentions([...(baseValues || []), ...(extraValues || [])]);
}

export function getMarkText(markEl) {
  return markEl?.dataset?.original || markEl?.textContent || '';
}

export function setPdMarkAppearance(markEl, { id, person, other, isAnon, originalText, fallbackText }) {
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

export function collectTextMatches(text, values, buildPattern) {
  const allMatches = [];

  for (const value of values) {
    if (!value || value.length < 2) continue;
    try {
      const pattern = new RegExp(buildPattern(value), 'gi');
      let match;
      while ((match = pattern.exec(text)) !== null) {
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        });
      }
    } catch {}
  }

  return allMatches;
}

export function filterOverlappingMatches(
  matches,
  sorter = (a, b) => a.start - b.start || b.end - a.end,
) {
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

export function replaceTextNodeWithMarks(node, matches, createMarkElement) {
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

export function walkAndAnnotate(node, annotateTextNode) {
  if (node.nodeType === 3) {
    annotateTextNode(node);
    return;
  }

  if (isAnnotatableElement(node)) {
    Array.from(node.childNodes).forEach((child) => walkAndAnnotate(child, annotateTextNode));
  }
}

export function replaceMarksWithOriginalText(root, id) {
  if (!root) return;
  root.querySelectorAll(`mark[data-pd-id="${id}"]`).forEach((mark) => {
    const text = document.createTextNode(getMarkText(mark));
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(text, mark);
    parent.normalize?.();
  });
}

export function buildWhitespacePattern(value) {
  const escapeRegex = (part) => String(part).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return escapeRegex(value);
  return parts.map((part) => escapeRegex(part)).join('[\\s\\n]+');
}

export function collectMarkCounts(root) {
  const counts = {};
  if (!root) return counts;
  root.querySelectorAll('mark[data-pd-id]').forEach((element) => {
    const { pdId } = element.dataset;
    counts[pdId] = (counts[pdId] || 0) + 1;
  });
  return counts;
}
