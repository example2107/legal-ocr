import { autoCropDocumentImage } from './documentImageCrop';

// ── Provider configs ──────────────────────────────────────────────────────────
export const PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    model: 'claude-sonnet-4-20250514',
    placeholder: 'sk-ant-...',
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    model: 'gpt-5.4',
    placeholder: 'sk-...',
  },
  gemini: {
    label: 'Gemini (Google)',
    model: 'gemini-3.1-pro-preview',
    placeholder: 'AIza...',
  },
};

export const PD_ANALYSIS_CHAR_LIMIT = 25000;

const PROMPT_QUALITY_SAFE = `Ты — консервативный проверяющий OCR для юридических документов на русском языке.

Тебе дан текст после OCR. Твоя задача — отметить только те места, где есть явный технический сбой распознавания.
Ты НЕ редактор и НЕ корректор. Не улучшай стиль, не нормализуй текст, не восстанавливай типовые юридические формулировки по памяти и не делай смысловых догадок по контексту.

ФОРМАТ МАРКЕРА:
- Если уверен в корректной замене: ⚠️[НЕТОЧНО: ошибочное_слово | правильный_вариант]
- Если видишь проблему, но не уверен в замене: ⚠️[НЕТОЧНО: ошибочное_слово]
- Если фрагмент совсем не читается: ⚠️[НЕЧИТАЕМО]

ПОМЕЧАЙ ТОЛЬКО ТАКИЕ СЛУЧАИ:
1. Явно несуществующее или сломанное слово:
   - "сувоей" -> ⚠️[НЕТОЧНО: сувоей | своей]
2. Очевидная склейка, разрыв или выпадение букв после OCR:
   - "возбуждеиие" -> ⚠️[НЕТОЧНО: возбуждеиие | возбуждение]
   - "следоват ль" -> ⚠️[НЕТОЧНО: следоват ль | следователь]
3. Совсем нечитаемый, смазанный или оборванный фрагмент:
   - ⚠️[НЕЧИТАЕМО]

НЕ ПОМЕЧАЙ:
- ФИО, адреса, улицы, населённые пункты, номера документов, телефоны, email, даты рождения, номера карт, ИНН, СНИЛС, VIN, госномера и любые другие ПД-фрагменты
- Аббревиатуры, реквизиты, числа, даты, суммы денег
- Грамматически спорные, но возможные фразы
- Слова, которые кажутся "не теми по смыслу", если это не очевидный OCR-сбой по самому написанию
- Слова, которые можно заменить только потому, что "так обычно пишут в юрдокументах"
- Уже помеченные маркером ⚠️[НЕТОЧНО: ...]

ЖЕСТКИЕ ПРАВИЛА:
- Если есть хотя бы малейшее сомнение — не предлагай замену, а либо оставь текст как есть, либо поставь ⚠️[НЕТОЧНО: фрагмент] без варианта.
- Не подменяй слово только на основании логики, шаблона документа или догадки о том, что "тут должно быть".
- Лучше пропустить сомнительный фрагмент, чем внести выдуманное исправление.

Верни полный текст с маркерами только там, где есть явные OCR-ошибки.
Если ошибок нет — верни текст без изменений.
Не добавляй пояснений, комментариев или списков.

Текст для проверки:
`;

// ── Промпт 1: OCR — только распознавание ─────────────────────────────────────
const SYS_OCR = `Ты — профессиональная система распознавания юридических документов на русском языке.

Твоя задача: ТОЧНО распознать текст с изображения. Только распознавание — никакого анализа.

ПРАВИЛА ФОРМАТИРОВАНИЯ:
1. Главное название документа (ПОСТАНОВЛЕНИЕ, РЕШЕНИЕ, ОПРЕДЕЛЕНИЕ и т.д.) стоящее по центру: ## НАЗВАНИЕ
2. Подзаголовок под названием (например "об отказе в возбуждении уголовного дела"): [CENTER]текст[/CENTER]
3. Важные разделы (ПОСТАНОВИЛ, УСТАНОВИЛ, РЕШИЛ, ОПРЕДЕЛИЛ и т.д.): **ТЕКСТ**
4. Строки где текст одновременно слева и справа (город слева, дата справа): [LEFTRIGHT: левый | правый]
   НЕ используй [LEFTRIGHT] для подписей, должностей и ФИО — они идут обычным текстом слева
5. Нумерованные и маркированные списки — воспроизводи точно как в документе, сохраняя номера и отступы
6. Таблицы — передавай построчно в виде обычного текста, ячейки разделяй через " | "
7. Возвращай ТОЛЬКО текст документа. Без пояснений.

ПРАВИЛА РАСПОЗНАВАНИЯ:
- Воспроизводи текст максимально точно как написано в документе
- НЕ исправляй ошибки и опечатки — если в документе написано с ошибкой, воспроизводи как есть
- Если слово нечёткое, смазанное или плохо пропечатано: ⚠️[НЕТОЧНО: твой вариант]
- Если текст совсем нечитаем: ⚠️[НЕЧИТАЕМО]
- Если не уверен — лучше поставь маркер, чем пропустить

ПРИМЕР правильного форматирования:
## ПОСТАНОВЛЕНИЕ
[CENTER]об отказе в возбуждении уголовного дела[/CENTER]
[LEFTRIGHT: г. Самара | «12» марта 2026 года.]
**УСТАНОВИЛ:**
**ПОСТАНОВИЛ:**`;

// ── Промпт 3: Анализ персональных данных ─────────────────────────────────────
const PROMPT_PD = `Проанализируй текст юридического документа и найди все персональные данные.

Верни результат ТОЛЬКО в формате JSON (без markdown, без \`\`\`, без пояснений):
{
  "persons": [
    {
      "id": "уникальный_id",
      "fullName": "Иванов И.И.",
      "role": "обвиняемый",
      "category": "private",
      "mentions": ["Иванов Иван Иванович", "Иванов И.И.", "Иванов", "И.И."]
    }
  ],
  "otherPD": [
    {
      "id": "уникальный_id",
      "type": "address",
      "label": "адрес",
      "value": "г. Москва, ул. Ленина, д. 5, кв. 12",
      "replacement": "[адрес]"
    }
  ],
  "ambiguousPersons": [
    {
      "value": "Слава",
      "context": "Слава сообщил, что видел автомобиль",
      "reason": "Краткое имя может относиться к нескольким уже найденным людям"
    }
  ]
}

КАТЕГОРИИ для persons — КЛЮЧЕВОЕ ПРАВИЛО:
Категория определяется НЕ по должности человека, а по его роли ИМЕННО В ДАННОМ ДОКУМЕНТЕ.

"professional" — лицо выполняет публичную функцию в рамках данного документа:
- Составляет, подписывает или утверждает данный документ (следователь, дознаватель, оперуполномоченный, начальник ОП, руководитель СО, прокурор, судья — если они ВЕДУТ дело или ПОДПИСЫВАЮТ документ)
- Осуществляет правосудие или надзор: судья, прокурор как гособвинитель
- Представляет сторону в процессуальном качестве: адвокат, представитель (всегда, независимо от статуса доверителя)
- Составил данный документ как специалист/эксперт (если документ — это заключение эксперта, акт специалиста)

"private" — все остальные, включая тех, кто по должности мог бы быть профессиональным участником, но в данном документе выступает в иной роли:
- Потерпевший, заявитель, пострадавший — всегда частное лицо
- Подозреваемый, обвиняемый, подсудимый, осуждённый — всегда частное лицо
- Свидетель, очевидец — всегда частное лицо (даже если это оперуполномоченный или следователь по другому делу)
- Гражданский истец, гражданский ответчик — частное лицо
- Понятой — частное лицо
- Лицо, в отношении которого проводится проверка или составлен документ — частное лицо
- Просто упоминаемое лицо без процессуальной функции в данном документе — частное лицо
- Нотариус, судебный пристав — частное лицо (кроме случая, когда данный документ составлен самим нотариусом)
- Эксперт/специалист, допрашиваемый как свидетель — частное лицо

ПРИОРИТЕТ: если человек одновременно выполняет публичную функцию (составляет/подписывает документ) и упоминается в другом контексте — приоритет у публичной функции → "professional".

ПРИМЕРЫ:
- Оперуполномоченный Леонтьев В.А. вынес данное постановление → "professional"
- Оперуполномоченный Петров допрашивается в данном документе как свидетель → "private"
- Начальник ОП Абалмазов А.Г. утвердил данный документ → "professional"
- Корчагова Е.В. подала заявление (заявитель) → "private"
- Боковая В.Р. — лицо, в интересах которого подано заявление → "private"
- Адвокат Смирнов защищает обвиняемого в данном деле → "professional"
- Эксперт Иванов составил данное заключение → "professional"
- Эксперт Иванов допрашивается как свидетель в данном документе → "private"

ТИПЫ для otherPD: address, phone, passport, zagranpassport, inn, snils, card, email, dob, birthplace, social_id, vehicle_plate, vehicle_vin, driver_license, military_id, oms_policy, birth_certificate, imei, org_link, other

Описание типов:
- address — адрес проживания или регистрации физлица (только с улицей/домом)
- phone — номер телефона
- passport — серия и номер внутреннего паспорта РФ
- zagranpassport — серия и номер заграничного паспорта
- inn — ИНН физлица
- snils — СНИЛС
- card — номер банковской карты или счёта, реквизиты счёта
- email — адрес электронной почты
- dob — дата рождения
- birthplace — место рождения (город, регион, страна)
- social_id — идентификатор в мессенджере/соцсети: числовой ID (id1942346643), username (@marvihram), никнейм аккаунта
- vehicle_plate — государственный регистрационный номер (госномер) транспортного средства (например «А123БВ 163»)
- vehicle_vin — VIN-номер транспортного средства (17-значный код, например «XTA210930Y2765432»)
- driver_license — серия и номер водительского удостоверения
- military_id — серия и номер военного билета
- oms_policy — номер полиса обязательного медицинского страхования (ОМС) — только номер, без названия страховой
- birth_certificate — серия и номер свидетельства о рождении
- imei — IMEI-номер мобильного устройства (15-значное число, например «356938035643809»)
- org_link — название организации, напрямую идентифицирующей конкретное физлицо: ИП («ИП Иванов И.И.»), организация где человек является единственным учредителем/директором небольшой компании и это прямо указано в тексте. НЕ включай просто место работы («работает в ООО "Ромашка"»)
- other — иные персональные данные, не подпадающие под перечисленные типы

ПРАВИЛА:
- Поле letter НЕ нужно — оно не используется
- Один человек = одна запись, все упоминания в mentions[], включая полное ФИО, фамилию с инициалами, только фамилию, только имя, а также краткие/разговорные формы имени, если из контекста очевидно, что это тот же человек
- Поле fullName ВСЕГДА в формате «Фамилия И.О.» (например «Иванов И.И.»), даже если в тексте указано полное имя. Если отчество неизвестно — «Иванов И.». Если известна только фамилия — просто «Иванов». Полное имя целиком пишется только в mentions[], не в fullName
- В mentions[] включай ВСЕ варианты упоминания человека: полное имя, фамилия+инициалы (например "Сергеев С.С."), только фамилия, только инициалы если они однозначно идентифицируют человека
- Краткие, разговорные и уменьшительные формы имени: если из контекста очевидно, что короткое имя относится к уже названному человеку, ОБЯЗАТЕЛЬНО включай эту форму в mentions[] того же человека, а НЕ создавай новую запись.
  Примеры:
  - «Вячеслав Игоревич Иванов ... Слава сказал ...» → один человек, в mentions[] добавь «Слава»
  - «Игорь Васильевич Полуянов ... Игорь пояснил ...» → один человек, в mentions[] добавь «Игорь»
  - «Александр Петрович Смирнов ... Саша ответил ...» → один человек, в mentions[] добавь «Саша»
  - «Евгений Викторович ... Женя сообщил ...» → один человек, в mentions[] добавь «Женя»
- Если короткое имя неоднозначно и в тексте нет надёжного контекста, НЕ делай предположение и НЕ привязывай его автоматически к человеку
- Если в документе несколько людей с одинаковым именем или потенциально подходящей краткой формой, связывай короткое имя только при явной контекстной однозначности
- Если короткое имя или упоминание лица неоднозначно и нельзя надёжно понять, к какому человеку оно относится, НЕ создавай новую person-запись и НЕ добавляй это упоминание в mentions[]. Вместо этого добавь запись в ambiguousPersons[]
- Для ambiguousPersons:
  - value — сам неоднозначный фрагмент (например «Слава»)
  - context — короткий фрагмент предложения, достаточный чтобы найти место в тексте
  - reason — краткая причина неоднозначности
- ambiguousPersons используй ТОЛЬКО для нормального читаемого текста, где проблема не в OCR, а в неоднозначной идентификации человека
- ОДНО И ТО ЖЕ упоминание не может одновременно быть в ambiguousPersons и в mentions[] какого-либо человека. Если фрагмент признан неоднозначным, удаляй его из всех mentions[] и оставляй только в ambiguousPersons
- В mentions[] пиши фамилию ТОЛЬКО в именительном падеже (кто? что?) — система сама найдёт все падежные формы. Например: если в тексте «Завгородней» — в mentions[] пиши «Завгородняя». Если в тексте «боковой В.Р.» (с маленькой буквы, родительный падеж) — в mentions[] пиши «Бокова» и «бокова» (именительный падеж, оба регистра). НЕ пиши в mentions[] падежные формы типа «Боковой», «Корчаговой», «Стрежневой» — только именительный
- В mentions[] включай варианты где инициалы стоят ПЕРЕД фамилией: если человек упоминается как «С.В. Лаптева» — добавь «С.В. Лаптева» в mentions[]
- OCR-артефакт строчная буква: OCR иногда распознаёт заглавную букву как строчную. Если в тексте встречается фамилия с маленькой буквы (например «бокова В.Р.» вместо «Бокова В.Р.»), это та же персона. ОБЯЗАТЕЛЬНО добавляй в mentions[] вариант с маленькой буквы: mentions: [«Бокова», «бокова», «Бокова В.Р.», «бокова В.Р.», ...]
- Падежи в mentions[]: система автоматически ищет падежные формы по корню слова, НО только если фамилия написана с заглавной буквы. Если фамилия встречается в тексте с маленькой буквы И в косвенном падеже (например «боковой В.Р.» — родительный падеж от «Бокова»), система может не найти её. Поэтому ОБЯЗАТЕЛЬНО добавляй в mentions[] явные варианты с маленькой буквы для всех падежей которые встречаются в тексте. Пример: «в интересах боковой В.Р.» → добавь «боковой», «боковой В.Р.» в mentions[]
- OCR-артефакт «гр.»: в юридических документах часто встречается сокращение «гр.» (гражданин/гражданка). OCR может распознать его по-разному: «гр.», «г р.», «г. р.», «г .р.», «гр .», «г р», «г.р.» — всё это одно и то же сокращение перед фамилией. Буква «г» или «г.» в этих вариантах НЕ является частью имени.
  В mentions[] ОБЯЗАТЕЛЬНО добавляй все возможные варианты написания этого префикса перед фамилией, чтобы система обезличила весь фрагмент:
  Пример: в тексте «г р. Корчаговой Е.В.» → fullName: «Корчагова Е.В.», mentions: [«Корчагова», «Корчагова Е.В.», «гр. Корчагова», «г р. Корчагова», «г. р. Корчагова», «г.р. Корчагова»]
  Пример: в тексте «г р. Стрежнева Лидия Андреевна» → fullName: «Стрежнева Л.А.», mentions: [«Стрежнева», «Стрежнева Л.А.», «Стрежнева Лидия Андреевна», «гр. Стрежнева», «г р. Стрежнева», «г. р. Стрежнева», «г.р. Стрежнева», «гр. Стрежнева Лидия Андреевна», «г р. Стрежнева Лидия Андреевна», «г. р. Стрежнева Лидия Андреевна»] — добавляй варианты с полным именем после всех префиксов
- Не включай названия организаций как persons
- НЕ включай процессуальные роли и должности как персональные данные (подсудимый, потерпевший, свидетель, обвиняемый, истец, ответчик, судья, прокурор и подобные) — они не являются ПД
- НЕ включай описания родственных связей без имени (двоюродный брат, жена подсудимого, мать и т.п.) — они не являются ПД
- НЕ включай место вынесения приговора/решения/постановления как адрес (например «г. Самара» в строке «г. Самара    22 ноября 2021 года» — это место суда, а не адрес человека). Адрес человека всегда идёт после слов «проживает», «зарегистрирован», «по адресу» и содержит улицу, дом, квартиру
- НЕ включай адреса организаций, банков, судов, учреждений — только адреса конкретных физических лиц
- Тип birthplace (место рождения) — ТОЛЬКО если в тексте явно написано «родился в», «родилась в», «уроженец», «уроженка», «место рождения». Просто упоминание города в другом контексте — НЕ является местом рождения
- Тип vehicle_plate — включай госномер в том виде, как он написан в тексте. Примеры: «А123БВ163», «А 123 БВ 163», «В007ВВ77» — всё это госномера
- Тип vehicle_vin — VIN состоит из 17 латинских букв и цифр (буквы I, O, Q не используются)
- Тип imei — 15 цифр подряд, часто после слова «IMEI» или «идентификатор устройства»
- Тип org_link — значение (value) это название организации/ИП, replacement — «[организация]»
- Вернуть ТОЛЬКО JSON

ПРАВИЛА ДЛЯ АДРЕСОВ (очень важно!):
Адрес является персональными данными ТОЛЬКО если это именно адрес/место жительства конкретного человека, а не просто город или регион.
Подходят не только улица и дом, но и адресные формы вида территория, сад, СНТ, участок, владение.
Просто город ("г. Самара"), регион ("Самарская область") или район без более точного адресного ориентира — НЕ ПД, не включай.

Находи адреса включая:
- адрес регистрации ("зарегистрирован по адресу:", "зарегистрированного по адресу:")
- адрес проживания ("проживает по адресу:", "фактически проживающего по адресу:")
- место нахождения ("находится по адресу:")
Если у одного человека два адреса — это ДВЕ отдельные записи в otherPD.

Примеры:
- "зарегистрированного по адресу: г. Самара, ул. Дзержинского, 2-40" → value="г. Самара, ул. Дзержинского, 2-40", replacement="[адрес]" (есть улица — включаем)
- "зарегистрированного по адресу: Республика Башкортостан, г. Уфа, тер. Коллективный сад № 14 ОСТ ОАО УМПО, участок 766 А" → value="Республика Башкортостан, г. Уфа, тер. Коллективный сад № 14 ОСТ ОАО УМПО, участок 766 А", replacement="[адрес]" (это конкретный адрес по территории и участку — включаем)
- "проживающего по адресу: СНТ Сосновый бор, участок 15" → value="СНТ Сосновый бор, участок 15", replacement="[адрес]" (садовое товарищество и участок — включаем)
- "уроженца г. Самара" → НЕ включать как адрес (просто город, нет улицы)
- "проживающего в г. Самара" → НЕ включать как адрес (просто город)
- "зарегистрирован: Самарская обл., Приволжский р-н, с. Общаровка, ул. Школьная, д. 20, кв. 5" → value="Самарская обл., Приволжский р-н, с. Общаровка, ул. Школьная, д. 20, кв. 5", replacement="[адрес]" (есть улица и дом — включаем)
- "проживающего по адресу: г. Тольятти, б-р Баумана, 1-49" → value="г. Тольятти, б-р Баумана, 1-49", replacement="[адрес]" (б-р = бульвар, есть номер дома — включаем)

ПРАВИЛО ДЛЯ replacement (очень важно!):
Поле replacement НЕ должно дублировать смысл предшествующего слова в тексте.
Примеры:
- "проживающей по адресу: г. Самара..." → value="г. Самара...", replacement="[адрес]"
- "зарегистрирован по адресу: г. Москва..." → value="г. Москва...", replacement="[адрес]"
- "дата рождения: 08.03.1994 г.р." → value="08.03.1994 г.р.", replacement="[дата рождения]"
- "телефон: +7 999 123-45-67" → value="+7 999 123-45-67", replacement="[телефон]"
- "родился в г. Мирный Архангельской обл." → value="г. Мирный Архангельской обл.", replacement="[место рождения]"
- "имеющий id 1194234643" → value="1194234643", replacement="[id пользователя]"
- "(id1942346643)" → value="id1942346643", replacement="[id пользователя]"
- "аккаунт "Другой Укупник" (@marvihram)" → value="@marvihram", replacement="[аккаунт]"
- "государственный номер А123БВ163" → type="vehicle_plate", value="А123БВ163", replacement="[госномер ТС]"
- "VIN XTA210930Y2765432" → type="vehicle_vin", value="XTA210930Y2765432", replacement="[VIN]"
- "водительское удостоверение серии 63 00 № 123456" → type="driver_license", value="63 00 № 123456", replacement="[вод. удостоверение]"
- "военный билет АБ № 1234567" → type="military_id", value="АБ № 1234567", replacement="[военный билет]"
- "полис ОМС 1234567890123456" → type="oms_policy", value="1234567890123456", replacement="[полис ОМС]"
- "свидетельство о рождении серии II-АБ № 123456" → type="birth_certificate", value="II-АБ № 123456", replacement="[св-во о рождении]"
- "загранпаспорт 71 № 1234567" → type="zagranpassport", value="71 № 1234567", replacement="[загранпаспорт]"
- "IMEI 356938035643809" → type="imei", value="356938035643809", replacement="[IMEI]"
- "ИП Иванов Иван Иванович" → type="org_link", value="ИП Иванов Иван Иванович", replacement="[организация]"
То есть: если перед значением в тексте уже стоит поясняющее слово ("адресу", "телефон", "родился" и т.д.) — value содержит только само значение, replacement — просто метку.

Текст документа:
`;

// ── Universal API caller ───────────────────────────────────────────────────────
async function callApi(messages, apiKey, system, provider) {
  if (provider === 'openai') return callOpenAI(messages, apiKey, system);
  if (provider === 'gemini') return callGemini(messages, apiKey, system);
  return callClaude(messages, apiKey, system);
}

async function callClaude(messages, apiKey, system) {
  const body = { model: PROVIDERS.claude.model, max_tokens: 64000, messages };
  if (system) body.system = system;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Ошибка Claude API: ' + resp.status);
  }
  const data = await resp.json();
  return data.content[0].text;
}

async function callOpenAI(messages, apiKey, system) {
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const parts = msg.content.map(c => {
        if (c.type === 'image') {
          return { type: 'image_url', image_url: { url: 'data:' + c.source.media_type + ';base64,' + c.source.data } };
        }
        return { type: 'text', text: c.text };
      });
      oaiMessages.push({ role: msg.role, content: parts });
    } else {
      oaiMessages.push({ role: msg.role, content: msg.content });
    }
  }
  const payload = { model: PROVIDERS.openai.model, max_completion_tokens: 64000, messages: oaiMessages };
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const rawError = await resp.text().catch(() => '');
    let err = {};
    try {
      err = rawError ? JSON.parse(rawError) : {};
    } catch {}

    const imageParts = oaiMessages.flatMap((msg) => (
      Array.isArray(msg.content)
        ? msg.content.filter((part) => part?.type === 'image_url')
        : []
    ));
    const imageUrlLengths = imageParts.map((part) => part?.image_url?.url?.length || 0);
    const payloadSize = JSON.stringify(payload).length;

    console.error('OpenAI request failed', {
      status: resp.status,
      statusText: resp.statusText,
      model: PROVIDERS.openai.model,
      messageCount: oaiMessages.length,
      imageCount: imageParts.length,
      imageUrlLengths,
      payloadSize,
      rawErrorPreview: rawError.slice(0, 1000),
    });

    throw new Error(err.error?.message || rawError || 'Ошибка OpenAI API: ' + resp.status);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callGemini(messages, apiKey, system) {
  const parts = [];
  if (system) parts.push({ text: system + '\n\n' });
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === 'image') {
          parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } });
        } else if (c.type === 'text') {
          parts.push({ text: c.text });
        }
      }
    } else {
      parts.push({ text: msg.content });
    }
  }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    PROVIDERS.gemini.model + ':generateContent?key=' + apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Ошибка Gemini API: ' + resp.status);
  }
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}

// ── Image compression ──────────────────────────────────────────────────────────
async function compressImage(base64, mediaType) {
  const croppedImage = await autoCropDocumentImage({ base64, mediaType });
  const sourceBase64 = croppedImage.base64 || base64;
  const sourceMediaType = croppedImage.mediaType || mediaType || 'image/jpeg';
  const sizeKb = (sourceBase64.length * 3) / 4 / 1024;
  if (sizeKb <= 3800) {
    return {
      base64: sourceBase64,
      mediaType: sourceMediaType,
      cropRect: croppedImage.cropRect,
      cropped: croppedImage.cropped,
    };
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 2400;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve({
        base64: canvas.toDataURL('image/jpeg', 0.80).split(',')[1],
        mediaType: 'image/jpeg',
        cropRect: croppedImage.cropRect,
        cropped: croppedImage.cropped,
      });
    };
    img.src = 'data:' + sourceMediaType + ';base64,' + sourceBase64;
  });
}

// ── Шаг 1: OCR всех страниц ───────────────────────────────────────────────────
// Убирает переносы слов через дефис которые OCR генерирует сам
function dehyphenate(text) {
  return text
    .replace(/([А-яЁёa-zA-Z])-\r?\n([а-яёa-z])/g, '$1$2')  // Са-\nмара → Самара
    .replace(/([А-яЁёa-zA-Z])- ([а-яёa-z])/g, '$1$2');       // Са- мара → Самара
}

export async function recognizeDocument(images, apiKey, provider, onProgress, existingPD) {
  const texts = [];
  const total = images.length;

  // OCR: 0–75% (наибольший вес — самый долгий этап)
  for (let i = 0; i < total; i++) {
    const pctStart = Math.round((i / total) * 75);
    onProgress({
      stage: 'ocr',
      current: i + 1,
      total,
      percent: pctStart,
      message: total > 1
        ? 'Распознавание страницы ' + (i + 1) + ' из ' + total + '...'
        : 'Распознавание страницы...',
    });

    const { base64, mediaType, cropRect, cropped } = await compressImage(images[i].base64, images[i].mediaType);

    const actualPageNumber = images[i]?.pageNum || i + 1;
    let text;
    try {
      text = await callApi([{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Распознай текст этого юридического документа.' },
        ],
      }], apiKey, SYS_OCR, provider);
    } catch (error) {
      console.error('OCR page request failed', {
        provider,
        pageIndexInBatch: i + 1,
        pageNumber: actualPageNumber,
        totalPagesInBatch: total,
        totalPagesInDocument: images[i]?.totalPages || null,
        originalMediaType: images[i]?.mediaType || null,
        sentMediaType: mediaType,
        originalBase64Length: images[i]?.base64?.length || 0,
        compressedBase64Length: base64.length,
        cropped,
        cropRect,
        textSource: images[i]?.textSource || null,
        renderWidth: images[i]?.renderWidth || null,
        renderHeight: images[i]?.renderHeight || null,
        errorMessage: error?.message || String(error),
      });
      throw error;
    }

    texts.push(text);

    onProgress({
      stage: 'ocr',
      current: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 75),
      message: total > 1
        ? 'Страница ' + (i + 1) + ' из ' + total + ' готова'
        : 'Страница готова',
    });
  }

  // Умная склейка страниц:
  // 1. Убираем одиночные цифры (номера страниц) — строка содержит только цифру
  // 2. Если страница заканчивается без знака препинания — склеиваем без двойного переноса
  const cleanedTexts = texts.map(t => {
    // Убираем переносы слов через дефис которые OCR добавляет сам:
    // «Са-\nмарского» → «Самарского», «зарегистриро-\nванного» → «зарегистрированного»
    // Только строчная буква после переноса — дефисы в составных словах сохраняются
    const dehyphenated = dehyphenate(t)
    return dehyphenated.split('\n')
     .filter(line => !/^\s*\d{1,3}\s*$/.test(line)) // убираем строки с одной цифрой (номера страниц)
     .join('\n')
     .trim();
  });

  const fullText = cleanedTexts
    .map((page, i) => '[PAGE:' + (images[i]?.pageNum || i + 1) + ']\n' + page)
    .join('\n');

  // Шаг 2: Проверка качества — 75–87%
  onProgress({ stage: 'quality', percent: 76, message: 'Проверка качества' });
  const checkedText = await runQualityCheck(fullText, apiKey, provider, onProgress);

  // Шаг 3: Анализ ПД — 87–100%
  onProgress({ stage: 'analysis', percent: 88, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(checkedText, apiKey, provider, onProgress, existingPD);

  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: checkedText, personalData };
}

export async function analyzePastedText(text, apiKey, provider, onProgress) {
  const plainText = text || '';
  onProgress({ stage: 'quality', percent: 15, message: 'Проверка качества текста...' });

  onProgress({ stage: 'analysis', percent: 55, message: 'Анализ персональных данных...' });
  const personalData = await analyzePD(plainText, apiKey, provider, onProgress);

  onProgress({ stage: 'done', percent: 100, message: 'Готово!' });
  return { text: plainText, personalData };
}

// ── Шаг 2: Проверка качества (отдельный запрос) ───────────────────────────────
async function runQualityCheck(fullText, apiKey, provider, onProgress) {
  // Разбиваем текст на страницы по [PAGE:N] маркерам
  // Проверяем каждую страницу отдельно — так прогресс обновляется равномерно
  const parts = fullText.split(/(\[PAGE:\d+\])/);
  // parts = [текст стр.1, '[PAGE:2]', текст стр.2, '[PAGE:3]', текст стр.3, ...]

  // Собираем страницы: { marker, text }
  const pages = [];
  let currentText = '';
  let currentMarker = null;
  for (const part of parts) {
    if (/^\[PAGE:\d+\]$/.test(part)) {
      if (currentMarker !== null || currentText.trim()) {
        pages.push({ marker: currentMarker, text: currentText });
      }
      currentText = '';
      currentMarker = part;
    } else {
      currentText += part;
    }
  }
  if (currentMarker !== null || currentText.trim()) {
    pages.push({ marker: currentMarker, text: currentText });
  }

  const total = pages.length;

  // Если страница одна — один запрос без разбивки
  if (total <= 1) {
    try {
      const onlyPage = pages[0] || { marker: null, text: fullText };
      const textForCheck = (onlyPage.text || '').replace(/\[PAGE:\d+\]/g, '');
      const checked = await callApi(
        [{ role: 'user', content: PROMPT_QUALITY_SAFE + textForCheck }],
        apiKey, null, provider
      );
      if (checked && checked.length > 50) {
        const cleaned = dehyphenate(checked);
        return onlyPage.marker ? `${onlyPage.marker}\n${cleaned}` : cleaned;
      }
    } catch (e) { console.warn('Quality check error:', e); }
    return fullText;
  }

  // Проверяем постранично — quality check для каждой страницы отдельно
  const checkedParts = [];
  for (let i = 0; i < total; i++) {
    const { marker, text } = pages[i];
    const pageText = text.trim();
    // Прогресс: quality check занимает 75–87%, делим равномерно по страницам
    const pct = Math.round(75 + ((i + 1) / total) * 12);
    onProgress({
      stage: 'quality',
      percent: pct,
      message: total > 1
        ? 'Проверка качества: страница ' + (i + 1) + ' из ' + total + '...'
        : 'Проверка качества распознавания...',
    });

    if (!pageText) {
      checkedParts.push((marker ? '\n' + marker + '\n' : '') + text);
      continue;
    }

    try {
      const checked = await callApi(
        [{ role: 'user', content: PROMPT_QUALITY_SAFE + pageText }],
        apiKey, null, provider
      );
      const result = dehyphenate((checked && checked.length > 30) ? checked : pageText);
      checkedParts.push((marker ? '\n' + marker + '\n' : '') + result);
    } catch (e) {
      console.warn('Quality check error page ' + (i + 1) + ':', e);
      checkedParts.push((marker ? '\n' + marker + '\n' : '') + pageText);
    }
  }

  return checkedParts.join('');
}

// ── Шаг 3: Анализ персональных данных ────────────────────────────────────────
export async function analyzePD(fullText, apiKey, provider, onProgress, existingPD) {
  let personalData = { persons: [], otherPD: [], ambiguousPersons: [] };
  try {
    const cleanForPD = fullText.replace(/\[PAGE:\d+\]/g, '');
    const textForPD = cleanForPD.length > PD_ANALYSIS_CHAR_LIMIT
      ? cleanForPD.slice(0, PD_ANALYSIS_CHAR_LIMIT) + '\n...'
      : cleanForPD;
    onProgress({ stage: 'analysis', percent: 91, message: 'Поиск персональных данных...' });

    // Формируем промпт — если есть существующая база, добавляем её
    let prompt = PROMPT_PD;
    if (existingPD && ((existingPD.persons && existingPD.persons.length > 0) || (existingPD.otherPD && existingPD.otherPD.length > 0))) {
      const existingJson = JSON.stringify({
        persons: (existingPD.persons || []).map(p => ({
          id: p.id, fullName: p.fullName, role: p.role, category: p.category, mentions: p.mentions,
        })),
        otherPD: (existingPD.otherPD || []).map(it => ({
          id: it.id, type: it.type, value: it.value, replacement: it.replacement,
        })),
      }, null, 2);
      prompt += '\n\nВАЖНО — СУЩЕСТВУЮЩАЯ БАЗА ПЕРСОНАЛЬНЫХ ДАННЫХ:\nЭтот документ является продолжением ранее обработанного. Вот уже известные персональные данные:\n' + existingJson + '\n\nПравила работы с существующей базой:\n\nPersons (лица):\n- Если в новом тексте встречается человек из существующей базы (совпадает fullName или одно из mentions) — используй его СУЩЕСТВУЮЩИЙ id. Добавь новые mentions если нашлись новые варианты написания. НЕ создавай для него новую запись\n- Если в новом тексте встречается новый человек, которого НЕТ в существующей базе — создай для него НОВУЮ запись с новым уникальным id\n\nOtherPD (адреса, телефоны, паспорта, даты рождения и т.д.):\n- Если в новом тексте встречается ПД, совпадающее по value (или очень близкое — тот же адрес, тот же номер телефона, тот же паспорт) с записью из существующей базы — используй СУЩЕСТВУЮЩИЙ id, НЕ создавай дубликат\n- Если в новом тексте встречается новое ПД, которого НЕТ в существующей базе (новый адрес, новый номер телефона, новый паспорт и т.д.) — создай для него НОВУЮ запись с новым id\n- Типы otherPD, которые нужно проверять на совпадение: address, phone, passport, zagranpassport, inn, snils, card, email, dob, birthplace, social_id, vehicle_plate, vehicle_vin, driver_license, military_id, oms_policy, birth_certificate, imei, org_link\n\nВ результирующем JSON верни ТОЛЬКО НОВЫЕ записи (которых нет в существующей базе) и ОБНОВЛЁННЫЕ существующие записи (с добавленными mentions для persons). Не включай неизменённые записи из существующей базы.\n\nТекст документа:\n';
    } else {
      prompt += '\n';
    }

    const pdRaw = await callApi(
      [{ role: 'user', content: prompt + textForPD }],
      apiKey, null, provider
    );
    // Убираем code-fence если модель обернула JSON в ```json...```
    const pdClean = pdRaw.replace(/^```[\w]*\n?/m, '').replace(/```\s*$/m, '').trim();
    const m = pdClean.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (parsed.ambiguousPersons?.length && parsed.persons?.length) {
        const ambiguousValues = new Set(
          parsed.ambiguousPersons
            .map(item => (item?.value || '').trim().toLowerCase())
            .filter(Boolean)
        );
        if (ambiguousValues.size > 0) {
          parsed.persons = parsed.persons.map(person => ({
            ...person,
            mentions: (person.mentions || []).filter(mention => !ambiguousValues.has((mention || '').trim().toLowerCase())),
          }));
        }
      }
      // Фильтруем некорректные записи otherPD на уровне кода:
      // Адрес без улицы — не ПД (просто город/регион)
      // Место рождения без явного указания (просто город) — не ПД
      if (parsed.otherPD) {
        parsed.otherPD = parsed.otherPD.filter(item => {
          if (item.type === 'address') {
            // Адрес должен содержать не только город/регион, а более точный адресный ориентир:
            // улицу/дом, квартиру, территорию, СНТ/сад, участок и т.п.
            const hasAddressDetail = /ул\.?|пр\.?|пер\.?|пр-т|б-р|бульв|шоссе|наб\.?|пл\.?|д\.\s*\d|дом\s*\d|кв\.\s*\d|квартира\s*\d|проспект|переулок|улица|бульвар|набережная|площадь|тупик|проезд|тер\.?|территори(?:я|и)|снт|днт|тсн|сад\b|коллективный\s+сад|участ(?:ок|ка)\b|владен(?:ие|ия)\b|домовладен(?:ие|ия)\b|\d+[-/]\d+/.test(item.value || '');
            return hasAddressDetail;
          }
          if (item.type === 'birthplace') {
            // Место рождения должно быть явно указано — не просто город
            // Если value это просто "г. Самара" или "Москва" — фильтруем
            const val = (item.value || '').trim();
            const isJustCity = /^(г\.?\s*)?[А-ЯЁ][а-яё]+(-[А-ЯЁ][а-яё]+)?(\s+(обл|область|края|край|респ|республика)\.?)?$/i.test(val);
            return !isJustCity;
          }
          return true;
        });
      }
      personalData = parsed;
    }
  } catch (e) {
    console.warn('PD parse error', e);
  }
  onProgress({ stage: 'analysis', percent: 97, message: 'Финализация...' });
  return personalData;
}
