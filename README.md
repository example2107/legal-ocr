# ЮрДок — Распознавание и обезличивание юридических документов

Веб-приложение для OCR-распознавания юридических документов и автоматического обезличивания персональных данных. Пользователь загружает сканы (JPG/PNG/PDF) или DOCX, приложение распознаёт текст через Claude/OpenAI/Gemini API, находит персональные данные и позволяет заменить их на метки (А., Б., [ФИО 1] и т.д.).

---

## Технический стек

- **Frontend:** React 18, Create React App
- **Деплой:** Vercel (auto-deploy из GitHub main)
- **URL:** https://legal-ocr-theta.vercel.app
- **GitHub:** github.com/example2107/legal-ocr (ветка main)
- **Vercel project ID:** prj_FFusJw7tCbzwdGHoE0ubo951g6Cr
- **Team ID:** team_kPkFtWplLjfW6dgwxjeLNhxQ

---

## Структура файлов

```
src/
├── App.js                  # Главный компонент — вся логика UI, состояние, экспорт
├── App.css                 # Стили интерфейса
├── index.css               # Глобальный сброс, CSS-переменные, глобальные стили скроллбаров
├── index.js                # Точка входа React
├── components/
│   ├── RichEditor.js       # Редактор с аннотациями ПД, buildAnnotatedHtml, patchPdMarks
│   └── RichEditor.css      # Стили редактора и маркеров ПД
└── utils/
    ├── claudeApi.js        # API-клиенты (Claude, OpenAI, Gemini) + промпты OCR/quality/PD
    ├── docxParser.js       # Парсинг DOCX через JSZip
    ├── history.js          # История документов (localStorage)
    └── pdfUtils.js         # Конвертация PDF в изображения через pdfjs-dist
```

---

## Локальный запуск

```bash
npm install
npm start
```

Требуется Node.js >= 18.

---

## Обновление на Vercel

1. Внести изменения в файлы
2. Commit в GitHub Desktop
3. Push origin → Vercel пересобирает автоматически (~20 сек)

---

## Архитектура и поток данных

### Режимы загрузки

**Изображения/PDF:**
1. `pdfUtils.js` конвертирует PDF в base64-изображения постранично
2. `claudeApi.js → recognizeDocument()` — OCR каждой страницы отдельным запросом
3. Страницы склеиваются с маркерами `[PAGE:N]`
4. Quality check — поиск OCR-артефактов и семантических ошибок
5. Анализ ПД — структурированный JSON с persons и otherPD
6. `RichEditor.js → buildAnnotatedHtml()` — вставка `<mark data-pd-id="...">` в HTML

**DOCX:**
1. `docxParser.js` читает XML напрямую через JSZip (без OCR)
2. Сразу идёт на анализ ПД (quality check пропускается)

### Состояние в App.js

Ключевые useState:
- `view` — `'home' | 'processing' | 'result'`
- `personalData` — `{ persons: [...], otherPD: [...] }` — данные от API
- `anonymized` — `{ [id]: bool }` — какие ПД скрыты
- `editorHtml` — текущий HTML редактора
- `pdWidth`, `viewerWidth` — ширины панелей (изменяются ресайзером)
- `pdNavState` — `{ [id]: { cur, total } }` — состояние навигации по упоминаниям

### Обезличивание

Реализовано через **DOM-патчинг** (`patchPdMarks` в RichEditor.js), а не пересборкой HTML. Это сохраняет пользовательские правки в редакторе.

При клике на элемент ПД → `handlePdClick(id)` → `patchPdMarks(editorDomRef.current, id, isAnon, letter, replacement)` → находит все `mark[data-pd-id="id"]` в DOM и меняет textContent + класс.

---

## Промпты (claudeApi.js)

Три промпта выполняются последовательно:

### SYS_OCR
System-промпт для распознавания. Задаёт формат:
- `## НАЗВАНИЕ` — заголовок документа
- `[CENTER]текст[/CENTER]` — центрированный текст
- `[LEFTRIGHT: левый | правый]` — строки с текстом слева и справа
- `[RIGHT-BLOCK]текст` — блок прижатый вправо (шапка)
- `[INDENT]текст` — абзац с отступом
- `⚠️[НЕТОЧНО: слово]` или `⚠️[НЕТОЧНО: слово | правильный_вариант]` — неточное распознавание
- `⚠️[НЕЧИТАЕМО]` — нечитаемый фрагмент

### PROMPT_QUALITY
Ищет три типа ошибок OCR: грамматическую невозможность, логическое несоответствие, нарушение юридического шаблона. Добавляет маркеры `⚠️[НЕТОЧНО: ...]` к найденным местам.

### PROMPT_PD
Анализирует текст и возвращает JSON:
```json
{
  "persons": [
    {
      "id": "уникальный_id",
      "fullName": "Иванов И.И.",
      "role": "заявитель",
      "category": "private | professional",
      "mentions": ["Иванов", "Иванов И.И.", "Иванов Иван Иванович"]
    }
  ],
  "otherPD": [
    {
      "id": "уникальный_id",
      "type": "address | phone | passport | zagranpassport | inn | snils | card | email | dob | birthplace | social_id | vehicle_plate | vehicle_vin | driver_license | military_id | oms_policy | birth_certificate | imei | org_link | other",
      "value": "г. Самара, ул. Дзержинского, 2-40",
      "replacement": "[адрес]"
    }
  ]
}
```

**Ключевые правила промпта:**
- `fullName` всегда в формате «Фамилия И.О.», полное имя только в `mentions[]`
- Категория определяется ролью в данном документе, не должностью:
  - `professional` — составляет/подписывает/утверждает документ, ведёт дело, представляет сторону
  - `private` — потерпевший, обвиняемый, свидетель, заявитель, понятой, упоминаемое лицо
- OCR-артефакт «гр.»: может быть написан как «г р.», «г. р.», «г.р.» — все варианты должны быть в `mentions[]`
- Фамилии с маленькой буквы (OCR-ошибка) добавляются в `mentions[]` отдельной строкой

---

## Логика buildPersonPattern (RichEditor.js)

Строит regex для поиска упоминания человека в тексте с учётом:
- **Падежных окончаний** — усекает последние 2 буквы корня, добавляет `[А-яЁё]{0,5}`
- **Инициалов** — ищет до и после фамилии: `А.Б.` или `А.`
- **Регистра первой буквы** — `caseInsensitiveFirst()` строит `[Бб]` пару для первой буквы каждого слова, чтобы находить фамилии с маленькой буквы (OCR-артефакт) без флага `i`
- Trailing пробел внутри `match[0]` обрезается, позиция `last` продвигается на `match[0].length`

---

## Панель персональных данных

### Структура элемента

```
[А.]  Корчагова Е.В.     [↑][2/5][↓]  👁    ← строка 1
      заявитель                               ← строка 2 (роль)
```

- Буква/метка — `pd-item-letter` (фиксированная ширина, flex-shrink: 0)
- Имя — `pd-item-name` (flex: 1, text-overflow: ellipsis)
- Навигация — `pd-item-nav` (скрыта, появляется при hover)
- Статус — `pd-item-status` (flex-shrink: 0, всегда виден)
- Роль — `pd-item-role` (вторая строка, мелкий текст)

### Навигация по упоминаниям (↑↓)

- `initNavCounter(id)` — вызывается при `onMouseEnter`, считает `mark[data-pd-id="id"]` в DOM, инициализирует `pdNavState[id] = { cur: -1, total: N }`
- `navigateToPd(id, direction, e)` — меняет `cur`, скроллит через `scrollIntoView`, flash через `IntersectionObserver` (ждёт пока элемент появится во вьюпорте)
- Таймер 10 секунд без навигации → `cur` сбрасывается в `-1` (показывается просто `N` вместо `X/N`)
- Счётчик: `cur === -1` → `7`, `cur >= 0` → `3/7`

### Скролл панели ПД

`setPdPanelRef` вешает `wheel` listener с `passive: false` + `preventDefault()` + ручной `el.scrollTop += e.deltaY`. Это блокирует scroll chaining на уровень compositor thread браузера. Скролл страницы происходит только если панель полностью умещается (`scrollHeight <= clientHeight`).

---

## Ресайзер панелей

Три панели: ПД (`pdWidth`) + редактор (flex: 1) + вьюер (`viewerWidth`).

Разделители `.panel-resizer` — вертикальная линия + sticky-пилла `‹›` по центру вьюпорта.

Начальные размеры зависят от `window.innerWidth`:
- < 1400px (MacBook 14"): pd=240, viewer=400
- 1400–1800px: pd=270, viewer=440
- ≥ 1800px (27"): pd=300, viewer=500

`ResizeObserver` на `.doc-title-row` обновляет CSS-переменную `--titlerow-h` → toolbar корректно прилипает даже когда кнопки переносятся на вторую строку.

---

## CSS-переменные для sticky-позиционирования

```css
--header-h: 60px;           /* высота .header */
--titlerow-h: 49px;         /* обновляется ResizeObserver из JS */
--toolbar-top: calc(var(--header-h) + var(--titlerow-h));
```

Используются в:
- `.doc-title-row { top: var(--header-h) }`
- `.rich-toolbar { top: var(--toolbar-top) }` (RichEditor.css)
- `.pd-panel { top: calc(var(--header-h) + 20px) }`
- `.viewer-panel { top: calc(var(--header-h) + 20px) }`

---

## Скроллбары

Глобальные стили в `index.css` (загружается раньше App.css — важно!):
- Ширина 8px, `border: 2px solid var(--bg2)` создаёт отступ вокруг thumb
- `:hover` → `var(--text2)`

Панель ПД: `direction: rtl` + `direction: ltr` на дочерних — скроллбар слева (подальше от ресайзера).

---

## Экспорт документов

### PDF
`window.open()` → записывает HTML с инлайн-стилями → `window.print()`. Маркеры ПД конвертируются в `<span class="pd-export">`.

### DOCX
Строится вручную через OOXML XML + JSZip (без внешних библиотек). Times New Roman 14pt (28 half-points), поля A4. Обрабатывает: `.right-block` (левый отступ 5100 DXA), `.lr-row` (город+дата через tab-stop или две строки для подписей), `.page-separator` (пропускается).

---

## Известные ограничения и поведение

- **Длинные документы** (>50 000 символов): предупреждение, часть ПД может быть пропущена при анализе (API принимает первые 25 000 символов)
- **PDF → изображения**: конвертируется через pdfjs-dist в браузере, может быть медленно для больших файлов
- **DOCX**: читается через JSZip, не через сервер — работает в браузере без серверной части
- **История**: localStorage, максимум ~50 документов (зависит от размера)
- **API ключ**: не сохраняется между сессиями, только в памяти текущей вкладки

---

## Известные баги / pending задачи

- **Словарь ПД (Вариант 3)** — при обработке нескольких частей одного документа сохранять соответствия (Бутаков → А.) и применять к следующей части
- **Resizable вьюер по высоте** — тянуть за угол вьюера для изменения высоты и ширины пропорционально
- Адаптация под разные устройства сделана, но возможны проблемы при нестандартных масштабах браузера

---

## Устройства разработчика

- MacBook Pro M5 14" — логическое разрешение 1512×982, DPR=2
- HP 14-bp102ur — 1920×1080, Windows 100%
- PC 27" — 2560×1440

---

## Деплой

```bash
# Локально
npm install
npm start

# Vercel CLI
npm install -g vercel
vercel

# Или через GitHub Desktop → push → Vercel auto-deploy
```
