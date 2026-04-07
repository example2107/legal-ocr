import { analyzePD, PROVIDERS } from './claudeApi';

describe('analyzePD ambiguous mentions normalization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('removes ambiguous values from person mentions when model returns both', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify({
              persons: [
                {
                  id: 'p1',
                  fullName: 'Иванов В.А.',
                  role: 'свидетель',
                  category: 'private',
                  mentions: ['Иванов Вячеслав Александрович', 'Вячеслав'],
                },
                {
                  id: 'p2',
                  fullName: 'Петров В.',
                  role: 'свидетель',
                  category: 'private',
                  mentions: ['Вячеслав Петров', 'Вячеслав'],
                },
              ],
              otherPD: [],
              ambiguousPersons: [
                {
                  value: 'Вячеслав',
                  context: 'Вячеслав подошёл к автомобилю',
                  reason: 'Имя неоднозначно',
                },
              ],
            }),
          },
        ],
      }),
    });

    const progress = jest.fn();
    const result = await analyzePD('Тестовый текст', 'test-key', 'claude', progress);

    expect(result.ambiguousPersons).toHaveLength(1);
    expect(result.ambiguousPersons[0].value).toBe('Вячеслав');
    expect(result.persons[0].mentions).toEqual(['Иванов Вячеслав Александрович']);
    expect(result.persons[1].mentions).toEqual(['Вячеслав Петров']);
  });
});
