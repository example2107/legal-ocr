describe('dataStore', () => {
  const localHistory = {
    addDocumentToProject: jest.fn(),
    createProject: jest.fn(),
    deleteDocument: jest.fn(),
    deleteProject: jest.fn(),
    loadHistory: jest.fn(),
    loadProjects: jest.fn(),
    saveDocument: jest.fn(),
    saveProject: jest.fn(),
  };

  function loadModule({ configured, supabase }) {
    jest.resetModules();
    jest.doMock('./history', () => localHistory);
    jest.doMock('./supabaseClient', () => ({
      isSupabaseConfigured: configured,
      STORAGE_BUCKET_SOURCE_FILES: 'source-files',
      supabase,
    }));
    return require('./dataStore');
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('falls back to local history when cloud is unavailable', async () => {
    const localDocs = [{ id: 'doc_local', title: 'Local doc' }];
    localHistory.loadHistory.mockReturnValue(localDocs);

    const { listDocuments } = loadModule({ configured: false, supabase: null });
    const docs = await listDocuments(null);

    expect(localHistory.loadHistory).toHaveBeenCalledTimes(1);
    expect(docs).toEqual(localDocs);
  });

  test('maps and saves a cloud document row', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'doc_cloud',
        title: 'Cloud doc',
        original_file_name: 'source.pdf',
        text: 'recognized',
        edited_html: '<p>recognized</p>',
        personal_data: { persons: [], otherPD: [], ambiguousPersons: [] },
        anonymized: { p1: true },
        source: 'ocr',
        project_id: 'proj_1',
        is_project_summary: false,
        page_from: 1,
        page_to: 2,
        total_pages: 10,
        chunk_index: 1,
        chunk_size: 5,
        batch_file_name: 'source.pdf',
        source_files: [{ storagePath: 'u1/proj_1/source.pdf' }],
        saved_at: '2026-04-09T00:00:00.000Z',
      },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    const from = jest.fn(() => ({ upsert }));
    const supabase = { from };

    const { saveDocumentRecord } = loadModule({ configured: true, supabase });
    const saved = await saveDocumentRecord(
      { id: 'user_1' },
      {
        id: 'doc_cloud',
        title: 'Cloud doc',
        originalFileName: 'source.pdf',
        text: 'recognized',
        editedHtml: '<p>recognized</p>',
        projectId: 'proj_1',
        sourceFiles: [{ storagePath: 'u1/proj_1/source.pdf' }],
      }
    );

    expect(from).toHaveBeenCalledWith('documents');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc_cloud',
        user_id: 'user_1',
        original_file_name: 'source.pdf',
        edited_html: '<p>recognized</p>',
        project_id: 'proj_1',
      }),
      { onConflict: 'id' }
    );
    expect(saved).toEqual(expect.objectContaining({
      id: 'doc_cloud',
      originalFileName: 'source.pdf',
      editedHtml: '<p>recognized</p>',
      projectId: 'proj_1',
      batchFileName: 'source.pdf',
    }));
  });

  test('creates a cloud project through supabase insert', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'proj_generated',
        title: 'Новый проект',
        document_ids: [],
        shared_pd: { persons: [], otherPD: [] },
        batch_session: null,
        created_at: '2026-04-09T00:00:00.000Z',
        updated_at: '2026-04-09T00:00:00.000Z',
      },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    const from = jest.fn(() => ({ insert }));
    const supabase = { from };

    const { createProjectRecord } = loadModule({ configured: true, supabase });
    const project = await createProjectRecord({ id: 'user_1' }, 'Новый проект');

    expect(from).toHaveBeenCalledWith('projects');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user_1',
      title: 'Новый проект',
      document_ids: [],
    }));
    expect(project).toEqual(expect.objectContaining({
      id: 'proj_generated',
      title: 'Новый проект',
      documentIds: [],
    }));
  });

  test('uploads source file into user/project storage path', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const storageFrom = jest.fn(() => ({ upload }));
    const supabase = { storage: { from: storageFrom } };
    const file = {
      name: 'Материалы дела.pdf',
      size: 123,
      type: 'application/pdf',
      lastModified: 1712530000000,
    };

    const { uploadSourceFile } = loadModule({ configured: true, supabase });
    const result = await uploadSourceFile(
      { id: 'user_1' },
      file,
      { projectId: 'proj_1' }
    );

    expect(storageFrom).toHaveBeenCalledWith('source-files');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^user_1\/proj_1\/\d+-/),
      file,
      expect.objectContaining({
        upsert: false,
        cacheControl: '3600',
        contentType: 'application/pdf',
      })
    );
    expect(result).toEqual(expect.objectContaining({
      name: 'Материалы дела.pdf',
      bucket: 'source-files',
      storagePath: expect.stringMatching(/^user_1\/proj_1\/\d+-/),
    }));
  });

  test('buildSourceFileKey is stable for batching identity', () => {
    const { buildSourceFileKey } = loadModule({ configured: false, supabase: null });

    expect(buildSourceFileKey({
      name: 'Материалы дела.pdf',
      size: 123,
      lastModified: 1712530000000,
    })).toBe('Материалы дела.pdf::123::1712530000000');
  });
});
