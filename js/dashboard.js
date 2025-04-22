// --- DOM Elements ---
const csvFileInput = document.getElementById('csvFileInput');
const periodSelector = document.getElementById('periodSelector');
const categoryFilterContainer = document.getElementById('categoryFilterContainer');
const paymentMethodFilterContainer = document.getElementById('paymentMethodFilterContainer');
const transactionFilterInput = document.getElementById('transactionFilterInput');
const transactionTableBody = document.getElementById('transactionTableBody');
const transactionTableHead = document.querySelector('#transactionDetailsSection table thead');
const categoryTableBody = document.getElementById('categoryTableBody');
const topExpensesList = document.getElementById('topExpensesList');
const totalExpensesEl = document.getElementById('totalExpenses');
const periodComparisonEl = document.getElementById('periodComparison');
const previousPeriodValueEl = document.getElementById('previousPeriodValue');
const loadingMessage = document.getElementById('loadingMessage');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const initialMessage = document.getElementById('initialMessage');
const dashboardContent = document.getElementById('dashboardContent');
const budgetTableBody = document.getElementById('budgetTableBody');
const budgetButton = document.getElementById('budgetButton');
const budgetModal = document.getElementById('budgetModal');
const closeModalButton = document.getElementById('closeModalButton');
const budgetInputContainer = document.getElementById('budgetInputContainer');
const saveBudgetsButton = document.getElementById('saveBudgetsButton');
const cancelBudgetsButton = document.getElementById('cancelBudgetsButton');
const overallBudgetValueEl = document.getElementById('overallBudgetValue');
const overallBudgetProgressEl = document.getElementById('overallBudgetProgress');
const overallBudgetStatusEl = document.getElementById('overallBudgetStatus');
const noTransactionsMessage = document.getElementById('noTransactionsMessage');
const budgetInfoText = document.getElementById('budgetInfoText');

// --- State Variables ---
let allTransactions = [];
let filteredTransactions = [];
let categories = new Set();
let paymentMethods = new Set();
let categoryBudgets = {};
let currentSort = { column: 'invoice_date', direction: 'desc' };
let chartInstances = { category: null, trend: null, paymentMethod: null };

// --- Constants ---
const EXPECTED_HEADERS = ['invoice_number', 'invoice_date', 'total_amount', 'tax', 'products_purchased', 'supplier_name', 'category', 'payment_method'];
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadBudgetsFromLocalStorage();
    setupEventListeners();
    dashboardContent.classList.add('opacity-50', 'pointer-events-none');
    initialMessage.classList.remove('hidden');
    initialMessage.querySelector('p.text-sm').textContent = `Formato esperado: ${EXPECTED_HEADERS.join(', ')}`;
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    csvFileInput.addEventListener('change', handleFileUpload);
    periodSelector.addEventListener('change', handleFiltersChange);
    categoryFilterContainer.addEventListener('change', handleFiltersChange);
    paymentMethodFilterContainer.addEventListener('change', handleFiltersChange);
    transactionFilterInput.addEventListener('input', handleTransactionTextFilter);
    transactionTableHead.addEventListener('click', handleTableSort);
    budgetButton.addEventListener('click', openBudgetModal);
    closeModalButton.addEventListener('click', closeBudgetModal);
    saveBudgetsButton.addEventListener('click', saveBudgets);
    cancelBudgetsButton.addEventListener('click', closeBudgetModal);
    window.addEventListener('click', (event) => {
        if (event.target == budgetModal) {
            closeBudgetModal();
        }
    });
}

// --- File Handling ---
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    resetMessages();
    loadingMessage.classList.remove('hidden');
    dashboardContent.classList.add('opacity-50', 'pointer-events-none');
    initialMessage.classList.add('hidden');

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvText = e.target.result;
            parseCSV(csvText);
            if (allTransactions.length > 0) {
                showSuccessMessage(`Archivo cargado con ${allTransactions.length} transacciones.`);
                populateFilters();
                applyFiltersAndRender();
                dashboardContent.classList.remove('opacity-50', 'pointer-events-none');
            } else {
                showErrorMessage("Archivo procesado, pero no se encontraron transacciones válidas. Verifica el formato.");
                resetDashboard();
                initialMessage.classList.remove('hidden');
            }
        } catch (error) {
            console.error("Error parsing CSV:", error);
            showErrorMessage(`Error al procesar el archivo: ${error.message}`);
            allTransactions = [];
            resetDashboard();
            initialMessage.classList.remove('hidden');
        } finally {
            loadingMessage.classList.add('hidden');
            csvFileInput.value = '';
        }
    };
    reader.onerror = () => {
        showErrorMessage("No se pudo leer el archivo.");
        loadingMessage.classList.add('hidden');
        csvFileInput.value = '';
        initialMessage.classList.remove('hidden');
    };
    reader.readAsText(file, 'UTF-8');
}

// --- CSV Parsing (Refined for Robustness) ---
function parseCSV(csvText) {
    const transactions = [];
    categories.clear();
    paymentMethods.clear();
    allTransactions = [];

    const lines = [];
    let currentLine = '';
    let inQuotes = false;

    csvText = csvText.replace(/\r\n/g, '\n');
    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        currentLine += char;
        if (char === '"') {
            if (inQuotes && csvText[i + 1] === '"') {
                currentLine += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        }
        if (char === '\n' && !inQuotes) {
            lines.push(currentLine.trim());
            currentLine = '';
        }
    }
    if (currentLine.trim()) {
        lines.push(currentLine.trim());
    }
    if (lines.length < 2) {
        throw new Error("El archivo CSV está vacío o no tiene encabezados.");
    }

    const headerLine = lines[0];
    const headers = parseCsvLine(headerLine).map(h => h.toLowerCase());

    const expectedHeadersLower = EXPECTED_HEADERS.map(h => h.toLowerCase());
    const actualHeadersSet = new Set(headers);
    const essential = ['invoice_date', 'total_amount', 'category', 'payment_method'];
    const missing = essential.filter(h => !actualHeadersSet.has(h));
    if (missing.length) {
        throw new Error(`Faltan columnas esenciales: ${missing.join(', ')}.`);
    }
    const headerIndices = {};
    expectedHeadersLower.forEach(h => {
        const idx = headers.indexOf(h);
        if (idx !== -1) headerIndices[h] = idx;
    });

    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) { skipped++; continue; }
        const values = parseCsvLine(line);
        const maxIdx = Math.max(
            headerIndices['invoice_date'],
            headerIndices['total_amount'],
            headerIndices['category'],
            headerIndices['payment_method']
        );
        if (values.length <= maxIdx) { skipped++; continue; }

        const dateStr = values[headerIndices['invoice_date']];
        const amtStr = values[headerIndices['total_amount']];
        const cat = values[headerIndices['category']] || 'Sin Categoría';
        const pay = values[headerIndices['payment_method']] || 'Desconocido';
        if (!dateStr || !amtStr) { skipped++; continue; }
        const dateParts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateParts) { skipped++; continue; }
        const date = new Date(Date.UTC(+dateParts[1], +dateParts[2]-1, +dateParts[3]));
        const amt = parseFloat(amtStr.replace(',', '.'));
        if (isNaN(amt)) { skipped++; continue; }

        transactions.push({
            invoice_number: values[headerIndices['invoice_number']] || '',
            invoice_date: date,
            total_amount: amt,
            products_purchased: values[headerIndices['products_purchased']] || '',
            supplier_name: values[headerIndices['supplier_name']] || '',
            category: cat.trim(),
            payment_method: pay.trim()
        });
        categories.add(cat);
        paymentMethods.add(pay);
    }

    allTransactions = transactions;
    if (allTransactions.length === 0) {
        throw new Error(`Se omitieron ${skipped} líneas; no hay datos válidos.`);
    }
}

// Helper for CSV lines
function parseCsvLine(line) {
    const vals = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQ && line[i+1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if (c === ',' && !inQ) {
            vals.push(cur.trim());
            cur = '';
        } else cur += c;
    }
    vals.push(cur.trim());
    return vals.map(v => v.startsWith('"') && v.endsWith('"')
        ? v.slice(1,-1).replace(/""/g,'"')
        : v);
}

// --- Filters, renderizado y lógica completa (idéntica a tu código original) ---
… (continúa igual; pega todo tu script JS restante) …
