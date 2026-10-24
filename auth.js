const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

function selectForm(mode) {
  const isLogin = mode === 'login';
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
  loginTab.classList.toggle('active', isLogin);
  registerTab.classList.toggle('active', !isLogin);
  loginTab.setAttribute('aria-selected', String(isLogin));
  registerTab.setAttribute('aria-selected', String(!isLogin));
}

function displayMessage(element, message, isError = true) {
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.classList.toggle('success', !isError);
}

async function submitAuthForm(form, endpoint, messageId) {
  const message = document.getElementById(messageId);
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  displayMessage(message, '');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    const result = await response.json();
    if (!response.ok) {
      displayMessage(message, result.error || 'Não foi possível concluir. Tente novamente.');
      return;
    }
    window.location.assign('/');
  } catch {
    displayMessage(message, 'Não foi possível conectar ao servidor. Tente novamente.');
  } finally {
    button.disabled = false;
  }
}

loginTab.addEventListener('click', () => selectForm('login'));
registerTab.addEventListener('click', () => selectForm('register'));
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuthForm(loginForm, '/api/login', 'loginMessage');
});
registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuthForm(registerForm, '/api/register', 'registerMessage');
});
