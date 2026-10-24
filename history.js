const PAGE_SIZE = 50;
const historyMonth = document.getElementById('historyMonth');
const historyCategory = document.getElementById('historyCategory');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const historyMessage = document.getElementById('historyMessage');
const historyTotalAmount = document.getElementById('historyTotalAmount');
const historyRecordCount = document.getElementById('historyRecordCount');
const historyPrevious = document.getElementById('historyPrevious');
const historyNext = document.getElementById('historyNext');
const historyPageLabel = document.getElementById('historyPageLabel');
const logoutButton = document.getElementById('logoutButton');

let currentOffset = 0;
let currentTotal = 0;
let loadSequence = 0;

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function formatDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
}

function displayMessage(message, isError = false) {
  historyMessage.textContent = message;
  historyMessage.classList.toggle('error', isError);
  historyMessage.classList.toggle('success', false);
}

function setupMonthOptions() {
  const currentDate = new Date();
  for (let index = 0; index < 36; index += 1) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - index, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric'
    }).format(date);
    historyMonth.append(option);
  }
}

function renderHistory(expenses) {
  historyList.replaceChildren();
  historyEmpty.hidden = expenses.length > 0;

  for (const expense of expenses) {
    const row = document.createElement('article');
    row.className = 'expense-item';

    const details = document.createElement('div');
    details.className = 'expense-item-details';
    const title = document.createElement('strong');
    title.textContent = expense.description;
    const meta = document.createElement('span');
    meta.textContent = `${expense.category} · ${formatDate(expense.spentOn)}${expense.barcode ? ' · código lido' : ''}`;
    details.append(title, meta);

    const amount = document.createElement('strong');
    amount.className = 'expense-amount';
    amount.textContent = formatCurrency(expense.amount);

    const removeButton = document.createElement('button');
    removeButton.className = 'expense-remove';
    removeButton.type = 'button';
    removeButton.textContent = 'Excluir';
    removeButton.setAttribute('aria-label', `Excluir registro: ${expense.description}`);
    removeButton.addEventListener('click', () => deleteExpense(expense.id));

    row.append(details, amount, removeButton);
    historyList.append(row);
  }
}

async function loadHistory() {
  const sequence = ++loadSequence;
  const parameters = new URLSearchParams({
    month: historyMonth.value,
    category: historyCategory.value,
    limit: String(PAGE_SIZE),
    offset: String(currentOffset)
  });
  displayMessage('Carregando histórico...');
  historyPrevious.disabled = true;
  historyNext.disabled = true;

  try {
    const response = await fetch(`/api/expenses?${parameters}`);
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o histórico.');
    if (sequence !== loadSequence) return;

    currentTotal = result.totalCount;
    historyTotalAmount.textContent = formatCurrency(result.filteredTotal);
    historyRecordCount.textContent = String(result.totalCount);
    historyPageLabel.textContent = `Página ${Math.floor(currentOffset / PAGE_SIZE) + 1}`;
    historyPrevious.disabled = currentOffset === 0;
    historyNext.disabled = currentOffset + PAGE_SIZE >= currentTotal;
    renderHistory(result.expenses);
    displayMessage('');
  } catch (error) {
    if (sequence === loadSequence) {
      displayMessage(error.message || 'Não foi possível carregar o histórico.', true);
    }
  }
}

async function deleteExpense(id) {
  if (!window.confirm('Excluir este registro do histórico?')) return;
  try {
    const response = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível excluir o registro.');
    if (currentOffset > 0 && currentOffset >= currentTotal - 1) {
      currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
    }
    await loadHistory();
  } catch (error) {
    displayMessage(error.message || 'Não foi possível excluir o registro.', true);
  }
}

historyMonth.addEventListener('change', () => {
  currentOffset = 0;
  loadHistory();
});
historyCategory.addEventListener('change', () => {
  currentOffset = 0;
  loadHistory();
});
historyPrevious.addEventListener('click', () => {
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  loadHistory();
});
historyNext.addEventListener('click', () => {
  if (currentOffset + PAGE_SIZE < currentTotal) {
    currentOffset += PAGE_SIZE;
    loadHistory();
  }
});
logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/auth.html');
});

setupMonthOptions();
loadHistory();
