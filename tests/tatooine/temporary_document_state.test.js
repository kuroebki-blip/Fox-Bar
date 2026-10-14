const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fixture() {
  const cache = new Map(); let now = 1000; let sends = 0;
  const ctx = { console, Date: { now: () => now }, JSON, Math, String, Number, Array, Object, RegExp,
    CacheService:{ getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)}) },
    LockService:{ getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}}) },
    Utilities:{ getUuid:()=> 'unused', base64Encode:x=>String(x), computeDigest:(_,source)=>source, DigestAlgorithm:{SHA_256:'sha'}, Charset:{UTF_8:'utf8'}, base64Decode:()=>new Array(120).fill(1) },
    UrlFetchApp:{ fetch:()=>{ sends++; return {getResponseCode:()=>200,getContentText:()=>'{"ok":true}'}; } },
    HtmlService:{createHtmlOutput:()=>({getBlob:()=>({getAs:()=>({setName:()=>({})})})})}, MimeType:{PDF:'pdf'},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})}, Session:{getScriptTimeZone:()=> 'UTC'} };
  const source = fs.readFileSync(path.join(__dirname, '../../apps-script/stock/production/Code.gs'), 'utf8') + `
parseInlineImages_=(raw)=>JSON.parse(raw); recognizePdfWithGemini_=()=>({document_date:'01.01.2026',supplier_full:'ООО Тест',supplier_short:'Тест',items:[]}); sanitizeRecognition_=(r,_,mode)=>Object.assign({scanMode:mode,documentDate:r.document_date,supplierFull:r.supplier_full,supplierShort:r.supplier_short,items:[]},r); shortSupplierName_=(_,s)=>s; normalizeDate_=x=>x; dateStamp_=()=> '01.01.2026'; normalizePurchaseChannel_=x=>x||'Покупка в магазине'; formatTelegramAmount_=()=> '0'; normalizeTelegramVenue_=x=>x; errorText_=e=>String(e.message||e); requiredString_=(x,n)=>{if(!x)throw new Error(n);return String(x)}; cleanBase64_=x=>x; authorizeRequest_=()=>({userId:'u1',venue:'fox'}); assertTelegramActionAllowed_=()=>{}; textOutput_=x=>x; telegramRouteConfig_=()=>({botToken:'mock',targetChatId:'mock'}); temporaryDocumentPdf_=()=>({}); globalThis.api={temporaryDocumentPreview_,temporaryDocumentSend_,temporaryDocumentStatus_,doPost};`;
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const auth = {userId:'u1',venue:'fox'}; const images = JSON.stringify([{mimeType:'image/jpeg',data:'abc'}]);
  return {ctx, cache, auth, images, api:ctx.api, sends:()=>sends, setNow:v=>{now=v;}};
}

test('temporary preview cannot overwrite an existing id and expires fail closed', () => {
  const f=fixture(); f.api.temporaryDocumentPreview_({previewId:'preview_123456',department:'Бар',imagesJson:f.images},f.auth);
  assert.throws(()=>f.api.temporaryDocumentPreview_({previewId:'preview_123456',department:'Бар',imagesJson:f.images},f.auth),/уже существует/);
  f.setNow(1000 + 601000);
  assert.throws(()=>f.api.temporaryDocumentStatus_({previewId:'preview_123456'},f.auth),/истёк/);
});

test('temporary send binds reviewed images and blocks UNKNOWN retries', () => {
  const f=fixture(); f.api.temporaryDocumentPreview_({previewId:'preview_abcdef',department:'Бар',imagesJson:f.images},f.auth);
  assert.throws(()=>f.api.temporaryDocumentSend_({previewId:'preview_abcdef',department:'Бар',scanMode:'document',imagesJson:JSON.stringify([{mimeType:'image/jpeg',data:'changed'}])},f.auth),/изменились/);
  const entry=JSON.parse([...f.cache.values()][0]); entry.state='UNKNOWN'; f.cache.set('temporaryDocument:preview_abcdef',JSON.stringify(entry));
  assert.throws(()=>f.api.temporaryDocumentSend_({previewId:'preview_abcdef',department:'Бар',scanMode:'document',imagesJson:f.images},f.auth),/неизвестен/);
  assert.equal(f.sends(),0);
});

test('legacy doPost with a job id is rejected before any persistence handler', () => {
  const f=fixture(); let writes=0;
  f.ctx.failJob_=f.ctx.recordActionError_=f.ctx.upsertDocumentRecord_=()=>{writes++;};
  const result=f.api.doPost({parameter:{action:'scanImages',jobId:'existing-job'}});
  assert.equal(result.ok,false);
  assert.match(result.error,/Старый scanner job отключён/);
  assert.equal(writes,0);
});

test('temporary and blocked scanner errors never enter legacy persistence, even before auth', () => {
  for (const parameter of [
    {action:'temporaryDocumentPreview',jobId:'foreign-job',previewId:'bad',department:'Бар',imagesJson:'[]'},
    {action:'temporaryDocumentSend',jobId:'foreign-job',previewId:'missing',department:'Бар',scanMode:'document',imagesJson:'[]'},
    {action:'scanImages',jobId:'foreign-job'}
  ]) {
    const f=fixture(); let writes=0;
    f.ctx.authorizeRequest_=()=>{ throw new Error('Доступ запрещён'); };
    f.ctx.failJob_=f.ctx.recordActionError_=f.ctx.upsertDocumentRecord_=()=>{writes++;};
    const result=f.api.doPost({parameter});
    assert.equal(result.ok,false);
    assert.match(result.error,/Доступ запрещён/);
    assert.equal(writes,0,parameter.action);
  }
});

test('preview lock contention does not create temporary state', () => {
  const f=fixture();
  f.ctx.LockService.getScriptLock=()=>({tryLock:()=>false,releaseLock:()=>{throw new Error('must not release');}});
  assert.throws(()=>f.api.temporaryDocumentPreview_({previewId:'preview_locked',department:'Бар',imagesJson:f.images},f.auth),/занят/);
  assert.equal(f.cache.size,0);
});

test('send success becomes SENT; explicit rejection becomes FAILED; network error becomes UNKNOWN', () => {
  for (const scenario of [
    { name:'success', fetch:()=>({getResponseCode:()=>200,getContentText:()=>'{"ok":true}'}), state:'SENT' },
    { name:'rejected', fetch:()=>({getResponseCode:()=>400,getContentText:()=>'{"ok":false,"description":"Bad Request"}'}), state:'FAILED' },
    { name:'timeout', fetch:()=>{throw new Error('network timeout');}, state:'UNKNOWN' }
  ]) {
    const f=fixture(); f.ctx.UrlFetchApp.fetch=scenario.fetch;
    f.api.temporaryDocumentPreview_({previewId:'preview_'+scenario.name,department:'Бар',imagesJson:f.images},f.auth);
    if (scenario.state === 'SENT') {
      f.api.temporaryDocumentSend_({previewId:'preview_'+scenario.name,department:'Бар',scanMode:'document',imagesJson:f.images},f.auth);
    } else {
      assert.throws(()=>f.api.temporaryDocumentSend_({previewId:'preview_'+scenario.name,department:'Бар',scanMode:'document',imagesJson:f.images},f.auth));
    }
    const status=f.api.temporaryDocumentStatus_({previewId:'preview_'+scenario.name},f.auth);
    assert.equal(status.status,scenario.state);
    if (scenario.state === 'UNKNOWN') assert.match(status.error,/network timeout/);
  }
});

test('Tatooine temporary send falls back to the signed current chat when no shared chat is configured', () => {
  const f=fixture(); let payload=null;
  f.auth={userId:'u1',venue:'tatooine',chatId:'-100123'};
  f.ctx.telegramRouteConfig_=()=>({botToken:'mock',targetChatId:''});
  f.ctx.UrlFetchApp.fetch=(_,options)=>{ payload=options.payload; return {getResponseCode:()=>200,getContentText:()=>'{"ok":true}'}; };
  f.api.temporaryDocumentPreview_({previewId:'preview_tatooine_route',department:'Бар',scanMode:'check',imagesJson:f.images},f.auth);
  f.api.temporaryDocumentSend_({previewId:'preview_tatooine_route',department:'Бар',scanMode:'check',imagesJson:f.images},f.auth);
  assert.equal(payload.chat_id,'-100123');
});
