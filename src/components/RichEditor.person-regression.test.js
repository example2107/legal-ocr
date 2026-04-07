import { buildAnnotatedHtml } from './RichEditor';

function renderWithPerson(rawText, mentions) {
  return buildAnnotatedHtml(
    rawText,
    {
      persons: [
        {
          id: 'p1',
          fullName: 'Баданов А.С.',
          category: 'private',
          letter: 'А.',
          mentions,
        },
      ],
      otherPD: [],
    },
    {}
  );
}

describe('person annotation regression', () => {
  test('does not capture last letter of previous sentence before surname and initials', () => {
    const html = buildAnnotatedHtml(
      'Он стал расспрашивать, что случилось. Баданов А.С. ответил, что ничего не помнит.',
      {
        persons: [
          {
            id: 'p1',
            fullName: 'Баданов А.С.',
            category: 'private',
            letter: 'А.',
            mentions: ['Баданов', 'Баданов А.С.'],
          },
        ],
        otherPD: [],
      },
      {}
    );

    expect(html).toContain('случилось. <mark');
    expect(html).toContain('>Баданов А.С.</mark>');
    expect(html).not.toContain('ь. Баданов А.С.');
  });

  test('does not capture last letter of previous word in another repeated case', () => {
    const html = buildAnnotatedHtml(
      '... ничего не пояснил. Полуянович И.В. сказал ...',
      {
        persons: [
          {
            id: 'p2',
            fullName: 'Полуянович И.В.',
            category: 'private',
            letter: 'А.',
            mentions: ['Полуянович', 'Полуянович И.В.'],
          },
        ],
        otherPD: [],
      },
      {}
    );

    expect(html).toContain('пояснил. <mark');
    expect(html).toContain('>Полуянович И.В.</mark>');
    expect(html).not.toContain('л. Полуянович И.В.');
  });

  test('still matches lowercase OCR surname variant', () => {
    const html = renderWithPerson('баданов А.С. ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>баданов А.С.</mark>');
  });

  test('still matches initials before surname', () => {
    const html = renderWithPerson('А.С. Баданов ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>А.С. Баданов</mark>');
  });

  test('still matches initials before surname when first initial is lowercase OCR error', () => {
    const html = renderWithPerson('а.С. Баданов ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>а.С. Баданов</mark>');
  });

  test('still matches initials before surname when both initials are lowercase OCR error', () => {
    const html = renderWithPerson('а.с. Баданов ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>а.с. Баданов</mark>');
  });

  test('matches initials before surname when initials are separated by a space', () => {
    const html = renderWithPerson('А. С. Баданов ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>А. С. Баданов</mark>');
  });

  test('matches initials before surname with space when first initial is lowercase OCR error', () => {
    const html = renderWithPerson('а. С. Баданов ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>а. С. Баданов</mark>');
  });

  test('matches initials before surname with space when both initials are lowercase OCR error', () => {
    const html = renderWithPerson('а. с. Баданов ответил, что ничего не помнит.', ['Баданов']);
    expect(html).toContain('>а. с. Баданов</mark>');
  });

  test('still matches surname in indirect case with initials', () => {
    const html = renderWithPerson('Он спросил у Баданова А.С., что произошло.', ['Баданов']);
    expect(html).toContain('>Баданова А.С.</mark>');
  });

  test('renders ambiguous person mention as separate highlight, not as pd mark', () => {
    const html = buildAnnotatedHtml(
      'Позднее Слава сообщил, что видел автомобиль.',
      {
        persons: [],
        otherPD: [],
        ambiguousPersons: [
          {
            value: 'Слава',
            context: 'Позднее Слава сообщил, что видел автомобиль.',
            reason: 'Краткое имя неоднозначно',
          },
        ],
      },
      {}
    );

    expect(html).toContain('class="ambiguous-person"');
    expect(html).toContain('>Слава</mark>');
    expect(html).not.toContain('data-pd-id=');
  });
});
