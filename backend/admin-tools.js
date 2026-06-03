// Global state specifically for the admin panel
let isPaused = false;
let isTickInputFocused = false;

// 1. Build and Inject the HTML
function buildAdminPanel() {
    const adminContainer = document.createElement('div');
    adminContainer.id = 'admin-panel';
    // Remove 'display: none' because if this script runs, they are an admin
    adminContainer.style.display = 'flex'; 
    
    adminContainer.innerHTML = `
        <button id="admin-toggle">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path id="admin-arrow" d="M15 18l-6-6 6-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <div class="admin-controls">
            <button id="btn-play-pause" class="admin-round-item" title="Play / Pause">
                <svg id="icon-play" viewBox="0 0 24 24" fill="#fff" style="display: none;"><path d="M8 5v14l11-7z"/></svg>
                <svg id="icon-pause" viewBox="0 0 24 24" fill="#fff" style="display: none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <div class="admin-round-item" title="Set Tick">
                <input type="number" id="input-set-tick" class="admin-num-input" placeholder="0">
            </div>
            <div class="admin-round-item" title="Set Speed (ms)">
                <input type="number" id="input-set-speed" class="admin-num-input" placeholder="ms">
            </div>
            <div class="admin-round-item" title="Fast Forward">
                <input type="number" id="input-fast-forward" class="admin-num-input" placeholder="ticks">
            </div>
            <div class="admin-round-item" title="Bulk Create">
                <input type="number" id="input-bulk-create" class="admin-num-input" placeholder="amount">
            </div>
            <button id="btn-bulk-delete" class="admin-round-item" title="Bulk Delete">
                <svg x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64; fill:#FFFFFF; stroke:#FFFFFF; stroke-width:0.8; stroke-miterlimit:10; padding: 4px;">
                    <path class="st0" d="M56,64l8-8L40,32L64,8l-8-8L32,24L8,0L0,8l24,24L0,56l8,8l24-24L56,64z"/>
                </svg>
            </button>
        </div>
    `;
    document.body.appendChild(adminContainer);
}

// 2. The Main Initialization Function (Called by home.html once loaded)
function initializeAdminEnvironment(initialPaused, initialTick, initialSpeed) {
    isPaused = initialPaused;
    buildAdminPanel();
    
    document.getElementById('input-set-tick').value = initialTick;
    document.getElementById('input-set-speed').value = initialSpeed;
    updatePlayPauseIcon();
    
    setupAdminEventListeners();
    setupAdminSocketListeners();
}

// 3. Setup UI Event Listeners
function setupAdminEventListeners() {
    const panel = document.getElementById('admin-panel');
    const toggleBtn = document.getElementById('admin-toggle');
    const playPauseBtn = document.getElementById('btn-play-pause');
    const tickInput = document.getElementById('input-set-tick');
    const speedInput = document.getElementById('input-set-speed');
    const fastForwardInput = document.getElementById('input-fast-forward');
    const bulkCreateInput = document.getElementById('input-bulk-create');
    const bulkDeleteBtn = document.getElementById('btn-bulk-delete');

    toggleBtn.addEventListener('click', () => panel.classList.toggle('open'));

    tickInput.addEventListener('focus', () => isTickInputFocused = true);
    tickInput.addEventListener('blur', () => isTickInputFocused = false);

    playPauseBtn.addEventListener('click', async () => {
        const action = isPaused ? 'resume' : 'pause';
        await sendAdminCommand(action);
        isPaused = !isPaused;
        updatePlayPauseIcon();
    });

    tickInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const val = parseInt(tickInput.value);
            if (!isNaN(val)) { await sendAdminCommand('set_tick', val); tickInput.blur(); }
        }
    });

    speedInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const val = parseInt(speedInput.value);
            if (!isNaN(val)) { await sendAdminCommand('set_speed', val); speedInput.blur(); }
        }
    });

    fastForwardInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const val = parseInt(fastForwardInput.value);
            if (!isNaN(val)) { await sendAdminCommand('fast_forward', val); fastForwardInput.blur(); }
        }
    });

    bulkCreateInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const val = parseInt(bulkCreateInput.value);
            if (!isNaN(val)) { await generateBulkAgents(val); bulkCreateInput.blur(); }
        }
    });

    bulkDeleteBtn.addEventListener('click', async () => {
        await cleanBulkAgents();
    });
}

// 4. Admin-specific Socket Listeners
function setupAdminSocketListeners() {
    // The main 'socket' variable is global from home.html, we can use it here!
    
    // Update the tick input live (if the admin isn't actively typing in it)
    socket.on('sim_update', (data) => {
        const tickInput = document.getElementById('input-set-tick');
        if (tickInput && !isTickInputFocused) {
            tickInput.value = data.tick;
        }
    });

    socket.on('admin_server_error', (errorData) => {
        console.warn(`🚨 SERVER ERROR: ${errorData.context}`, errorData.details);
        showAdminToast(errorData.context, errorData.details);
    });
}

// 5. Utility Functions
async function sendAdminCommand(action, value = null) {
    try {
        const payload = { action };
        if (value !== null) payload.value = value;
        await fetch('/api/sim/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) { console.error("Admin command failed", err); }
}

function updatePlayPauseIcon() {
    document.getElementById('icon-play').style.display = isPaused ? 'block' : 'none';
    document.getElementById('icon-pause').style.display = isPaused ? 'none' : 'block';
}

async function generateBulkAgents(amount) {
    const inputEl = document.getElementById('input-bulk-create');
    inputEl.disabled = true;
    try {
        const res = await fetch('/api/agents/bulk', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount })
        });
        const data = await res.json();
        if (data.success) inputEl.value = ''; 
        else alert("Error: " + data.message);
    } catch(e) { console.error("Error generating agents:", e); }
    inputEl.disabled = false;
}

async function cleanBulkAgents() {
    if (!confirm("Are you sure? This will permanently delete all bulk-generated agents and their logs.")) return;
    try { await fetch('/api/agents/bulk', { method: 'DELETE' }); } 
    catch(e) { console.error("Error cleaning up:", e); }
}

function showAdminToast(title, message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 9999;
        background: #ff4d4d; color: white; padding: 15px;
        border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        font-family: monospace; max-width: 350px;
    `;
    toast.innerHTML = `<strong>${title}</strong><br><span style="font-size: 0.8em">${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}