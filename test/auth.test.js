const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { createServer } = require('../server');

async function withServer(t, run) {
  const directory = mkdtempSync(join(tmpdir(), 'mymoney-auth-'));
  const server = createServer({ dbPath: join(directory, 'test.sqlite') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    rmSync(directory, { recursive: true, force: true });
  });
  await run(baseUrl);
}

function originHeaders(baseUrl, cookie) {
  return {
    Origin: baseUrl,
    ...(cookie ? { Cookie: cookie } : {})
  };
}

async function postJson(baseUrl, path, body, cookie) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { ...originHeaders(baseUrl, cookie), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function putJson(baseUrl, path, body, cookie) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { ...originHeaders(baseUrl, cookie), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function register(baseUrl, email = 'ana@example.com') {
  const response = await postJson(baseUrl, '/api/register', {
    name: 'Ana Silva',
    email,
    password: 'uma-senha-forte-123'
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  return { response, cookie };
}

test('cadastro valida campos, armazena senha derivada e autentica a conta', async (t) => {
  await withServer(t, async (baseUrl) => {
    const invalid = await postJson(baseUrl, '/api/register', {
      name: 'A',
      email: 'inválido',
      password: 'curta'
    });
    assert.equal(invalid.status, 400);

    const { response, cookie } = await register(baseUrl);
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
    assert.ok(cookie);
    const registered = await response.json();
    assert.equal(registered.user.name, 'Ana Silva');
    assert.deepEqual(registered.financialProfile, {
      monthlyIncome: 6500,
      fixedExpenses: 2600,
      variableExpenses: 1200,
      investmentGoal: 35
    });

    const duplicate = await postJson(baseUrl, '/api/register', {
      name: 'Outra Ana',
      email: 'ANA@example.com',
      password: 'uma-senha-forte-456'
    });
    assert.equal(duplicate.status, 400);
    assert.match((await duplicate.json()).error, /Não foi possível criar a conta/);
  });
});

test('login válido cria sessão e credenciais inválidas usam mensagem genérica', async (t) => {
  await withServer(t, async (baseUrl) => {
    await register(baseUrl);
    const valid = await postJson(baseUrl, '/api/login', {
      email: 'ANA@example.com',
      password: 'uma-senha-forte-123'
    });
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get('set-cookie'), /HttpOnly/);

    const invalid = await postJson(baseUrl, '/api/login', {
      email: 'ana@example.com',
      password: 'senha-incorreta'
    });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error, 'E-mail ou senha inválidos.');

    const unknown = await postJson(baseUrl, '/api/login', {
      email: 'naoexiste@example.com',
      password: 'senha-incorreta'
    });
    assert.equal(unknown.status, 401);
    assert.equal((await unknown.json()).error, 'E-mail ou senha inválidos.');
  });
});

test('protege o painel, salva dados financeiros por usuário e permite editar o perfil', async (t) => {
  await withServer(t, async (baseUrl) => {
    const protectedPage = await fetch(baseUrl, { redirect: 'manual' });
    assert.equal(protectedPage.status, 302);
    assert.equal(protectedPage.headers.get('location'), '/auth.html');

    const protectedExpenses = await fetch(`${baseUrl}/expenses`, { redirect: 'manual' });
    assert.equal(protectedExpenses.status, 302);
    assert.equal(protectedExpenses.headers.get('location'), '/auth.html');
    const protectedExpensesFile = await fetch(`${baseUrl}/expenses.html`, { redirect: 'manual' });
    assert.equal(protectedExpensesFile.status, 302);
    assert.equal(protectedExpensesFile.headers.get('location'), '/auth.html');
    const protectedHistory = await fetch(`${baseUrl}/history`, { redirect: 'manual' });
    assert.equal(protectedHistory.status, 302);
    assert.equal(protectedHistory.headers.get('location'), '/auth.html');
    const protectedHistoryFile = await fetch(`${baseUrl}/history.html`, { redirect: 'manual' });
    assert.equal(protectedHistoryFile.status, 302);
    assert.equal(protectedHistoryFile.headers.get('location'), '/auth.html');

    const { cookie } = await register(baseUrl);
    const dashboard = await fetch(baseUrl, {
      headers: originHeaders(baseUrl, cookie)
    });
    assert.equal(dashboard.status, 200);
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, /href="\/expenses" target="_blank" rel="noopener">Controle de gastos/);
    assert.match(dashboardHtml, /href="\/history">Histórico/);
    assert.match(dashboardHtml, /id="ideaDetailsDialog"/);
    assert.equal((dashboardHtml.match(/<script src="script\.js"><\/script>/g) || []).length, 1);
    const dashboardScript = await fetch(`${baseUrl}/script.js`);
    assert.match(await dashboardScript.text(), /Ver estatísticas detalhadas/);
    assert.doesNotMatch(dashboardHtml, /id="expenseForm"/);
    assert.doesNotMatch(dashboardHtml, /id="scannerVideo"/);

    const historyPage = await fetch(`${baseUrl}/history`, {
      headers: originHeaders(baseUrl, cookie)
    });
    assert.equal(historyPage.status, 200);
    assert.match(await historyPage.text(), /Compras e pagamentos/);
    const protectedProfile = await fetch(`${baseUrl}/profile`, {
      headers: originHeaders(baseUrl, cookie)
    });
    assert.equal(protectedProfile.status, 200);
    assert.match(await protectedProfile.text(), /Meu perfil/);

    const expensesPage = await fetch(`${baseUrl}/expenses`, {
      headers: originHeaders(baseUrl, cookie)
    });
    assert.equal(expensesPage.status, 200);
    const expensesHtml = await expensesPage.text();
    assert.match(expensesHtml, /href="\/history">Histórico/);
    assert.match(expensesHtml, /Compras e despesas/);
    assert.match(expensesHtml, /id="expenseForm"/);

    const updateFinancial = await putJson(baseUrl, '/api/financial-profile', {
      monthlyIncome: 8000,
      fixedExpenses: 3000,
      variableExpenses: 1500,
      investmentGoal: 40
    }, cookie);
    assert.equal(updateFinancial.status, 200);

    const secondUser = await register(baseUrl, 'bia@example.com');
    const secondMe = await fetch(`${baseUrl}/api/me`, {
      headers: originHeaders(baseUrl, secondUser.cookie)
    });
    assert.equal(secondMe.status, 200);
    assert.deepEqual((await secondMe.json()).financialProfile, {
      monthlyIncome: 6500,
      fixedExpenses: 2600,
      variableExpenses: 1200,
      investmentGoal: 35
    });

    const updateProfile = await putJson(baseUrl, '/api/profile', {
      name: 'Ana Atualizada',
      email: 'ana.nova@example.com',
      currentPassword: 'uma-senha-forte-123',
      newPassword: 'outra-senha-forte-456'
    }, cookie);
    assert.equal(updateProfile.status, 200);
    assert.deepEqual((await updateProfile.json()).user, {
      id: 1,
      name: 'Ana Atualizada',
      email: 'ana.nova@example.com'
    });

    const newPasswordLogin = await postJson(baseUrl, '/api/login', {
      email: 'ana.nova@example.com',
      password: 'outra-senha-forte-456'
    });
    assert.equal(newPasswordLogin.status, 200);
    const newCookie = newPasswordLogin.headers.get('set-cookie')?.split(';')[0];
    const logout = await postJson(baseUrl, '/api/logout', {}, newCookie);
    assert.equal(logout.status, 200);
    const expiredSession = await fetch(`${baseUrl}/api/me`, {
      headers: originHeaders(baseUrl, newCookie)
    });
    assert.equal(expiredSession.status, 401);
  });
});

test('limita tentativas consecutivas de login', async (t) => {
  await withServer(t, async (baseUrl) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await postJson(baseUrl, '/api/login', {
        email: 'ana@example.com',
        password: 'senha-incorreta'
      });
    }
    const blocked = await postJson(baseUrl, '/api/login', {
      email: 'ana@example.com',
      password: 'senha-incorreta'
    });
    assert.equal(blocked.status, 429);
  });
});

test('registra gastos com validação, lista por usuário e não permite excluir gasto alheio', async (t) => {
  await withServer(t, async (baseUrl) => {
    const { cookie } = await register(baseUrl);
    const unauthenticated = await fetch(`${baseUrl}/api/expenses`);
    assert.equal(unauthenticated.status, 401);

    const invalid = await postJson(baseUrl, '/api/expenses', {
      description: 'Compra',
      amount: 0,
      category: 'Mercado',
      spentOn: '2026-10-24'
    }, cookie);
    assert.equal(invalid.status, 400);

    const created = await postJson(baseUrl, '/api/expenses', {
      description: 'Compra de frutas',
      amount: 25.5,
      category: 'Mercado',
      spentOn: '2026-10-24',
      barcode: '7891234567890'
    }, cookie);
    assert.equal(created.status, 201);
    const { expense } = await created.json();
    assert.equal(expense.description, 'Compra de frutas');
    assert.equal(expense.amount, 25.5);
    assert.equal(expense.barcode, '7891234567890');

    const secondExpenseResponse = await postJson(baseUrl, '/api/expenses', {
      description: 'Passagem de ônibus',
      amount: 6.5,
      category: 'Transporte',
      spentOn: '2026-10-23'
    }, cookie);
    assert.equal(secondExpenseResponse.status, 201);

    const secondUser = await register(baseUrl, 'bia@example.com');
    const secondList = await fetch(`${baseUrl}/api/expenses`, {
      headers: originHeaders(baseUrl, secondUser.cookie)
    });
    assert.deepEqual((await secondList.json()).expenses, []);

    const deleteOtherUserExpense = await fetch(`${baseUrl}/api/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: originHeaders(baseUrl, secondUser.cookie)
    });
    assert.equal(deleteOtherUserExpense.status, 404);

    const pagedList = await fetch(`${baseUrl}/api/expenses?month=all&limit=1&offset=0`, {
      headers: originHeaders(baseUrl, cookie)
    });
    const pagedResult = await pagedList.json();
    assert.equal(pagedList.status, 200);
    assert.equal(pagedResult.totalCount, 2);
    assert.equal(pagedResult.expenses.length, 1);
    assert.equal(pagedResult.expenses[0].description, 'Compra de frutas');
    assert.equal(pagedResult.filteredTotal, 32);

    const categoryList = await fetch(`${baseUrl}/api/expenses?month=all&category=Transporte`, {
      headers: originHeaders(baseUrl, cookie)
    });
    const categoryResult = await categoryList.json();
    assert.equal(categoryResult.totalCount, 1);
    assert.equal(categoryResult.expenses[0].description, 'Passagem de ônibus');

    const list = await fetch(`${baseUrl}/api/expenses`, {
      headers: originHeaders(baseUrl, cookie)
    });
    const listResult = await list.json();
    assert.deepEqual(listResult.expenses, [expense, (await secondExpenseResponse.json()).expense]);
    assert.equal(listResult.monthTotal, 32);

    const deleted = await fetch(`${baseUrl}/api/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: originHeaders(baseUrl, cookie)
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await fetch(`${baseUrl}/api/expenses`, {
      headers: originHeaders(baseUrl, cookie)
    });
    const afterDeleteResult = await afterDelete.json();
    assert.equal(afterDeleteResult.expenses.length, 1);
    assert.equal(afterDeleteResult.expenses[0].description, 'Passagem de ônibus');
  });
});
