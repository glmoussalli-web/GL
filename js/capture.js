/* ===== Camera Capture, Image Attachments & OCR ===== */

let cameraStream = null;
let capturedImageData = null;
let tesseractReady = false;
let tesseractWorker = null;

// ===== Camera =====
async function startCamera() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = cameraStream;
    video.style.display = 'block';
    canvas.style.display = 'none';
    document.getElementById('camera-take-btn').style.display = '';
    document.getElementById('camera-retake-btn').style.display = 'none';
    document.getElementById('camera-use-btn').style.display = 'none';
  } catch (e) {
    toast(t('cameraNotAvailable'), 'error');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = document.getElementById('camera-video');
  if (video) video.srcObject = null;
}

function takePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  capturedImageData = canvas.toDataURL('image/jpeg', 0.85);
  video.style.display = 'none';
  canvas.style.display = 'block';
  stopCamera();
  document.getElementById('camera-take-btn').style.display = 'none';
  document.getElementById('camera-retake-btn').style.display = '';
  document.getElementById('camera-use-btn').style.display = '';
}

function retakePhoto() {
  capturedImageData = null;
  document.getElementById('camera-canvas').style.display = 'none';
  startCamera();
}

async function usePhoto() {
  if (!capturedImageData) return;
  document.getElementById('capture-result').style.display = 'block';
  document.getElementById('capture-ocr-text').textContent = t('processing');
  // Run OCR
  const text = await runOCR(capturedImageData);
  document.getElementById('capture-ocr-text').textContent = text || '(no text detected)';
  // Try to classify
  const classification = classifyDocument(text);
  document.getElementById('capture-classification').textContent = classification.type;
  document.getElementById('capture-suggested-entries').innerHTML = renderSuggestedEntries(classification);
}

// ===== Image Upload (non-camera) =====
function handleCaptureImageUpload(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    capturedImageData = e.target.result;
    const preview = document.getElementById('capture-image-preview');
    preview.innerHTML = `<img src="${capturedImageData}" style="max-width:100%;max-height:300px;border-radius:var(--radius);">`;
    preview.style.display = 'block';
    document.getElementById('capture-result').style.display = 'block';
    document.getElementById('capture-ocr-text').textContent = t('processing');
    const text = await runOCR(capturedImageData);
    document.getElementById('capture-ocr-text').textContent = text || '(no text detected)';
    const classification = classifyDocument(text);
    document.getElementById('capture-classification').textContent = classification.type;
    document.getElementById('capture-suggested-entries').innerHTML = renderSuggestedEntries(classification);
  };
  reader.readAsDataURL(file);
}

// ===== OCR with Tesseract.js =====
async function initTesseract() {
  if (tesseractReady) return;
  try {
    tesseractWorker = await Tesseract.createWorker('por+eng+spa', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          const el = document.getElementById('capture-ocr-text');
          if (el && el.textContent.startsWith(t('processing'))) {
            el.textContent = t('processing') + ' ' + pct + '%';
          }
        }
      }
    });
    tesseractReady = true;
  } catch (e) {
    console.error('Tesseract init failed:', e);
  }
}

async function runOCR(imageData) {
  await initTesseract();
  if (!tesseractWorker) return '';
  try {
    const { data: { text } } = await tesseractWorker.recognize(imageData);
    return text.trim();
  } catch (e) {
    console.error('OCR error:', e);
    return '';
  }
}

// ===== Document Classification =====
function classifyDocument(text) {
  if (!text) return { type: 'unknown', entries: [] };
  const lower = text.toLowerCase();

  // NF-e / Nota Fiscal detection
  if (lower.includes('nota fiscal') || lower.includes('nf-e') || lower.includes('danfe') || lower.includes('chave de acesso')) {
    return classifyNFe(text);
  }
  // Receipt / Recibo
  if (lower.includes('recibo') || lower.includes('receipt') || lower.includes('recibido')) {
    return classifyReceipt(text);
  }
  // Bank statement
  if (lower.includes('extrato') || lower.includes('bank statement') || lower.includes('saldo anterior') || lower.includes('estado de cuenta')) {
    return { type: 'Bank Statement / Extrato Bancario', entries: [] };
  }
  // Invoice / Fatura
  if (lower.includes('fatura') || lower.includes('invoice') || lower.includes('factura') || lower.includes('vencimento')) {
    return classifyInvoice(text);
  }
  // Payment voucher
  if (lower.includes('comprovante') || lower.includes('pagamento') || lower.includes('payment') || lower.includes('pago')) {
    return classifyPayment(text);
  }
  return { type: 'General Document / Documento Geral', entries: [] };
}

function classifyNFe(text) {
  const amount = extractAmount(text);
  return {
    type: 'Nota Fiscal (NF-e)',
    entries: [{
      description: 'NF-e - Compra de Mercadorias',
      debitCode: '1.1.3.01',
      creditCode: '2.1.1.01',
      amount: amount
    }]
  };
}

function classifyReceipt(text) {
  const amount = extractAmount(text);
  return {
    type: 'Receipt / Recibo',
    entries: [{
      description: 'Recibo - Pagamento',
      debitCode: '6.1.1.05',
      creditCode: '1.1.1.01',
      amount: amount
    }]
  };
}

function classifyInvoice(text) {
  const amount = extractAmount(text);
  return {
    type: 'Invoice / Fatura',
    entries: [{
      description: 'Fatura - Despesa',
      debitCode: '6.1.1.05',
      creditCode: '2.1.1.01',
      amount: amount
    }]
  };
}

function classifyPayment(text) {
  const amount = extractAmount(text);
  return {
    type: 'Payment / Comprovante',
    entries: [{
      description: 'Comprovante de Pagamento',
      debitCode: '2.1.1.01',
      creditCode: '1.1.1.02',
      amount: amount
    }]
  };
}

function extractAmount(text) {
  // Try to find monetary values like R$ 1.234,56 or 1234.56 or $ 100.00
  const patterns = [
    /R\$\s*([\d.,]+)/i,
    /(?:valor|total|amount|importe|value)[:\s]*R?\$?\s*([\d.,]+)/i,
    /(?:[\d.]+,\d{2})/,
    /\$\s*([\d.,]+)/
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = m[1] || m[0];
      return parseNum(val);
    }
  }
  return 0;
}

function renderSuggestedEntries(classification) {
  if (!classification.entries || classification.entries.length === 0) {
    return `<p style="color:var(--text-muted);">No entries suggested. Create manually.</p>`;
  }
  let html = '<table><thead><tr><th>Description</th><th>Debit</th><th>Credit</th><th class="num">Amount</th><th></th></tr></thead><tbody>';
  for (const e of classification.entries) {
    html += `<tr>
      <td><input type="text" class="sug-desc" value="${e.description}" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;"></td>
      <td><input type="text" class="sug-debit" value="${e.debitCode}" style="width:100px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;"></td>
      <td><input type="text" class="sug-credit" value="${e.creditCode}" style="width:100px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;"></td>
      <td class="num"><input type="text" class="sug-amount" value="${fmt(e.amount)}" style="width:100px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;text-align:right;"></td>
      <td><button class="btn btn-primary btn-sm" onclick="createEntryFromSuggestion(this)">&#10003;</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

async function createEntryFromSuggestion(btn) {
  const tr = btn.closest('tr');
  const desc = tr.querySelector('.sug-desc').value;
  const debitCode = tr.querySelector('.sug-debit').value;
  const creditCode = tr.querySelector('.sug-credit').value;
  const amount = parseNum(tr.querySelector('.sug-amount').value);

  if (!desc || !debitCode || !creditCode || !amount) {
    toast(t('fillAllFields'), 'error');
    return;
  }

  allAccounts = await getCompanyAccounts();
  const debitAcct = allAccounts.find(a => a.code === debitCode);
  const creditAcct = allAccounts.find(a => a.code === creditCode);
  if (!debitAcct || !creditAcct) {
    toast('Account not found: ' + (!debitAcct ? debitCode : creditCode), 'error');
    return;
  }

  const entryId = await dbAdd('entries', {
    date: today(), description: desc, reference: '', source: 'camera',
    currency: 'BRL', exchangeRate: 1, status: 'posted',
    companyId: currentCompanyId, createdAt: new Date().toISOString()
  });
  await dbAdd('lines', {
    entryId, accountId: debitAcct.id, accountCode: debitCode,
    debit: amount, credit: 0, debitBase: amount, creditBase: 0, memo: ''
  });
  await dbAdd('lines', {
    entryId, accountId: creditAcct.id, accountCode: creditCode,
    debit: 0, credit: amount, debitBase: 0, creditBase: amount, memo: ''
  });

  // Save image as attachment
  if (capturedImageData) {
    await dbAdd('attachments', {
      entryId, filename: 'capture_' + Date.now() + '.jpg',
      data: capturedImageData, createdAt: new Date().toISOString()
    });
  }

  toast(t('entryPosted'), 'success');
  btn.textContent = '✓';
  btn.disabled = true;
}

// ===== Attachment Management =====
async function getEntryAttachments(entryId) {
  return await dbGetByIndex('attachments', 'entryId', entryId) || [];
}

async function addAttachmentToEntry(entryId, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      await dbAdd('attachments', {
        entryId,
        filename: file.name,
        data: e.target.result,
        createdAt: new Date().toISOString()
      });
      resolve();
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderAttachments(attachments) {
  if (!attachments || attachments.length === 0) return `<p style="color:var(--text-muted);">${t('noAttachments')}</p>`;
  let html = '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  for (const a of attachments) {
    if (a.data.startsWith('data:image')) {
      html += `<div style="border:1px solid var(--border);border-radius:var(--radius);padding:4px;max-width:150px;">
        <img src="${a.data}" style="max-width:100%;border-radius:4px;" title="${a.filename}">
        <p style="font-size:0.7rem;color:var(--text-muted);text-align:center;margin-top:2px;">${a.filename}</p>
      </div>`;
    } else {
      html += `<div style="border:1px solid var(--border);border-radius:var(--radius);padding:8px;">
        <p style="font-size:0.8rem;">${a.filename}</p>
      </div>`;
    }
  }
  html += '</div>';
  return html;
}
