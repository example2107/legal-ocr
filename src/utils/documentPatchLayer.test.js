import {
  buildDocumentPatchLayer,
  listExportReadyPatches,
  listNonExportablePatches,
  normalizeDocumentPatchLayer,
  removeDocumentPatch,
  upsertDocumentPatch,
} from './documentPatchLayer';

describe('documentPatchLayer', () => {
  test('builds normalized patch layer', () => {
    const layer = buildDocumentPatchLayer({
      patches: [
        {
          id: 'pd_1',
          fragmentId: 'pd_1',
          pageNumber: 7,
          patchPlan: {
            fragmentId: 'pd_1',
            pageNumber: 7,
            replacementText: 'Петров П.П.',
          },
          appliedAt: '2026-04-09T12:00:00.000Z',
        },
      ],
    });

    expect(layer).toEqual({
      version: 1,
      patches: [
        {
          id: 'pd_1',
          fragmentId: 'pd_1',
          pageNumber: 7,
          patchPlan: {
            fragmentId: 'pd_1',
            pageNumber: 7,
            replacementText: 'Петров П.П.',
          },
          appliedAt: '2026-04-09T12:00:00.000Z',
        },
      ],
    });
  });

  test('normalizes patch layer from entry wrapper', () => {
    const layer = normalizeDocumentPatchLayer({
      patchLayer: {
        version: 1,
        patches: [
          {
            fragmentId: 'pd_2',
            patchPlan: {
              fragmentId: 'pd_2',
              pageNumber: 11,
              replacementText: 'Новое имя',
            },
          },
        ],
      },
    });

    expect(layer?.patches[0]).toMatchObject({
      id: 'pd_2',
      fragmentId: 'pd_2',
      pageNumber: 11,
    });
  });

  test('upserts patch by fragment id', () => {
    const initialLayer = buildDocumentPatchLayer({
      patches: [
        {
          fragmentId: 'pd_1',
          patchPlan: { fragmentId: 'pd_1', pageNumber: 3, replacementText: 'Старый' },
        },
      ],
    });

    const nextLayer = upsertDocumentPatch({
      patchLayer: initialLayer,
      fragmentId: 'pd_1',
      patchPlan: { fragmentId: 'pd_1', pageNumber: 3, replacementText: 'Новый' },
      appliedAt: '2026-04-09T13:00:00.000Z',
    });

    expect(nextLayer?.patches).toHaveLength(1);
    expect(nextLayer?.patches[0]).toMatchObject({
      fragmentId: 'pd_1',
      pageNumber: 3,
      patchPlan: { replacementText: 'Новый' },
      appliedAt: '2026-04-09T13:00:00.000Z',
    });
  });

  test('removes one patch by fragment id', () => {
    const initialLayer = buildDocumentPatchLayer({
      patches: [
        {
          fragmentId: 'pd_1',
          patchPlan: { fragmentId: 'pd_1', pageNumber: 3, replacementText: 'Первый' },
        },
        {
          fragmentId: 'pd_2',
          patchPlan: { fragmentId: 'pd_2', pageNumber: 4, replacementText: 'Второй' },
        },
      ],
    });

    const nextLayer = removeDocumentPatch({
      patchLayer: initialLayer,
      fragmentId: 'pd_1',
    });

    expect(nextLayer?.patches).toHaveLength(1);
    expect(nextLayer?.patches[0]).toMatchObject({
      fragmentId: 'pd_2',
      pageNumber: 4,
    });
  });

  test('splits exportable and non-exportable patches', () => {
    const layer = buildDocumentPatchLayer({
      patches: [
        {
          fragmentId: 'pd_1',
          patchPlan: { fragmentId: 'pd_1', pageNumber: 3, replacementText: 'Готов', status: 'ready' },
        },
        {
          fragmentId: 'pd_2',
          patchPlan: { fragmentId: 'pd_2', pageNumber: 4, replacementText: 'Проверка', status: 'review_required' },
        },
      ],
    });

    expect(listExportReadyPatches(layer)).toHaveLength(1);
    expect(listExportReadyPatches(layer)[0]).toMatchObject({ fragmentId: 'pd_1' });
    expect(listNonExportablePatches(layer)).toHaveLength(1);
    expect(listNonExportablePatches(layer)[0]).toMatchObject({ fragmentId: 'pd_2' });
  });
});
