const ideas = [
  {
    ticker: 'HGLG11',
    name: 'Fundo de Logística',
    risco: 'baixo',
    yield: '0.96%',
    vacancia: '7,4%',
    pvp: '1,05',
    valor: 'R$ 95,80',
    perfil: 'Conservador',
    score: 82,
    fonte: 'Relatório gerencial • 2026'
  },
  {
    ticker: 'KNRI11',
    name: 'Receita Imobiliária',
    risco: 'medio',
    yield: '1.18%',
    vacancia: '9,2%',
    pvp: '1,12',
    valor: 'R$ 112,40',
    perfil: 'Moderado',
    score: 76,
    fonte: 'Comunicado • 2026'
  },
  {
    ticker: 'VISC11',
    name: 'Vinci Shopping',
    risco: 'medio',
    yield: '1.07%',
    vacancia: '10,1%',
    pvp: '1,09',
    valor: 'R$ 89,30',
    perfil: 'Moderado',
    score: 72,
    fonte: 'Dados públicos • 2026'
  },
  {
    ticker: 'MXRF11',
    name: 'Maxi Renda',
    risco: 'alto',
    yield: '1.31%',
    vacancia: '12,6%',
    pvp: '1,19',
    valor: 'R$ 13,76',
    perfil: 'Agressivo',
    score: 68,
    fonte: 'Fato relevante • 2026'
  },
  {
    ticker: 'XPML11',
    name: 'XP Malls',
    risco: 'baixo',
    yield: '0.89%',
    vacancia: '8,3%',
    pvp: '1,01',
    valor: 'R$ 98,50',
    perfil: 'Conservador',
    score: 80,
    fonte: 'Atualização trimestral • 2026'
  },
  {
    ticker: 'RBRR11',
    name: 'RBR Real Estate',
    risco: 'alto',
    yield: '1.42%',
    vacancia: '13,9%',
    pvp: '1,24',
    valor: 'R$ 14,90',
    perfil: 'Agressivo',
    score: 64,
    fonte: 'Dados do mercado • 2026'
  }
];

const ideaList = document.getElementById('ideaList');
const ideaDetailsDialog = document.getElementById('ideaDetailsDialog');
const closeIdeaDetails = document.getElementById('closeIdeaDetails');
const receita = document.getElementById('receita');
const despesasFixas = document.getElementById('despesasFixas');
const gastosVariaveis = document.getElementById('gastosVariaveis');
const metaInvestimento = document.getElementById('metaInvestimento');
const sliderValues = {
  receita: document.getElementById('receitaValor'),
  despesasFixas: document.getElementById('despesasFixasValor'),
  gastosVariaveis: document.getElementById('gastosVariaveisValor'),
  metaInvestimento: document.getElementById('metaInvestimentoValor')
};
const excedenteValor = document.getElementById('excedenteValor');
const metaValor = document.getElementById('metaValor');
const perfilValor = document.getElementById('perfilValor');
const filters = document.querySelectorAll('.filter');
const financialSaveStatus = document.getElementById('financialSaveStatus');
const accountName = document.getElementById('accountName');
const logoutButton = document.getElementById('logoutButton');

let selectedRisk = 'todos';
let saveTimer;

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function updateSliderValue(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const progress = ((value - min) / (max - min)) * 100;
  const output = sliderValues[input.id];

  input.style.setProperty('--range-progress', `${progress}%`);
  output.textContent =
    input.id === 'metaInvestimento' ? `${value}%` : formatMoney(value);
  input.setAttribute('aria-valuetext', output.textContent);
}

function computeFinancialProfile() {
  const receitaMes = Number(receita.value || 0);
  const despesasFix = Number(despesasFixas.value || 0);
  const variaveis = Number(gastosVariaveis.value || 0);
  const meta = Number(metaInvestimento.value || 0);

  const excedente = receitaMes - despesasFix - variaveis;
  const suggestedAllocation = Math.max(0, (excedente * meta) / 100);

  excedenteValor.textContent = formatMoney(excedente);
  metaValor.textContent = formatMoney(suggestedAllocation);

  if (meta <= 25) {
    perfilValor.textContent = 'Conservador';
  } else if (meta <= 45) {
    perfilValor.textContent = 'Moderado';
  } else {
    perfilValor.textContent = 'Agressivo';
  }
}

function financialProfilePayload() {
  return {
    monthlyIncome: Number(receita.value),
    fixedExpenses: Number(despesasFixas.value),
    variableExpenses: Number(gastosVariaveis.value),
    investmentGoal: Number(metaInvestimento.value)
  };
}

async function loadAccount() {
  try {
    const response = await fetch('/api/me');
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    if (!response.ok) throw new Error('Não foi possível carregar os dados da conta.');
    const { user, financialProfile } = await response.json();
    accountName.textContent = user.name;
    receita.value = financialProfile.monthlyIncome;
    despesasFixas.value = financialProfile.fixedExpenses;
    gastosVariaveis.value = financialProfile.variableExpenses;
    metaInvestimento.value = financialProfile.investmentGoal;
    [receita, despesasFixas, gastosVariaveis, metaInvestimento].forEach(updateSliderValue);
    computeFinancialProfile();
    renderIdeas();
  } catch {
    financialSaveStatus.textContent = 'Não foi possível carregar seu perfil financeiro.';
    financialSaveStatus.classList.add('error');
  }
}

async function saveFinancialProfile() {
  financialSaveStatus.textContent = 'Salvando…';
  financialSaveStatus.classList.remove('error', 'success');
  try {
    const response = await fetch('/api/financial-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(financialProfilePayload())
    });
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
    financialSaveStatus.textContent = 'Perfil financeiro salvo.';
    financialSaveStatus.classList.add('success');
  } catch (error) {
    financialSaveStatus.textContent = error.message || 'Não foi possível salvar seu perfil financeiro.';
    financialSaveStatus.classList.add('error');
  }
}

function getRiskLabel(risco) {
  if (risco === 'baixo') return 'Baixo risco';
  if (risco === 'medio') return 'Médio risco';
  return 'Alto risco';
}

function showIdeaDetails(ticker) {
  const item = ideas.find((idea) => idea.ticker === ticker);
  if (!item) return;

  document.getElementById('ideaDetailsTitle').textContent = item.ticker;
  document.getElementById('ideaDetailsName').textContent = item.name;
  const riskBadge = document.getElementById('ideaDetailsRisk');
  riskBadge.textContent = getRiskLabel(item.risco);
  riskBadge.className = `badge ${item.risco}`;
  document.getElementById('ideaDetailsProfile').textContent = `Perfil indicado: ${item.perfil}`;
  document.getElementById('ideaDetailsPrice').textContent = item.valor;
  document.getElementById('ideaDetailsYield').textContent = item.yield;
  document.getElementById('ideaDetailsVacancy').textContent = item.vacancia;
  document.getElementById('ideaDetailsPvp').textContent = item.pvp;
  document.getElementById('ideaDetailsScore').textContent = `${item.score}/100`;
  document.getElementById('ideaDetailsSource').textContent = item.fonte;
  ideaDetailsDialog.showModal();
}

function renderIdeas() {
  const filtered = ideas.filter((item) => {
    if (selectedRisk === 'todos') return true;
    return item.risco === selectedRisk;
  });

  ideaList.innerHTML = filtered
    .map((item) => {
      const suggested = Math.round((Number((document.getElementById('receita').value || 0)) * 0.55) / 1000);
      const suggestionValue = Math.max(350, Math.round((Number(item.score) * 10) + suggested));

      return `
        <article class="idea-card">
          <div class="idea-top">
            <h3>${item.ticker}</h3>
            <span class="badge ${item.risco}">${getRiskLabel(item.risco)}</span>
          </div>
          <div class="idea-meta">
            <span>${item.name}</span>
            <span>${item.perfil}</span>
          </div>
          <div class="price">${item.valor} <small>por cota</small></div>
          <div class="tag-row">
            <span class="tag">Yield ${item.yield}</span>
            <span class="tag">Vacância ${item.vacancia}</span>
            <span class="tag">P/VP ${item.pvp}</span>
          </div>
          <div class="idea-footer">
            <span>Alocação sugerida</span>
            <strong>R$ ${suggestionValue}</strong>
          </div>
          <div class="idea-footer">
            <span>Fonte</span>
            <strong>${item.fonte}</strong>
          </div>
          <button class="idea-details-button" type="button" data-idea-ticker="${item.ticker}" aria-haspopup="dialog">
            Ver estatísticas detalhadas
          </button>
        </article>
      `;
    })
    .join('');
}

ideaList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-idea-ticker]');
  if (button) showIdeaDetails(button.dataset.ideaTicker);
});

closeIdeaDetails.addEventListener('click', () => ideaDetailsDialog.close());

ideaDetailsDialog.addEventListener('click', (event) => {
  if (event.target === ideaDetailsDialog) ideaDetailsDialog.close();
});

[receita, despesasFixas, gastosVariaveis, metaInvestimento].forEach((input) => {
  input.addEventListener('input', () => {
    updateSliderValue(input);
    computeFinancialProfile();
    renderIdeas();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveFinancialProfile, 400);
  });
  updateSliderValue(input);
});

filters.forEach((button) => {
  button.addEventListener('click', () => {
    filters.forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    selectedRisk = button.dataset.risk;
    renderIdeas();
  });
});

computeFinancialProfile();
renderIdeas();
loadAccount();

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/auth.html');
});
