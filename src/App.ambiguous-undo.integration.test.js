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

function setInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor.set.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
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
  test('pd mark text can be edited from context menu', async () => {
    localStorage.setItem('legal_ocr_history', JSON.stringify([{
      id: 'doc_test_2',
      title: 'Документ для правки ПД',
      originalFileName: 'test.pdf',
      text: 'Иванов Иван Иванович пояснил обстоятельства.',
      editedHtml: '',
      personalData: {
        persons: [
          {
            id: 'p1',
            fullName: 'Иванов Иван Иванович',
            role: 'свидетель',
            category: 'private',
            letter: 'А.',
            mentions: ['Иванов Иван Иванович'],
          },
        ],
        otherPD: [],
        ambiguousPersons: [],
      },
      anonymized: {},
      source: 'ocr',
      savedAt: '2026-04-09T10:00:00.000Z',
    }]));

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<App />);
    });
    await flush();

    click(findByText(container, 'button', 'История'));
    await flush();

    click(findByText(container, '.history-card', 'Документ для правки ПД'));
    await flush();

    const pdMark = container.querySelector('mark[data-pd-id="p1"]');
    expect(pdMark).not.toBeNull();
    expect(pdMark.textContent).toBe('Иванов Иван Иванович');

    contextMenu(pdMark);
    await flush();

    expect(findByText(container, '.ctx-menu-item', 'Редактировать запись ПД')).toBeUndefined();
    click(findByText(container, '.ctx-menu-item', 'Исправить текст фрагмента'));
    await flush();

    const input = container.querySelector('.modal-input');
    expect(input).not.toBeNull();
    setInputValue(input, 'Иванов И.И.');

    click(findByText(container, 'button', 'Сохранить'));
    await flush();

    const updatedMark = container.querySelector('mark[data-pd-id="p1"]');
    expect(updatedMark).not.toBeNull();
    expect(updatedMark.textContent).toBe('Иванов И.И.');
  });

  test('pd mark can adopt canonical text from PD panel', async () => {
    localStorage.setItem('legal_ocr_history', JSON.stringify([{
      id: 'doc_test_2b',
      title: 'Документ для принятия канона',
      originalFileName: 'test.pdf',
      text: 'Стрекова Лилия Андреевна пояснила обстоятельства.',
      editedHtml: '',
      personalData: {
        persons: [
          {
            id: 'p1',
            fullName: 'Стрежнева Лидия Андреевна',
            role: 'свидетель',
            category: 'private',
            letter: 'А.',
            mentions: ['Стрекова Лилия Андреевна', 'Стрежнева Лидия Андреевна'],
          },
        ],
        otherPD: [],
        ambiguousPersons: [],
      },
      anonymized: {},
      source: 'ocr',
      savedAt: '2026-04-09T10:05:00.000Z',
    }]));

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<App />);
    });
    await flush();

    click(findByText(container, 'button', 'История'));
    await flush();

    click(findByText(container, '.history-card', 'Документ для принятия канона'));
    await flush();

    const pdMark = container.querySelector('mark[data-pd-id="p1"]');
    expect(pdMark).not.toBeNull();
    expect(pdMark.textContent).toBe('Стрекова Лилия Андреевна');

    contextMenu(pdMark);
    await flush();

    click(findByText(container, '.ctx-menu-item', 'Принять вид из панели ПД'));
    await flush();

    const updatedMark = container.querySelector('mark[data-pd-id="p1"]');
    expect(updatedMark).not.toBeNull();
    expect(updatedMark.textContent).toBe('Стрежнева Лидия Андреевна');
  });

  test('pd fragment edit targets the exact clicked mark when duplicates exist', async () => {
    localStorage.setItem('legal_ocr_history', JSON.stringify([{
      id: 'doc_test_2c',
      title: 'Документ с дублями упоминаний',
      originalFileName: 'test.pdf',
      text: 'Иванов Иван Иванович пояснил. Позже Иванов Иван Иванович подтвердил показания.',
      editedHtml: '',
      personalData: {
        persons: [
          {
            id: 'p1',
            fullName: 'Иванов Иван Иванович',
            role: 'свидетель',
            category: 'private',
            letter: 'А.',
            mentions: ['Иванов Иван Иванович'],
          },
        ],
        otherPD: [],
        ambiguousPersons: [],
      },
      anonymized: {},
      source: 'ocr',
      savedAt: '2026-04-09T10:07:00.000Z',
    }]));

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<App />);
    });
    await flush();

    click(findByText(container, 'button', 'История'));
    await flush();

    click(findByText(container, '.history-card', 'Документ с дублями упоминаний'));
    await flush();

    const marksBefore = Array.from(container.querySelectorAll('mark[data-pd-id="p1"]'));
    expect(marksBefore).toHaveLength(2);

    contextMenu(marksBefore[1]);
    await flush();

    click(findByText(container, '.ctx-menu-item', 'Исправить текст фрагмента'));
    await flush();

    const input = container.querySelector('.modal-input');
    setInputValue(input, 'Иванов И.И.');

    click(findByText(container, 'button', 'Сохранить'));
    await flush();

    const marksAfter = Array.from(container.querySelectorAll('mark[data-pd-id="p1"]'));
    expect(marksAfter).toHaveLength(2);
    expect(marksAfter[0].textContent).toBe('Иванов Иван Иванович');
    expect(marksAfter[1].textContent).toBe('Иванов И.И.');
  });

  test('editing person card re-annotates document by corrected full name', async () => {
    localStorage.setItem('legal_ocr_history', JSON.stringify([{
      id: 'doc_test_3',
      title: 'Документ для переаннотации ПД',
      originalFileName: 'test.pdf',
      text: 'Стрежнева Лидия Андреевна пояснила обстоятельства.',
      editedHtml: '',
      personalData: {
        persons: [
          {
            id: 'p1',
            fullName: 'Стрекова Лилия Андреевна',
            role: 'свидетель',
            category: 'private',
            letter: 'А.',
            mentions: ['Стрекова Лилия Андреевна'],
          },
        ],
        otherPD: [],
        ambiguousPersons: [],
      },
      anonymized: {},
      source: 'ocr',
      savedAt: '2026-04-09T10:30:00.000Z',
    }]));

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<App />);
    });
    await flush();

    click(findByText(container, 'button', 'История'));
    await flush();

    click(findByText(container, '.history-card', 'Документ для переаннотации ПД'));
    await flush();

    expect(container.querySelector('mark[data-pd-id="p1"]')).toBeNull();

    click(findByText(container, 'button', 'Изм.'));
    await flush();

    const inputs = container.querySelectorAll('.modal-input');
    expect(inputs.length).toBeGreaterThan(0);
    setInputValue(inputs[0], 'Стрежнева Лидия Андреевна');

    click(findByText(container, 'button', 'Сохранить'));
    await flush();

    const updatedMark = container.querySelector('mark[data-pd-id="p1"]');
    expect(updatedMark).not.toBeNull();
    expect(updatedMark.textContent).toBe('Стрежнева Лидия Андреевна');
  });

  test('editing person card keeps existing marked occurrences while adding new canonical matches', async () => {
    localStorage.setItem('legal_ocr_history', JSON.stringify([{
      id: 'doc_test_4',
      title: 'Документ без потери старых маркеров',
      originalFileName: 'test.pdf',
      text: 'Стрекова Лилия Андреевна пояснила, что Стрежнева Лидия Андреевна также фигурирует в деле.',
      editedHtml: '',
      personalData: {
        persons: [
          {
            id: 'p1',
            fullName: 'Стрекова Лилия Андреевна',
            role: 'свидетель',
            category: 'private',
            letter: 'А.',
            mentions: ['Стрекова Лилия Андреевна'],
          },
        ],
        otherPD: [],
        ambiguousPersons: [],
      },
      anonymized: {},
      source: 'ocr',
      savedAt: '2026-04-09T10:40:00.000Z',
    }]));

    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(<App />);
    });
    await flush();

    click(findByText(container, 'button', 'История'));
    await flush();

    click(findByText(container, '.history-card', 'Документ без потери старых маркеров'));
    await flush();

    expect(Array.from(container.querySelectorAll('mark[data-pd-id="p1"]')).map(el => el.textContent))
      .toContain('Стрекова Лилия Андреевна');

    click(findByText(container, 'button', 'Изм.'));
    await flush();

    const inputs = container.querySelectorAll('.modal-input');
    setInputValue(inputs[0], 'Стрежнева Лидия Андреевна');

    click(findByText(container, 'button', 'Сохранить'));
    await flush();

    const markTexts = Array.from(container.querySelectorAll('mark[data-pd-id="p1"]')).map(el => el.textContent);
    expect(markTexts).toContain('Стрекова Лилия Андреевна');
    expect(markTexts).toContain('Стрежнева Лидия Андреевна');
  });
});
