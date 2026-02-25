/* ===== WhatsApp Integration ===== */

// ===== Webhook Configuration =====
async function saveWebhookConfig() {
  const url = document.getElementById('wh-url').value.trim();
  const token = document.getElementById('wh-token').value.trim();
  await dbPut('settings', { key: 'webhookUrl', value: url });
  await dbPut('settings', { key: 'webhookToken', value: token });
  toast(t('settingsSaved'), 'success');
}

async function loadWebhookConfig() {
  const url = await dbGet('settings', 'webhookUrl');
  const token = await dbGet('settings', 'webhookToken');
  if (url) document.getElementById('wh-url').value = url.value || '';
  if (token) document.getElementById('wh-token').value = token.value || '';
}

// ===== Poll for Webhook Messages =====
async function pollWebhookMessages() {
  const urlSetting = await dbGet('settings', 'webhookUrl');
  if (!urlSetting || !urlSetting.value) return;
  try {
    const resp = await fetch(urlSetting.value + '/messages', {
      headers: { 'Authorization': 'Bearer ' + ((await dbGet('settings', 'webhookToken'))?.value || '') }
    });
    if (resp.ok) {
      const messages = await resp.json();
      if (Array.isArray(messages) && messages.length > 0) {
        for (const msg of messages) {
          await processWhatsAppMessage(msg);
        }
        toast(`${messages.length} WhatsApp messages processed.`, 'success');
      }
    }
  } catch (e) {
    // Silently fail for background polling
    console.log('Webhook poll failed:', e.message);
  }
}

// ===== Process WhatsApp Message =====
async function processWhatsAppMessage(msg) {
  const text = msg.text || msg.body || msg.message || '';
  const imageData = msg.image || msg.media || null;
  const sender = msg.from || msg.sender || 'WhatsApp';
  const timestamp = msg.timestamp || new Date().toISOString();

  if (imageData) {
    // Process image with OCR
    const ocrText = await runOCR(imageData);
    const classification = classifyDocument(ocrText);
    if (classification.entries.length > 0) {
      for (const entry of classification.entries) {
        await createEntryFromWhatsApp(entry, sender, timestamp, imageData);
      }
    }
  } else if (text) {
    // Try to parse text as transaction
    const parsed = parseWhatsAppText(text);
    if (parsed) {
      await createEntryFromWhatsApp(parsed, sender, timestamp, null);
    }
  }
}

function parseWhatsAppText(text) {
  // Try patterns like:
  // "Pagamento R$ 500,00 para Fornecedor X"
  // "Venda R$ 1.000,00 cliente Y"
  // "Despesa R$ 200,00 aluguel"
  const lower = text.toLowerCase();
  const amount = extractAmount(text);
  if (!amount) return null;

  let description = text.slice(0, 100);
  let debitCode, creditCode;

  if (lower.includes('pagamento') || lower.includes('pago') || lower.includes('payment')) {
    debitCode = '2.1.1.01'; creditCode = '1.1.1.02';
    description = 'WhatsApp: ' + description;
  } else if (lower.includes('venda') || lower.includes('sale') || lower.includes('recebimento') || lower.includes('received')) {
    debitCode = '1.1.1.02'; creditCode = '4.1.1.01';
    description = 'WhatsApp: ' + description;
  } else if (lower.includes('compra') || lower.includes('purchase') || lower.includes('comprado')) {
    debitCode = '1.1.3.01'; creditCode = '2.1.1.01';
    description = 'WhatsApp: ' + description;
  } else if (lower.includes('despesa') || lower.includes('expense') || lower.includes('gasto')) {
    debitCode = '6.1.1.05'; creditCode = '1.1.1.01';
    description = 'WhatsApp: ' + description;
  } else {
    return null;
  }

  return { description, debitCode, creditCode, amount };
}

async function createEntryFromWhatsApp(entry, sender, timestamp, imageData) {
  allAccounts = await dbGetAll('accounts');
  const debitAcct = allAccounts.find(a => a.code === entry.debitCode);
  const creditAcct = allAccounts.find(a => a.code === entry.creditCode);
  if (!debitAcct || !creditAcct) return;

  const isoDate = timestamp ? timestamp.slice(0, 10) : today();
  const entryId = await dbAdd('entries', {
    date: isoDate, description: entry.description,
    reference: 'WhatsApp - ' + sender, source: 'whatsapp',
    currency: 'BRL', exchangeRate: 1, status: 'draft',
    createdAt: new Date().toISOString()
  });
  await dbAdd('lines', {
    entryId, accountId: debitAcct.id, accountCode: entry.debitCode,
    debit: entry.amount, credit: 0, debitBase: entry.amount, creditBase: 0, memo: ''
  });
  await dbAdd('lines', {
    entryId, accountId: creditAcct.id, accountCode: entry.creditCode,
    debit: 0, credit: entry.amount, debitBase: 0, creditBase: entry.amount, memo: ''
  });

  // Save image attachment if present
  if (imageData) {
    await dbAdd('attachments', {
      entryId, filename: 'whatsapp_' + Date.now() + '.jpg',
      data: imageData, createdAt: new Date().toISOString()
    });
  }
}

// ===== Manual Paste Processing =====
async function processManualPaste() {
  const text = document.getElementById('wa-paste-text').value.trim();
  const imageInput = document.getElementById('wa-paste-image');
  const resultDiv = document.getElementById('wa-paste-result');

  if (!text && (!imageInput.files || !imageInput.files[0])) {
    toast(t('fillAllFields'), 'error');
    return;
  }

  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `<p>${t('processing')}</p>`;

  let entries = [];
  let imageData = null;

  // Process image if present
  if (imageInput.files && imageInput.files[0]) {
    imageData = await readFileAsDataURL(imageInput.files[0]);
    const ocrText = await runOCR(imageData);
    const classification = classifyDocument(ocrText);
    entries = classification.entries;
    resultDiv.innerHTML = `
      <p><strong>${t('ocrResult')}:</strong></p>
      <pre style="background:var(--bg);padding:8px;border-radius:var(--radius);font-size:0.8rem;max-height:150px;overflow:auto;">${ocrText}</pre>
      <p><strong>Classification:</strong> ${classification.type}</p>
    `;
  }

  // Process text
  if (text) {
    const parsed = parseWhatsAppText(text);
    if (parsed) entries.push(parsed);
  }

  if (entries.length > 0) {
    let html = resultDiv.innerHTML + '<h3 style="margin-top:12px;">Suggested Entries</h3>';
    html += '<table><thead><tr><th>Description</th><th>Debit</th><th>Credit</th><th class="num">Amount</th><th></th></tr></thead><tbody>';
    for (const e of entries) {
      html += `<tr>
        <td><input type="text" class="wa-desc" value="${e.description}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:4px;"></td>
        <td><input type="text" class="wa-debit" value="${e.debitCode}" style="width:90px;padding:4px;border:1px solid var(--border);border-radius:4px;"></td>
        <td><input type="text" class="wa-credit" value="${e.creditCode}" style="width:90px;padding:4px;border:1px solid var(--border);border-radius:4px;"></td>
        <td class="num"><input type="text" class="wa-amount" value="${fmt(e.amount)}" style="width:90px;padding:4px;border:1px solid var(--border);border-radius:4px;text-align:right;"></td>
        <td><button class="btn btn-primary btn-sm" onclick="createWAEntry(this, ${imageData ? 'true' : 'false'})">&#10003;</button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    resultDiv.innerHTML = html;
  } else {
    resultDiv.innerHTML += '<p style="color:var(--text-muted);margin-top:8px;">Could not identify a transaction. Create entry manually.</p>';
  }
}

async function createWAEntry(btn, hasImage) {
  const tr = btn.closest('tr');
  const desc = tr.querySelector('.wa-desc').value;
  const debitCode = tr.querySelector('.wa-debit').value;
  const creditCode = tr.querySelector('.wa-credit').value;
  const amount = parseNum(tr.querySelector('.wa-amount').value);

  if (!desc || !debitCode || !creditCode || !amount) {
    toast(t('fillAllFields'), 'error');
    return;
  }

  allAccounts = await dbGetAll('accounts');
  const debitAcct = allAccounts.find(a => a.code === debitCode);
  const creditAcct = allAccounts.find(a => a.code === creditCode);
  if (!debitAcct || !creditAcct) {
    toast('Account not found.', 'error');
    return;
  }

  const entryId = await dbAdd('entries', {
    date: today(), description: desc, reference: 'WhatsApp',
    source: 'whatsapp', currency: 'BRL', exchangeRate: 1,
    status: 'posted', createdAt: new Date().toISOString()
  });
  await dbAdd('lines', {
    entryId, accountId: debitAcct.id, accountCode: debitCode,
    debit: amount, credit: 0, debitBase: amount, creditBase: 0, memo: ''
  });
  await dbAdd('lines', {
    entryId, accountId: creditAcct.id, accountCode: creditCode,
    debit: 0, credit: amount, debitBase: 0, creditBase: amount, memo: ''
  });

  // Attach image if present
  if (hasImage) {
    const imageInput = document.getElementById('wa-paste-image');
    if (imageInput.files && imageInput.files[0]) {
      await addAttachmentToEntry(entryId, imageInput.files[0]);
    }
  }

  toast(t('entryPosted'), 'success');
  btn.textContent = '✓';
  btn.disabled = true;
}

// ===== Message as Source =====
async function processMessageAsEntry() {
  const text = document.getElementById('msg-entry-text').value.trim();
  if (!text) { toast(t('fillAllFields'), 'error'); return; }

  const parsed = parseWhatsAppText(text);
  const resultDiv = document.getElementById('msg-entry-result');
  resultDiv.style.display = 'block';

  if (parsed) {
    resultDiv.innerHTML = `
      <table><thead><tr><th>Description</th><th>Debit</th><th>Credit</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      <tr>
        <td><input type="text" class="wa-desc" value="${parsed.description}" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:4px;"></td>
        <td><input type="text" class="wa-debit" value="${parsed.debitCode}" style="width:90px;padding:4px;border:1px solid var(--border);border-radius:4px;"></td>
        <td><input type="text" class="wa-credit" value="${parsed.creditCode}" style="width:90px;padding:4px;border:1px solid var(--border);border-radius:4px;"></td>
        <td class="num"><input type="text" class="wa-amount" value="${fmt(parsed.amount)}" style="width:90px;padding:4px;border:1px solid var(--border);border-radius:4px;text-align:right;"></td>
        <td><button class="btn btn-primary btn-sm" onclick="createWAEntry(this, false)">&#10003;</button></td>
      </tr></tbody></table>
    `;
  } else {
    resultDiv.innerHTML = '<p style="color:var(--text-muted);">Could not parse message. Use keywords: pagamento, venda, compra, despesa with a monetary value.</p>';
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
