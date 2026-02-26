/* ===== GENERAL LEDGER APP — Core Logic ===== */

let db = null;
let allAccounts = [];
let currentViewEntryId = null;
let currentCompanyId = null;

// ===== Utility =====
function fmt(n) { return (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function parseNum(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}
function today() { return new Date().toISOString().slice(0, 10); }
function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = type + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}
function typeLabel(tp) {
  const map = { ativo: 'asset', passivo: 'liability', pl: 'equityType', receita: 'revenueType', custo: 'costType', despesa: 'expenseType' };
  return t(map[tp] || tp);
}
function accountNature(type) { return ['ativo', 'custo', 'despesa'].includes(type) ? 'debit' : 'credit'; }
function ruleTypeLabel(rt) {
  const map = { pagamento:'ruleTypePagamento', recebimento:'ruleTypeRecebimento', venda:'ruleTypeVenda', compra:'ruleTypeCompra', despesa:'ruleTypeDespesa', salario:'ruleTypeSalario', aluguel:'ruleTypeAluguel', bancaria:'ruleTypeBancaria', nfe_entrada:'ruleTypeNfeEntrada', nfe_saida:'ruleTypeNfeSaida', nfe_icms:'ruleTypeNfeIcms', nfe_pis:'ruleTypeNfePis', nfe_cofins:'ruleTypeNfeCofins' };
  return t(map[rt] || rt);
}

// ===== Theme Toggle =====
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('gl_theme', next);
  document.getElementById('theme-toggle').innerHTML = next === 'dark' ? '&#9788;' : '&#9790;';
}
function applyTheme() {
  const saved = localStorage.getItem('gl_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-toggle').innerHTML = saved === 'dark' ? '&#9788;' : '&#9790;';
}

// ===== IndexedDB =====
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('GeneralLedgerDB', 3);
    req.onerror = () => { document.getElementById('db-status').className = 'err'; document.getElementById('db-status').textContent = t('dbError'); reject(req.error); };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      const oldVer = e.oldVersion;
      if (!d.objectStoreNames.contains('accounts')) {
        const accts = d.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
        accts.createIndex('code', 'code'); accts.createIndex('parentCode', 'parentCode'); accts.createIndex('type', 'type'); accts.createIndex('companyId', 'companyId');
      }
      if (!d.objectStoreNames.contains('entries')) {
        const entries = d.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        entries.createIndex('date', 'date'); entries.createIndex('status', 'status'); entries.createIndex('companyId', 'companyId');
      }
      if (!d.objectStoreNames.contains('lines')) {
        const lines = d.createObjectStore('lines', { keyPath: 'id', autoIncrement: true });
        lines.createIndex('entryId', 'entryId'); lines.createIndex('accountId', 'accountId');
      }
      if (!d.objectStoreNames.contains('currencies')) {
        const cur = d.createObjectStore('currencies', { keyPath: 'id', autoIncrement: true });
        cur.createIndex('code', 'code');
      }
      if (!d.objectStoreNames.contains('settings')) { d.createObjectStore('settings', { keyPath: 'key' }); }
      if (!d.objectStoreNames.contains('users')) {
        const users = d.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
        users.createIndex('username', 'username', { unique: true });
      }
      if (!d.objectStoreNames.contains('attachments')) {
        const att = d.createObjectStore('attachments', { keyPath: 'id', autoIncrement: true });
        att.createIndex('entryId', 'entryId');
      }
      // v3: companies + rules stores
      if (!d.objectStoreNames.contains('companies')) {
        d.createObjectStore('companies', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('rules')) {
        const rules = d.createObjectStore('rules', { keyPath: 'id', autoIncrement: true });
        rules.createIndex('companyId', 'companyId'); rules.createIndex('transactionType', 'transactionType');
      }
      // Add companyId index to existing stores if upgrading from v2
      if (oldVer < 3) {
        const tx = e.target.transaction;
        if (d.objectStoreNames.contains('accounts')) {
          const as = tx.objectStore('accounts');
          if (!as.indexNames.contains('companyId')) as.createIndex('companyId', 'companyId');
        }
        if (d.objectStoreNames.contains('entries')) {
          const es = tx.objectStore('entries');
          if (!es.indexNames.contains('companyId')) es.createIndex('companyId', 'companyId');
        }
      }
    };
    req.onsuccess = () => { db = req.result; document.getElementById('db-status').className = 'ok'; document.getElementById('db-status').textContent = t('dbOk'); resolve(db); };
  });
}

function dbTx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function dbGet(store, key) { return new Promise((res, rej) => { const r = dbTx(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function dbGetAll(store) { return new Promise((res, rej) => { const r = dbTx(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function dbAdd(store, data) { return new Promise((res, rej) => { const r = dbTx(store, 'readwrite').add(data); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function dbPut(store, data) { return new Promise((res, rej) => { const r = dbTx(store, 'readwrite').put(data); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function dbDelete(store, key) { return new Promise((res, rej) => { const r = dbTx(store, 'readwrite').delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
function dbGetByIndex(store, idx, val) { return new Promise((res, rej) => { const r = dbTx(store).index(idx).getAll(val); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

// ===== Company-filtered helpers =====
async function getCompanyAccounts() { return currentCompanyId ? await dbGetByIndex('accounts', 'companyId', currentCompanyId) : await dbGetAll('accounts'); }
async function getCompanyEntries() { return currentCompanyId ? await dbGetByIndex('entries', 'companyId', currentCompanyId) : await dbGetAll('entries'); }
async function getCompanyRules() { return currentCompanyId ? await dbGetByIndex('rules', 'companyId', currentCompanyId) : await dbGetAll('rules'); }

// ===== Multi-Company =====
async function migrateToMultiCompany() {
  const companies = await dbGetAll('companies');
  if (companies.length > 0) return;
  // Create default company from existing settings
  const nameSetting = await dbGet('settings', 'companyName');
  const cName = nameSetting?.value || 'Minha Empresa';
  const companyId = await dbAdd('companies', { name: cName, cnpj: '', baseCurrency: 'BRL', fiscalMonthStart: 1, isActive: true, createdAt: new Date().toISOString() });
  // Migrate existing accounts and entries to companyId
  const allAccts = await dbGetAll('accounts');
  for (const a of allAccts) { if (!a.companyId) { a.companyId = companyId; await dbPut('accounts', a); } }
  const allEntries = await dbGetAll('entries');
  for (const e of allEntries) { if (!e.companyId) { e.companyId = companyId; await dbPut('entries', e); } }
  // Seed default rules for this company
  await seedDefaultRules(companyId);
  currentCompanyId = companyId;
  localStorage.setItem('gl_company', String(companyId));
}

async function loadCompanySelector() {
  const companies = await dbGetAll('companies');
  const sel = document.getElementById('company-selector');
  sel.innerHTML = companies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (currentCompanyId) sel.value = currentCompanyId;
  else if (companies.length) { currentCompanyId = companies[0].id; sel.value = currentCompanyId; }
}

async function switchCompany(id) {
  currentCompanyId = parseInt(id);
  localStorage.setItem('gl_company', String(currentCompanyId));
  document.getElementById('company-selector').value = currentCompanyId;
  refreshCurrentTab();
}

// ===== Company CRUD =====
async function loadCompanyList() {
  const companies = await dbGetAll('companies');
  const tbody = document.getElementById('company-list');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const c of companies) {
    const isCurrent = c.id === currentCompanyId;
    tbody.innerHTML += `<tr${isCurrent ? ' style="background:rgba(37,99,235,.06);"' : ''}><td><strong>${c.name}</strong></td><td>${c.cnpj || '-'}</td><td>${c.baseCurrency || 'BRL'}</td><td>${isCurrent ? '<span class="status-badge status-posted">' + t('active') + '</span>' : ''}</td><td>${!isCurrent ? `<button class="btn btn-sm btn-danger" onclick="deleteCompany(${c.id})">&times;</button>` : ''}</td></tr>`;
  }
}

async function addCompany() {
  const name = document.getElementById('new-company-name').value.trim();
  const cnpj = document.getElementById('new-company-cnpj').value.trim();
  const cur = document.getElementById('new-company-currency').value.trim().toUpperCase() || 'BRL';
  if (!name) { toast(t('fillAllFields'), 'error'); return; }
  const companyId = await dbAdd('companies', { name, cnpj, baseCurrency: cur, fiscalMonthStart: 1, isActive: true, createdAt: new Date().toISOString() });
  // Seed default chart of accounts for new company
  await seedDefaults(companyId);
  // Seed default rules for new company
  await seedDefaultRules(companyId);
  document.getElementById('new-company-name').value = '';
  document.getElementById('new-company-cnpj').value = '';
  toast(t('companyCreated'), 'success');
  loadCompanyList(); loadCompanySelector();
}

async function deleteCompany(id) {
  if (!confirm(t('confirmDeleteCompany'))) return;
  const entries = await dbGetByIndex('entries', 'companyId', id);
  if (entries.length > 0) { toast(t('companyHasEntries'), 'error'); return; }
  // Delete accounts for this company
  const accts = await dbGetByIndex('accounts', 'companyId', id);
  for (const a of accts) await dbDelete('accounts', a.id);
  // Delete rules for this company
  const rules = await dbGetByIndex('rules', 'companyId', id);
  for (const r of rules) await dbDelete('rules', r.id);
  await dbDelete('companies', id);
  toast(t('companyDeleted')); loadCompanyList(); loadCompanySelector();
}

// ===== Auto-Accounting Rules =====
async function seedDefaultRules(companyId) {
  const existing = await dbGetByIndex('rules', 'companyId', companyId);
  if (existing.length > 0) return;
  const defaults = [
    { name: 'Pagamento Fornecedor', transactionType: 'pagamento', debitCode: '2.1.1.01', creditCode: '1.1.1.02' },
    { name: 'Recebimento Cliente', transactionType: 'recebimento', debitCode: '1.1.1.02', creditCode: '1.1.2.01' },
    { name: 'Venda de Mercadoria', transactionType: 'venda', debitCode: '1.1.2.01', creditCode: '4.1.1.01' },
    { name: 'Compra de Mercadoria', transactionType: 'compra', debitCode: '1.1.3.01', creditCode: '2.1.1.01' },
    { name: 'Despesa Geral', transactionType: 'despesa', debitCode: '6.1.1.05', creditCode: '1.1.1.01' },
    { name: 'Pagamento Salario', transactionType: 'salario', debitCode: '6.1.1.01', creditCode: '1.1.1.02' },
    { name: 'Pagamento Aluguel', transactionType: 'aluguel', debitCode: '6.1.1.02', creditCode: '1.1.1.02' },
    { name: 'Despesa Bancaria', transactionType: 'bancaria', debitCode: '6.1.1.06', creditCode: '1.1.1.02' },
    { name: 'NF-e Compra Mercadorias', transactionType: 'nfe_entrada', debitCode: '1.1.3.01', creditCode: '2.1.1.01' },
    { name: 'NF-e Venda Mercadorias', transactionType: 'nfe_saida', debitCode: '1.1.2.01', creditCode: '4.1.1.01' },
    { name: 'ICMS sobre Vendas', transactionType: 'nfe_icms', debitCode: '6.1.1.05', creditCode: '2.1.2.01' },
    { name: 'PIS sobre Vendas', transactionType: 'nfe_pis', debitCode: '6.1.1.05', creditCode: '2.1.2.02' },
    { name: 'COFINS sobre Vendas', transactionType: 'nfe_cofins', debitCode: '6.1.1.05', creditCode: '2.1.2.03' },
  ];
  for (const r of defaults) { r.companyId = companyId; r.isActive = true; await dbAdd('rules', r); }
}

async function getRuleForType(transactionType) {
  const rules = await getCompanyRules();
  return rules.find(r => r.transactionType === transactionType && r.isActive);
}

async function loadRulesList() {
  const rules = await getCompanyRules();
  const tbody = document.getElementById('rules-list');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const r of rules) {
    tbody.innerHTML += `<tr><td>${r.name}</td><td>${ruleTypeLabel(r.transactionType)}</td><td><code>${r.debitCode}</code></td><td><code>${r.creditCode}</code></td><td><button class="btn btn-sm btn-danger" onclick="deleteRule(${r.id})">&times;</button></td></tr>`;
  }
  if (!rules.length) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Nenhuma regra. Clique "Adicionar" para criar.</td></tr>';
}

async function addRule() {
  const name = document.getElementById('new-rule-name').value.trim();
  const type = document.getElementById('new-rule-type').value;
  const debitCode = document.getElementById('new-rule-debit').value.trim();
  const creditCode = document.getElementById('new-rule-credit').value.trim();
  if (!name || !debitCode || !creditCode) { toast(t('fillAllFields'), 'error'); return; }
  await dbAdd('rules', { name, transactionType: type, debitCode, creditCode, companyId: currentCompanyId, isActive: true });
  document.getElementById('new-rule-name').value = '';
  document.getElementById('new-rule-debit').value = '';
  document.getElementById('new-rule-credit').value = '';
  toast(t('ruleCreated'), 'success'); loadRulesList();
}

async function deleteRule(id) {
  if (!confirm(t('confirmDeleteRule'))) return;
  await dbDelete('rules', id); toast(t('ruleDeleted')); loadRulesList();
}

// ===== Seed Defaults =====
async function seedDefaults(companyId) {
  const cid = companyId || currentCompanyId;
  const existing = await dbGetByIndex('accounts', 'companyId', cid);
  if (existing.length > 0) return;
  const accts = [
    {code:'1',name:'ATIVO',type:'ativo',parentCode:'',isGroup:true},{code:'1.1',name:'ATIVO CIRCULANTE',type:'ativo',parentCode:'1',isGroup:true},{code:'1.1.1',name:'CAIXA E EQUIVALENTES',type:'ativo',parentCode:'1.1',isGroup:true},{code:'1.1.1.01',name:'Caixa Geral',type:'ativo',parentCode:'1.1.1',isGroup:false},{code:'1.1.1.02',name:'Banco c/c',type:'ativo',parentCode:'1.1.1',isGroup:false},{code:'1.1.2',name:'CONTAS A RECEBER',type:'ativo',parentCode:'1.1',isGroup:true},{code:'1.1.2.01',name:'Clientes Nacionais',type:'ativo',parentCode:'1.1.2',isGroup:false},{code:'1.1.3',name:'ESTOQUES',type:'ativo',parentCode:'1.1',isGroup:true},{code:'1.1.3.01',name:'Mercadorias para Revenda',type:'ativo',parentCode:'1.1.3',isGroup:false},{code:'1.2',name:'ATIVO NAO CIRCULANTE',type:'ativo',parentCode:'1',isGroup:true},{code:'1.2.1',name:'IMOBILIZADO',type:'ativo',parentCode:'1.2',isGroup:true},{code:'1.2.1.01',name:'Moveis e Utensilios',type:'ativo',parentCode:'1.2.1',isGroup:false},{code:'1.2.1.02',name:'Equipamentos de Informatica',type:'ativo',parentCode:'1.2.1',isGroup:false},
    {code:'2',name:'PASSIVO',type:'passivo',parentCode:'',isGroup:true},{code:'2.1',name:'PASSIVO CIRCULANTE',type:'passivo',parentCode:'2',isGroup:true},{code:'2.1.1',name:'FORNECEDORES',type:'passivo',parentCode:'2.1',isGroup:true},{code:'2.1.1.01',name:'Fornecedores Nacionais',type:'passivo',parentCode:'2.1.1',isGroup:false},{code:'2.1.2',name:'OBRIGACOES FISCAIS',type:'passivo',parentCode:'2.1',isGroup:true},{code:'2.1.2.01',name:'ICMS a Pagar',type:'passivo',parentCode:'2.1.2',isGroup:false},{code:'2.1.2.02',name:'PIS a Pagar',type:'passivo',parentCode:'2.1.2',isGroup:false},{code:'2.1.2.03',name:'COFINS a Pagar',type:'passivo',parentCode:'2.1.2',isGroup:false},{code:'2.1.3',name:'OBRIGACOES TRABALHISTAS',type:'passivo',parentCode:'2.1',isGroup:true},{code:'2.1.3.01',name:'Salarios a Pagar',type:'passivo',parentCode:'2.1.3',isGroup:false},{code:'2.2',name:'PASSIVO NAO CIRCULANTE',type:'passivo',parentCode:'2',isGroup:true},{code:'2.2.1',name:'EMPRESTIMOS LP',type:'passivo',parentCode:'2.2',isGroup:true},{code:'2.2.1.01',name:'Emprestimos Bancarios LP',type:'passivo',parentCode:'2.2.1',isGroup:false},
    {code:'3',name:'PATRIMONIO LIQUIDO',type:'pl',parentCode:'',isGroup:true},{code:'3.1',name:'CAPITAL SOCIAL',type:'pl',parentCode:'3',isGroup:true},{code:'3.1.1.01',name:'Capital Subscrito',type:'pl',parentCode:'3.1',isGroup:false},{code:'3.2',name:'RESERVAS',type:'pl',parentCode:'3',isGroup:true},{code:'3.2.1.01',name:'Reserva Legal',type:'pl',parentCode:'3.2',isGroup:false},{code:'3.3',name:'LUCROS/PREJUIZOS ACUMULADOS',type:'pl',parentCode:'3',isGroup:true},{code:'3.3.1.01',name:'Lucros Acumulados',type:'pl',parentCode:'3.3',isGroup:false},
    {code:'4',name:'RECEITAS',type:'receita',parentCode:'',isGroup:true},{code:'4.1',name:'RECEITA OPERACIONAL',type:'receita',parentCode:'4',isGroup:true},{code:'4.1.1.01',name:'Venda de Mercadorias',type:'receita',parentCode:'4.1',isGroup:false},{code:'4.1.1.02',name:'Receita de Servicos',type:'receita',parentCode:'4.1',isGroup:false},{code:'4.2',name:'OUTRAS RECEITAS',type:'receita',parentCode:'4',isGroup:true},{code:'4.2.1.01',name:'Receitas Financeiras',type:'receita',parentCode:'4.2',isGroup:false},
    {code:'5',name:'CUSTOS',type:'custo',parentCode:'',isGroup:true},{code:'5.1',name:'CUSTO MERCADORIA VENDIDA',type:'custo',parentCode:'5',isGroup:true},{code:'5.1.1.01',name:'CMV Mercadorias',type:'custo',parentCode:'5.1',isGroup:false},
    {code:'6',name:'DESPESAS',type:'despesa',parentCode:'',isGroup:true},{code:'6.1',name:'DESPESAS OPERACIONAIS',type:'despesa',parentCode:'6',isGroup:true},{code:'6.1.1.01',name:'Salarios e Ordenados',type:'despesa',parentCode:'6.1',isGroup:false},{code:'6.1.1.02',name:'Aluguel',type:'despesa',parentCode:'6.1',isGroup:false},{code:'6.1.1.03',name:'Energia Eletrica',type:'despesa',parentCode:'6.1',isGroup:false},{code:'6.1.1.04',name:'Depreciacoes',type:'despesa',parentCode:'6.1',isGroup:false},{code:'6.1.1.05',name:'Material de Escritorio',type:'despesa',parentCode:'6.1',isGroup:false},{code:'6.1.1.06',name:'Despesas Bancarias',type:'despesa',parentCode:'6.1',isGroup:false},{code:'6.2',name:'DESPESAS FINANCEIRAS',type:'despesa',parentCode:'6',isGroup:true},{code:'6.2.1.01',name:'Juros Pagos',type:'despesa',parentCode:'6.2',isGroup:false},
  ];
  for (const a of accts) { a.companyId = cid; a.currency = 'BRL'; a.active = true; await dbAdd('accounts', a); }
  // Only seed currencies/settings for first company
  const allCur = await dbGetAll('currencies');
  if (allCur.length === 0) {
    await dbAdd('currencies', { code:'BRL', name:'Real Brasileiro', rate:1, updatedAt:today() });
    await dbAdd('currencies', { code:'USD', name:'Dolar Americano', rate:5.80, updatedAt:today() });
    await dbAdd('currencies', { code:'EUR', name:'Euro', rate:6.30, updatedAt:today() });
    await dbPut('settings', { key:'companyName', value:'Minha Empresa' });
    await dbPut('settings', { key:'fiscalMonth', value:'1' });
    await dbPut('settings', { key:'baseCurrency', value:'BRL' });
  }
}

// ===== Tab Navigation =====
function switchTab(tabId) {
  if (currentUser) {
    const perms = ROLE_PERMISSIONS[currentUser.role];
    if (perms && !perms.tabs.includes(tabId)) { toast(t('accessDenied'), 'error'); return; }
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tabId));
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'accounts') loadAccountTree();
  if (tabId === 'journal') { loadAccountSelectors(); loadEntries(); }
  if (tabId === 'settings') { loadSettings(); loadUserManagement(); loadCompanyList(); loadRulesList(); }
}
function refreshCurrentTab() {
  const active = document.querySelector('.tab-btn.active');
  if (active) switchTab(active.dataset.tab);
  translatePage();
}

document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
document.querySelectorAll('.sub-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.parentElement;
    group.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const parent = btn.closest('.tab-content') || btn.closest('.card') || btn.parentElement.parentElement;
    const subId = btn.dataset.subtab;
    parent.querySelectorAll('.sub-content').forEach(c => c.classList.toggle('active', c.id === subId));
  });
});

// ===== Chart of Accounts =====
async function loadAccountTree() {
  allAccounts = await getCompanyAccounts();
  allAccounts.sort((a, b) => a.code.localeCompare(b.code));
  const filterType = document.getElementById('acct-filter-type').value;
  const search = document.getElementById('acct-search').value.toLowerCase();
  let filtered = allAccounts;
  if (filterType) filtered = filtered.filter(a => a.type === filterType);
  if (search) filtered = filtered.filter(a => a.code.includes(search) || a.name.toLowerCase().includes(search));
  const container = document.getElementById('account-tree');
  container.innerHTML = '';
  function renderLevel(parentCode, depth) {
    const children = filtered.filter(a => a.parentCode === parentCode);
    if (!children.length) return null;
    const wrapper = document.createElement('div');
    if (depth > 0) wrapper.className = 'tree-children';
    for (const acct of children) {
      const item = document.createElement('div');
      item.className = 'tree-item' + (acct.isGroup ? ' group' : '');
      item.style.paddingLeft = (12 + depth * 20) + 'px';
      const hasChildren = filtered.some(a => a.parentCode === acct.code);
      item.innerHTML = `<span class="tree-toggle">${hasChildren ? '&#9660;' : '&nbsp;'}</span><span class="code">${acct.code}</span><span class="name">${acct.name}</span><span class="type-badge type-${acct.type}">${typeLabel(acct.type)}</span><span style="display:flex;gap:4px;" class="role-edit"><button class="btn btn-sm" onclick="editAccount(${acct.id})">&#9998;</button>${!acct.isGroup ? `<button class="btn btn-sm btn-danger" onclick="deleteAccount(${acct.id})">&times;</button>` : ''}</span>`;
      if (hasChildren) {
        const toggle = item.querySelector('.tree-toggle');
        const childrenDiv = renderLevel(acct.code, depth + 1);
        toggle.style.cursor = 'pointer';
        toggle.addEventListener('click', (e) => { e.stopPropagation(); childrenDiv.classList.toggle('collapsed'); toggle.innerHTML = childrenDiv.classList.contains('collapsed') ? '&#9654;' : '&#9660;'; });
        wrapper.appendChild(item);
        if (childrenDiv) wrapper.appendChild(childrenDiv);
      } else { wrapper.appendChild(item); }
    }
    return wrapper;
  }
  const tree = renderLevel('', 0);
  if (tree) container.appendChild(tree);
  else container.innerHTML = `<p style="padding:20px;color:var(--text-muted);text-align:center;">${t('noAccountsFound')}</p>`;
  applyRolePermissions();
}
document.getElementById('acct-filter-type').addEventListener('change', loadAccountTree);
document.getElementById('acct-search').addEventListener('input', loadAccountTree);

function showAccountModal(acct) {
  document.getElementById('acct-modal-title').textContent = acct ? t('editAccount') : t('newAccountTitle');
  document.getElementById('acct-edit-id').value = acct ? acct.id : '';
  document.getElementById('acct-code').value = acct ? acct.code : '';
  document.getElementById('acct-name').value = acct ? acct.name : '';
  document.getElementById('acct-type').value = acct ? acct.type : 'ativo';
  document.getElementById('acct-parent').value = acct ? acct.parentCode : '';
  document.getElementById('acct-isgroup').value = acct ? String(acct.isGroup) : 'false';
  document.getElementById('account-modal').classList.add('show');
}
function closeAccountModal() { document.getElementById('account-modal').classList.remove('show'); }
async function saveAccount() {
  const id = document.getElementById('acct-edit-id').value;
  const data = { code: document.getElementById('acct-code').value.trim(), name: document.getElementById('acct-name').value.trim(), type: document.getElementById('acct-type').value, parentCode: document.getElementById('acct-parent').value.trim(), isGroup: document.getElementById('acct-isgroup').value === 'true', currency: 'BRL', active: true, companyId: currentCompanyId };
  if (!data.code || !data.name) { toast(t('codeNameRequired'), 'error'); return; }
  try {
    if (id) { data.id = parseInt(id); await dbPut('accounts', data); toast(t('accountUpdated')); }
    else { await dbAdd('accounts', data); toast(t('accountCreated'), 'success'); }
    closeAccountModal(); loadAccountTree();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}
async function editAccount(id) { const acct = await dbGet('accounts', id); if (acct) showAccountModal(acct); }
async function deleteAccount(id) {
  if (!confirm(t('confirmDeleteAccount'))) return;
  const lines = await dbGetByIndex('lines', 'accountId', id);
  if (lines.length > 0) { toast(t('accountHasEntries'), 'error'); return; }
  await dbDelete('accounts', id); toast(t('accountDeleted')); loadAccountTree();
}

// ===== Journal Entries =====
let jeLineCount = 0;
function buildAccountOptions() {
  return allAccounts.filter(a => !a.isGroup && a.active).map(a => `<option value="${a.id}" data-code="${a.code}">${a.code} - ${a.name}</option>`).join('');
}
async function loadAccountSelectors() {
  allAccounts = await getCompanyAccounts();
  allAccounts.sort((a, b) => a.code.localeCompare(b.code));
  const currencies = await dbGetAll('currencies');
  const curSel = document.getElementById('je-currency');
  curSel.innerHTML = currencies.map(c => `<option value="${c.code}" data-rate="${c.rate}">${c.code}</option>`).join('');
  curSel.onchange = () => {
    const opt = curSel.selectedOptions[0];
    document.getElementById('je-rate').value = opt ? opt.dataset.rate : 1;
    document.getElementById('je-rate-group').style.display = curSel.value === 'BRL' ? 'none' : 'flex';
  };
  document.getElementById('je-rate-group').style.display = 'none';
  if (!document.getElementById('je-date').value) document.getElementById('je-date').value = today();
  if (jeLineCount === 0) { addJELine(); addJELine(); }
}
function addJELine() {
  jeLineCount++;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="line-num">${jeLineCount}</td><td><select class="je-account" onchange="updateJETotals()"><option value="">${t('selectAccount')}</option>${buildAccountOptions()}</select></td><td><input type="text" class="je-debit" placeholder="0,00" oninput="updateJETotals()"></td><td><input type="text" class="je-credit" placeholder="0,00" oninput="updateJETotals()"></td><td><input type="text" class="je-memo" placeholder="${t('memo')}"></td><td><button class="btn btn-sm" onclick="removeJELine(this)">&times;</button></td>`;
  document.getElementById('je-lines-body').appendChild(tr);
}
function removeJELine(btn) {
  if (document.getElementById('je-lines-body').rows.length <= 2) { toast(t('min2Lines'), 'error'); return; }
  btn.closest('tr').remove(); updateJETotals();
}
function updateJETotals() {
  let totalD = 0, totalC = 0;
  document.querySelectorAll('#je-lines-body tr').forEach(tr => { totalD += parseNum(tr.querySelector('.je-debit').value); totalC += parseNum(tr.querySelector('.je-credit').value); });
  document.getElementById('je-total-debit').textContent = fmt(totalD);
  document.getElementById('je-total-credit').textContent = fmt(totalC);
  const diff = Math.abs(totalD - totalC);
  const msg = document.getElementById('je-balance-msg');
  if (diff < 0.005) { msg.textContent = t('balanced'); msg.style.color = 'var(--success)'; }
  else { msg.textContent = t('difference') + ' ' + fmt(diff); msg.style.color = 'var(--danger)'; }
}
async function saveJE(status) {
  const desc = document.getElementById('je-desc').value.trim();
  const date = document.getElementById('je-date').value;
  if (!desc || !date) { toast(t('dateDescRequired'), 'error'); return; }
  const currency = document.getElementById('je-currency').value;
  const rate = parseFloat(document.getElementById('je-rate').value) || 1;
  const rows = []; let totalD = 0, totalC = 0, valid = true;
  document.querySelectorAll('#je-lines-body tr').forEach(tr => {
    const accountId = parseInt(tr.querySelector('.je-account').value);
    const accountCode = tr.querySelector('.je-account').selectedOptions[0]?.dataset?.code || '';
    const debit = parseNum(tr.querySelector('.je-debit').value);
    const credit = parseNum(tr.querySelector('.je-credit').value);
    const memo = tr.querySelector('.je-memo').value.trim();
    if (!accountId && (debit || credit)) valid = false;
    if (accountId && (debit || credit)) {
      rows.push({ accountId, accountCode, debit, credit, debitBase: Math.round(debit * rate * 100) / 100, creditBase: Math.round(credit * rate * 100) / 100, memo });
      totalD += debit; totalC += credit;
    }
  });
  if (!valid) { toast(t('selectAccountForLines'), 'error'); return; }
  if (rows.length < 2) { toast(t('min2LinesWithValue'), 'error'); return; }
  if (Math.abs(totalD - totalC) > 0.005) { toast(t('entryNotBalanced'), 'error'); return; }
  const editId = document.getElementById('je-edit-id').value;
  const entryData = { date, description: desc, reference: document.getElementById('je-ref').value.trim(), source: 'manual', currency, exchangeRate: rate, status, companyId: currentCompanyId, createdAt: new Date().toISOString() };
  try {
    let entryId;
    if (editId) { entryData.id = parseInt(editId); await dbPut('entries', entryData); entryId = entryData.id; const old = await dbGetByIndex('lines', 'entryId', entryId); for (const o of old) await dbDelete('lines', o.id); }
    else { entryId = await dbAdd('entries', entryData); }
    for (const row of rows) { row.entryId = entryId; await dbAdd('lines', row); }
    const attInput = document.getElementById('je-attachment');
    if (attInput.files) { for (const f of attInput.files) await addAttachmentToEntry(entryId, f); }
    toast(status === 'posted' ? t('entryPosted') : t('draftSaved'), 'success');
    resetJEForm(); loadEntries();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}
function resetJEForm() {
  document.getElementById('je-edit-id').value = '';
  document.getElementById('je-form-title').textContent = t('newEntryTitle');
  document.getElementById('je-desc').value = ''; document.getElementById('je-ref').value = '';
  document.getElementById('je-date').value = today();
  document.getElementById('je-currency').value = 'BRL'; document.getElementById('je-rate').value = '1';
  document.getElementById('je-rate-group').style.display = 'none';
  document.getElementById('je-lines-body').innerHTML = ''; jeLineCount = 0;
  addJELine(); addJELine(); updateJETotals();
}
async function loadEntries() {
  const entries = await getCompanyEntries(); const allLines = await dbGetAll('lines');
  const from = document.getElementById('je-filter-from').value;
  const to = document.getElementById('je-filter-to').value;
  const search = document.getElementById('je-filter-search').value.toLowerCase();
  const sf = document.getElementById('je-filter-status').value;
  let filtered = entries;
  if (from) filtered = filtered.filter(e => e.date >= from);
  if (to) filtered = filtered.filter(e => e.date <= to);
  if (search) filtered = filtered.filter(e => e.description.toLowerCase().includes(search) || (e.reference || '').toLowerCase().includes(search));
  if (sf) filtered = filtered.filter(e => e.status === sf);
  filtered.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const tbody = document.getElementById('je-list');
  tbody.innerHTML = '';
  const srcLabel = { manual: t('manual'), csv: 'CSV', api: 'API', xml: 'XML', camera: t('camera'), whatsapp: 'WhatsApp', message: t('message') };
  const statusLabel = { posted: t('posted'), draft: t('draft'), reversed: t('reversed') };
  const statusClass = { posted: 'status-posted', draft: 'status-draft', reversed: 'status-reversed' };
  for (const e of filtered) {
    const lines = allLines.filter(l => l.entryId === e.id);
    const totalD = lines.reduce((s, l) => s + (l.debitBase || 0), 0);
    const totalC = lines.reduce((s, l) => s + (l.creditBase || 0), 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${e.id}</td><td>${e.date}</td><td>${e.description}</td><td>${e.reference || '-'}</td><td>${srcLabel[e.source] || e.source}</td><td class="num">${fmt(totalD)}</td><td class="num">${fmt(totalC)}</td><td>${e.currency}</td><td><span class="status-badge ${statusClass[e.status] || ''}">${statusLabel[e.status] || e.status}</span></td><td><button class="btn btn-sm" onclick="viewEntry(${e.id})">&#128065;</button>${e.status === 'draft' ? ` <button class="btn btn-sm role-edit" onclick="editEntry(${e.id})">&#9998;</button>` : ''}</td>`;
    tbody.appendChild(tr);
  }
  if (!filtered.length) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-muted);">${t('noEntriesFound')}</td></tr>`;
  applyRolePermissions();
}
async function viewEntry(id) {
  currentViewEntryId = id;
  const entry = await dbGet('entries', id);
  const lines = await dbGetByIndex('lines', 'entryId', id);
  const attachments = await getEntryAttachments(id);
  let html = `<p><strong>${t('date')}:</strong> ${entry.date} | <strong>${t('status')}:</strong> ${t(entry.status)} | <strong>${t('currency')}:</strong> ${entry.currency}${entry.exchangeRate !== 1 ? ' (' + entry.exchangeRate + ')' : ''}</p><p><strong>${t('description')}:</strong> ${entry.description}</p><p><strong>${t('reference')}:</strong> ${entry.reference || '-'} | <strong>${t('source')}:</strong> ${entry.source}</p>`;
  html += `<div class="table-wrap" style="margin-top:12px;"><table><thead><tr><th>${t('account')}</th><th class="num">${t('debit')}</th><th class="num">${t('credit')}</th><th>${t('memo')}</th></tr></thead><tbody>`;
  for (const l of lines) { const acct = allAccounts.find(a => a.id === l.accountId); html += `<tr><td>${l.accountCode} - ${acct ? acct.name : '?'}</td><td class="num">${l.debit ? fmt(l.debit) : ''}</td><td class="num">${l.credit ? fmt(l.credit) : ''}</td><td>${l.memo || ''}</td></tr>`; }
  html += '</tbody></table></div>';
  if (attachments.length) { html += `<h3 style="margin-top:12px;">${t('attachments')}</h3>${renderAttachments(attachments)}`; }
  document.getElementById('entry-modal-content').innerHTML = html;
  document.getElementById('entry-reverse-btn').style.display = entry.status === 'posted' ? '' : 'none';
  document.getElementById('entry-modal').classList.add('show');
}
function closeEntryModal() { document.getElementById('entry-modal').classList.remove('show'); }
async function reverseEntry() {
  if (!currentViewEntryId) return;
  if (!confirm(t('confirmReverse'))) return;
  const entry = await dbGet('entries', currentViewEntryId);
  const lines = await dbGetByIndex('lines', 'entryId', currentViewEntryId);
  entry.status = 'reversed'; await dbPut('entries', entry);
  const revId = await dbAdd('entries', { date: today(), description: 'ESTORNO: ' + entry.description, reference: 'EST-' + entry.id, source: 'manual', currency: entry.currency, exchangeRate: entry.exchangeRate, status: 'posted', companyId: currentCompanyId, createdAt: new Date().toISOString() });
  for (const l of lines) { await dbAdd('lines', { entryId: revId, accountId: l.accountId, accountCode: l.accountCode, debit: l.credit, credit: l.debit, debitBase: l.creditBase, creditBase: l.debitBase, memo: 'Estorno' }); }
  toast(t('entryReversed'), 'success'); closeEntryModal(); loadEntries();
}
async function editEntry(id) {
  const entry = await dbGet('entries', id); const lines = await dbGetByIndex('lines', 'entryId', id);
  document.getElementById('je-edit-id').value = id;
  document.getElementById('je-form-title').textContent = t('editAccount') + ' #' + id;
  document.getElementById('je-date').value = entry.date; document.getElementById('je-desc').value = entry.description;
  document.getElementById('je-ref').value = entry.reference || '';
  document.getElementById('je-currency').value = entry.currency; document.getElementById('je-rate').value = entry.exchangeRate;
  document.getElementById('je-rate-group').style.display = entry.currency === 'BRL' ? 'none' : 'flex';
  document.getElementById('je-lines-body').innerHTML = ''; jeLineCount = 0;
  for (const l of lines) {
    jeLineCount++;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="line-num">${jeLineCount}</td><td><select class="je-account" onchange="updateJETotals()"><option value="">${t('selectAccount')}</option>${buildAccountOptions()}</select></td><td><input type="text" class="je-debit" value="${l.debit ? fmt(l.debit) : ''}" oninput="updateJETotals()"></td><td><input type="text" class="je-credit" value="${l.credit ? fmt(l.credit) : ''}" oninput="updateJETotals()"></td><td><input type="text" class="je-memo" value="${l.memo || ''}"></td><td><button class="btn btn-sm" onclick="removeJELine(this)">&times;</button></td>`;
    document.getElementById('je-lines-body').appendChild(tr);
    tr.querySelector('.je-account').value = l.accountId;
  }
  updateJETotals(); document.getElementById('je-form-card').scrollIntoView({ behavior: 'smooth' });
}

// ===== Dashboard =====
async function loadDashboard() {
  allAccounts = await getCompanyAccounts();
  const allLines = await dbGetAll('lines');
  const entries = await getCompanyEntries();
  const postedIds = new Set(entries.filter(e => e.status === 'posted').map(e => e.id));
  const posted = allLines.filter(l => postedIds.has(l.entryId));
  const bal = { ativo: 0, passivo: 0, pl: 0, receita: 0, custo: 0, despesa: 0 };
  for (const l of posted) {
    const acct = allAccounts.find(a => a.id === l.accountId);
    if (!acct) continue;
    const n = accountNature(acct.type);
    bal[acct.type] += n === 'debit' ? (l.debitBase - l.creditBase) : (l.creditBase - l.debitBase);
  }
  const ni = bal.receita - bal.custo - bal.despesa;
  document.getElementById('dash-summary').innerHTML = `
    <div class="summary-card"><div class="label">${t('totalAssets')}</div><div class="value">${fmt(bal.ativo)}</div></div>
    <div class="summary-card"><div class="label">${t('totalLiabilities')}</div><div class="value">${fmt(bal.passivo)}</div></div>
    <div class="summary-card"><div class="label">${t('equity')}</div><div class="value">${fmt(bal.pl)}</div></div>
    <div class="summary-card"><div class="label">${t('revenue')}</div><div class="value positive">${fmt(bal.receita)}</div></div>
    <div class="summary-card"><div class="label">${t('costsExpenses')}</div><div class="value negative">${fmt(bal.custo + bal.despesa)}</div></div>
    <div class="summary-card"><div class="label">${t('netIncome')}</div><div class="value ${ni >= 0 ? 'positive' : 'negative'}">${fmt(ni)}</div></div>`;
  const recent = entries.sort((a, b) => b.id - a.id).slice(0, 10);
  const tbody = document.getElementById('dash-recent');
  tbody.innerHTML = '';
  for (const e of recent) {
    const lines = allLines.filter(l => l.entryId === e.id);
    const d = lines.reduce((s, l) => s + (l.debitBase || 0), 0);
    const c = lines.reduce((s, l) => s + (l.creditBase || 0), 0);
    tbody.innerHTML += `<tr><td>${e.date}</td><td>${e.description}</td><td>${e.reference || '-'}</td><td class="num">${fmt(d)}</td><td class="num">${fmt(c)}</td><td><span class="status-badge status-${e.status}">${t(e.status)}</span></td></tr>`;
  }
  if (!recent.length) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">${t('noEntriesYet')}</td></tr>`;
}

// ===== Reports =====
async function getReportData(from, to) {
  allAccounts = await getCompanyAccounts(); allAccounts.sort((a, b) => a.code.localeCompare(b.code));
  const entries = await getCompanyEntries(); const allLines = await dbGetAll('lines');
  const postedIds = new Set(entries.filter(e => e.status === 'posted' && (!from || e.date >= from) && (!to || e.date <= to)).map(e => e.id));
  const posted = allLines.filter(l => postedIds.has(l.entryId));
  const acctBal = {};
  for (const a of allAccounts) acctBal[a.id] = { debit: 0, credit: 0 };
  for (const l of posted) { if (!acctBal[l.accountId]) acctBal[l.accountId] = { debit: 0, credit: 0 }; acctBal[l.accountId].debit += l.debitBase || 0; acctBal[l.accountId].credit += l.creditBase || 0; }
  function getBalance(code) { let d = 0, c = 0; for (const a of allAccounts) { if ((a.code === code || a.code.startsWith(code + '.')) && !a.isGroup && acctBal[a.id]) { d += acctBal[a.id].debit; c += acctBal[a.id].credit; } } return { debit: d, credit: c }; }
  return { allAccounts, acctBal, getBalance, postedLines: posted };
}
async function generateReport() {
  const from = document.getElementById('rpt-from').value; const to = document.getElementById('rpt-to').value;
  const data = await getReportData(from, to);
  const company = (await dbGet('settings', 'companyName'))?.value || 'Empresa';
  const period = (from || '...') + ' - ' + (to || '...');
  generateBalancete(data, company, period); generateDRE(data, company, period);
  generateBalanco(data, company, period); generateFluxoCaixa(data, company, period);
  generateConsolidated(from, to);
}
function generateBalancete(data, company, period) {
  let totalD = 0, totalC = 0, rows = '';
  for (const a of data.allAccounts) { if (a.isGroup) continue; const b = data.acctBal[a.id] || { debit: 0, credit: 0 }; if (!b.debit && !b.credit) continue; const bal = accountNature(a.type) === 'debit' ? (b.debit - b.credit) : (b.credit - b.debit); totalD += b.debit; totalC += b.credit; rows += `<tr><td>${a.code}</td><td>${a.name}</td><td class="num">${fmt(b.debit)}</td><td class="num">${fmt(b.credit)}</td><td class="num">${fmt(bal)}</td></tr>`; }
  document.getElementById('rpt-balancete-content').innerHTML = `<div class="report-header"><h2>${company}</h2><p>${t('trialBalanceTitle')} — ${period}</p></div><div class="table-wrap"><table><thead><tr><th>${t('code')}</th><th>${t('account')}</th><th class="num">${t('debit')}</th><th class="num">${t('credit')}</th><th class="num">${t('balance')}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="report-total"><td colspan="2">${t('total')}</td><td class="num">${fmt(totalD)}</td><td class="num">${fmt(totalC)}</td><td class="num">${fmt(totalD - totalC)}</td></tr></tfoot></table></div><div class="btn-group no-print" style="margin-top:12px;"><button class="btn btn-sm" onclick="printReport('rpt-balancete')">${t('print')}</button><button class="btn btn-sm" onclick="exportReportCSV('balancete')">${t('exportCSV')}</button></div>`;
}
function generateDRE(data, company, period) {
  function aRows(gc, indent) { let h = ''; for (const a of data.allAccounts) { if (a.isGroup || !a.code.startsWith(gc + '.')) continue; const b = data.acctBal[a.id] || { debit: 0, credit: 0 }; if (!b.debit && !b.credit) continue; const v = accountNature(a.type) === 'debit' ? (b.debit - b.credit) : (b.credit - b.debit); h += `<tr><td class="indent-${indent}">${a.code} - ${a.name}</td><td class="num">${fmt(v)}</td></tr>`; } return h; }
  const rev = data.getBalance('4'); const totalRev = rev.credit - rev.debit;
  const cost = data.getBalance('5'); const totalCost = cost.debit - cost.credit;
  const exp = data.getBalance('6'); const totalExp = exp.debit - exp.credit;
  const gp = totalRev - totalCost; const ni = gp - totalExp;
  document.getElementById('rpt-dre-content').innerHTML = `<div class="report-header"><h2>${company}</h2><p>${t('dreTitle')} — ${period}</p></div><table><thead><tr><th>${t('description')}</th><th class="num">${t('valueBRL')}</th></tr></thead><tbody><tr class="report-section"><td colspan="2"><h3>${t('operatingRevenue')}</h3></td></tr>${aRows('4',1)}<tr class="report-total"><td>${t('totalRevenue')}</td><td class="num">${fmt(totalRev)}</td></tr><tr class="report-section"><td colspan="2"><h3>${t('costs')}</h3></td></tr>${aRows('5',1)}<tr class="report-total"><td>${t('totalCosts')}</td><td class="num">(${fmt(totalCost)})</td></tr><tr class="report-grand-total"><td>${t('grossProfit')}</td><td class="num">${fmt(gp)}</td></tr><tr class="report-section"><td colspan="2"><h3>${t('operatingExpenses')}</h3></td></tr>${aRows('6',1)}<tr class="report-total"><td>${t('totalExpenses')}</td><td class="num">(${fmt(totalExp)})</td></tr><tr class="report-grand-total"><td>${t('netResult')}</td><td class="num" style="color:${ni>=0?'var(--success)':'var(--danger)'}">${fmt(ni)}</td></tr></tbody></table><div class="btn-group no-print" style="margin-top:12px;"><button class="btn btn-sm" onclick="printReport('rpt-dre')">${t('print')}</button><button class="btn btn-sm" onclick="exportReportCSV('dre')">${t('exportCSV')}</button></div>`;
}
function generateBalanco(data, company, period) {
  function gRows(parentCodes) { let h = ''; for (const pc of parentCodes) { const p = data.allAccounts.find(a => a.code === pc); if (!p) continue; const ch = data.allAccounts.filter(a => !a.isGroup && a.code.startsWith(pc + '.')); if (!ch.some(a => { const b = data.acctBal[a.id] || { debit: 0, credit: 0 }; return b.debit || b.credit; })) continue; const gb = data.getBalance(pc); const n = accountNature(p.type); const gv = n === 'debit' ? (gb.debit - gb.credit) : (gb.credit - gb.debit); h += `<tr style="font-weight:600;"><td class="indent-1">${p.name}</td><td class="num">${fmt(gv)}</td></tr>`; for (const a of ch) { const b = data.acctBal[a.id] || { debit: 0, credit: 0 }; if (!b.debit && !b.credit) continue; const v = n === 'debit' ? (b.debit - b.credit) : (b.credit - b.debit); h += `<tr><td class="indent-2">${a.code} - ${a.name}</td><td class="num">${fmt(v)}</td></tr>`; } } return h; }
  const ab = data.getBalance('1'); const ta = ab.debit - ab.credit;
  const pb = data.getBalance('2'); const tp = pb.credit - pb.debit;
  const plb = data.getBalance('3'); const tpl = plb.credit - plb.debit;
  const rev = data.getBalance('4'); const cost = data.getBalance('5'); const exp = data.getBalance('6');
  const ni = (rev.credit - rev.debit) - (cost.debit - cost.credit) - (exp.debit - exp.credit);
  const tplni = tpl + ni; const total = tp + tplni;
  const ag = data.allAccounts.filter(a => a.isGroup && a.type === 'ativo' && a.parentCode === '1').map(a => a.code);
  const pg = data.allAccounts.filter(a => a.isGroup && a.type === 'passivo' && a.parentCode === '2').map(a => a.code);
  const plg = data.allAccounts.filter(a => a.isGroup && a.type === 'pl' && a.parentCode === '3').map(a => a.code);
  const closed = Math.abs(ta - total) < 0.01;
  document.getElementById('rpt-balanco-content').innerHTML = `<div class="report-header"><h2>${company}</h2><p>${t('balanceSheetTitle')} — ${period}</p></div><table><thead><tr><th>${t('description')}</th><th class="num">${t('valueBRL')}</th></tr></thead><tbody><tr class="report-section"><td colspan="2"><h3>${t('assets')}</h3></td></tr>${gRows(ag)}<tr class="report-grand-total"><td>${t('totalAsset')}</td><td class="num">${fmt(ta)}</td></tr><tr class="report-section"><td colspan="2"><h3>${t('liabilities')}</h3></td></tr>${gRows(pg)}<tr class="report-total"><td>${t('totalLiability')}</td><td class="num">${fmt(tp)}</td></tr><tr class="report-section"><td colspan="2"><h3>${t('equitySection')}</h3></td></tr>${gRows(plg)}<tr><td class="indent-1">${t('periodResult')}</td><td class="num">${fmt(ni)}</td></tr><tr class="report-total"><td>${t('totalEquity')}</td><td class="num">${fmt(tplni)}</td></tr><tr class="report-grand-total"><td>${t('totalLiabPlusEquity')}</td><td class="num">${fmt(total)}</td></tr></tbody></table><p style="margin-top:8px;font-size:.85rem;color:${closed?'var(--success)':'var(--danger)'}">${closed ? t('balanceClosed') : t('balanceNotClosed') + ' ' + fmt(ta - total)}</p><div class="btn-group no-print" style="margin-top:12px;"><button class="btn btn-sm" onclick="printReport('rpt-balanco')">${t('print')}</button><button class="btn btn-sm" onclick="exportReportCSV('balanco')">${t('exportCSV')}</button></div>`;
}
function generateFluxoCaixa(data, company, period) {
  const gb = data.getBalance; const rev = gb('4'); const cost = gb('5'); const exp = gb('6');
  const ni = (rev.credit - rev.debit) - (cost.debit - cost.credit) - (exp.debit - exp.credit);
  const dep = gb('6.1.1.04'); const dv = dep.debit - dep.credit;
  const cl = gb('1.1.2'); const es = gb('1.1.3'); const fo = gb('2.1.1'); const ob = gb('2.1.2'); const tr2 = gb('2.1.3');
  const op = ni + dv + (-(cl.debit - cl.credit)) + (-(es.debit - es.credit)) + (fo.credit - fo.debit) + (ob.credit - ob.debit) + (tr2.credit - tr2.debit);
  const im = gb('1.2'); const inv = -(im.debit - im.credit) + dv;
  const em = gb('2.2'); const ca = gb('3.1'); const fin = (em.credit - em.debit) + (ca.credit - ca.debit);
  const tot = op + inv + fin;
  document.getElementById('rpt-fluxo-content').innerHTML = `<div class="report-header"><h2>${company}</h2><p>${t('cashFlowTitle')} — ${period}</p></div><table><thead><tr><th>${t('description')}</th><th class="num">${t('valueBRL')}</th></tr></thead><tbody><tr class="report-section"><td colspan="2"><h3>${t('operatingActivities')}</h3></td></tr><tr><td class="indent-1">${t('netResultPeriod')}</td><td class="num">${fmt(ni)}</td></tr><tr><td class="indent-1">${t('depreciation')}</td><td class="num">${fmt(dv)}</td></tr><tr><td class="indent-1">${t('clientsVariation')}</td><td class="num">${fmt(-(cl.debit - cl.credit))}</td></tr><tr><td class="indent-1">${t('inventoryVariation')}</td><td class="num">${fmt(-(es.debit - es.credit))}</td></tr><tr><td class="indent-1">${t('suppliersVariation')}</td><td class="num">${fmt(fo.credit - fo.debit)}</td></tr><tr><td class="indent-1">${t('taxVariation')}</td><td class="num">${fmt(ob.credit - ob.debit)}</td></tr><tr><td class="indent-1">${t('laborVariation')}</td><td class="num">${fmt(tr2.credit - tr2.debit)}</td></tr><tr class="report-total"><td>${t('operatingCash')}</td><td class="num">${fmt(op)}</td></tr><tr class="report-section"><td colspan="2"><h3>${t('investingActivities')}</h3></td></tr><tr><td class="indent-1">${t('fixedAssetVariation')}</td><td class="num">${fmt(inv)}</td></tr><tr class="report-total"><td>${t('investingCash')}</td><td class="num">${fmt(inv)}</td></tr><tr class="report-section"><td colspan="2"><h3>${t('financingActivities')}</h3></td></tr><tr><td class="indent-1">${t('loansVariation')}</td><td class="num">${fmt(em.credit - em.debit)}</td></tr><tr><td class="indent-1">${t('capitalVariation')}</td><td class="num">${fmt(ca.credit - ca.debit)}</td></tr><tr class="report-total"><td>${t('financingCash')}</td><td class="num">${fmt(fin)}</td></tr><tr class="report-grand-total"><td>${t('netCashVariation')}</td><td class="num" style="color:${tot>=0?'var(--success)':'var(--danger)'}">${fmt(tot)}</td></tr></tbody></table><div class="btn-group no-print" style="margin-top:12px;"><button class="btn btn-sm" onclick="printReport('rpt-fluxo')">${t('print')}</button><button class="btn btn-sm" onclick="exportReportCSV('fluxo')">${t('exportCSV')}</button></div>`;
}

// ===== Consolidated Report =====
async function generateConsolidated(from, to) {
  const companies = await dbGetAll('companies');
  if (companies.length < 2) {
    document.getElementById('rpt-consolidated-content').innerHTML = `<p style="color:var(--text-muted);text-align:center;">Consolidado requer pelo menos 2 empresas cadastradas.</p>`;
    return;
  }
  const allLines = await dbGetAll('lines');
  const allEntriesDB = await dbGetAll('entries');
  const allAccountsDB = await dbGetAll('accounts');
  const period = (from || '...') + ' - ' + (to || '...');
  let rows = '';
  let grandTotals = { ativo: 0, passivo: 0, pl: 0, receita: 0, custo: 0, despesa: 0 };
  for (const company of companies) {
    const cAccounts = allAccountsDB.filter(a => a.companyId === company.id);
    const cEntries = allEntriesDB.filter(e => e.companyId === company.id && e.status === 'posted' && (!from || e.date >= from) && (!to || e.date <= to));
    const postedIds = new Set(cEntries.map(e => e.id));
    const cLines = allLines.filter(l => postedIds.has(l.entryId));
    const bal = { ativo: 0, passivo: 0, pl: 0, receita: 0, custo: 0, despesa: 0 };
    for (const l of cLines) {
      const acct = cAccounts.find(a => a.id === l.accountId);
      if (!acct) continue;
      const n = accountNature(acct.type);
      bal[acct.type] += n === 'debit' ? (l.debitBase - l.creditBase) : (l.creditBase - l.debitBase);
    }
    const ni = bal.receita - bal.custo - bal.despesa;
    for (const k of Object.keys(grandTotals)) grandTotals[k] += bal[k];
    rows += `<tr><td><strong>${company.name}</strong></td><td class="num">${fmt(bal.ativo)}</td><td class="num">${fmt(bal.passivo)}</td><td class="num">${fmt(bal.pl)}</td><td class="num">${fmt(bal.receita)}</td><td class="num">${fmt(bal.custo + bal.despesa)}</td><td class="num" style="color:${ni>=0?'var(--success)':'var(--danger)'}">${fmt(ni)}</td></tr>`;
  }
  const gni = grandTotals.receita - grandTotals.custo - grandTotals.despesa;
  document.getElementById('rpt-consolidated-content').innerHTML = `<div class="report-header"><h2>${t('consolidatedTitle')}</h2><p>${t('allCompanies')} — ${period}</p></div><div class="table-wrap"><table><thead><tr><th>${t('company')}</th><th class="num">${t('totalAssets')}</th><th class="num">${t('totalLiabilities')}</th><th class="num">${t('equity')}</th><th class="num">${t('revenue')}</th><th class="num">${t('costsExpenses')}</th><th class="num">${t('netIncome')}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="report-grand-total"><td>${t('total')}</td><td class="num">${fmt(grandTotals.ativo)}</td><td class="num">${fmt(grandTotals.passivo)}</td><td class="num">${fmt(grandTotals.pl)}</td><td class="num">${fmt(grandTotals.receita)}</td><td class="num">${fmt(grandTotals.custo + grandTotals.despesa)}</td><td class="num" style="color:${gni>=0?'var(--success)':'var(--danger)'}">${fmt(gni)}</td></tr></tfoot></table></div><div class="btn-group no-print" style="margin-top:12px;"><button class="btn btn-sm" onclick="printReport('rpt-consolidated')">${t('print')}</button><button class="btn btn-sm" onclick="exportReportCSV('consolidated')">${t('exportCSV')}</button></div>`;
}

function printReport(id) { document.getElementById('tab-reports').classList.add('printing'); window.print(); document.getElementById('tab-reports').classList.remove('printing'); }
function exportReportCSV(name) {
  const table = document.querySelector('#rpt-' + name + '-content table');
  if (!table) { toast(t('generateReportFirst'), 'error'); return; }
  let csv = ''; for (const row of table.rows) { const cells = []; for (const cell of row.cells) cells.push('"' + cell.textContent.trim().replace(/"/g, '""') + '"'); csv += cells.join(';') + '\n'; }
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '_' + today() + '.csv'; a.click();
}

// ===== CSV Import =====
let csvData = null, csvHeaders = [];
const csvDZ = document.getElementById('csv-drop-zone');
const csvFI = document.getElementById('csv-file-input');
csvDZ.addEventListener('dragover', (e) => { e.preventDefault(); csvDZ.classList.add('dragover'); });
csvDZ.addEventListener('dragleave', () => csvDZ.classList.remove('dragover'));
csvDZ.addEventListener('drop', (e) => { e.preventDefault(); csvDZ.classList.remove('dragover'); handleCSVFile(e.dataTransfer.files[0]); });
csvFI.addEventListener('change', () => { if (csvFI.files[0]) handleCSVFile(csvFI.files[0]); });
function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => { const text = e.target.result; const delim = text.includes(';') ? ';' : ','; const rows = text.split('\n').filter(r => r.trim()); csvHeaders = rows[0].split(delim).map(h => h.trim().replace(/^"|"$/g, '')); csvData = rows.slice(1).map(r => { const cells = r.split(delim).map(c => c.trim().replace(/^"|"$/g, '')); const obj = {}; csvHeaders.forEach((h, i) => obj[h] = cells[i] || ''); return obj; }); showCSVPreview(); };
  reader.readAsText(file, 'UTF-8');
}
function showCSVPreview() {
  document.getElementById('csv-preview').style.display = 'block';
  const fields = [t('date'), t('description'), t('debitAccount'), t('creditAccount'), t('value'), t('currency')];
  const ids = ['Data', 'Descricao', 'Conta_Debito', 'Conta_Credito', 'Valor', 'Moeda'];
  const mapping = document.getElementById('csv-mapping'); mapping.innerHTML = '';
  fields.forEach((f, i) => { const fg = document.createElement('div'); fg.className = 'form-group'; fg.innerHTML = `<label>${f}</label><select id="csv-map-${ids[i]}"><option value="">${t('ignore')}</option>${csvHeaders.map(h => `<option value="${h}">${h}</option>`).join('')}</select>`; mapping.appendChild(fg); });
  const table = document.getElementById('csv-preview-table');
  let html = '<thead><tr>' + csvHeaders.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  for (const row of csvData.slice(0, 5)) html += '<tr>' + csvHeaders.map(h => `<td>${row[h] || ''}</td>`).join('') + '</tr>';
  table.innerHTML = html + '</tbody>';
  document.getElementById('csv-validation').innerHTML = `<p>${csvData.length} ${t('linesFound')}</p>`;
}
async function executeCSVImport() {
  if (!csvData || !csvData.length) { toast(t('noDataToImport'), 'error'); return; }
  const gm = f => document.getElementById('csv-map-' + f)?.value || '';
  const dc = gm('Data'), desc = gm('Descricao'), dbc = gm('Conta_Debito'), crc = gm('Conta_Credito'), vc = gm('Valor'), cc = gm('Moeda');
  if (!dc || !vc || !dbc || !crc) { toast(t('mapMinFields'), 'error'); return; }
  allAccounts = await getCompanyAccounts(); const acctByCode = {}; for (const a of allAccounts) acctByCode[a.code] = a;
  let imp = 0, err = 0;
  for (const row of csvData) {
    const date = row[dc] || ''; const d = row[desc] || 'CSV Import'; const dbCode = row[dbc]?.trim(); const crCode = row[crc]?.trim(); const amt = parseNum(row[vc]); const cur = row[cc]?.trim() || 'BRL';
    if (!date || !amt || !dbCode || !crCode) { err++; continue; }
    const da = acctByCode[dbCode]; const ca = acctByCode[crCode]; if (!da || !ca) { err++; continue; }
    let isoDate = date; if (date.includes('/')) { const p = date.split('/'); if (p[2]?.length === 4) isoDate = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
    const curs = await dbGetAll('currencies'); const co = curs.find(c => c.code === cur); const rate = co ? co.rate : 1;
    const eid = await dbAdd('entries', { date: isoDate, description: d, reference: '', source: 'csv', currency: cur, exchangeRate: rate, status: 'posted', companyId: currentCompanyId, createdAt: new Date().toISOString() });
    await dbAdd('lines', { entryId: eid, accountId: da.id, accountCode: dbCode, debit: amt, credit: 0, debitBase: Math.round(amt * rate * 100) / 100, creditBase: 0, memo: '' });
    await dbAdd('lines', { entryId: eid, accountId: ca.id, accountCode: crCode, debit: 0, credit: amt, debitBase: 0, creditBase: Math.round(amt * rate * 100) / 100, memo: '' });
    imp++;
  }
  toast(`${t('imported')}: ${imp} | ${t('errors')}: ${err}`, imp > 0 ? 'success' : 'error');
  if (imp > 0) resetCSVImport();
}
function resetCSVImport() { csvData = null; csvHeaders = []; document.getElementById('csv-preview').style.display = 'none'; csvFI.value = ''; }

// ===== API Import =====
let apiResponseData = null;
async function testAPIConnection() {
  const url = document.getElementById('api-url').value.trim(); if (!url) { toast(t('enterEndpointURL'), 'error'); return; }
  const method = document.getElementById('api-method').value; let headers = {}; try { headers = JSON.parse(document.getElementById('api-headers').value || '{}'); } catch {}
  const opts = { method, headers }; if (method === 'POST') { opts.body = document.getElementById('api-body').value; headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
  try {
    const resp = await fetch(url, opts); apiResponseData = await resp.json();
    document.getElementById('api-response').style.display = 'block';
    document.getElementById('api-response-data').textContent = JSON.stringify(apiResponseData, null, 2).slice(0, 3000);
    const sample = Array.isArray(apiResponseData) ? apiResponseData[0] : (apiResponseData.data?.[0] || apiResponseData);
    if (sample && typeof sample === 'object') {
      const keys = Object.keys(sample);
      const fields = ['date', 'description', 'debitAccount', 'creditAccount', 'amount', 'currency'];
      const mapping = document.getElementById('api-mapping'); mapping.innerHTML = '';
      for (const f of fields) { const fg = document.createElement('div'); fg.className = 'form-group'; fg.innerHTML = `<label>${f}</label><select id="api-map-${f}"><option value="">${t('ignore')}</option>${keys.map(k => `<option value="${k}">${k}</option>`).join('')}</select>`; mapping.appendChild(fg); }
    }
    toast(t('connectionOK'), 'success');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}
async function executeAPIImport() {
  if (!apiResponseData) { toast(t('testFirst'), 'error'); return; }
  const records = Array.isArray(apiResponseData) ? apiResponseData : (apiResponseData.data || [apiResponseData]);
  const gm = f => document.getElementById('api-map-' + f)?.value || '';
  const dk = gm('date'), dsk = gm('description'), dbk = gm('debitAccount'), crk = gm('creditAccount'), ak = gm('amount'), ck = gm('currency');
  if (!dk || !ak || !dbk || !crk) { toast(t('mapMinFields'), 'error'); return; }
  allAccounts = await getCompanyAccounts(); const byCode = {}; for (const a of allAccounts) byCode[a.code] = a;
  let imp = 0, err = 0;
  for (const rec of records) {
    const date = rec[dk]; const desc = rec[dsk] || 'API Import'; const dbc = String(rec[dbk]).trim(); const crc = String(rec[crk]).trim(); const amt = parseNum(rec[ak]); const cur = rec[ck] || 'BRL';
    if (!date || !amt || !dbc || !crc) { err++; continue; }
    const da = byCode[dbc]; const ca = byCode[crc]; if (!da || !ca) { err++; continue; }
    const curs = await dbGetAll('currencies'); const co = curs.find(c => c.code === cur); const rate = co ? co.rate : 1;
    const eid = await dbAdd('entries', { date, description: desc, reference: '', source: 'api', currency: cur, exchangeRate: rate, status: 'posted', companyId: currentCompanyId, createdAt: new Date().toISOString() });
    await dbAdd('lines', { entryId: eid, accountId: da.id, accountCode: dbc, debit: amt, credit: 0, debitBase: Math.round(amt * rate * 100) / 100, creditBase: 0, memo: '' });
    await dbAdd('lines', { entryId: eid, accountId: ca.id, accountCode: crc, debit: 0, credit: amt, debitBase: 0, creditBase: Math.round(amt * rate * 100) / 100, memo: '' });
    imp++;
  }
  toast(`API: ${t('imported')} ${imp} | ${t('errors')}: ${err}`, imp > 0 ? 'success' : 'error');
}

// ===== Backup =====
async function exportFullBackup() {
  const data = { version: '3.0', exportDate: new Date().toISOString(), companies: await dbGetAll('companies'), accounts: await dbGetAll('accounts'), entries: await dbGetAll('entries'), lines: await dbGetAll('lines'), currencies: await dbGetAll('currencies'), settings: await dbGetAll('settings'), users: await dbGetAll('users'), attachments: await dbGetAll('attachments'), rules: await dbGetAll('rules') };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'razao_geral_backup_' + today() + '.json'; a.click();
  toast(t('backupExported'), 'success');
}
const bkDZ = document.getElementById('backup-drop-zone');
const bkFI = document.getElementById('backup-file-input');
bkDZ.addEventListener('dragover', (e) => { e.preventDefault(); bkDZ.classList.add('dragover'); });
bkDZ.addEventListener('dragleave', () => bkDZ.classList.remove('dragover'));
bkDZ.addEventListener('drop', (e) => { e.preventDefault(); bkDZ.classList.remove('dragover'); handleBackupFile(e.dataTransfer.files[0]); });
bkFI.addEventListener('change', () => { if (bkFI.files[0]) handleBackupFile(bkFI.files[0]); });
function handleBackupFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => { try { const data = JSON.parse(e.target.result); document.getElementById('backup-preview').style.display = 'block'; document.getElementById('backup-preview').innerHTML = `<p><strong>${t('backupFrom')}</strong> ${data.exportDate || '?'}</p><p>${t('accounts_')}: ${data.accounts?.length || 0} | ${t('entries_')}: ${data.entries?.length || 0} | ${t('lines_')}: ${data.lines?.length || 0}</p><p style="color:var(--danger);margin-top:8px;">${t('replaceWarning')}</p><div class="btn-group" style="margin-top:12px;"><button class="btn btn-danger btn-sm" onclick="restoreBackup()">${t('confirmRestore')}</button><button class="btn btn-sm" onclick="document.getElementById('backup-preview').style.display='none'">${t('cancel')}</button></div>`; window._backupData = data; } catch { toast(t('invalidFile'), 'error'); } };
  reader.readAsText(file);
}
async function restoreBackup() {
  const data = window._backupData; if (!data) return;
  const stores = ['accounts', 'entries', 'lines', 'currencies', 'settings', 'users', 'attachments', 'companies', 'rules'];
  for (const store of stores) { if (db.objectStoreNames.contains(store)) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); await new Promise(r => { tx.oncomplete = r; }); } }
  for (const a of (data.accounts || [])) await dbAdd('accounts', a);
  for (const e of (data.entries || [])) await dbAdd('entries', e);
  for (const l of (data.lines || [])) await dbAdd('lines', l);
  for (const c of (data.currencies || [])) await dbAdd('currencies', c);
  for (const s of (data.settings || [])) await dbPut('settings', s);
  for (const u of (data.users || [])) await dbAdd('users', u);
  for (const a of (data.attachments || [])) await dbAdd('attachments', a);
  for (const c of (data.companies || [])) await dbAdd('companies', c);
  for (const r of (data.rules || [])) await dbAdd('rules', r);
  toast(t('backupRestored'), 'success');
  document.getElementById('backup-preview').style.display = 'none';
  await loadCompanySelector(); switchTab('dashboard');
}

// ===== Settings =====
async function loadSettings() {
  const company = await dbGet('settings', 'companyName');
  const fiscal = await dbGet('settings', 'fiscalMonth');
  if (company) document.getElementById('set-company').value = company.value;
  if (fiscal) document.getElementById('set-fiscal-month').value = fiscal.value;
  loadCurrencyList(); loadWebhookConfig();
}
async function saveSettings() {
  await dbPut('settings', { key: 'companyName', value: document.getElementById('set-company').value.trim() });
  await dbPut('settings', { key: 'fiscalMonth', value: document.getElementById('set-fiscal-month').value });
  toast(t('settingsSaved'), 'success');
}
async function loadCurrencyList() {
  const curs = await dbGetAll('currencies');
  const tbody = document.getElementById('currency-list'); tbody.innerHTML = '';
  for (const c of curs) tbody.innerHTML += `<tr><td><strong>${c.code}</strong></td><td>${c.name}</td><td class="num">${c.rate}</td><td>${c.updatedAt}</td><td>${c.code !== 'BRL' ? `<button class="btn btn-sm btn-danger" onclick="deleteCurrency(${c.id})">&times;</button>` : ''}</td></tr>`;
}
async function saveCurrency() {
  const code = document.getElementById('cur-code').value.trim().toUpperCase();
  const name = document.getElementById('cur-name').value.trim();
  const rate = parseFloat(document.getElementById('cur-rate').value);
  if (!code || !name || !rate) { toast(t('fillAllFields'), 'error'); return; }
  const existing = await dbGetAll('currencies');
  const found = existing.find(c => c.code === code);
  if (found) { found.name = name; found.rate = rate; found.updatedAt = today(); await dbPut('currencies', found); toast(t('currencyUpdated'), 'success'); }
  else { await dbAdd('currencies', { code, name, rate, updatedAt: today() }); toast(t('currencyAdded'), 'success'); }
  document.getElementById('cur-code').value = ''; document.getElementById('cur-name').value = ''; document.getElementById('cur-rate').value = '';
  loadCurrencyList();
}
async function deleteCurrency(id) { if (!confirm(t('deleteCurrency'))) return; await dbDelete('currencies', id); toast(t('currencyDeleted')); loadCurrencyList(); }
async function clearAllData() {
  if (!confirm(t('confirmClear1'))) return; if (!confirm(t('confirmClear2'))) return;
  const stores = ['accounts', 'entries', 'lines', 'currencies', 'settings', 'users', 'attachments', 'companies', 'rules'];
  for (const store of stores) { if (db.objectStoreNames.contains(store)) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); await new Promise(r => { tx.oncomplete = r; }); } }
  await migrateToMultiCompany();
  await seedDefaults(currentCompanyId);
  toast(t('dataReset'), 'info'); switchTab('dashboard');
}

// ===== NF-e Drop Zone =====
const nfeDZ = document.getElementById('nfe-drop-zone');
const nfeFI = document.getElementById('nfe-file-input');
nfeDZ.addEventListener('dragover', (e) => { e.preventDefault(); nfeDZ.classList.add('dragover'); });
nfeDZ.addEventListener('dragleave', () => nfeDZ.classList.remove('dragover'));
nfeDZ.addEventListener('drop', (e) => { e.preventDefault(); nfeDZ.classList.remove('dragover'); handleNFeFile(e.dataTransfer.files[0]); });
nfeFI.addEventListener('change', () => { if (nfeFI.files[0]) handleNFeFile(nfeFI.files[0]); });

// ===== Capture Drop Zone =====
const capDZ = document.getElementById('capture-drop-zone');
const capFI = document.getElementById('capture-file-input');
capDZ.addEventListener('dragover', (e) => { e.preventDefault(); capDZ.classList.add('dragover'); });
capDZ.addEventListener('dragleave', () => capDZ.classList.remove('dragover'));
capDZ.addEventListener('drop', (e) => { e.preventDefault(); capDZ.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleCaptureImageUpload(e.dataTransfer.files[0]); });
capFI.addEventListener('change', () => { if (capFI.files[0]) handleCaptureImageUpload(capFI.files[0]); });

// ===== INIT =====
(async function init() {
  try {
    applyTheme();
    await openDB();
    await migrateToMultiCompany();
    // Restore company from localStorage
    const savedCompany = localStorage.getItem('gl_company');
    if (savedCompany) currentCompanyId = parseInt(savedCompany);
    const companies = await dbGetAll('companies');
    if (!currentCompanyId && companies.length) currentCompanyId = companies[0].id;
    await seedDefaults(currentCompanyId);
    await loadCompanySelector();
    // Set language selector
    document.getElementById('lang-selector').value = currentLang;
    translatePage();
    // Set default report dates
    document.getElementById('rpt-from').value = new Date().getFullYear() + '-01-01';
    document.getElementById('rpt-to').value = today();
    // Auth
    const authed = await initAuth();
    if (authed) loadDashboard();
  } catch (e) { console.error('Init error:', e); }
})();
