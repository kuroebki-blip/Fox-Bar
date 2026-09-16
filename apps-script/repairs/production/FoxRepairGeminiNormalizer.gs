/**
 * Gemini-based text normalizer for FO'X repair tickets.
 *
 * This file is intended to live in the same Apps Script project as the existing
 * FO'X stock/receipt code, so it can reuse the already configured Gemini client:
 * - GEMINI_API_KEY
 * - GEMINI_MODEL
 * - FOX_RECEIPTS.defaultGeminiModel
 * - FOX_RECEIPTS.geminiDocumentRetry
 * - callGeminiGenerateContent_()
 * - parseGeminiJsonResult_()
 * - normalizeGeminiModel_()
 * - errorText_()
 */
function normalizeFoxRepairTextWithGemini_(rawText) {
  const source = String(rawText || '').trim().replace(/\s+/g, ' ');
  if (!source) return { title:'', description:'' };

  const props = PropertiesService.getScriptProperties();
  const apiKey = String(props.getProperty('GEMINI_API_KEY') || '').trim();
  if (!apiKey) throw new Error('В Script Properties не задан GEMINI_API_KEY.');

  const model = normalizeGeminiModel_(
    props.getProperty('GEMINI_MODEL') || FOX_RECEIPTS.defaultGeminiModel
  );

  const schema = {
    type:'OBJECT',
    properties:{
      title:{ type:'STRING' },
      description:{ type:'STRING' }
    },
    required:['title','description']
  };

  const prompt = [
    'Ты нормализуешь сообщения сотрудников ресторана FO’X для технических заявок на ремонт.',
    'Исходное сообщение может быть разговорным, с матом, опечатками, сленгом и обращениями.',
    'Нужно сохранить только фактически сообщённую неисправность и убрать эмоциональный шум.',
    'Никогда не придумывай диагноз, причину поломки, детали или последствия, которых нет в исходном тексте.',
    'title — короткое название тикета, обычно 2–7 слов. Пример: «холодильник сломался» -> «Поломка холодильника».',
    'description — короткая нейтральная формулировка того же факта, максимум 1 предложение.',
    'Если из текста нельзя понять объект или проблему, аккуратно переформулируй только то, что известно.',
    'Не добавляй ресторан, департамент, срочность, автора и служебные данные.',
    'Верни только JSON по схеме.',
    '',
    'ИСХОДНОЕ СООБЩЕНИЕ:',
    source
  ].join('\n');

  const body = {
    contents:[{ role:'user', parts:[{ text:prompt }] }],
    generationConfig:{
      responseMimeType:'application/json',
      responseSchema:schema,
      temperature:0,
      maxOutputTokens:512
    }
  };

  let parsed;
  try {
    parsed = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, body, {
      maxAttempts:2,
      retrySettings:FOX_RECEIPTS.geminiDocumentRetry,
      operation:'repair_normalize'
    }).text);
  } catch (firstError) {
    if (!/INVALID_ARGUMENT|invalid argument|HTTP 400/i.test(errorText_(firstError))) throw firstError;
    parsed = parseGeminiJsonResult_(callGeminiGenerateContent_(apiKey, model, {
      contents:[{ role:'user', parts:[{ text:prompt }] }],
      generationConfig:{ responseMimeType:'application/json', temperature:0, maxOutputTokens:512 }
    }, {
      maxAttempts:2,
      retrySettings:FOX_RECEIPTS.geminiDocumentRetry,
      operation:'repair_normalize_fallback',
      fallback:true
    }).text);
  }

  const title = String(parsed && parsed.title || '').trim().replace(/\s+/g, ' ').slice(0, 180);
  const description = String(parsed && parsed.description || '').trim().replace(/\s+/g, ' ').slice(0, 500);

  return {
    title:title || source.slice(0, 180),
    description:description || title || source.slice(0, 500)
  };
}
