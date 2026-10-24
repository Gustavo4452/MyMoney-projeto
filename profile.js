const profileForm = document.getElementById('profileForm');
const profileMessage = document.getElementById('profileMessage');
const logoutButton = document.getElementById('logoutButton');

function showProfileMessage(message, isError = true) {
  profileMessage.textContent = message;
  profileMessage.classList.toggle('error', isError);
  profileMessage.classList.toggle('success', !isError);
}

async function loadProfile() {
  try {
    const response = await fetch('/api/me');
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    if (!response.ok) throw new Error('Não foi possível carregar o perfil.');
    const { user } = await response.json();
    document.getElementById('profileName').value = user.name;
    document.getElementById('profileEmail').value = user.email;
  } catch {
    showProfileMessage('Não foi possível carregar os dados da conta. Tente novamente.');
  }
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = profileForm.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(profileForm));
  button.disabled = true;
  showProfileMessage('');
  try {
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    if (!response.ok) {
      showProfileMessage(result.error || 'Não foi possível salvar as alterações.');
      return;
    }
    profileForm.elements.currentPassword.value = '';
    profileForm.elements.newPassword.value = '';
    showProfileMessage('Perfil atualizado.', false);
  } catch {
    showProfileMessage('Não foi possível conectar ao servidor. Tente novamente.');
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/auth.html');
});

loadProfile();
