/* ===== NF-e XML Import ===== */

let parsedNFe = null;

function handleNFeFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(e.target.result, 'text/xml');
      parsedNFe = parseNFeXML(xml);
      renderNFePreview(parsedNFe);
    } catch (err) {
      toast(t('invalidFile'), 'error');
    }
  };
  reader.readAsText(file);
}

function parseNFeXML(xml) {
  const ns = 'http://www.portalfiscal.inf.br/nfe';
  const q = (parent, tag) => {
    const el = parent.getElementsByTagNameNS(ns, tag)[0] || parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  };
  const qAll = (parent, tag) => {
    const els = parent.getElementsByTagNameNS(ns, tag);
    return els.length ? els : parent.getElementsByTagName(tag);
  };

  const infNFe = xml.getElementsByTagNameNS(ns, 'infNFe')[0] || xml.getElementsByTagName('infNFe')[0];
  if (!infNFe) {
    // Try procNFe wrapper
    const proc = xml.getElementsByTagNameNS(ns, 'nfeProc')[0] || xml.getElementsByTagName('nfeProc')[0];
    if (proc) {
      const inner = proc.getElementsByTagNameNS(ns, 'infNFe')[0] || proc.getElementsByTagName('infNFe')[0];
      if (inner) return parseInfNFe(inner, q, qAll, ns);
    }
    throw new Error('infNFe not found');
  }
  return parseInfNFe(infNFe, q, qAll, ns);
}

function parseInfNFe(infNFe, q, qAll, ns) {
  const ide = infNFe.getElementsByTagNameNS(ns, 'ide')[0] || infNFe.getElementsByTagName('ide')[0];
  const emit = infNFe.getElementsByTagNameNS(ns, 'emit')[0] || infNFe.getElementsByTagName('emit')[0];
  const dest = infNFe.getElementsByTagNameNS(ns, 'dest')[0] || infNFe.getElementsByTagName('dest')[0];
  const total = infNFe.getElementsByTagNameNS(ns, 'total')[0] || infNFe.getElementsByTagName('total')[0];
  const icmsTot = total ? (total.getElementsByTagNameNS(ns, 'ICMSTot')[0] || total.getElementsByTagName('ICMSTot')[0]) : null;

  const nfeNumber = ide ? q(ide, 'nNF') : '';
  const serie = ide ? q(ide, 'serie') : '';
  const dhEmi = ide ? (q(ide, 'dhEmi') || q(ide, 'dEmi')) : '';
  const natOp = ide ? q(ide, 'natOp') : '';
  const tpNF = ide ? q(ide, 'tpNF') : ''; // 0=entrada, 1=saida

  const emitName = emit ? (q(emit, 'xFant') || q(emit, 'xNome')) : '';
  const emitCNPJ = emit ? q(emit, 'CNPJ') : '';
  const destName = dest ? (q(dest, 'xFant') || q(dest, 'xNome')) : '';
  const destCNPJ = dest ? (q(dest, 'CNPJ') || q(dest, 'CPF')) : '';

  // Totals
  const vProd = icmsTot ? parseFloat(q(icmsTot, 'vProd')) || 0 : 0;
  const vNF = icmsTot ? parseFloat(q(icmsTot, 'vNF')) || 0 : 0;
  const vICMS = icmsTot ? parseFloat(q(icmsTot, 'vICMS')) || 0 : 0;
  const vPIS = icmsTot ? parseFloat(q(icmsTot, 'vPIS')) || 0 : 0;
  const vCOFINS = icmsTot ? parseFloat(q(icmsTot, 'vCOFINS')) || 0 : 0;
  const vIPI = icmsTot ? parseFloat(q(icmsTot, 'vIPI')) || 0 : 0;
  const vFrete = icmsTot ? parseFloat(q(icmsTot, 'vFrete')) || 0 : 0;
  const vDesc = icmsTot ? parseFloat(q(icmsTot, 'vDesc')) || 0 : 0;

  // Items
  const detEls = qAll(infNFe, 'det');
  const items = [];
  for (let i = 0; i < detEls.length; i++) {
    const det = detEls[i];
    const prod = det.getElementsByTagNameNS(ns, 'prod')[0] || det.getElementsByTagName('prod')[0];
    if (prod) {
      items.push({
        code: q(prod, 'cProd'),
        name: q(prod, 'xProd'),
        ncm: q(prod, 'NCM'),
        cfop: q(prod, 'CFOP'),
        qty: parseFloat(q(prod, 'qCom')) || 0,
        unit: q(prod, 'uCom'),
        unitPrice: parseFloat(q(prod, 'vUnCom')) || 0,
        total: parseFloat(q(prod, 'vProd')) || 0
      });
    }
  }

  // Parse date
  let isoDate = '';
  if (dhEmi) {
    isoDate = dhEmi.slice(0, 10);
  }

  return {
    number: nfeNumber, serie, date: isoDate, natOp, tpNF,
    emitName, emitCNPJ, destName, destCNPJ,
    vProd, vNF, vICMS, vPIS, vCOFINS, vIPI, vFrete, vDesc,
    items
  };
}

async function renderNFePreview(nfe) {
  const container = document.getElementById('nfe-preview');
  container.style.display = 'block';
  const isEntrada = nfe.tpNF === '0';
  const direction = isEntrada ? 'Entrada (Purchase)' : 'Saida (Sale)';

  let itemRows = '';
  for (const item of nfe.items) {
    itemRows += `<tr><td>${item.code}</td><td>${item.name}</td><td>${item.ncm}</td><td>${item.cfop}</td><td class="num">${item.qty} ${item.unit}</td><td class="num">${fmt(item.unitPrice)}</td><td class="num">${fmt(item.total)}</td></tr>`;
  }

  container.innerHTML = `
    <h3>${t('nfeDetails')}</h3>
    <div class="form-row" style="margin-bottom:12px;">
      <div><strong>${t('nfeNumber')}:</strong> ${nfe.number} (Serie ${nfe.serie})</div>
      <div><strong>${t('issueDate')}:</strong> ${nfe.date}</div>
      <div><strong>Tipo:</strong> ${direction}</div>
    </div>
    <div class="form-row" style="margin-bottom:12px;">
      <div><strong>${t('issuer')}:</strong> ${nfe.emitName} (${nfe.emitCNPJ})</div>
      <div><strong>${t('recipient')}:</strong> ${nfe.destName} (${nfe.destCNPJ})</div>
    </div>
    <div class="form-row" style="margin-bottom:12px;">
      <div><strong>${t('totalValue')}:</strong> R$ ${fmt(nfe.vNF)}</div>
      <div><strong>Produtos:</strong> R$ ${fmt(nfe.vProd)}</div>
    </div>
    <div style="margin-bottom:12px;">
      <strong>${t('taxes')}:</strong> ICMS: ${fmt(nfe.vICMS)} | PIS: ${fmt(nfe.vPIS)} | COFINS: ${fmt(nfe.vCOFINS)} | IPI: ${fmt(nfe.vIPI)}
    </div>
    <h3>${t('items')} (${nfe.items.length})</h3>
    <div class="table-wrap" style="max-height:200px;margin-bottom:12px;">
      <table><thead><tr><th>Cod</th><th>Produto</th><th>NCM</th><th>CFOP</th><th class="num">Qtd</th><th class="num">Vlr Unit</th><th class="num">Total</th></tr></thead>
      <tbody>${itemRows}</tbody></table>
    </div>
    <h3>Lancamentos Sugeridos</h3>
    <div id="nfe-suggested-entries"></div>
    <div class="btn-group" style="margin-top:12px;">
      <button class="btn btn-sm" onclick="resetNFeImport()">${t('cancel')}</button>
      <button class="btn btn-primary btn-sm" onclick="createNFeEntries()">${t('createEntriesFromNFe')}</button>
    </div>
  `;

  // Render suggested entries
  const entries = await suggestNFeEntries(nfe);
  let entryHtml = '<table><thead><tr><th>Descricao</th><th>Debito</th><th>Credito</th><th class="num">Valor</th></tr></thead><tbody>';
  for (const e of entries) {
    entryHtml += `<tr><td>${e.description}</td><td>${e.debitCode} - ${e.debitName}</td><td>${e.creditCode} - ${e.creditName}</td><td class="num">${fmt(e.amount)}</td></tr>`;
  }
  entryHtml += '</tbody></table>';
  document.getElementById('nfe-suggested-entries').innerHTML = entryHtml;
}

async function suggestNFeEntries(nfe) {
  const entries = [];
  const isEntrada = nfe.tpNF === '0';

  if (isEntrada) {
    // Purchase NF-e — use auto-accounting rule if available
    const ruleEntrada = await getRuleForType('nfe_entrada');
    if (nfe.vProd > 0) {
      entries.push({ description: `NF-e ${nfe.number} - Compra Mercadorias - ${nfe.emitName}`, debitCode: ruleEntrada?.debitCode || '1.1.3.01', debitName: 'Mercadorias para Revenda', creditCode: ruleEntrada?.creditCode || '2.1.1.01', creditName: 'Fornecedores Nacionais', amount: nfe.vProd });
    }
    if (nfe.vICMS > 0) {
      const r = await getRuleForType('nfe_icms');
      entries.push({ description: `NF-e ${nfe.number} - ICMS a Recuperar`, debitCode: r?.debitCode || '1.1.2.01', debitName: 'ICMS a Recuperar', creditCode: r?.creditCode || '2.1.1.01', creditName: 'Fornecedores Nacionais', amount: nfe.vICMS });
    }
    if (nfe.vPIS > 0) {
      const r = await getRuleForType('nfe_pis');
      entries.push({ description: `NF-e ${nfe.number} - PIS a Recuperar`, debitCode: r?.debitCode || '1.1.2.01', debitName: 'PIS a Recuperar', creditCode: r?.creditCode || '2.1.1.01', creditName: 'Fornecedores Nacionais', amount: nfe.vPIS });
    }
    if (nfe.vCOFINS > 0) {
      const r = await getRuleForType('nfe_cofins');
      entries.push({ description: `NF-e ${nfe.number} - COFINS a Recuperar`, debitCode: r?.debitCode || '1.1.2.01', debitName: 'COFINS a Recuperar', creditCode: r?.creditCode || '2.1.1.01', creditName: 'Fornecedores Nacionais', amount: nfe.vCOFINS });
    }
  } else {
    // Sale NF-e — use auto-accounting rule if available
    const ruleSaida = await getRuleForType('nfe_saida');
    if (nfe.vProd > 0) {
      entries.push({ description: `NF-e ${nfe.number} - Venda Mercadorias - ${nfe.destName}`, debitCode: ruleSaida?.debitCode || '1.1.2.01', debitName: 'Clientes Nacionais', creditCode: ruleSaida?.creditCode || '4.1.1.01', creditName: 'Venda de Mercadorias', amount: nfe.vProd });
    }
    if (nfe.vICMS > 0) {
      const r = await getRuleForType('nfe_icms');
      entries.push({ description: `NF-e ${nfe.number} - ICMS sobre Vendas`, debitCode: r?.debitCode || '6.1.1.05', debitName: 'ICMS sobre Vendas', creditCode: r?.creditCode || '2.1.2.01', creditName: 'ICMS a Pagar', amount: nfe.vICMS });
    }
    if (nfe.vPIS > 0) {
      const r = await getRuleForType('nfe_pis');
      entries.push({ description: `NF-e ${nfe.number} - PIS sobre Vendas`, debitCode: r?.debitCode || '6.1.1.05', debitName: 'PIS sobre Vendas', creditCode: r?.creditCode || '2.1.2.02', creditName: 'PIS a Pagar', amount: nfe.vPIS });
    }
    if (nfe.vCOFINS > 0) {
      const r = await getRuleForType('nfe_cofins');
      entries.push({ description: `NF-e ${nfe.number} - COFINS sobre Vendas`, debitCode: r?.debitCode || '6.1.1.05', debitName: 'COFINS sobre Vendas', creditCode: r?.creditCode || '2.1.2.03', creditName: 'COFINS a Pagar', amount: nfe.vCOFINS });
    }
  }
  return entries;
}

async function createNFeEntries() {
  if (!parsedNFe) return;
  const entries = await suggestNFeEntries(parsedNFe);
  allAccounts = await getCompanyAccounts();
  const acctByCode = {};
  for (const a of allAccounts) acctByCode[a.code] = a;

  let created = 0;
  for (const e of entries) {
    const debitAcct = acctByCode[e.debitCode];
    const creditAcct = acctByCode[e.creditCode];
    if (!debitAcct || !creditAcct) continue;

    const entryId = await dbAdd('entries', {
      date: parsedNFe.date || today(),
      description: e.description,
      reference: 'NF-e ' + parsedNFe.number,
      source: 'xml', currency: 'BRL', exchangeRate: 1,
      status: 'posted', companyId: currentCompanyId, createdAt: new Date().toISOString()
    });
    await dbAdd('lines', {
      entryId, accountId: debitAcct.id, accountCode: e.debitCode,
      debit: e.amount, credit: 0, debitBase: e.amount, creditBase: 0, memo: ''
    });
    await dbAdd('lines', {
      entryId, accountId: creditAcct.id, accountCode: e.creditCode,
      debit: 0, credit: e.amount, debitBase: 0, creditBase: e.amount, memo: ''
    });
    created++;
  }
  toast(`${t('nfeImported')} (${created})`, 'success');
  resetNFeImport();
}

function resetNFeImport() {
  parsedNFe = null;
  document.getElementById('nfe-preview').style.display = 'none';
  const input = document.getElementById('nfe-file-input');
  if (input) input.value = '';
}
