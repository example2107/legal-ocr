import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function contextMenu(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
    }));
  });
}

function keyCombo(key, opts = {}) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      code: key.toLowerCase() === 'z' ? 'KeyZ' : key.toLowerCase() === 'y' ? 'KeyY' : '',
      ctrlKey: true,
      ...opts,
    }));
  });
}

function findByText(container, selector, text) {
  return Array.from(container.querySelectorAll(selector)).find(
    el => el.textContent && el.textContent.includes(text)
  );
}

describe('App ambiguous person undo/redo integration', () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);

    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    global.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    localStorage.clear();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  test('attaching ambiguous mention to existing person can be undone and redone', async () => {
    localStorage.setItem('legal_ocr_history', JSON.stringify([{
      id: 'doc_test_1',
      title: 'Тестовый документ',
      originalFileName: 'test.pdf',
      text: 'Иванов Вячеслав Александрович пояснил обстоятельства. Позднее Слава сообщил, что видел автомобиль.',
      editedHtml: '',
      personalData: {
        persons: [
          {
            id: 'p1',
            fullName: 'Иванов В.А.',
            role: 'свидетель',
            category: 'private',
            letter: 'А.',
            mentions: ['Иванов Вячеслав Александрович', 'Иванов В.А.', 'Иванов'],
          },
        ],
        otherPD: [],
        ambiguousPersons: [
          {
            value: 'Слава',
            context: 'Позднее Слава сообщил, что видел автомобиль.',
            reason: 'Краткое имя неоднозначно',
          },
        ],
      },
      anonymized: {},
      source: 'ocr',
      savedAt: '2026-04-08T10:00:00.000Z',
    }]));

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<App />);
    });
    await flush();

    click(findByText(container, 'button', 'История'));
    await flush();

    click(findByText(container, '.history-card', 'Тестовый документ'));
    await flush();

    let ambiguousMark = container.querySelector('mark.ambiguous-person');
    expect(ambiguousMark).not.toBeNull();
    expect(ambiguousMark.textContent).toBe('Слава');

    contextMenu(ambiguousMark);
    await flush();

    click(findByText(container, '.ctx-menu-item', 'Иванов В.А.'));
    await flush();

    let pdMark = Array.from(container.querySelectorAll('mark[data-pd-id="p1"]'))
      .find(el => el.textContent === 'Слава');
    expect(pdMark).not.toBeNull();
    expect(pdMark.textContent).toBe('Слава');
    expect(container.querySelector('mark.ambiguous-person')).toBeNull();

    document.body.focus();
    keyCombo('z');
    await flush();

    ambiguousMark = container.querySelector('mark.ambiguous-person');
    expect(ambiguousMark).not.toBeNull();
    expect(ambiguousMark.textContent).toBe('Слава');
    expect(Array.from(container.querySelectorAll('mark[data-pd-id="p1"]')).some(el => el.textContent === 'Слава')).toBe(false);

    keyCombo('z', { shiftKey: true });
    await flush();

    pdMark = Array.from(container.querySelectorAll('mark[data-pd-id="p1"]'))
      .find(el => el.textContent === 'Слава');
    expect(pdMark).not.toBeNull();
    expect(pdMark.textContent).toBe('Слава');
    expect(container.querySelector('mark.ambiguous-person')).toBeNull();
  });
});
