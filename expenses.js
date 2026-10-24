const expenseForm = document.getElementById('expenseForm');
const expenseFormMessage = document.getElementById('expenseFormMessage');
const expenseMonthTotal = document.getElementById('expenseMonthTotal');
const expenseBarcode = document.getElementById('expenseBarcode');
const scannerVideo = document.getElementById('scannerVideo');
const scannerPlaceholder = document.getElementById('scannerPlaceholder');
const scannerMessage = document.getElementById('scannerMessage');
const startScannerButton = document.getElementById('startScannerButton');
const stopScannerButton = document.getElementById('stopScannerButton');
const logoutButton = document.getElementById('logoutButton');

let cameraStream;
let scanFrame;
let scanner;
let scannerActive = false;
let scanInProgress = false;

function showExpenseMessage(element, message, type = '') {
  element.textContent = message;
  element.classList.toggle('error', type === 'error');
  element.classList.toggle('success', type === 'success');
}

function formatExpenseMoney(amount) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(amount);
}

function formatExpenseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
}

function localDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

async function loadExpenses() {
  try {
    const month = localDateString().slice(0, 7);
    const response = await fetch(`/api/expenses?month=${month}`);
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os gastos.');
    expenseMonthTotal.textContent = formatExpenseMoney(result.monthTotal);
  } catch (error) {
    showExpenseMessage(expenseFormMessage, error.message || 'Não foi possível carregar seus gastos.', 'error');
  }
}

expenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = document.getElementById('saveExpenseButton');
  const formData = new FormData(expenseForm);
  const amount = Number(formData.get('amount'));
  const payload = {
    description: formData.get('description'),
    amount,
    category: formData.get('category'),
    spentOn: formData.get('spentOn'),
    barcode: formData.get('barcode')
  };

  submitButton.disabled = true;
  showExpenseMessage(expenseFormMessage, 'Salvando...');
  try {
    const response = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.status === 401) {
      window.location.replace('/auth.html');
      return;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o gasto.');
    const selectedCategory = expenseForm.elements.category.value;
    expenseForm.reset();
    expenseForm.elements.category.value = selectedCategory;
    expenseForm.elements.spentOn.value = localDateString();
    showExpenseMessage(expenseFormMessage, 'Gasto registrado.', 'success');
    await loadExpenses();
  } catch (error) {
    showExpenseMessage(expenseFormMessage, error.message || 'Não foi possível salvar o gasto.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

function stopScanner(message = 'Câmera desligada.') {
  scannerActive = false;
  if (scanFrame) window.cancelAnimationFrame(scanFrame);
  scanFrame = undefined;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
  }
  scannerVideo.srcObject = null;
  scannerVideo.hidden = true;
  scannerPlaceholder.hidden = false;
  startScannerButton.disabled = false;
  stopScannerButton.disabled = true;
  showExpenseMessage(scannerMessage, message);
}

async function scanNextFrame() {
  if (!scannerActive || scanInProgress || scannerVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (scannerActive) scanFrame = window.requestAnimationFrame(scanNextFrame);
    return;
  }

  scanInProgress = true;
  try {
    const detections = await scanner.detect(scannerVideo);
    if (detections.length > 0) {
      const scannedValue = detections[0].rawValue.trim();
      if (scannedValue.length > 0 && scannedValue.length <= 200) {
        expenseBarcode.value = scannedValue;
        stopScanner('Código lido. Confira o produto e informe o valor pago manualmente.');
        document.querySelector('#expenseForm input[name="description"]').focus();
        return;
      }
      stopScanner('O código lido está vazio ou é longo demais para salvar.');
      return;
    }
  } catch {
    stopScanner('Não foi possível ler esse código. Ajuste a posição e tente novamente.');
    return;
  } finally {
    scanInProgress = false;
  }
  if (scannerActive) scanFrame = window.requestAnimationFrame(scanNextFrame);
}

async function startScanner() {
  if (!window.isSecureContext) {
    showExpenseMessage(scannerMessage, 'A câmera exige uma conexão segura (HTTPS) ou acesso local por localhost.', 'error');
    return;
  }
  if (!('BarcodeDetector' in window)) {
    showExpenseMessage(scannerMessage, 'A leitura pela câmera não é suportada neste navegador. Você ainda pode digitar o código e registrar o gasto manualmente.', 'error');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showExpenseMessage(scannerMessage, 'Este navegador não permite acesso à câmera. Preencha o gasto manualmente.', 'error');
    return;
  }

  startScannerButton.disabled = true;
  try {
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
    const formats = supportedFormats.filter((format) => [
      'qr_code',
      'ean_13',
      'ean_8',
      'upc_a',
      'upc_e',
      'code_128',
      'code_39',
      'itf',
      'data_matrix'
    ].includes(format));
    if (formats.length === 0) {
      showExpenseMessage(scannerMessage, 'Não há formatos de código compatíveis neste navegador. Digite o código manualmente.', 'error');
      startScannerButton.disabled = false;
      return;
    }

    scanner = new window.BarcodeDetector({ formats });
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } }
    });
    scannerVideo.srcObject = cameraStream;
    scannerVideo.hidden = false;
    scannerPlaceholder.hidden = true;
    await scannerVideo.play();
    scannerActive = true;
    stopScannerButton.disabled = false;
    showExpenseMessage(scannerMessage, 'Aponte a câmera para o código. A leitura será interrompida quando ele for reconhecido.');
    scanFrame = window.requestAnimationFrame(scanNextFrame);
  } catch (error) {
    stopScanner(
      error.name === 'NotAllowedError'
        ? 'Permita o acesso à câmera no navegador ou digite o código manualmente.'
        : 'Não foi possível iniciar a câmera. Verifique se ela está disponível e tente novamente.'
    );
    showExpenseMessage(scannerMessage, scannerMessage.textContent, 'error');
  }
}

expenseForm.elements.spentOn.value = localDateString();
startScannerButton.addEventListener('click', startScanner);
stopScannerButton.addEventListener('click', () => stopScanner());
logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/auth.html');
});
window.addEventListener('pagehide', () => stopScanner('Câmera desligada.'));
loadExpenses();
