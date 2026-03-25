import React, { useMemo } from 'react';

function parseDocumentText(text) {
  const lines = text.split('\n');
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      segments.push({ type: 'h2', content: line.slice(3), key: `h2-${i}` });
    } else if (line.startsWith('### ')) {
      segments.push({ type: 'h3', content: line.slice(4), key: `h3-${i}` });
    } else if (line === '---') {
      segments.push({ type: 'divider', key: `div-${i}` });
    } else if (line.trim() === '') {
      segments.push({ type: 'br', key: `br-${i}` });
    } else {
      segments.push({ type: 'p', content: line, key: `p-${i}` });
    }
  }
  return segments;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitTextWithHighlights(text, highlights, anonymized, onAnonymize) {
  const allPatterns = [
    '⚠️\\[(НЕТОЧНО: [^\\]]*|НЕЧИТАЕМО)\\]',
    ...highlights.filter(h => h.text && h.text.length > 1).map(h => `(${escapeRegex(h.text)})`),
  ];

  let masterRegex;
  try {
    masterRegex = new RegExp(allPatterns.join('|'), 'g');
  } catch {
    return [<span key="raw">{text}</span>];
  }

  const result = [];
  let lastIndex = 0;
  let match;
  let k = 0;

  while ((match = masterRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(<span key={`t-${k++}`}>{text.slice(lastIndex, match.index)}</span>);
    }

    const matchedText = match[0];

    if (matchedText.startsWith('⚠️[')) {
      const inner = matchedText.slice(3, -1);
      const isUnreadable = inner === 'НЕЧИТАЕМО';
      result.push(
        <mark
          key={`u-${k++}`}
          className={`uncertain ${isUnreadable ? 'unreadable' : ''}`}
          title={isUnreadable ? 'Текст не удалось распознать' : 'Возможно неточное распознавание — проверьте вручную'}
        >
          {isUnreadable ? '[НЕЧИТАЕМО]' : inner.replace('НЕТОЧНО: ', '')}
        </mark>
      );
    } else {
      const hl = highlights.find(h => h.text === matchedText);
      if (hl) {
        const isAnon = !!anonymized[hl.id];
        const displayText = isAnon
          ? (hl.type === 'person' ? hl.letter : hl.replacement)
          : matchedText;
        result.push(
          <mark
            key={`pd-${k++}`}
            className={`pd-mark pd-${hl.type} pd-cat-${hl.type === 'person' ? hl.category : hl.pdType} ${isAnon ? 'anonymized' : ''}`}
            onClick={() => onAnonymize(hl.id)}
            title={isAnon ? `Нажмите, чтобы показать` : 'Нажмите, чтобы обезличить'}
          >
            {displayText}
          </mark>
        );
      } else {
        result.push(<span key={`f-${k++}`}>{matchedText}</span>);
      }
    }

    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < text.length) {
    result.push(<span key={`t-${k++}`}>{text.slice(lastIndex)}</span>);
  }

  return result;
}

function processBold(content, key) {
  const parts = content.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={`${key}-s${i}`}>{part}</strong>
      : <span key={`${key}-t${i}`}>{part}</span>
  );
}

export function DocumentRenderer({ text, personalData, anonymized, onAnonymize }) {
  const segments = useMemo(() => parseDocumentText(text), [text]);

  const highlights = useMemo(() => {
    const marks = [];
    for (const person of (personalData.persons || [])) {
      for (const mention of (person.mentions || [person.fullName])) {
        if (mention && mention.length > 1) {
          marks.push({
            text: mention,
            type: 'person',
            category: person.category,
            id: person.id,
            letter: person.letter,
            fullName: person.fullName,
          });
        }
      }
    }
    for (const item of (personalData.otherPD || [])) {
      if (item.value) {
        marks.push({
          text: item.value,
          type: 'other',
          pdType: item.type,
          id: item.id,
          replacement: item.replacement,
        });
      }
    }
    marks.sort((a, b) => b.text.length - a.text.length);
    return marks;
  }, [personalData]);

  const renderLine = (content, key) => {
    const parts = splitTextWithHighlights(content, highlights, anonymized, onAnonymize);
    return parts.map((part, i) => {
      if (typeof part.props?.children === 'string') {
        const children = processBold(part.props.children, `${key}-b${i}`);
        return React.cloneElement(part, { key: `${key}-p${i}` }, ...children);
      }
      return part;
    });
  };

  return (
    <div className="doc-text">
      {segments.map((seg) => {
        switch (seg.type) {
          case 'h2': return <h2 key={seg.key} className="doc-h2">{renderLine(seg.content, seg.key)}</h2>;
          case 'h3': return <h3 key={seg.key} className="doc-h3">{renderLine(seg.content, seg.key)}</h3>;
          case 'divider': return <div key={seg.key} className="doc-divider" />;
          case 'br': return <div key={seg.key} className="doc-br" />;
          case 'p': return <p key={seg.key} className="doc-p">{renderLine(seg.content, seg.key)}</p>;
          default: return null;
        }
      })}
    </div>
  );
}
