const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { createServer: createHttpServer } = require('node:http');
const { readFileSync, existsSync, mkdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { promisify } = require('node:util');

const scryptAsync = promisify(scrypt);
const ROOT = __dirname;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const PASSWORD_COST = 32768;
const PASSWORD_BLOCK_SIZE = 8;
const PASSWORD_PARALLELIZATION = 1;
const PASSWORD_KEY_LENGTH = 64;
const MAX_BODY_BYTES = 16 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_SALT = Buffer.from('mymoney-login-timing-salt');
const PUBLIC_FILES = new Set([
  'auth.html',
  'auth.js',
  'index.html',
  'expenses.js',
  'history.js',
  'profile.html',
  'profile.js',
  'script.js',
  'styles.css'
]);

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isUniqueConstraint(error) {
  return error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
    error.message.includes('UNIQUE constraint failed');
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateEmail(email) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

function passwordOptions() {
  return {
    N: PASSWORD_COST,
    r: PASSWORD_BLOCK_SIZE,
    p: PASSWORD_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH, passwordOptions());
  return `scrypt$${PASSWORD_COST}$${PASSWORD_BLOCK_SIZE}$${PASSWORD_PARALLELIZATION}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, cost, blockSize, parallelization, saltHex, keyHex] = storedHash.split('$');
  if (
    algorithm !== 'scrypt' ||
    Number(cost) !== PASSWORD_COST ||
    Number(blockSize) !== PASSWORD_BLOCK_SIZE ||
    Number(parallelization) !== PASSWORD_PARALLELIZATION ||
    !/^[\da-f]{32}$/.test(saltHex || '') ||
    !/^[\da-f]{128}$/.test(keyHex || '')
  ) {
    return false;
  }

  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(
    password,
    Buffer.from(saltHex, 'hex'),
    expected.length,
    passwordOptions()
  );
  return timingSafeEqual(actual, expected);
}

function initializeDatabase(dbPath) {
  const resolvedPath = resolve(dbPath);
  mkdirSync(join(resolvedPath, '..'), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, fileName) {
  const filePath = join(ROOT, fileName);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const contentType = fileName.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : fileName.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'text/javascript; charset=utf-8';
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': fileName.endsWith('.html') ? 'no-store' : 'public, max-age=300'
  });
  response.end(readFileSync(filePath));
}

function readCookie(request, cookieName) {
  const cookies = request.headers.cookie || '';
  const cookie = cookies.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`));
  return cookie ? cookie.slice(cookieName.length + 1) : '';
}

function sessionCookie(token, secure) {
  return `mymoney_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(secure) {
  return `mymoney_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

function getSession(db, request) {
  const token = readCookie(request, 'mymoney_session');
  if (!/^[\da-f]{64}$/.test(token)) return null;

  const session = db.prepare(`
    SELECT users.id, users.name, users.email, sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(hash(token));

  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    return null;
  }
  return { id: session.id, name: session.name, email: session.email };
}

function createFinancialProfile(db, userId) {
  const profile = db.prepare(`
    SELECT monthly_income, fixed_expenses, variable_expenses, investment_goal
    FROM financial_profiles WHERE user_id = ?
  `).get(userId);
  return {
    monthlyIncome: profile.monthly_income / 100,
    fixedExpenses: profile.fixed_expenses / 100,
    variableExpenses: profile.variable_expenses / 100,
    investmentGoal: profile.investment_goal
  };
}

function validFinancialProfile(body) {
  const fields = [
    ['monthlyIncome', 0, 50000],
    ['fixedExpenses', 0, 30000],
    ['variableExpenses', 0, 20000],
    ['investmentGoal', 0, 100]
  ];
  for (const [field, min, max] of fields) {
    if (!Number.isSafeInteger(body[field]) || body[field] < min || body[field] > max) {
      return `O campo ${field} está fora dos limites permitidos.`;
    }
  }
  return null;
}

const EXPENSE_CATEGORIES = new Set([
  'Alimentação',
  'Casa',
  'Mercado',
  'Saúde',
  'Transporte',
  'Outros'
]);

function validateExpense(body) {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category : '';
  const amount = body.amount;
  const spentOn = typeof body.spentOn === 'string' ? body.spentOn : '';
  const barcode = typeof body.barcode === 'string' ? body.barcode.trim() : '';

  if (description.length < 1 || description.length > 120) {
    return { error: 'Informe uma descrição com até 120 caracteres.' };
  }
  if (!EXPENSE_CATEGORIES.has(category)) {
    return { error: 'Selecione uma categoria válida.' };
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return { error: 'Informe um valor maior que zero e até R$ 1.000.000,00.' };
  }
  const parsedDate = new Date(`${spentOn}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== spentOn) {
    return { error: 'Informe uma data válida.' };
  }
  if (barcode.length > 200) {
    return { error: 'O código lido excede o limite permitido.' };
  }
  return {
    expense: {
      description,
      category,
      amountCents: Math.round(amount * 100),
      spentOn,
      barcode: barcode || null
    }
  };
}

function listExpenses(db, userId, { month, category, limit, offset }) {
  const conditions = ['user_id = ?'];
  const parameters = [userId];
  if (month !== 'all') {
    conditions.push('substr(spent_on, 1, 7) = ?');
    parameters.push(month);
  }
  if (category !== 'all') {
    conditions.push('category = ?');
    parameters.push(category);
  }
  const whereClause = conditions.join(' AND ');
  const rows = db.prepare(`
    SELECT id, description, category, amount_cents, spent_on, barcode
    FROM expenses
    WHERE ${whereClause}
    ORDER BY spent_on DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset);
  const filteredTotals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount_cents
    FROM expenses
    WHERE ${whereClause}
  `).get(...parameters);
  const monthlyTotal = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS amount_cents
    FROM expenses
    WHERE user_id = ? AND substr(spent_on, 1, 7) = ?
  `).get(userId, month);
  return {
    expenses: rows.map((row) => ({
      id: row.id,
      description: row.description,
      category: row.category,
      amount: row.amount_cents / 100,
      spentOn: row.spent_on,
      barcode: row.barcode
    })),
    monthTotal: monthlyTotal.amount_cents / 100,
    filteredTotal: filteredTotals.amount_cents / 100,
    totalCount: filteredTotals.count,
    limit,
    offset
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Corpo da requisição excede o limite.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    const error = new Error('Envie os dados em formato JSON válido.');
    error.statusCode = 400;
    throw error;
  }
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function recordFailedLogin(db, addressHash) {
  const timestamp = Date.now();
  const row = db.prepare('SELECT attempts, window_started_at, blocked_until FROM login_attempts WHERE address_hash = ?').get(addressHash);
  if (row?.blocked_until && Date.parse(row.blocked_until) > timestamp) return true;

  const windowIsCurrent = row && timestamp - Date.parse(row.window_started_at) < LOGIN_WINDOW_MS;
  const attempts = windowIsCurrent ? row.attempts + 1 : 1;
  const windowStart = windowIsCurrent ? row.window_started_at : new Date(timestamp).toISOString();
  const blockedUntil = attempts >= LOGIN_MAX_ATTEMPTS
    ? new Date(timestamp + LOGIN_WINDOW_MS).toISOString()
    : null;

  db.prepare(`
    INSERT INTO login_attempts (address_hash, attempts, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(address_hash) DO UPDATE SET
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).run(addressHash, attempts, windowStart, blockedUntil);
  return Boolean(blockedUntil);
}

function loginIsBlocked(db, addressHash) {
  const row = db.prepare('SELECT blocked_until FROM login_attempts WHERE address_hash = ?').get(addressHash);
  return Boolean(row?.blocked_until && Date.parse(row.blocked_until) > Date.now());
}

function createServer({ dbPath = join(ROOT, 'data', 'mymoney.sqlite'), secureCookies = process.env.NODE_ENV === 'production' } = {}) {
  const db = initializeDatabase(dbPath);
  const server = createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      if (['POST', 'PUT', 'DELETE'].includes(request.method) && !requireSameOrigin(request)) {
        sendJson(response, 403, { error: 'Origem da requisição não permitida.' });
        return;
      }

      try {
        if (request.method === 'POST' && pathname === '/api/register') {
          const body = await readJsonBody(request);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const email = normalizeEmail(body.email);
          const password = typeof body.password === 'string' ? body.password : '';
          if (name.length < 2 || name.length > 100) {
            sendJson(response, 400, { error: 'Informe um nome com pelo menos 2 caracteres e no máximo 100.' });
            return;
          }
          if (!validateEmail(email)) {
            sendJson(response, 400, { error: 'Informe um e-mail válido.' });
            return;
          }
          if (password.length < 12 || password.length > 128) {
            sendJson(response, 400, { error: 'A senha deve ter entre 12 e 128 caracteres.' });
            return;
          }

          const passwordHash = await hashPassword(password);
          const timestamp = nowIso();
          try {
            const createUser = db.prepare('INSERT INTO users (name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
            const createProfile = db.prepare('INSERT INTO financial_profiles (user_id, updated_at) VALUES (?, ?)');
            db.exec('BEGIN');
            let userId;
            try {
              const result = createUser.run(name, email, passwordHash, timestamp, timestamp);
              userId = Number(result.lastInsertRowid);
              createProfile.run(userId, timestamp);
              db.exec('COMMIT');
            } catch (error) {
              db.exec('ROLLBACK');
              throw error;
            }
            const token = randomBytes(32).toString('hex');
            db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
              .run(hash(token), userId, new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(), timestamp);
            sendJson(response, 201, {
              user: { id: userId, name, email },
              financialProfile: createFinancialProfile(db, userId)
            }, { 'Set-Cookie': sessionCookie(token, secureCookies) });
          } catch (error) {
            if (isUniqueConstraint(error)) {
              sendJson(response, 400, { error: 'Não foi possível criar a conta com esses dados.' });
              return;
            }
            throw error;
          }
          return;
        }

        if (request.method === 'POST' && pathname === '/api/login') {
          const body = await readJsonBody(request);
          const email = normalizeEmail(body.email);
          const password = typeof body.password === 'string' ? body.password : '';
          const addressHash = hash(request.socket.remoteAddress || 'unknown');
          if (loginIsBlocked(db, addressHash)) {
            sendJson(response, 429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
            return;
          }

          const user = validateEmail(email)
            ? db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email)
            : null;
          const validPassword = user
            ? await verifyPassword(password, user.password_hash)
            : (await scryptAsync(password, DUMMY_SALT, PASSWORD_KEY_LENGTH, passwordOptions()), false);
          if (!user || !validPassword) {
            const blocked = recordFailedLogin(db, addressHash);
            sendJson(response, blocked ? 429 : 401, {
              error: blocked
                ? 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'
                : 'E-mail ou senha inválidos.'
            });
            return;
          }

          db.prepare('DELETE FROM login_attempts WHERE address_hash = ?').run(addressHash);
          const token = randomBytes(32).toString('hex');
          const timestamp = nowIso();
          db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
            .run(hash(token), user.id, new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(), timestamp);
          sendJson(response, 200, {
            user: { id: user.id, name: user.name, email: user.email },
            financialProfile: createFinancialProfile(db, user.id)
          }, { 'Set-Cookie': sessionCookie(token, secureCookies) });
          return;
        }

        const session = getSession(db, request);
        if (request.method === 'POST' && pathname === '/api/logout') {
          if (session) {
            const token = readCookie(request, 'mymoney_session');
            db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
          }
          sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(secureCookies) });
          return;
        }

        if (!session) {
          sendJson(response, 401, { error: 'Sessão expirada ou não autenticada.' });
          return;
        }

        if (request.method === 'GET' && pathname === '/api/expenses') {
          const requestedMonth = url.searchParams.get('month') || nowIso().slice(0, 7);
          const category = url.searchParams.get('category') || 'all';
          const limit = Number(url.searchParams.get('limit') || 200);
          const offset = Number(url.searchParams.get('offset') || 0);
          if (requestedMonth !== 'all' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) {
            sendJson(response, 400, { error: 'Informe um mês válido no formato AAAA-MM.' });
            return;
          }
          if (category !== 'all' && !EXPENSE_CATEGORIES.has(category)) {
            sendJson(response, 400, { error: 'Selecione uma categoria válida.' });
            return;
          }
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
              !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
            sendJson(response, 400, { error: 'Parâmetros de paginação inválidos.' });
            return;
          }
          sendJson(response, 200, listExpenses(db, session.id, {
            month: requestedMonth,
            category,
            limit,
            offset
          }));
          return;
        }

        if (request.method === 'POST' && pathname === '/api/expenses') {
          const body = await readJsonBody(request);
          const validation = validateExpense(body);
          if (validation.error) {
            sendJson(response, 400, { error: validation.error });
            return;
          }
          const { description, category, amountCents, spentOn, barcode } = validation.expense;
          const result = db.prepare(`
            INSERT INTO expenses (user_id, description, category, amount_cents, spent_on, barcode, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(session.id, description, category, amountCents, spentOn, barcode, nowIso());
          sendJson(response, 201, {
            expense: {
              id: Number(result.lastInsertRowid),
              description,
              category,
              amount: amountCents / 100,
              spentOn,
              barcode
            }
          });
          return;
        }

        const expenseMatch = pathname.match(/^\/api\/expenses\/(\d+)$/);
        if (request.method === 'DELETE' && expenseMatch) {
          const result = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
            .run(Number(expenseMatch[1]), session.id);
          if (result.changes === 0) {
            sendJson(response, 404, { error: 'Gasto não encontrado.' });
            return;
          }
          sendJson(response, 200, { ok: true });
          return;
        }

        if (request.method === 'GET' && pathname === '/api/me') {
          sendJson(response, 200, {
            user: { id: session.id, name: session.name, email: session.email },
            financialProfile: createFinancialProfile(db, session.id)
          });
          return;
        }

        if (request.method === 'PUT' && pathname === '/api/financial-profile') {
          const body = await readJsonBody(request);
          const validationError = validFinancialProfile(body);
          if (validationError) {
            sendJson(response, 400, { error: validationError });
            return;
          }
          db.prepare(`
            UPDATE financial_profiles
            SET monthly_income = ?, fixed_expenses = ?, variable_expenses = ?, investment_goal = ?, updated_at = ?
            WHERE user_id = ?
          `).run(body.monthlyIncome * 100, body.fixedExpenses * 100, body.variableExpenses * 100, body.investmentGoal, nowIso(), session.id);
          sendJson(response, 200, { financialProfile: createFinancialProfile(db, session.id) });
          return;
        }

        if (request.method === 'PUT' && pathname === '/api/profile') {
          const body = await readJsonBody(request);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const email = normalizeEmail(body.email);
          const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
          const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
          if (name.length < 2 || name.length > 100) {
            sendJson(response, 400, { error: 'Informe um nome com pelo menos 2 caracteres e no máximo 100.' });
            return;
          }
          if (!validateEmail(email)) {
            sendJson(response, 400, { error: 'Informe um e-mail válido.' });
            return;
          }

          const currentUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.id);
          const needsPasswordChange = newPassword.length > 0;
          if (needsPasswordChange && (newPassword.length < 12 || newPassword.length > 128)) {
            sendJson(response, 400, { error: 'A nova senha deve ter entre 12 e 128 caracteres.' });
            return;
          }
          if (needsPasswordChange && (!currentPassword || !(await verifyPassword(currentPassword, currentUser.password_hash)))) {
            sendJson(response, 400, { error: 'A senha atual não confere.' });
            return;
          }

          const newPasswordHash = needsPasswordChange ? await hashPassword(newPassword) : null;
          try {
            if (newPasswordHash) {
              db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, updated_at = ? WHERE id = ?')
                .run(name, email, newPasswordHash, nowIso(), session.id);
            } else {
              db.prepare('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?')
                .run(name, email, nowIso(), session.id);
            }
          } catch (error) {
            if (isUniqueConstraint(error)) {
              sendJson(response, 400, { error: 'Não foi possível salvar os dados com essas informações.' });
              return;
            }
            throw error;
          }
          if (newPasswordHash) {
            const currentTokenHash = hash(readCookie(request, 'mymoney_session'));
            db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
              .run(session.id, currentTokenHash);
          }

          sendJson(response, 200, { user: { id: session.id, name, email } });
          return;
        }

        sendJson(response, 404, { error: 'Rota não encontrada.' });
      } catch (error) {
        if (error.statusCode) {
          sendJson(response, error.statusCode, { error: error.message });
          return;
        }
        console.error('Falha ao processar requisição da aplicação.');
        sendJson(response, 500, { error: 'Não foi possível concluir a solicitação. Tente novamente.' });
      }
      return;
    }

    const session = getSession(db, request);
    if (pathname === '/' || pathname === '/index.html') {
      if (!session) {
        response.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      sendFile(response, 'index.html');
      return;
    }
    if (pathname === '/profile' || pathname === '/profile.html') {
      if (!session) {
        response.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      sendFile(response, 'profile.html');
      return;
    }
    if (pathname === '/expenses' || pathname === '/expenses.html') {
      if (!session) {
        response.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      sendFile(response, 'expenses.html');
      return;
    }
    if (pathname === '/history' || pathname === '/history.html') {
      if (!session) {
        response.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      sendFile(response, 'history.html');
      return;
    }
    if (pathname === '/auth.html') {
      sendFile(response, 'auth.html');
      return;
    }
    const fileName = pathname.slice(1);
    if (PUBLIC_FILES.has(fileName)) {
      sendFile(response, fileName);
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  });

  server.on('close', () => db.close());
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, () => {
    console.log(`MyMoney disponível em http://localhost:${port}`);
  });
}

module.exports = { createServer };
