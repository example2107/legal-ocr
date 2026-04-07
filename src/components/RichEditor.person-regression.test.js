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

function expectMarkedText(html, markedText) {
  expect(html).toContain(`>${markedText}</mark>`);
}

function renderWithAddress(rawText, value) {
  return buildAnnotatedHtml(
    rawText,
    {
      persons: [],
      otherPD: [
        {
          id: 'addr1',
          type: 'address',
          value,
          replacement: '[адрес]',
        },
      ],
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

  test.each([
    'З,С. Лебедев',
    'З.С, Лебедев',
    'З,С, Лебедев',
    'З, С. Лебедев',
    'З. С, Лебедев',
    'З, с. Лебедев',
    'з,С. Лебедев',
    'з,с. Лебедев',
    'з. с, Лебедев',
  ])('matches initials before surname when dots are replaced by commas: %s', (value) => {
    const html = buildAnnotatedHtml(
      `${value} пояснил, что видел автомобиль.`,
      {
        persons: [
          {
            id: 'p3',
            fullName: 'Лебедев З.С.',
            category: 'private',
            letter: 'А.',
            mentions: ['Лебедев', 'З.С. Лебедев'],
          },
        ],
        otherPD: [],
      },
      {}
    );

    expectMarkedText(html, value);
  });

  test.each([
    'З ,С. Лебедев',
    'З, С . Лебедев',
    'З . С, Лебедев',
    'з , с . Лебедев',
    'з. с , лебедев',
  ])('matches initials before surname with conservative OCR spaces around punctuation: %s', (value) => {
    const html = buildAnnotatedHtml(
      `${value} пояснил, что видел автомобиль.`,
      {
        persons: [
          {
            id: 'p5',
            fullName: 'Лебедев З.С.',
            category: 'private',
            letter: 'А.',
            mentions: ['Лебедев', 'З.С. Лебедев'],
          },
        ],
        otherPD: [],
      },
      {}
    );

    expectMarkedText(html, value);
  });

  test.each([
    'Лебедев З,С.',
    'Лебедев З.С,',
    'Лебедев З,С,',
    'Лебедев з,С.',
    'Лебедев з,с.',
    'Лебедев З, С.',
    'Лебедев з, с.',
    'Лебедев З. С,',
  ])('matches surname followed by initials when dots are replaced by commas: %s', (value) => {
    const html = buildAnnotatedHtml(
      `${value} пояснил, что видел автомобиль.`,
      {
        persons: [
          {
            id: 'p4',
            fullName: 'Лебедев З.С.',
            category: 'private',
            letter: 'А.',
            mentions: ['Лебедев', 'Лебедев З.С.'],
          },
        ],
        otherPD: [],
      },
      {}
    );

    expectMarkedText(html, value);
  });

  test.each([
    'Лебедев З ,С.',
    'Лебедев З, С .',
    'Лебедев З . С,',
    'лебедев з , с .',
    'лебедев з. с ,',
  ])('matches surname followed by initials with conservative OCR spaces and lowercase surname: %s', (value) => {
    const html = buildAnnotatedHtml(
      `${value} пояснил, что видел автомобиль.`,
      {
        persons: [
          {
            id: 'p6',
            fullName: 'Лебедев З.С.',
            category: 'private',
            letter: 'А.',
            mentions: ['Лебедев', 'Лебедев З.С.'],
          },
        ],
        otherPD: [],
      },
      {}
    );

    expectMarkedText(html, value);
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

  test.each([
    ['с. Белозерки, ул. Золинская, 13', 'ул. Золинская, 13'],
    ['с. Белозерки, ул. Золинская, д. 13', 'ул. Золинская, д. 13'],
    ['в селе Белозерки на улице Золинская, дом 13', 'на улице Золинская, дом 13'],
    ['д. № 13 по ул. Золинская с. Белозерки', 'д. № 13 по ул. Золинская'],
    ['д. 13 по ул. Золинская с. Белозерки', 'д. 13 по ул. Золинская'],
  ])('matches address variants with reordered street/house/locality: %s', (valueInText, expectedMarkedPart) => {
    const html = renderWithAddress(
      `Фрагмент: ${valueInText}.`,
      'Самарская область, муниципальный район Волжский, с. Белозерки, ул. Золинская, д. 13'
    );

    expectMarkedText(html, expectedMarkedPart);
  });
});
