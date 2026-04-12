# ЮрДок

ЮрДок — веб-приложение для распознавания, редактирования и обезличивания юридических документов.
Текущая продуктовая модель простая:

- пользователь сначала создаёт проект;
- вся работа с файлами и текстом ведётся только внутри проекта;
- результат открывается в редакторе с панелью персональных данных;
- экспорт в `PDF` сейчас обычный цифровой, без попытки вернуть правки обратно в исходный PDF.

Этот `README` — рабочий handoff-документ для продолжения разработки. Он описывает текущее состояние приложения, его реальные функции, карту кода и ограничения, которые важно учитывать перед следующими изменениями.

## Что умеет приложение

### Работа с проектами

- создание проекта;
- открытие проекта с главной страницы;
- удаление проекта;
- переименование проекта;
- хранение всех документов внутри конкретного проекта;
- хранение общей проектной базы ПД (`sharedPD`) для последовательной обработки частей одного дела.

### Источники данных внутри проекта

- вкладка `Документы`:
  - `PDF`
  - `JPG`
  - `PNG`
  - `WEBP`
- вкладка `DOCX`
- вкладка `Текст` для вставки цифрового текста;
- импорт `.юрдок` внутрь проекта.

### Распознавание и анализ

- выбор AI-провайдера:
  - `Claude`
  - `OpenAI`
  - `Gemini`
- ввод API-ключа внутри проекта;
- OCR для `PDF` и изображений;
- автообрезка изображения по основной странице перед OCR, если границы найдены достаточно уверенно;
- quality-check после OCR для явных ошибок распознавания;
- извлечение персональных данных в структурированном виде;
- объединение новых ПД с уже накопленной базой ПД проекта.

### Batch-обработка

- `PDF` обрабатывается постранично;
- изображения обрабатываются как batch по одному файлу за шаг;
- можно поставить обработку на паузу;
- можно продолжить незавершённую обработку;
- можно вернуться из экрана обработки обратно в проект;
- при прерывании пользователь видит точку продолжения и может выбрать те же исходные файлы заново;
- страницы большого PDF автоматически объединяются в один накапливаемый документ проекта, а не в множество отдельных документов.

### Редактор результата

- открытие документа из проекта в rich-text редакторе;
- панель персональных данных слева;
- переключение отдельного ПД между открытым и обезличенным видом;
- массовое обезличивание по категории;
- навигация по вхождениям конкретного ПД;
- редактирование записи ПД;
- удаление записи ПД;
- удаление конкретной метки ПД из текста;
- создание нового ПД из выделенного фрагмента;
- привязка фрагмента к существующему ПД;
- редактирование конкретного текстового фрагмента ПД;
- применение канонического вида из панели ПД к конкретной метке;
- обработка неоднозначных упоминаний (`ambiguousPersons`);
- обработка uncertain-маркеров (`НЕТОЧНО`, `НЕЧИТАЕМО`);
- `undo / redo`.

### Просмотр оригинала

- открытие панели `Оригинал`;
- показ исходных страниц документа;
- синхронизация страницы оригинала и страницы в редакторе;
- ручная навигация по страницам из панели редактора;
- автоматическое обновление текущей страницы при скролле редактора.

### Сохранение и экспорт

- сохранение текущего документа;
- экспорт в `DOCX`;
- экспорт в обычный цифровой `PDF`;
- экспорт документа в `.юрдок`;
- импорт `.юрдок` обратно в проект;
- сборка итогового документа проекта из нескольких документов проекта.

## Как устроен пользовательский поток

### 1. Главная страница

Главная страница больше не является экраном распознавания.

На ней есть только:

- hero-блок проекта;
- кнопка `Создать проект`;
- список существующих проектов.

Пользователь не загружает документы на главной странице.

### 2. Экран проекта

Это единственная рабочая зона загрузки и распознавания.

Внутри проекта доступны:

- выбор провайдера;
- поле API-ключа;
- вкладки `Документы`, `DOCX`, `Текст`;
- импорт `.юрдок`;
- кнопка запуска распознавания;
- карточка batch-статуса, если есть незавершённая обработка;
- список документов проекта;
- кнопка сборки итогового документа.

### 3. Экран обработки

Показывает:

- текущий текст статуса;
- процент прогресса;
- кнопку `Пауза` или `Продолжить распознавание`;
- кнопку `Вернуться в проект`.

Если пауза уже запрошена, интерфейс сообщает, что она будет поставлена после завершения текущей страницы.

### 4. Экран результата

Содержит:

- заголовок документа;
- действия `Оригинал`, `Сохранить`, `DOCX`, `PDF`;
- rich-text редактор;
- навигацию по страницам;
- левую панель ПД;
- правую панель оригинала, если она открыта.

## Поддерживаемые форматы и поведение

| Источник | Где загружается | Как обрабатывается |
| --- | --- | --- |
| `PDF` | Проект → `Документы` | OCR, quality-check, анализ ПД, batch по 1 странице |
| `JPG / PNG / WEBP` | Проект → `Документы` | OCR, quality-check, анализ ПД, batch по 1 файлу |
| `DOCX` | Проект → `DOCX` | парсинг DOCX, анализ ПД без batch |
| Текст | Проект → `Текст` | анализ ПД без OCR и без batch |
| `.юрдок` | Проект | импорт готового документа без OCR |

## Актуальные продуктовые решения

Это важно не менять случайно при следующих доработках:

- главная страница — только проекты;
- история как отдельный пользовательский раздел убрана из интерфейса;
- все новые документы должны быть привязаны к проекту;
- `PDF`-экспорт не пытается модифицировать исходный PDF;
- просмотр `Оригинал` остаётся только reference-view для пользователя;
- batch для `PDF` всегда идёт по `1` странице;
- batch для изображений всегда идёт по `1` файлу;
- `DOCX` и `Текст` не используют batch-сессию;
- итоговый документ проекта — это отдельный документ проекта, а не временный preview.

## Модель данных

### Документ

Документ в рантайме обычно содержит:

- `id`
- `title`
- `originalFileName`
- `text`
- `editedHtml`
- `personalData`
- `anonymized`
- `source`
- `projectId`
- `isProjectSummary`
- `pageFrom`
- `pageTo`
- `totalPages`
- `chunkIndex`
- `chunkSize`
- `batchFileName`
- `sourceFiles`
- `pageMetadata`
- `savedAt`

### Проект

Проект обычно содержит:

- `id`
- `title`
- `documentIds`
- `sharedPD`
- `batchSession`
- `createdAt`
- `updatedAt`

### `personalData`

Используется структура:

```js
{
  persons: [],
  otherPD: [],
  ambiguousPersons: []
}
```

#### `persons`

Каждая запись человека содержит:

- `id`
- `fullName`
- `role`
- `category`
  - `private`
  - `professional`
- `mentions`
- `letter`

#### `otherPD`

Каждая запись содержит:

- `id`
- `type`
- `value`
- `replacement`
- `mentions` при необходимости

Типы могут включать, например:

- `address`
- `phone`
- `passport`
- `dob`
- `birthplace`
- `email`
- `card`
- `inn`
- `snils`
- и другие типы, перечисленные в prompt-слое

#### `ambiguousPersons`

Используется для неоднозначных упоминаний лиц. Обычно запись содержит:

- `value`
- `context`
- `reason`

### `anonymized`

Это объект вида:

```js
{
  [pdId]: true
}
```

Он определяет, какая запись ПД сейчас показана в обезличенном виде.

## Где искать основную логику

### Главный composition-слой

- [src/App.js](/Users/lebedev/Desktop/legal-ocr/src/App.js)

`App.js` теперь в первую очередь координирует экраны и связывает вынесенные hooks/компоненты. Это всё ещё главный вход в приложение, но уже не единственный монолит.

### Экраны

- [src/components/HomeProjectsView.js](/Users/lebedev/Desktop/legal-ocr/src/components/HomeProjectsView.js) — главная страница проектов
- [src/components/ProjectWorkspaceView.js](/Users/lebedev/Desktop/legal-ocr/src/components/ProjectWorkspaceView.js) — экран проекта
- [src/components/ProcessingView.js](/Users/lebedev/Desktop/legal-ocr/src/components/ProcessingView.js) — экран обработки
- [src/components/ResultWorkspaceView.js](/Users/lebedev/Desktop/legal-ocr/src/components/ResultWorkspaceView.js) — экран результата
- [src/components/AppHeader.js](/Users/lebedev/Desktop/legal-ocr/src/components/AppHeader.js) — верхняя шапка
- [src/components/AppMainContent.js](/Users/lebedev/Desktop/legal-ocr/src/components/AppMainContent.js) — маршрутизация экранов на уровне view-композиции

### Ключевые hooks

- [src/hooks/useAppWorkspaceState.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useAppWorkspaceState.js) — верхнеуровневое рабочее состояние
- [src/hooks/useAppNavigationFlow.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useAppNavigationFlow.js) — переходы между экранами и unsaved-flow
- [src/hooks/useAppViewProps.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useAppViewProps.js) — сборка props для экранов
- [src/hooks/useProjectRecognitionActions.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useProjectRecognitionActions.js) — запуск распознавания внутри проекта
- [src/hooks/useProjectWorkspaceActions.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useProjectWorkspaceActions.js) — действия на экране проекта
- [src/hooks/useWorkspaceSaveActions.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useWorkspaceSaveActions.js) — сохранение и экспорт
- [src/hooks/useEditorPdActions.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useEditorPdActions.js) — действия редактора над ПД
- [src/hooks/useEditorPageNavigation.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useEditorPageNavigation.js) — синхронизация и навигация по страницам

### Редактор и разметка

- [src/components/RichEditor.js](/Users/lebedev/Desktop/legal-ocr/src/components/RichEditor.js) — coordinator редактора
- [src/components/rich-editor](/Users/lebedev/Desktop/legal-ocr/src/components/rich-editor) — внутренние части редактора
- [src/utils/richEditorAnnotations.js](/Users/lebedev/Desktop/legal-ocr/src/utils/richEditorAnnotations.js) — построение annotated HTML
- [src/utils/richEditorMarkUtils.js](/Users/lebedev/Desktop/legal-ocr/src/utils/richEditorMarkUtils.js) — DOM helper для `<mark>`
- [src/utils/editorPdDomUtils.js](/Users/lebedev/Desktop/legal-ocr/src/utils/editorPdDomUtils.js) — DOM/text helper для действий над ПД

### OCR и AI-слой

- [src/utils/claudeApi.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApi.js) — публичный API-слой распознавания и анализа
- [src/utils/claudeApiConfig.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApiConfig.js) — провайдеры, модели, prompts, лимиты
- [src/utils/claudeApiClient.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApiClient.js) — вызов внешних AI API
- [src/utils/claudeApiImage.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApiImage.js) — подготовка изображений к OCR
- [src/utils/claudeApiQuality.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApiQuality.js) — quality-check после OCR

### Batch и проектные документы

- [src/utils/projectBatch.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectBatch.js) — модель batch-сессии
- [src/utils/runProjectBatchRecognition.js](/Users/lebedev/Desktop/legal-ocr/src/utils/runProjectBatchRecognition.js) — основной orchestration batch-распознавания
- [src/utils/projectBatchRecognitionJob.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectBatchRecognitionJob.js) — шаги batch-job
- [src/utils/projectBatchRecognitionLifecycle.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectBatchRecognitionLifecycle.js) — обновление статусов batch
- [src/utils/projectBatchRecognitionStages.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectBatchRecognitionStages.js) — stage-helper для batch
- [src/utils/projectDocumentOps.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectDocumentOps.js) — merge документов проекта и итогового документа
- [src/utils/documentPageMetadata.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentPageMetadata.js) — метаданные страниц

### Хранение данных

- [src/utils/dataStore.js](/Users/lebedev/Desktop/legal-ocr/src/utils/dataStore.js) — основной persistence-слой
- [src/utils/history.js](/Users/lebedev/Desktop/legal-ocr/src/utils/history.js) — local fallback и импорт/экспорт `.юрдок`
- [src/utils/documentViewState.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentViewState.js) — загрузка/сброс состояния документа

### Файлы исходников и просмотр оригинала

- [src/utils/pdfUtils.js](/Users/lebedev/Desktop/legal-ocr/src/utils/pdfUtils.js) — рендер PDF в страницы
- [src/utils/documentImageCrop.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentImageCrop.js) — автообрезка по основной странице
- [src/utils/originalViewerFiles.js](/Users/lebedev/Desktop/legal-ocr/src/utils/originalViewerFiles.js) — подготовка исходных файлов для viewer
- [src/utils/originalImagePages.js](/Users/lebedev/Desktop/legal-ocr/src/utils/originalImagePages.js) — работа с изображениями оригинала
- [src/components/OriginalViewerPanel.js](/Users/lebedev/Desktop/legal-ocr/src/components/OriginalViewerPanel.js) — панель просмотра оригинала

### Экспорт

- [src/utils/docxExport.js](/Users/lebedev/Desktop/legal-ocr/src/utils/docxExport.js) — экспорт в DOCX
- [src/utils/pdfExportFlow.js](/Users/lebedev/Desktop/legal-ocr/src/utils/pdfExportFlow.js) — текущий экспорт в обычный PDF
- [src/utils/pdfPatchExport.js](/Users/lebedev/Desktop/legal-ocr/src/utils/pdfPatchExport.js) — legacy-named helper, сейчас используется только как печатная обёртка для обычного rich-text PDF

## Хранение данных и режимы работы

### Cloud-режим

Если настроены:

- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`

и пользователь авторизован, приложение использует:

- `Supabase Auth`
- `Supabase Postgres`
- `Supabase Storage`

### Local fallback

Если Supabase не настроен, приложение может работать в локальном режиме:

- проекты и документы хранятся в `localStorage`;
- используется [history.js](/Users/lebedev/Desktop/legal-ocr/src/utils/history.js);
- `.юрдок` остаётся рабочим способом переноса документов.

## Текущие ограничения

### 1. Анализ ПД по длине текста

В [claudeApi.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApi.js) действует лимит `PD_ANALYSIS_CHAR_LIMIT`.

Это значит:

- очень длинный текст может быть распознан целиком;
- но анализ ПД выполняется только на ограниченном фрагменте текста;
- интерфейс показывает предупреждение для длинных документов.

### 2. PDF-экспорт

Экспорт `PDF` сейчас:

- не изменяет исходный PDF;
- не использует patch-preview;
- печатает текущее содержимое rich-text редактора как цифровой документ.

Это осознанное решение текущей версии продукта.

### 3. Просмотр оригинала

Панель `Оригинал`:

- показывает исходный документ;
- синхронизируется по страницам;
- не является editable-слоем;
- нужна только как визуальная опора при сверке результата.

### 4. Batch-resume для изображений

Для продолжения batch по изображениям пользователь должен выбрать тот же набор файлов заново. Сопоставление идёт по имени, размеру и `lastModified`.

## Команды разработки

Установка зависимостей:

```bash
npm install
```

Локальный запуск:

```bash
npm start
```

Production build:

```bash
npm run build
```

Обычный lint:

```bash
npm run lint
```

Строгий lint без warning:

```bash
npm run lint:strict
```

Проверка тестов:

```bash
npm run test:ci
```

Покрытие:

```bash
npm run coverage
```

Проверка циклических зависимостей:

```bash
npm run deps:check
```

Проверка дублирования кода:

```bash
npm run dupcheck
```

## Тесты, которые особенно важны

- [src/App.ambiguous-undo.integration.test.js](/Users/lebedev/Desktop/legal-ocr/src/App.ambiguous-undo.integration.test.js)
- [src/components/RichEditor.person-regression.test.js](/Users/lebedev/Desktop/legal-ocr/src/components/RichEditor.person-regression.test.js)
- [src/utils/claudeApi.ambiguous.test.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApi.ambiguous.test.js)
- [src/utils/projectBatch.test.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectBatch.test.js)
- [src/utils/projectDocumentOps.test.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectDocumentOps.test.js)
- [src/utils/documentImageCrop.test.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentImageCrop.test.js)
- [src/utils/documentPageMetadata.test.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentPageMetadata.test.js)
- [src/utils/dataStore.test.js](/Users/lebedev/Desktop/legal-ocr/src/utils/dataStore.test.js)

## Что важно помнить перед следующими изменениями

- пользователь не работает с кодом и не должен выполнять ручные технические шаги без очень чётких инструкций;
- сначала лучше проверять, относится ли изменение к продукту, к OCR/prompt-слою или к техническому долгу;
- новые функции лучше добавлять в проектную модель, а не возвращать сценарии “вне проекта”;
- при изменениях в редакторе обязательно проверять:
  - навигацию по страницам;
  - синхронизацию с `Оригиналом`;
  - `undo / redo`;
  - редактирование ПД;
  - удаление ПД;
  - создание нового ПД из выделения;
- при изменениях в OCR обязательно проверять:
  - `PDF`
  - изображения
  - `DOCX`
  - текст
  - batch pause/resume
- перед коммитом минимальный безопасный набор проверок:
  - `npm run build`
  - `npm run lint:strict`
  - `npm run deps:check`

## Legacy и очистка

В репозитории ещё могут оставаться файлы или названия, связанные со старой идеей возврата текста обратно в исходный PDF. На текущий продукт они не должны влиять.

Главное правило:

- если модуль не участвует в текущем пользовательском сценарии “проекты → распознавание → редактор → просмотр оригинала → обычный экспорт”, его нужно считать кандидатом на удаление или отдельную ревизию;
- но удалять такой код нужно только после проверки реальных импортов и использования.

## Коротко: с чего начинать новому разработчику

Если нужно быстро войти в проект, смотреть в таком порядке:

1. [src/App.js](/Users/lebedev/Desktop/legal-ocr/src/App.js)
2. [src/components/ProjectWorkspaceView.js](/Users/lebedev/Desktop/legal-ocr/src/components/ProjectWorkspaceView.js)
3. [src/components/ResultWorkspaceView.js](/Users/lebedev/Desktop/legal-ocr/src/components/ResultWorkspaceView.js)
4. [src/hooks/useProjectRecognitionActions.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useProjectRecognitionActions.js)
5. [src/hooks/useEditorPdActions.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/useEditorPdActions.js)
6. [src/utils/claudeApi.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApi.js)
7. [src/utils/runProjectBatchRecognition.js](/Users/lebedev/Desktop/legal-ocr/src/utils/runProjectBatchRecognition.js)
8. [src/utils/dataStore.js](/Users/lebedev/Desktop/legal-ocr/src/utils/dataStore.js)

Этого достаточно, чтобы понять:

- где начинается пользовательский поток;
- как запускается распознавание;
- как формируется документ;
- как работает редактор;
- где сохраняются проекты и документы.
