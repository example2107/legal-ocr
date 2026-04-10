# ЮрДок

Веб-приложение для распознавания и обезличивания юридических документов. Оно работает со сканами, PDF, DOCX и цифровым текстом, находит персональные данные, показывает их в редакторе и позволяет обезличивать документ без ручной разметки с нуля.

Этот `README` предназначен как handoff-документ для продолжения работы в другом чате. Здесь описаны:

- текущий функционал приложения;
- архитектура на уровне ключевых узлов;
- важные технические ограничения;
- где искать основную логику;
- какая следующая задача считается приоритетной.

## Ключевой функционал

Приложение сейчас умеет:

- загружать `PDF`, изображения (`JPG`, `PNG`, `WEBP`) и `DOCX`;
- принимать цифровой текст через отдельную вкладку `Текст`;
- распознавать текст через `Claude`, `OpenAI` или `Gemini`;
- перед OCR осторожно автообрезать изображение по границе основной страницы, если границы найдены уверенно;
- делать консервативный post-OCR quality check для явных OCR-сбоев;
- извлекать персональные данные и хранить их в структурированном виде;
- показывать результат в редакторе с интерактивными маркерами;
- обезличивать найденные ПД прямо в редакторе;
- редактировать запись ПД из панели ПД;
- удалять конкретную запись ПД из панели ПД;
- быстро исправлять конкретный фрагмент ПД в тексте через ПКМ;
- применять к конкретному маркеру канонический вид из панели ПД;
- показывать uncertain-маркеры `НЕТОЧНО` / `НЕЧИТАЕМО` с вариантами исправления через ПКМ;
- вести историю документов;
- работать с проектами, где несколько частей документа используют общую накопительную базу ПД;
- распознавать большие PDF в проекте постранично с возможностью продолжения после остановки;
- автоматически собирать постраничное распознавание большого PDF в один накапливаемый документ проекта;
- собирать итоговый документ проекта;
- показывать оригинальные страницы PDF и локально накладывать на них preview правок;
- сохранять локальные PDF-патчи как отдельный слой документа;
- экспортировать `PDF` с учётом локальных `ready`-патчей поверх оригинальных страниц;
- экспортировать результат в `PDF`, `DOCX` и формат `.юрдок`.

## Технологический стек

- `React 18`
- `Create React App`
- `pdfjs-dist`
- ручной DOCX parsing через OOXML / `JSZip`
- `Supabase Auth`
- `Supabase Postgres`
- `Supabase Storage`
- локальный fallback в `localStorage`, если Supabase не настроен
- OCR / extraction через LLM API:
  - `Claude`
  - `OpenAI`
  - `Gemini`

## Локальный запуск

Требования:

- `Node.js >= 18`
- `npm`

Запуск:

```bash
npm install
npm start
```

Для cloud-режима дополнительно нужны:

- `.env.local` по образцу `.env.example`;
- `REACT_APP_SUPABASE_URL`;
- `REACT_APP_SUPABASE_ANON_KEY`;
- применённая схема из `supabase/schema.sql`.

Если env не заданы, приложение уходит в локальный fallback-режим без auth.

Сборка:

```bash
npm run build
```

Тесты:

```bash
npm test
```

Дополнительные проверки качества:

```bash
npm run lint
npm run test:ci
npm run coverage
npm run deps:check
npm run dupcheck
```

Важно:

- production build намеренно запускается с `CI=false`, чтобы `CRA` не валил deploy на `eslint` warnings;
- строгие проверки качества для разработки и рефакторинга запускаются отдельно через `lint` и `test:ci`.

Точечный прогон ключевых тестов:

```bash
CI=true npm test -- --watchAll=false --runInBand src/components/RichEditor.person-regression.test.js src/utils/claudeApi.ambiguous.test.js src/utils/projectBatch.test.js src/utils/projectDocumentOps.test.js src/utils/documentPageMetadata.test.js src/utils/documentCoordinateLayer.test.js src/utils/documentCoordinateMatcher.test.js src/utils/documentPatchRegion.test.js src/utils/documentPatchPlan.test.js src/utils/documentPatchLayer.test.js src/utils/documentPageCompositor.test.js src/utils/documentImageCrop.test.js src/App.ambiguous-undo.integration.test.js
```

## Общая структура проекта

```text
src/
├── App.js
├── App.css
├── index.js
├── index.css
├── components/
│   ├── AuthScreen.js
│   ├── DocumentPatchList.js
│   ├── DocumentRenderer.js
│   ├── DocumentTitleActions.js
│   ├── OriginalViewerPanel.js
│   ├── PdFragmentEditorModal.js
│   ├── PdFragmentPatchDetails.js
│   ├── PdfPatchExportPreviewModal.js
│   ├── RichEditor.js
│   ├── RichEditor.css
│   └── RichEditor.person-regression.test.js
├── context/
│   ├── AuthContext.js
│   └── AuthContext.test.js
├── hooks/
│   ├── usePatchedViewerPages.js
│   ├── usePdFragmentPatchPreview.js
│   ├── usePdfExportFlow.js
│   └── useStoredData.js
└── utils/
    ├── claudeApi.js
    ├── claudeApi.ambiguous.test.js
    ├── dataStore.js
    ├── dataStore.test.js
    ├── documentCoordinateLayer.js
    ├── documentCoordinateLayer.test.js
    ├── documentCoordinateMatcher.js
    ├── documentCoordinateMatcher.test.js
    ├── documentImageCrop.js
    ├── documentImageCrop.test.js
    ├── documentPageCompositor.js
    ├── documentPageCompositor.test.js
    ├── documentPageMetadata.js
    ├── documentPageMetadata.test.js
    ├── documentPatchLayer.js
    ├── documentPatchLayer.test.js
    ├── documentPatchPlan.js
    ├── documentPatchPlan.test.js
    ├── documentPatchRegion.js
    ├── documentPatchRegion.test.js
    ├── documentViewState.js
    ├── docxParser.js
    ├── history.js
    ├── originalImagePages.js
    ├── originalViewerFiles.js
    ├── pdfUtils.js
    ├── pdfExportFlow.js
    ├── pdfPatchExport.js
    ├── projectBatch.js
    ├── projectBatch.test.js
    ├── projectDocumentOps.js
    ├── projectDocumentOps.test.js
    ├── richEditorAnnotations.js
    ├── runProjectBatchRecognition.js
    └── supabaseClient.js

supabase/
└── schema.sql
```

Дополнительно:

- `src/App.ambiguous-undo.integration.test.js` — интеграционный тест undo/redo для нового поведения с `ambiguousPersons`

## Архитектура по крупным частям

### 1. `App.js`

Это главный orchestration-слой приложения. Здесь находятся:

- основная навигация между экранами;
- логика главной страницы, проекта, результата и processing view;
- auth-gate и переключение между auth-screen и приложением;
- распознавание документов;
- batch-обработка больших PDF в проекте;
- работа с историей и проектами;
- orchestration для cloud/local data layer;
- undo/redo snapshot-логика;
- экспорт;
- обработка ручных действий пользователя в редакторе.

Если нужно понять общий flow, почти всегда начинать нужно с `src/App.js`.

Важно:

- `App.js` всё ещё остаётся главным hotspot проекта;
- но часть orchestration уже вынесена в отдельные модули, поэтому новую логику лучше добавлять не прямо в этот файл, а в соответствующий util, hook или компонент.

### 1.1. `useStoredData.js`

Хук для загрузки и обновления основных данных приложения.

Сейчас он отвечает за:

- первичную загрузку `history` и `projects`;
- `dataLoading`;
- `refreshHistory()` и `refreshProjects()`;
- auth-aware hydration и очистку данных при выходе пользователя.

### 2. `RichEditor.js`

Это ядро разметки и интерактивной работы с текстом.

Здесь находятся:

- построение начального HTML с маркерами ПД;
- regex-поиск persons и otherPD;
- отдельная разметка `ambiguousPersons`;
- DOM patching для обезличивания без полной пересборки HTML;
- контекстные действия по mark-элементам;
- отдельные действия для uncertain-маркеров;
- действия по ПД-маркерам: снять статус ПД, исправить текст фрагмента, принять вид из панели ПД;
- вспомогательная логика редактора.

Если проблема связана с тем, что что-то не подсветилось или подсветилось неправильно, смотреть нужно сюда.

Важно:

- pure annotation/matching логика уже вынесена из `RichEditor.js`;
- сам файл теперь в первую очередь отвечает за UI редактора, DOM patching и контекстные действия.

### 2.1. `richEditorAnnotations.js`

Отдельный util для pure-логики разметки.

Там сейчас находятся:

- regex-паттерны для `persons` и `otherPD`;
- адресный matcher;
- построение annotated HTML;
- разметка `ambiguousPersons`;
- `htmlToPlainText()`.

Если задача связана именно с тем, как текст размечается и где ищутся ПД-совпадения, сначала смотреть нужно сюда.

### 3. `claudeApi.js`

Это API-слой для LLM-запросов. Несмотря на имя файла, он обслуживает не только Claude.

Здесь находятся:

- список провайдеров и моделей;
- OCR prompt;
- quality-check prompt;
- prompt для извлечения ПД;
- `recognizeDocument()`;
- `analyzePD()`;
- `analyzePastedText()`.

Если вопрос связан с качеством распознавания, извлечением ПД или тем, что модель вернула не ту структуру, смотреть нужно сюда.

Важно:

- для вставленного вручную текста `quality check` отключён;
- для OCR-документов `quality check` оставлен, но сейчас работает в более консервативном режиме и должен помечать только явные OCR-сбои, а не «додумывать» юридический текст;
- batch-мерж ПД по проекту всё ещё опирается на `sharedPD` / `existingPD`.

### 4. `dataStore.js`

Это основной слой сохранения документов и проектов.

Сейчас он:

- пишет в `Supabase`, если пользователь авторизован и env настроены;
- использует `history.js` как локальный fallback, если Supabase не настроен;
- сохраняет документы, проекты и связи между ними;
- загружает исходные файлы в `Supabase Storage`.

Если вопрос про то, где теперь реально живут документы и проекты, смотреть сначала сюда.

Важно:

- это основной persistence-слой приложения;
- `Supabase` на free-tier уже является базовым рабочим режимом;
- fallback в `history.js` нужен для режима без cloud-настроек и для совместимости;
- этот слой теперь прикрыт отдельными тестами.

### 5. `history.js`

Это уже не основной storage-слой, а локальный fallback для режима без Supabase.

Здесь находятся:

- история документов;
- проекты;
- импорт/экспорт `.юрдок`;
- `sharedPD` проекта;
- `batchSession` проекта.

Если ломается resume, история или проектная структура, искать нужно здесь и в `App.js`.

### 6. `supabaseClient.js` / `AuthContext.js` / `AuthScreen.js`

Это auth/cloud-слой.

Здесь находятся:

- инициализация клиента Supabase;
- проверка, настроен ли cloud-режим;
- регистрация / вход / выход;
- восстановление сессии;
- `emailRedirectTo` для подтверждения почты.

Если проблема связана с регистрацией, логином, сессией или тем, почему приложение ушло в local fallback, смотреть сначала сюда.

### 7. PDF / patch pipeline

#### `pdfUtils.js`

Сейчас умеет:

- считать число страниц;
- рендерить весь PDF в изображения;
- рендерить только диапазон страниц;
- сохранять размеры страниц и render-метаданные;
- извлекать text-layer для digital PDF;
- сжимать страницы до безопасного размера base64.

Это критично для batch-обработки больших PDF.

#### `documentImageCrop.js`

Осторожная автообрезка изображения перед OCR.

Сейчас util:

- пытается найти главный прямоугольник страницы по яркости и форме;
- убирает узкие боковые фрагменты соседних страниц;
- обрезает изображение только если уверенность достаточная;
- при сомнительном результате оставляет исходную картинку без изменений.

Это нужно, чтобы OCR не захватывал текст с соседней страницы или фона снимка.

#### `documentPageMetadata.js`

Отдельный слой метаданных исходных страниц.

Сейчас там:

- связь документа с исходным PDF и страницами;
- размеры страниц и диапазоны;
- merge page metadata для batch-документов и итоговых документов.

#### `documentCoordinateLayer.js`

Координатный слой PDF.

Он хранит:

- страницы;
- text spans / fragments;
- bounding boxes для digital PDF text-layer;
- merge и normalization для persistence.

#### `documentCoordinateMatcher.js`

Сопоставляет текст редактора с `coordinateLayer`.

Возвращает:

- страницу;
- диапазон span-ов;
- bbox найденной области;
- тип совпадения.

#### `documentPatchRegion.js` / `documentPatchPlan.js`

Подготавливают будущую локальную замену на странице.

Сейчас считают:

- область замены;
- эвристическую проверку, поместится ли новый текст;
- `patchPlan` со статусом `ready` / `review_required` / `unavailable`.

#### `documentPageCompositor.js`

MVP-композитор страницы.

Он умеет:

- собирать preview локальной замены на canvas;
- применять локальный патч к странице в viewer;
- отдавать картинку страницы для patched PDF export.

#### `documentPatchLayer.js`

Persistence-слой локальных PDF-правок документа.

Там сейчас:

- хранение патчей;
- удаление отдельных патчей;
- список экспортируемых и пропускаемых патчей.

#### `pdfPatchExport.js` / `pdfExportFlow.js` / `usePdfExportFlow.js`

PDF export flow с поддержкой локальных патчей.

Сейчас он:

- показывает preview перед export;
- отделяет `ready`-патчи от `review_required`;
- собирает patched PDF из оригинальных страниц, если они загружены;
- падает обратно в старый текстовый PDF export, если патчей нет.

### 8. `projectBatch.js`

Небольшой util для batch-обработки PDF в проекте.

Там лежат:

- постраничный размер batch;
- метаданные batch-сессии;
- resume-сопоставление файла;
- форматирование названий и диапазонов страниц.

### 8.1. `runProjectBatchRecognition.js`

Отдельный orchestration util для batch-распознавания больших PDF в проекте.

Он держит:

- постраничный проход по PDF;
- обновление `batchSession`;
- вызов OCR/persistence-слоя;
- логику resume;
- автоматическую сборку страниц в один накапливаемый документ проекта.

### 8.2. `projectDocumentOps.js`

Service-слой для project-level операций над документами.

Сейчас там живут:

- merge страниц большого PDF в один `project-batch` документ;
- построение summary-документа;
- сохранение `project-summary`.

### 8.3. `documentViewState.js`

Небольшой util для сборки и очистки рабочего состояния документа.

Он используется для:

- загрузки документа в result-view;
- reset рабочего документа;
- возврата на проект и домой без ручного раскладывания множества setter'ов в `App.js`.

## Экраны приложения

Основные view:

- `auth`
- `home`
- `project`
- `processing`
- `result`

### `home`

На главной странице есть:

- поле API-ключа;
- выбор провайдера;
- вкладка `Документы`;
- вкладка `Текст`;
- история;
- проекты.

### `project`

В проекте есть:

- загрузка PDF;
- список документов проекта;
- перенос документов из истории;
- импорт `.юрдок`;
- batch-обработка больших PDF;
- кнопка сборки итогового документа.

Важно:

- большой PDF теперь распознаётся по `1` странице;
- пользователь при этом не получает отдельный документ на каждую страницу;
- страницы автоматически объединяются в один накапливаемый документ этого PDF;
- если процесс остановился, продолжение идёт с первой необработанной страницы того же файла.

Если Supabase настроен, проект и документы привязаны к текущему пользователю.

### `processing`

Показывает ход распознавания:

- подготовка;
- OCR;
- quality check;
- анализ ПД;
- финализация.

Для большого PDF в проекте прогресс сейчас считается как aggregate по батчам.

### `result`

Содержит:

- редактор;
- панель персональных данных;
- опциональный viewer оригинала;
- список локальных PDF-правок;
- preview модалку экспорта patched PDF;
- экспорт;
- сохранение.

## Модель данных ПД

Текущее состояние `personalData`:

```json
{
  "persons": [],
  "otherPD": [],
  "ambiguousPersons": []
}
```

### `persons`

Обычные лица.

Типовые поля:

- `id`
- `fullName`
- `role`
- `category`
- `mentions[]`
- `letter`

### `otherPD`

Другие ПД:

- адреса;
- телефоны;
- паспортные и иные номера;
- даты рождения;
- email и т.д.

Типовые поля:

- `id`
- `type`
- `label`
- `value`
- `replacement`
- `mentions[]`

### `ambiguousPersons`

Отдельная категория для читаемого текста, где нет OCR-проблемы, но есть неоднозначность идентификации человека.

Типовой случай:

- в тексте уже есть полный человек;
- дальше встречается короткое имя;
- но по контексту нельзя надёжно понять, к кому оно относится.

В таком случае фрагмент не должен становиться обычным person mention, а должен попадать в `ambiguousPersons`.

## Как устроена разметка в редакторе

Сейчас есть три смысловые группы:

- обычные ПД — фиолетовые маркеры;
- OCR-warning — оранжевые маркеры неточного распознавания;
- `ambiguousPersons` — отдельная синяя пометка.

Важно:

- `OCR-warning` и `ambiguousPersons` логически разделены;
- `ambiguousPersons` не должны превращаться в обычные `persons[].mentions`;
- если модель возвращает конфликтно и то и другое, в `claudeApi.js` есть постобработка, которая убирает ambiguous-значения из `mentions[]`.
- каноническое значение ПД в панели и конкретные текстовые вхождения в редакторе — не одно и то же;
- изменение карточки ПД не должно уничтожать уже размеченные вхождения, а только дозаполнять новые совпадения.

## Текущая логика поиска ПД

### Persons

Поиск persons построен на regex в `RichEditor.js`.

Что уже поддерживается:

- фамилия + инициалы;
- инициалы + фамилия;
- падежные формы;
- строчные OCR-ошибки регистра;
- смешение точек и запятых в инициалах;
- пробелы вокруг знаков в инициалах;
- защита от захвата последней буквы предыдущего предложения.

Это покрыто регрессионными тестами.

### OtherPD

Базовый поиск `otherPD` работает через гибкое совпадение по whitespace.

Для `address` поверх этого добавлен специальный matcher:

- он использует уже известный полный адрес;
- вытаскивает из него улицу и дом;
- умеет подхватывать переставленные формы адреса.

Поддерживаемые адресные формы сейчас включают:

- `ул. Золинская, 13`
- `ул. Золинская, д. 13`
- `на улице Золинская, дом 13`
- `д. 13 по ул. Золинская`
- `д. № 13 по ул. Золинская`

Это сделано консервативно: цель — хотя бы скрывать street+house часть адреса, даже если полный канонический адрес в тексте не повторяется.

## OCR / LLM pipeline

Для PDF и изображений сейчас flow такой:

1. страницы переводятся в изображения;
2. при необходимости изображение осторожно обрезается по границе основной страницы;
3. OCR идёт постранично;
4. текст страниц склеивается с маркерами `[PAGE:N]`;
5. quality-check исправляет явные OCR-ошибки;
6. PD extraction возвращает JSON;
7. редактор строит HTML-маркировку.

Для DOCX:

1. текст читается напрямую из OOXML;
2. OCR пропускается;
3. дальше идёт только анализ ПД.

Для цифрового текста:

1. текст вставляется во вкладке `Текст`;
2. quality-check пропускается;
3. дальше идёт только PD extraction.

## Главные ограничения

### 1. Ограничение PD-analysis по длине текста

В `src/utils/claudeApi.js` сейчас есть:

- `PD_ANALYSIS_CHAR_LIMIT = 25000`

Это лимит символов, включая:

- буквы;
- цифры;
- пробелы;
- переносы строк;
- знаки препинания.

Из текста перед этим удаляются только маркеры страниц `[PAGE:N]`.

Следствие:

- если документ длиннее этого лимита, часть ПД после лимита может не попасть в PD analysis;
- в UI для таких документов показывается предупреждение;
- для `project-summary` и `project-batch` это предупреждение отключено, потому что эти документы не должны вводить пользователя в заблуждение длиной уже собранного результата.

### 2. `Supabase` + локальный fallback

Сейчас основной рабочий вариант — `Supabase` на бесплатном тарифе.

Используется:

- `Supabase Auth` для регистрации, входа и личных кабинетов;
- `Supabase Postgres` для метаданных документов и проектов;
- `Supabase Storage` для исходных файлов;
- `history.js` / `localStorage` как fallback-режим, если Supabase не настроен.

Что важно помнить:

- free-tier `Supabase` подходит как рабочая база для текущего multi-user режима, но storage там ограничен;
- поэтому тяжёлые артефакты стоит хранить экономно и не плодить лишние постоянные page-images без необходимости;
- текущая README-секция про `localStorage` уже не описывает основной режим работы приложения.

### 3. Большие PDF

Жёсткого лимита по `file.size` на входе нет, но есть фактические ограничения:

- число страниц;
- разрешение страниц;
- время рендера в браузере;
- размер base64 после рендера;
- длина текста после OCR;
- стоимость и длина LLM-запросов.

### 4. Текущий экспорт PDF

Экспорт в PDF теперь работает в двух режимах:

- если локальных PDF-патчей нет, остаётся старый текстовый export;
- если есть `ready`-патчи и загружен оригинал, приложение собирает patched PDF из оригинальных страниц с локальными заменами.

Важно понимать ограничения текущего MVP:

- это не полноценное редактирование внутренней структуры PDF;
- в export попадают только патчи со статусом `ready`;
- `review_required`-патчи сейчас только показываются в preview и не применяются автоматически;
- качество замены зависит от canvas-композитора и может отличаться от оригинальной типографики.

## Проекты

Проект — это контейнер для нескольких частей одного дела.

Сейчас в проекте есть:

- `title`
- `documentIds`
- `sharedPD`
- `batchSession`

Поле `description` удалено.

### `sharedPD`

Это накопительная база ПД проекта.

Она используется:

- для сквозной нумерации;
- для сохранения единых обозначений;
- для передачи `existingPD` в следующие части документа.

Это критично для batch-логики: мерж ПД между частями проекта по-прежнему строится вокруг `sharedPD` / `existingPD`.

### Документы проекта

Каждый проектный документ хранится как обычная запись истории, но с `projectId`.

Для batch-частей PDF дополнительно пишутся метаданные:

- `pageFrom`
- `pageTo`
- `totalPages`
- `chunkIndex`
- `chunkSize`
- `batchFileName`
- `pageMetadata`
- `coordinateLayer`
- `patchLayer`

Эти поля уже используются в текущем MVP patched PDF export и остаются важны для дальнейшего усиления этого pipeline.

### Итоговый документ проекта

`buildProjectSummary()`:

- склеивает `editedHtml` частей;
- берёт накопленный `personalData`;
- мёржит `anonymized`;
- создаёт документ с `source = 'project-summary'`.

`project-summary` сейчас полезен как общий результат по проекту, но он всё ещё остаётся логическим сводным документом, а не восстановленным исходным PDF.

## Batch-обработка больших PDF в проекте

Это одна из последних крупных доработок.

### Текущее поведение

- большой PDF в проекте обрабатывается по `1` странице;
- каждая новая страница сразу подшивается в один накапливаемый `project-batch` документ;
- пользователь не получает отдельный документ на каждую страницу;
- ПД мёржатся от страницы к странице через `sharedPD` / `existingPD`;
- если обработка прервалась, её можно продолжить;
- продолжение идёт с первой необработанной страницы того же PDF;
- для resume пользователь должен заново выбрать тот же файл;
- нумерация страниц в тексте и page metadata теперь сквозная по исходному PDF;
- старый пользовательский `part-separator` между batch-кусками больше не используется.

### Где смотреть

- orchestration: [src/App.js](/Users/lebedev/Desktop/legal-ocr/src/App.js)
- batch runner: [src/utils/runProjectBatchRecognition.js](/Users/lebedev/Desktop/legal-ocr/src/utils/runProjectBatchRecognition.js)
- helpers: [src/utils/projectBatch.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectBatch.js)
- PDF page-range rendering: [src/utils/pdfUtils.js](/Users/lebedev/Desktop/legal-ocr/src/utils/pdfUtils.js)
- project/document persistence: [src/utils/dataStore.js](/Users/lebedev/Desktop/legal-ocr/src/utils/dataStore.js)
- local fallback: [src/utils/history.js](/Users/lebedev/Desktop/legal-ocr/src/utils/history.js)

### Что важно помнить

Сейчас resume-сессия хранит только метаданные, но не сам `File` объект. Поэтому:

- продолжение после сбоя возможно;
- но пользователь должен заново выбрать тот же PDF;
- после полной перезагрузки страницы приложение не сможет само “достать файл из памяти”.

Это нормальное поведение для браузера и текущей архитектуры.

## Viewer оригинала и PDF-патчи

В result-view есть показ оригинала через `originalImages`.

Сейчас важно понимать:

- `originalImages` живут только в runtime state;
- это не долговременное хранение оригинала;
- поверх них теперь можно накладывать локальные viewer-патчи из `patchLayer`;
- список активных патчей доступен прямо в UI;
- patched PDF export опирается на эти страницы и текущий patch pipeline;
- если оригинальные страницы не загружены, patched export невозможен и приложение честно предупреждает об этом.

Это остаётся критичным ограничением текущего MVP.

## Undo / redo

В `App.js` есть snapshot-механика:

- snapshot содержит `html`, `pd`, `anon`;
- undo/redo должен менять их синхронно;
- логика уже выровнена после появления `ambiguousPersons`.

Покрыто интеграционным тестом:

- [src/App.ambiguous-undo.integration.test.js](/Users/lebedev/Desktop/legal-ocr/src/App.ambiguous-undo.integration.test.js)

## Импорт / экспорт `.юрдок`

`.юрдок` используется как внутренний переносимый JSON-формат.

Туда уже попадают:

- текст;
- HTML редактора;
- ПД;
- anonymized-state;
- источник;
- batch-метаданные страниц и файла;
- `pageMetadata`;
- `coordinateLayer`;
- `patchLayer`.

Это полезно и для дебага, и для переноса кейсов между сессиями.

## Тесты

### Покрытие безопасного refactor-слоя

В проект уже добавлены проверки, которые важны именно для дальнейшей безопасной разработки:

- `src/context/AuthContext.test.js` — auth/session lifecycle, signup redirect, cloud-mode auth flow;
- `src/utils/dataStore.test.js` — `Supabase` persistence, local fallback, source-file upload;
- `npm run deps:check` — проверка циклических зависимостей через `madge`;
- `npm run dupcheck` — контроль явного copy-paste через `jscpd`;
- `npm run lint` — guardrails по сложности, размеру файлов и базовым ошибкам.

### `src/components/RichEditor.person-regression.test.js`

Покрывает:

- ложный захват буквы перед точкой;
- OCR-ошибки в инициале;
- точки/запятые/пробелы в initials;
- строчные OCR-варианты;
- базовую разметку `ambiguousPersons`;
- адресные варианты с перестановкой street/house.

### `src/utils/claudeApi.ambiguous.test.js`

Покрывает:

- удаление conflicting ambiguous-values из `persons[].mentions`.

### `src/utils/projectBatch.test.js`

Покрывает:

- построение batch-сессии;
- resume-сопоставление файла;
- helpers по single-page range.

### Новые PDF / patch tests

Покрывают:

- `src/utils/projectDocumentOps.test.js` — сборку одного накапливаемого `project-batch` документа;
- `src/utils/documentPageMetadata.test.js` — merge и normalization page metadata;
- `src/utils/documentCoordinateLayer.test.js` — координатный слой и merge страниц;
- `src/utils/documentCoordinateMatcher.test.js` — сопоставление текста с PDF-координатами;
- `src/utils/documentPatchRegion.test.js` — расчёт области замены;
- `src/utils/documentPatchPlan.test.js` — статус и структура `patchPlan`;
- `src/utils/documentPatchLayer.test.js` — хранение и фильтрация локальных патчей;
- `src/utils/documentPageCompositor.test.js` — preview/compositor логика;
- `src/utils/documentImageCrop.test.js` — автообрезка страницы перед OCR.

### `src/App.ambiguous-undo.integration.test.js`

Покрывает:

- attach existing person для ambiguous-метки;
- `Ctrl+Z`;
- `Ctrl+Shift+Z`.

## Текущее состояние code health

После последних безопасных рефакторингов проект лучше подготовлен для дальнейшей разработки, но hotspots всё ещё есть.

Что уже сделано:

- добавлены quality guardrails (`eslint`, `madge`, `jscpd`);
- добавлены тесты на `Supabase/Auth` и persistence-слой;
- часть orchestration уже вынесена из `App.js`;
- pure annotation-слой вынесен из `RichEditor.js`.
- PDF export / viewer / patch flow уже в значительной части вынесен в отдельные util, hook и component-модули.

Что остаётся главным источником сложности:

- `src/App.js`;
- `src/components/RichEditor.js`;
- `src/utils/claudeApi.js`.

Практический вывод:

- новые крупные задачи лучше делать малыми шагами;
- перед заметной правкой стоит прогонять `lint`, целевые тесты и `build`;
- если появляется ещё один большой поток изменений, лучше снова выносить его в отдельный util/hook, а не раздувать `App.js`.

## Текущее состояние PDF-редактирования и что ещё осталось

### Что уже реализовано

Сейчас в проекте уже есть рабочий MVP-конвейер внесения правок обратно в оригинальные страницы PDF:

1. у документа сохраняются `pageMetadata`;
2. для digital PDF сохраняется `coordinateLayer`;
3. текстовый фрагмент редактора можно сопоставить с областью страницы;
4. для замены строится `patchPlan`;
5. можно собрать preview локальной замены;
6. локальный патч можно применить в viewer;
7. патчи сохраняются в `patchLayer`;
8. перед export показывается preview, какие патчи попадут в PDF;
9. `ready`-патчи можно экспортировать в patched PDF поверх оригинальных страниц.

### Что ещё не считается полностью закрытым

MVP уже рабочий, но задача ещё не завершена на 100%.

Что ещё нужно для более надёжного продакшн-качества:

- прогнать patched export на большем наборе реальных документов;
- улучшить типографику и качество локальной замены на странице;
- решить, что делать с `review_required`-патчами;
- усилить кейсы длинных замен, которые могут не помещаться в исходную область;
- при необходимости улучшать работу со scan-only PDF, где нет полноценного text-layer.

То есть задача перешла из стадии “надо спроектировать pipeline” в стадию “pipeline уже есть, его нужно усиливать и проверять на реальных кейсах”.

## Что ещё стоит учитывать

Есть ещё несколько вещей, которые стоит помнить при продолжении работы:

- модель extraction иногда ведёт себя непоследовательно, поэтому часть логики уже вынесена в постобработку на стороне приложения;
- cloud-режим сейчас построен на `Supabase` free-tier, поэтому при работе с файлами и будущими page-assets важно учитывать ограниченный storage;
- `localStorage` больше не является основной моделью хранения, но всё ещё важен как fallback и как legacy-слой совместимости;
- любые крупные изменения в редакторе лучше проверять не только unit-тестами regex, но и хотя бы одним интеграционным сценарием;
- для нового рефакторинга уже есть базовые guardrails: `lint`, `deps:check`, `dupcheck`, `test:ci`;
- если продолжение работы идёт в новом чате, почти всегда начинать нужно с чтения:
  - [src/App.js](/Users/lebedev/Desktop/legal-ocr/src/App.js)
  - [src/components/RichEditor.js](/Users/lebedev/Desktop/legal-ocr/src/components/RichEditor.js)
  - [src/utils/richEditorAnnotations.js](/Users/lebedev/Desktop/legal-ocr/src/utils/richEditorAnnotations.js)
  - [src/utils/claudeApi.js](/Users/lebedev/Desktop/legal-ocr/src/utils/claudeApi.js)
  - [src/utils/dataStore.js](/Users/lebedev/Desktop/legal-ocr/src/utils/dataStore.js)
  - [src/utils/projectDocumentOps.js](/Users/lebedev/Desktop/legal-ocr/src/utils/projectDocumentOps.js)
  - [src/utils/runProjectBatchRecognition.js](/Users/lebedev/Desktop/legal-ocr/src/utils/runProjectBatchRecognition.js)
  - [src/utils/documentPageMetadata.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentPageMetadata.js)
  - [src/utils/documentCoordinateLayer.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentCoordinateLayer.js)
  - [src/utils/documentPatchPlan.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentPatchPlan.js)
  - [src/utils/documentPageCompositor.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentPageCompositor.js)
  - [src/utils/pdfPatchExport.js](/Users/lebedev/Desktop/legal-ocr/src/utils/pdfPatchExport.js)
  - [src/utils/documentImageCrop.js](/Users/lebedev/Desktop/legal-ocr/src/utils/documentImageCrop.js)
  - [src/hooks/usePdfExportFlow.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/usePdfExportFlow.js)
  - [src/hooks/usePatchedViewerPages.js](/Users/lebedev/Desktop/legal-ocr/src/hooks/usePatchedViewerPages.js)
  - [src/context/AuthContext.js](/Users/lebedev/Desktop/legal-ocr/src/context/AuthContext.js)
  - [src/utils/supabaseClient.js](/Users/lebedev/Desktop/legal-ocr/src/utils/supabaseClient.js)
  - [supabase/schema.sql](/Users/lebedev/Desktop/legal-ocr/supabase/schema.sql)
