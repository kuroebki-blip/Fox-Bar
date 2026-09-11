from pathlib import Path

index = Path('index.html')
text = index.read_text()


def replace_once(old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, got {count}: {old[:140]!r}')
    text = text.replace(old, new, 1)


replace_once("<title>FO'X App v15.16.3 — RECEIPT POLLING RECOVERY</title>", "<title>FO'X App v15.16.4 — COMPACT PDF UPLOAD</title>")
replace_once('shared/document-scanner/document-scanner.js?v=15.16.3', 'shared/document-scanner/document-scanner.js?v=15.16.4')

marker = "const RECEIPT_POLL_INTERVAL_MS = 1500;\n"
replace_once(marker, marker + "const RECEIPT_PDF_MAX_SIDE = 1500;\nconst RECEIPT_PDF_JPEG_QUALITY = .76;\nconst RECEIPT_PDF_ATTACH_ATTEMPTS = 3;\n")

helper_anchor = """async function buildCashOcrImagesPayload_(pages,onProgress){
  assertOcrPageCount_(pages.length);
  const images=[];
  for(let i=0;i<pages.length;i++){
    if(onProgress)onProgress(i,pages.length);
    images.push(await dataUrlToCashOcrImage_(pages[i].dataUrl));
  }
  validateOcrImagesPayload_(images);
  return images;
}
"""
helper_block = helper_anchor + """async function buildReceiptPdfUploadPages_(pages){
  const compact=[];
  for(let i=0;i<pages.length;i++){
    const prepared=await dataUrlToOcrImage_(pages[i].dataUrl,RECEIPT_PDF_MAX_SIDE,RECEIPT_PDF_JPEG_QUALITY);
    compact.push({dataUrl:'data:'+prepared.mimeType+';base64,'+prepared.data,width:prepared.width,height:prepared.height});
  }
  return compact;
}
async function attachReceiptPdfWithRecovery_(jobId,pdfBase64,pdfName){
  let lastError=null;
  for(let attempt=1;attempt<=RECEIPT_PDF_ATTACH_ATTEMPTS;attempt++){
    try{
      await postReceipt({action:'attachPdf',jobId,pdfBase64,pdfName});
      return;
    }catch(error){
      lastError=error;
      if(!isTransientReceiptStatusError_(error))throw error;
      await new Promise(resolve=>setTimeout(resolve,1200*attempt));
      try{
        const state=await getReceiptJobStatus_(jobId);
        if(state&&state.ok&&state.pdfFileId)return;
      }catch(statusError){
        if(!isTransientReceiptStatusError_(statusError))throw statusError;
      }
    }
  }
  throw lastError||new Error('Не удалось загрузить PDF.');
}
"""
replace_once(helper_anchor, helper_block)

old_pdf = """    const pdfBlob=await buildReceiptPdf(pagesSnapshot);
    if(!receiptJobIsActive_(receiptJobId,jobId))throw new Error('Операция отменена.');
    if(pdfBlob.size>15*1024*1024)throw new Error('PDF больше 15 МБ. Уменьши количество страниц.');
    const base64=await blobToBase64(pdfBlob);
"""
new_pdf = """    // После OCR собираем отдельный компактный PDF для Telegram. Это снижает
    // нагрузку на iOS WebView и размер cross-origin POST в Apps Script.
    const pdfPages=await buildReceiptPdfUploadPages_(pagesSnapshot);
    const pdfBlob=await buildReceiptPdf(pdfPages);
    if(!receiptJobIsActive_(receiptJobId,jobId))throw new Error('Операция отменена.');
    if(pdfBlob.size>12*1024*1024)throw new Error('PDF больше 12 МБ после оптимизации. Уменьши количество страниц.');
    const base64=await blobToBase64(pdfBlob);
"""
replace_once(old_pdf, new_pdf)
replace_once("    await postReceipt({action:'attachPdf',jobId,pdfBase64:base64,pdfName:'FO_X_'+jobId+'.pdf'});", "    await attachReceiptPdfWithRecovery_(jobId,base64,'FO_X_'+jobId+'.pdf');")
index.write_text(text)

test = Path('tests/receipts/scanner_polling_resilience.test.js')
t = test.read_text()
addition = r'''

test('Telegram PDF is recompressed before attach upload', () => {
  assert.match(frontend, /RECEIPT_PDF_MAX_SIDE\s*=\s*1500/);
  assert.match(frontend, /RECEIPT_PDF_JPEG_QUALITY\s*=\s*\.76/);
  assert.match(frontend, /buildReceiptPdfUploadPages_\(pagesSnapshot\)[\s\S]*?buildReceiptPdf\(pdfPages\)/);
});

test('attachPdf Load failed is recovered without blind duplicate retry', () => {
  assert.match(frontend, /RECEIPT_PDF_ATTACH_ATTEMPTS\s*=\s*3/);
  assert.match(frontend, /async function attachReceiptPdfWithRecovery_/);
  assert.match(frontend, /state&&state\.ok&&state\.pdfFileId/);
  assert.match(frontend, /attachReceiptPdfWithRecovery_\(jobId,base64,'FO_X_'\+jobId\+'\.pdf'\)/);
});
'''
if 'Telegram PDF is recompressed before attach upload' not in t:
    t += addition
test.write_text(t)

changelog = Path('CHANGELOG.md')
c = changelog.read_text()
anchor = '## Unreleased\n\n'
entry = "- FO’X `v15.16.4`: исправлен `Load failed` при подготовке PDF для Telegram на iPhone/Telegram WebView. После OCR страницы отдельно сжимаются до 1500 px/JPEG 0.76 перед сборкой PDF, поэтому `attachPdf` отправляет значительно меньший payload. Временный сетевой сбой загрузки повторяется до трёх раз, но перед повтором frontend проверяет `pdfFileId`, чтобы не создавать слепые дубли в Drive. Backend и Gemini OCR не меняются.\n\n"
if entry not in c:
    c = c.replace(anchor, anchor + entry, 1)
changelog.write_text(c)
