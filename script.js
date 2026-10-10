/* ============================================
   KBK DONATION SYSTEM — SHARED JAVASCRIPT
   Uses Supabase for shared storage with a local browser cache
   ============================================ */

const STORAGE_KEY = 'kbk_donations';
const DONOR_KEY = 'kbk_donors';
const BENEFICIARY_KEY = 'kbk_beneficiaries';
const PROJECT_KEY = 'kbk_projects';
const DISTRIBUTION_KEY = 'kbk_distributions';
const EXPENSE_KEY = 'kbk_expenses';
const ASSISTANCE_REQUEST_KEY = 'kbk_assistance_requests';
const ACCOUNT_KEY = 'kbk_accounts';
const ACTIVITY_KEY = 'kbk_activity_log';
const INVENTORY_KEY = 'kbk_inventory';
const FEEDBACK_KEY = 'kbk_public_feedback';
const KBK_CONTACT_EMAIL = 'ryealensarmiento@gmail.com';
const AUTH_KEY = 'kbk_user_logged_in';
const ROLE_KEY = 'kbk_user_role';
const USER_KEY = 'kbk_username';
const SHARED_DATA_KEYS = [
    STORAGE_KEY, DONOR_KEY, BENEFICIARY_KEY, PROJECT_KEY, DISTRIBUTION_KEY,
    EXPENSE_KEY, ACTIVITY_KEY, INVENTORY_KEY
];
let supabaseClient = null;
let supabaseUser = null;
let supabaseInitializationError = null;
const pendingSharedWrites = new Map();
const remoteRevisions = new Map();
let publicUniqueDonorCount = null;
let publicBeneficiariesHelped = null;
let remoteAssistanceRequests = null;
let remoteFeedbackMessages = null;

function showSystemStatus(message, isError = false) {
    let status = document.getElementById('kbkSystemStatus');
    if (!status) {
        status = document.createElement('div');
        status.id = 'kbkSystemStatus';
        status.setAttribute('role', isError ? 'alert' : 'status');
        status.style.cssText = 'position:fixed;z-index:10000;bottom:12px;left:12px;right:12px;max-width:760px;margin:auto;padding:12px 16px;border-radius:8px;background:#fff3cd;color:#664d03;border:1px solid #ffecb5;font:14px/1.45 sans-serif;box-shadow:0 2px 10px #0002';
        document.body.appendChild(status);
    }
    status.textContent = message;
    status.style.background = isError ? '#f8d7da' : '#fff3cd';
    status.style.color = isError ? '#842029' : '#664d03';
    status.style.borderColor = isError ? '#f5c2c7' : '#ffecb5';
    status.setAttribute('role', isError ? 'alert' : 'status');
    if (isError && pendingSharedWrites.size && !message.includes('Another administrator changed')) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.textContent = 'Retry sync';
        retryButton.style.cssText = 'margin-left:12px;padding:5px 10px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;cursor:pointer';
        retryButton.addEventListener('click', retryPendingSharedWrites);
        status.appendChild(retryButton);
    }
}

function clearSystemStatus() {
    document.getElementById('kbkSystemStatus')?.remove();
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Unable to load ${src}. Check your network and hosting settings.`));
        document.head.appendChild(script);
    });
}

async function initializeSupabaseClient() {
    if (!window.KBK_SUPABASE_CONFIG?.url || !window.KBK_SUPABASE_CONFIG?.anonKey
        || window.KBK_SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID')
        || window.KBK_SUPABASE_CONFIG.anonKey.includes('YOUR_SUPABASE')) {
        try {
            await loadScript('supabase-config.js');
        } catch {
            throw new Error('Supabase is not configured. Create supabase-config.js from supabase-config.example.js and enter the project URL and publishable key.');
        }
    }
    const config = window.KBK_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey || config.url.includes('YOUR_PROJECT_ID')
        || config.anonKey.includes('YOUR_SUPABASE')) {
        throw new Error('Supabase is not configured. Create supabase-config.js from supabase-config.example.js and enter the project URL and publishable key.');
    }
    let projectUrl;
    try {
        projectUrl = new URL(config.url);
    } catch {
        throw new Error('The Supabase URL is invalid. Use the project URL, for example https://YOUR_PROJECT_ID.supabase.co.');
    }
    if (!['https:', 'http:'].includes(projectUrl.protocol)
        || !['', '/'].includes(projectUrl.pathname)
        || projectUrl.search || projectUrl.hash) {
        throw new Error('Use the Supabase project URL (https://YOUR_PROJECT_ID.supabase.co), not an API endpoint such as /rest/v1/.');
    }
    if (!window.supabase?.createClient) {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js');
    }
    if (!window.supabase?.createClient) throw new Error('Supabase client did not load.');
    supabaseClient = window.supabase.createClient(projectUrl.origin, config.anonKey);
}

function cacheRemoteValue(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        throw new Error(`Unable to cache shared ${key} data in this browser: ${error.message}`);
    }
}

async function loadAdminSharedData() {
    const { data, error } = await supabaseClient
        .from('kbk_app_data')
        .select('data_key,data,revision');
    if (error) throw new Error(`Unable to load shared KBK records: ${error.message}`);

    const remoteData = new Map(data.map(row => [row.data_key, row]));
    const missingKeys = [];
    SHARED_DATA_KEYS.forEach(key => {
        if (remoteData.has(key)) {
            const row = remoteData.get(key);
            cacheRemoteValue(key, row.data);
            remoteRevisions.set(key, row.revision);
        } else {
            cacheRemoteValue(key, []);
            missingKeys.push({ data_key: key, data: [], updated_by: supabaseUser.id, revision: 1 });
        }
    });
    if (missingKeys.length) {
        const { error: insertError } = await supabaseClient.from('kbk_app_data').upsert(missingKeys, { onConflict: 'data_key' });
        if (insertError) throw new Error(`Unable to initialize shared KBK records: ${insertError.message}`);
        missingKeys.forEach(row => remoteRevisions.set(row.data_key, row.revision));
    }
}

function preserveLegacyBrowserData() {
    SHARED_DATA_KEYS.forEach(key => {
        const legacyValue = localStorage.getItem(key);
        const backupKey = `kbk_legacy_backup_${key}`;
        if (legacyValue && !localStorage.getItem(backupKey)) localStorage.setItem(backupKey, legacyValue);
    });
}

async function loadPublicSharedData() {
    const { data, error } = await supabaseClient.rpc('kbk_public_snapshot');
    if (error) throw new Error(`Unable to load public transparency data: ${error.message}`);
    publicUniqueDonorCount = Number.isInteger(data?.kbk_public_metadata?.uniqueDonors)
        ? data.kbk_public_metadata.uniqueDonors : null;
    publicBeneficiariesHelped = Number.isInteger(data?.kbk_public_metadata?.beneficiariesHelped)
        ? data.kbk_public_metadata.beneficiariesHelped : null;
    for (const key of SHARED_DATA_KEYS) {
        if (Object.prototype.hasOwnProperty.call(data, key)) cacheRemoteValue(key, data[key]);
        else cacheRemoteValue(key, []);
    }
}

async function loadAdminAssistanceRequests() {
    if (!supabaseClient || !supabaseUser || getUserRole() !== 'admin') {
        throw new Error('A signed-in KBK administrator is required to load assistance requests.');
    }
    const { data, error } = await supabaseClient
        .from('kbk_assistance_requests')
        .select('id,requester_name,contact,assistance_type,quantity,description,status,submitted_at,reviewed_at')
        .order('submitted_at', { ascending: false });
    if (error) throw new Error(error.message);
    remoteAssistanceRequests = data.map(request => ({
        id: request.id,
        name: request.requester_name || '',
        contact: request.contact,
        type: request.assistance_type,
        quantity: request.quantity || '',
        description: request.description,
        status: request.status,
        submittedAt: request.submitted_at,
        reviewedAt: request.reviewed_at
    }));
}

async function loadAdminFeedbackMessages() {
    if (!supabaseClient || !supabaseUser || getUserRole() !== 'admin') {
        throw new Error('A signed-in KBK administrator is required to load contact messages.');
    }
    const { data, error } = await supabaseClient
        .from('kbk_public_feedback_messages')
        .select('id,requester_name,contact,subject,message,status,submitted_at')
        .order('submitted_at', { ascending: false });
    if (error) throw new Error(error.message);
    remoteFeedbackMessages = data.map(item => ({
        id: item.id,
        name: item.requester_name || '',
        contact: item.contact,
        subject: item.subject,
        message: item.message,
        status: item.status,
        submittedAt: item.submitted_at
    }));
}

async function initializeSupabaseForPage(page) {
    try {
        localStorage.removeItem(ACCOUNT_KEY);
        await initializeSupabaseClient();
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw new Error(`Unable to check sign-in status: ${error.message}`);

        if (session) {
            const { data: profile, error: profileError } = await supabaseClient
                .from('kbk_profiles')
                .select('username,role,active')
                .eq('user_id', session.user.id)
                .maybeSingle();
            if (profileError) throw new Error(`Unable to verify your KBK account: ${profileError.message}`);
            if (!profile || !profile.active || !['admin', 'staff'].includes(String(profile.role).toLowerCase())) {
                await supabaseClient.auth.signOut();
                clearAuthSession();
                throw new Error('This account is not active for the KBK system. Contact an administrator.');
            }
            supabaseUser = session.user;
            sessionStorage.setItem(AUTH_KEY, 'true');
            sessionStorage.setItem(ROLE_KEY, String(profile.role).toLowerCase());
            sessionStorage.setItem(USER_KEY, profile.username);
        } else {
            clearAuthSession();
        }

        if (page === 'dashboard') {
            if (!session) return;
            preserveLegacyBrowserData();
            if (String(sessionStorage.getItem(ROLE_KEY)).toLowerCase() === 'admin') await loadAdminSharedData();
            else {
                const { data, error: readError } = await supabaseClient.from('kbk_app_data').select('data_key,data');
                if (readError) throw new Error(`Unable to load shared KBK records: ${readError.message}`);
                const remoteData = new Map(data.map(row => [row.data_key, row.data]));
                SHARED_DATA_KEYS.forEach(key => cacheRemoteValue(key, remoteData.get(key) ?? []));
            }
        } else if (page === 'public') {
            await loadPublicSharedData();
        }
        clearSystemStatus();
    } catch (error) {
        clearAuthSession();
        supabaseInitializationError = error;
        console.error('Supabase initialization failed.', error);
        showSystemStatus(error.message, true);
    }
}

function persistSharedData(key, value) {
    if (!SHARED_DATA_KEYS.includes(key) || !supabaseClient || !supabaseUser) return;
    const previousWrite = pendingSharedWrites.get(key) || Promise.resolve();
    const nextWrite = previousWrite.catch(() => {}).then(async () => {
        const revision = remoteRevisions.get(key);
        if (!Number.isInteger(revision)) throw new Error('This record has no loaded server revision. Reload the page before saving.');
        const { data, error } = await supabaseClient.from('kbk_app_data').update({
            data: value,
            updated_by: supabaseUser.id,
            updated_at: new Date().toISOString(),
            revision: revision + 1
        }).eq('data_key', key).eq('revision', revision).select('revision').maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error('Another administrator changed this data after you opened the page. Reload before making further changes.');
        remoteRevisions.set(key, data.revision);
    });
    pendingSharedWrites.set(key, nextWrite);
    nextWrite.then(() => {
        if (pendingSharedWrites.get(key) === nextWrite) pendingSharedWrites.delete(key);
        if (!pendingSharedWrites.size) clearSystemStatus();
    }).catch(error => {
        console.error(`Unable to sync ${key} with Supabase.`, error);
        showSystemStatus(`A change to shared ${key.replace('kbk_', '').replace(/_/g, ' ')} did not sync: ${error.message}. Your browser has an unsynced local copy; ask an administrator to retry before using another device.`, true);
    });
    return nextWrite;
}

async function retryPendingSharedWrites() {
    const retryButton = document.querySelector('#kbkSystemStatus button');
    if (retryButton) retryButton.disabled = true;
    try {
        const retries = [...pendingSharedWrites.keys()].map(key => {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            if (!Array.isArray(value)) throw new Error(`The local ${key} copy is not a valid record list.`);
            return persistSharedData(key, value);
        });
        await Promise.all(retries);
        clearSystemStatus();
    } catch (error) {
        console.error('Unable to retry shared-data synchronization.', error);
        showSystemStatus(`Shared-data synchronization still failed: ${error.message}`, true);
    }
}

/* ---------- DEFAULT SEED DATA ---------- */
const DEFAULT_DONATIONS = [
    { id: 1, donor: 'Juan Dela Cruz', type: 'cash', amount: 500, item: '', category: 'Fiesta Project', date: '2026-09-06', status: 'verified' },
    { id: 2, donor: 'Maria Santos', type: 'cash', amount: 1000, item: '', category: 'Feeding Program', date: '2026-09-05', status: 'verified' },
    { id: 3, donor: 'Pedro Reyes', type: 'in-kind', amount: 0, item: 'rice', quantity: 10, unit: 'sacks', category: 'Feeding Program', date: '2026-09-04', status: 'received' },
    { id: 4, donor: 'Ana Lopez', type: 'cash', amount: 2500, item: '', category: 'Education Fund', date: '2026-09-03', status: 'allocated' },
    { id: 5, donor: 'Carlos Mendoza', type: 'cash', amount: 1500, item: '', category: 'Medical Assistance', date: '2026-09-02', status: 'verified' },
    { id: 6, donor: 'Liza Cruz', type: 'in-kind', amount: 0, item: 'canned goods', quantity: 5, unit: 'boxes', category: 'Feeding Program', date: '2026-09-01', status: 'verified' }
];

const DONATION_STATUSES = ['received', 'verified', 'allocated', 'distributed', 'completed', 'rejected'];
const DISTRIBUTION_STATUSES = ['Planned', 'Distributed', 'Completed'];
const PUBLIC_DISTRIBUTION_CATEGORIES = ['Food Packs', 'School Supplies', 'Hygiene Kits', 'Medical Assistance', 'Cash Assistance', 'Other Support'];

const DEFAULT_DONORS = [
    { id: 1, name: 'Juan Dela Cruz', type: 'Individual', email: 'juan.delacruz@example.com', phone: '0917-123-4567', organization: '', status: 'active', lastDonation: '2026-09-06' },
    { id: 2, name: 'Maria Santos', type: 'Individual', email: 'maria.santos@example.com', phone: '0918-765-4321', organization: '', status: 'active', lastDonation: '2026-09-05' },
    { id: 3, name: 'Pedro Reyes', type: 'Business', email: 'pedro.reyes@harvestco.ph', phone: '0922-334-9901', organization: 'Harvest Co.', status: 'active', lastDonation: '2026-09-04' },
    { id: 4, name: 'Ana Lopez', type: 'Organization', email: 'ana@communitycare.ph', phone: '0998-112-7745', organization: 'Community Care Inc.', status: 'active', lastDonation: '2026-09-03' },
    { id: 5, name: 'Carlos Mendoza', type: 'Individual', email: 'carlos.mendoza@example.com', phone: '0933-889-2211', organization: '', status: 'inactive', lastDonation: '2026-09-02' }
];

const DEFAULT_BENEFICIARIES = [
    { id: 1, name: 'Rosa Mendoza', type: 'Individual', contact: '0917-555-0140', location: 'Barangay San Isidro', notes: 'Senior citizen', assistance: [{ date: '2026-09-06', description: 'Food pack', value: 'Rice, canned goods, and cooking oil' }] },
    { id: 2, name: 'Santos Family', type: 'Family', contact: '0918-555-0182', location: 'Barangay Mabini', notes: 'Five household members', assistance: [{ date: '2026-09-04', description: 'Emergency grocery assistance', value: '₱1,500.00' }] },
    { id: 3, name: 'San Isidro Youth Group', type: 'Group', contact: '0922-555-0166', location: 'Barangay San Isidro', notes: '', assistance: [] }
];

const DEFAULT_PROJECTS = [
    { id: 1, name: 'Back-to-School Drive', budget: 30000, description: 'School supplies and learning support', status: 'Active', donationIds: [] },
    { id: 2, name: 'Food Distribution', budget: 20000, description: 'Food packs for local families', status: 'Active', donationIds: [] },
    { id: 3, name: 'Christmas Giving', budget: 25000, description: 'Seasonal community giving', status: 'Planned', donationIds: [] },
    { id: 4, name: 'Youth Outreach', budget: 12000, description: 'Youth engagement and activities', status: 'Active', donationIds: [] },
    { id: 5, name: 'Community Assistance', budget: 18000, description: 'Emergency and community support', status: 'Active', donationIds: [] }
];

/* ---------- DATA HELPERS ---------- */
function getDonations() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_DONATIONS));
        return [...DEFAULT_DONATIONS];
    }
    try {
        const donations = JSON.parse(raw);
        if (!Array.isArray(donations)) throw new Error('Donation storage must contain a list.');
        const hasTrackingCodes = donations.some(donation => Object.prototype.hasOwnProperty.call(donation, 'trackingCode'));
        const cleanedDonations = donations.map(donation => {
            const cleanDonation = { ...donation };
            delete cleanDonation.trackingCode;
            return {
                ...normalizeInKindDonation(cleanDonation),
                status: normalizeDonationStatus(cleanDonation.status),
                allocations: Array.isArray(cleanDonation.allocations) ? cleanDonation.allocations : []
            };
        });
        if (hasTrackingCodes) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedDonations));
            } catch (error) {
                console.error('Unable to remove obsolete donation tracking codes from browser storage.', error);
            }
        }
        return cleanedDonations;
    } catch (error) {
        console.error('Unable to read saved donations.', error);
        return [...DEFAULT_DONATIONS];
    }
}

function getDonationDonorName(donation) {
    if (donation.donorId != null) {
        const linkedDonor = getDonors().find(donor => String(donor.id) === String(donation.donorId));
        if (linkedDonor) return linkedDonor.name;
    }
    return String(donation.donor || '').trim() || 'Anonymous Donor';
}

function getDonationDonorProfile(donation) {
    return donation.donorId == null
        ? null
        : getDonors().find(donor => String(donor.id) === String(donation.donorId)) || null;
}

function populateDonationDonorOptions(selectedValue = '', searchValue = '') {
    const select = document.getElementById('donorSelection');
    if (!select) return;
    const query = searchValue.trim().toLocaleLowerCase();
    const donors = getDonors().filter(donor =>
        !query ||
        String(donor.name || '').toLocaleLowerCase().includes(query) ||
        String(donor.organization || '').toLocaleLowerCase().includes(query)
    ).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    select.innerHTML = [
        '<option value="">Select a donor</option>',
        ...donors.map(donor => `<option value="${escapeHtml(String(donor.id))}">${escapeHtml(donor.name)}${donor.organization ? ` — ${escapeHtml(donor.organization)}` : ''}</option>`),
        '<option value="__new__">Add a new donor</option>',
        '<option value="__anonymous__">Anonymous / identity not provided</option>'
    ].join('');
    select.value = selectedValue;
    updateDonationDonorFields();
}

function updateDonationDonorFields() {
    const selection = document.getElementById('donorSelection');
    const nameInput = document.getElementById('donorName');
    const newDonorGroup = document.getElementById('newDonorGroup');
    const recognitionLabel = document.getElementById('donorPublicRecognitionLabel');
    const recognition = document.getElementById('donorPublicRecognition');
    if (!selection || !nameInput || !newDonorGroup || !recognitionLabel || !recognition) return;

    const isNewDonor = selection.value === '__new__';
    const isAnonymous = selection.value === '__anonymous__';
    newDonorGroup.hidden = !isNewDonor;
    nameInput.required = isNewDonor;
    recognitionLabel.hidden = isAnonymous;
    if (isAnonymous) recognition.checked = false;
}

function migrateDonationDonorLinks() {
    if (getUserRole() !== 'admin') return;
    const donors = getDonors();
    const donations = getDonations();
    const donorIdsByName = new Map();
    donors.forEach(donor => {
        const name = String(donor.name || '').trim().toLocaleLowerCase();
        if (!name) return;
        const ids = donorIdsByName.get(name) || [];
        ids.push(donor.id);
        donorIdsByName.set(name, ids);
    });

    let changed = false;
    donations.forEach(donation => {
        if (donation.donorId != null || !String(donation.donor || '').trim()) return;
        const matches = donorIdsByName.get(String(donation.donor).trim().toLocaleLowerCase()) || [];
        if (matches.length !== 1) return;
        donation.donorId = matches[0];
        changed = true;
    });
    if (changed) saveDonations(donations);
}

function resolveDonationDonor(selection, enteredName) {
    if (selection === '__anonymous__') {
        return { donorId: null, donor: 'Anonymous Donor', anonymous: true };
    }
    const donors = getDonors();
    if (selection === '__new__') {
        const name = enteredName.trim();
        if (!name) throw new Error('Enter the new donor’s name.');
        const matchingDonors = donors.filter(donor =>
            String(donor.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase()
        );
        if (matchingDonors.length > 1) {
            throw new Error('More than one donor profile has this name. Select the correct existing donor or resolve the duplicate profiles first.');
        }
        if (matchingDonors.length === 1) {
            return { donorId: matchingDonors[0].id, donor: matchingDonors[0].name, anonymous: false };
        }
        const donor = {
            id: nextId(donors),
            name,
            type: 'Individual',
            email: '',
            phone: '',
            organization: '',
            status: 'active',
            lastDonation: ''
        };
        saveDonors([...donors, donor]);
        document.getElementById('donationDonorSearch').value = '';
        populateDonationDonorOptions(String(donor.id));
        return { donorId: donor.id, donor: donor.name, anonymous: false };
    }
    const donor = donors.find(item => String(item.id) === selection);
    if (!donor) throw new Error('That donor profile is no longer available. Refresh the donor list and select again.');
    return { donorId: donor.id, donor: donor.name, anonymous: false };
}

function saveDonations(list) {
    const cleanedDonations = list.map(donation => {
        const cleanDonation = { ...donation };
        delete cleanDonation.trackingCode;
        return cleanDonation;
    });
    saveStoredList(STORAGE_KEY, cleanedDonations);
}

function getDonors() {
    const raw = localStorage.getItem(DONOR_KEY);
    if (!raw) {
        localStorage.setItem(DONOR_KEY, JSON.stringify(DEFAULT_DONORS));
        return [...DEFAULT_DONORS];
    }
    try { return JSON.parse(raw); } catch { return [...DEFAULT_DONORS]; }
}

function saveDonors(list) {
    saveStoredList(DONOR_KEY, list);
}

function getBeneficiaries() {
    const raw = localStorage.getItem(BENEFICIARY_KEY);
    if (!raw) {
        localStorage.setItem(BENEFICIARY_KEY, JSON.stringify(DEFAULT_BENEFICIARIES));
        return DEFAULT_BENEFICIARIES.map(beneficiary => ({ ...beneficiary, assistance: [...beneficiary.assistance] }));
    }
    try {
        const beneficiaries = JSON.parse(raw);
        if (!Array.isArray(beneficiaries)) throw new Error('Beneficiary storage must contain a list.');
        return beneficiaries.map(beneficiary => ({ ...beneficiary, assistance: Array.isArray(beneficiary.assistance) ? beneficiary.assistance : [] }));
    } catch (error) {
        console.error('Unable to read saved beneficiaries.', error);
        return [];
    }
}

function saveBeneficiaries(list) {
    saveStoredList(BENEFICIARY_KEY, list);
}

function readStoredList(key, label, defaults = []) {
    const raw = localStorage.getItem(key);
    if (!raw) {
        localStorage.setItem(key, JSON.stringify(defaults));
        return [...defaults];
    }
    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) throw new Error(`${label} storage must contain a list.`);
        return list;
    } catch (error) {
        console.error(`Unable to read saved ${label}.`, error);
        return [];
    }
}

function saveStoredList(key, list) {
    localStorage.setItem(key, JSON.stringify(list));
    return persistSharedData(key, list);
}

function getProjects() {
    return readStoredList(PROJECT_KEY, 'projects', DEFAULT_PROJECTS);
}

function getDistributions() {
    return readStoredList(DISTRIBUTION_KEY, 'distributions');
}

function getExpenses() {
    return readStoredList(EXPENSE_KEY, 'expenses');
}

function getAssistanceRequests() {
    return readStoredList(ASSISTANCE_REQUEST_KEY, 'assistance requests');
}

function getActivityLog() {
    return readStoredList(ACTIVITY_KEY, 'activity log');
}

function getInventory() {
    return readStoredList(INVENTORY_KEY, 'inventory');
}

function getPublicFeedback() {
    return readStoredList(FEEDBACK_KEY, 'public feedback');
}

function logActivity(action) {
    const activity = getActivityLog();
    activity.unshift({ action, user: sessionStorage.getItem(USER_KEY) || sessionStorage.getItem(ROLE_KEY) || 'unknown', date: new Date().toISOString() });
    const save = saveStoredList(ACTIVITY_KEY, activity.slice(0, 100));
    renderActivityLog();
    return save;
}

function nextId(list) {
    return list.length ? Math.max(...list.map(d => d.id)) + 1 : 1;
}

/* ---------- FORMATTERS ---------- */
function peso(n) {
    return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function normalizeDonationStatus(status) {
    if (status === 'pending') return 'received';
    return DONATION_STATUSES.includes(status) ? status : 'received';
}

function donationReference(id) {
    return `DON-${String(id).padStart(4, '0')}`;
}

function normalizeInKindDonation(donation) {
    if (donation.type !== 'in-kind') return donation;
    const normalized = { ...donation };
    if (Number.isFinite(Number(normalized.quantity)) && Number(normalized.quantity) > 0 && normalized.unit) {
        normalized.quantity = Number(normalized.quantity);
        normalized.unit = String(normalized.unit).trim().toLowerCase();
        return normalized;
    }
    const legacyItem = String(normalized.item || '');
    const match = legacyItem.match(/^\s*(\d+(?:\.\d+)?)\s+(pieces?|pcs?|items?|sets?|packs?|boxes?|sacks?|bags?|bottles?|cans?|kilograms?|kgs?|grams?|g|kg|liters?|litres?)\s+(?:of\s+)?(.*)$/i);
    if (!match) {
        normalized.quantity = null;
        normalized.unit = '';
        return normalized;
    }
    const unitAliases = {
        piece: 'pieces', pieces: 'pieces', pc: 'pieces', pcs: 'pieces',
        item: 'items', items: 'items', set: 'sets', sets: 'sets',
        pack: 'packs', packs: 'packs', box: 'boxes', boxes: 'boxes',
        sack: 'sacks', sacks: 'sacks', bag: 'bags', bags: 'bags',
        bottle: 'bottles', bottles: 'bottles', can: 'cans', cans: 'cans',
        kilogram: 'kg', kilograms: 'kg', kg: 'kg', kgs: 'kg',
        gram: 'g', grams: 'g', g: 'g', liter: 'liters', liters: 'liters',
        litre: 'liters', litres: 'liters'
    };
    normalized.quantity = Number(match[1]);
    normalized.unit = unitAliases[match[2].toLowerCase()] || match[2].toLowerCase();
    normalized.item = match[3].trim() || 'Donated items';
    return normalized;
}

function formatInKindDonation(donation) {
    const normalized = normalizeInKindDonation(donation);
    if (!Number.isFinite(Number(normalized.quantity)) || Number(normalized.quantity) <= 0 || !normalized.unit) {
        return normalized.item || 'In-kind donation';
    }
    return `${Number(normalized.quantity).toLocaleString('en-PH')} ${normalized.unit} of ${normalized.item || 'Donated items'}`;
}

function formatInKindTotals(donations) {
    const totals = new Map();
    donations.filter(donation => donation.type === 'in-kind').forEach(donation => {
        const normalized = normalizeInKindDonation(donation);
        if (!Number.isFinite(Number(normalized.quantity)) || Number(normalized.quantity) <= 0 || !normalized.unit) return;
        const item = String(normalized.item || 'Donated items').trim();
        const key = `${normalized.unit.toLowerCase()}|${item.toLowerCase()}`;
        const current = totals.get(key) || { unit: normalized.unit, item, quantity: 0 };
        current.quantity += Number(normalized.quantity);
        totals.set(key, current);
    });
    return [...totals.values()]
        .map(({ unit, item, quantity }) => `${quantity.toLocaleString('en-PH')} ${unit} of ${item}`)
        .join(' · ') || '0';
}

/* ---------- STATS ---------- */
function computeStats(list = getDonations()) {
    const totalCash = list.filter(d => d.type === 'cash').reduce((s, d) => s + Number(d.amount || 0), 0);
    const uniqueDonors = new Set(list.map(d =>
        d.donorId != null
            ? `id:${d.donorId}`
            : `name:${String(d.donor || '').trim().toLocaleLowerCase()}`
    ).filter(key => key !== 'name:')).size;
    const inKindCount = list.filter(d => d.type === 'in-kind').length;
    const inKindUnits = formatInKindTotals(list);
    const cashCount = list.filter(d => d.type === 'cash').length;
    return { totalCash, uniqueDonors, inKindCount, inKindUnits, cashCount, totalCount: list.length };
}

function computePublicStats(donations) {
    const verifiedDonations = donations.filter(donation =>
        ['verified', 'allocated', 'distributed', 'completed'].includes(String(donation.status).toLowerCase())
    );
    const cashDonations = verifiedDonations.filter(donation => donation.type === 'cash');
    const totalCash = cashDonations.reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
    const allocated = cashDonations.reduce((sum, donation) => sum + (Array.isArray(donation.allocations)
        ? donation.allocations.reduce((allocationSum, allocation) => allocationSum + Number(allocation.amount || 0), 0)
        : 0), 0);
    const used = getExpenses()
        .filter(expense => expense.verified === true)
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const beneficiaries = getBeneficiaries();
    const beneficiaryIds = new Set(beneficiaries.filter(beneficiary => beneficiary.id != null).map(beneficiary => String(beneficiary.id)));
    const distributions = getDistributions();
    const helpedBeneficiaryIds = new Set();
    beneficiaries.forEach(beneficiary => {
        if (beneficiary.id == null) return;
        const planned = distributions.filter(distribution =>
            String(distribution.beneficiaryId) === String(beneficiary.id) &&
            String(distribution.status).toLowerCase() === 'planned'
        );
        const plannedAssistance = new Map();
        planned.forEach(distribution => {
            const key = JSON.stringify([
                distribution.date,
                distribution.itemAmount,
                distribution.quantity || distribution.itemAmount
            ]);
            plannedAssistance.set(key, (plannedAssistance.get(key) || 0) + 1);
        });
        const hasRecordedHelp = beneficiary.assistance.some(assistance => {
            const key = JSON.stringify([assistance.date, assistance.description, assistance.value]);
            const plannedCount = plannedAssistance.get(key) || 0;
            if (plannedCount === 0) return true;
            plannedAssistance.set(key, plannedCount - 1);
            return false;
        });
        if (hasRecordedHelp) helpedBeneficiaryIds.add(String(beneficiary.id));
    });

    distributions
        .filter(distribution => ['distributed', 'completed'].includes(String(distribution.status).toLowerCase()))
        .filter(distribution => distribution.beneficiaryId != null && beneficiaryIds.has(String(distribution.beneficiaryId)))
        .forEach(distribution => helpedBeneficiaryIds.add(String(distribution.beneficiaryId)));

    return {
        totalCash,
        allocated,
        used,
        beneficiariesHelped: helpedBeneficiaryIds.size,
        activeProjects: getProjects().filter(project => String(project.status).toLowerCase() === 'active').length
    };
}

/* ---------- AUTH ---------- */
function isLoggedIn() {
    return sessionStorage.getItem(AUTH_KEY) === 'true';
}

function getUserRole() {
    return sessionStorage.getItem(ROLE_KEY) || 'guest';
}

function clearAuthSession() {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(USER_KEY);
}

function requireAuth() {
    if (!isLoggedIn() || !['admin', 'staff'].includes(getUserRole())) {
        clearAuthSession();
        window.location.replace('login.html');
        return false;
    }
    return true;
}

async function logout() {
    try {
        await logActivity('Logged out');
    } catch (error) {
        console.error('Unable to record logout activity.', error);
    } finally {
        if (supabaseClient) {
            const { error } = await supabaseClient.auth.signOut();
            if (error) {
                console.error('Unable to end the Supabase session.', error);
                showSystemStatus(`Unable to sign out securely: ${error.message}`, true);
                return;
            }
        }
        clearAuthSession();
        window.location.replace('login.html?loggedOut=1');
    }
}

/* ---------- RENDER: PUBLIC PAGE ---------- */
let selectedCategory = null;

function updatePublicDataStatus() {
    const status = document.getElementById('publicDataStatus');
    if (!status) return;
    if (supabaseInitializationError) {
        status.hidden = false;
        status.textContent = 'Live community data could not be loaded. Any figures shown may be saved in this browser and could be out of date; please try again later.';
        return;
    }
    status.hidden = true;
}

function renderPublicPage() {
    updatePublicDataStatus();
    const publicDonations = getDonations().filter(donation =>
        ['verified', 'allocated', 'distributed', 'completed'].includes(String(donation.status).toLowerCase())
    );
    const stats = computeStats(publicDonations);
    const publicStats = computePublicStats(publicDonations);

    setText('publicTotal', peso(stats.totalCash));
    setText('publicCashTotal', peso(stats.totalCash));
    setText('publicDonors', publicUniqueDonorCount ?? stats.uniqueDonors);
    setText('publicInKind', stats.inKindUnits);
    setText('publicInKindRecords', publicDonations.filter(donation => donation.type === 'in-kind').length);
    setText('publicVerifiedCount', publicDonations.length);
    const beneficiariesHelped = publicBeneficiariesHelped ?? publicStats.beneficiariesHelped;
    setText('publicBeneficiaries', beneficiariesHelped);
    setText('publicAllocated', peso(publicStats.allocated));
    setText('publicUsed', peso(publicStats.used));
    setText('publicHelped', beneficiariesHelped);
    setText('publicProjects', publicStats.activeProjects);

    const totalCash = publicStats.totalCash;
    [
        ['publicAllocatedProgress', 'publicAllocatedPercent', publicStats.allocated],
        ['publicUsedProgress', 'publicUsedPercent', publicStats.used]
    ].forEach(([progressId, percentId, amount]) => {
        const percentage = totalCash > 0 ? amount / totalCash * 100 : 0;
        const progress = document.getElementById(progressId);
        if (progress) progress.value = Math.min(percentage, 100);
        setText(percentId, `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`);
    });
    renderPublicImpact(publicDonations);
    renderPublicCampaignProgress(publicDonations);
    renderPublicProjectTransparency(publicDonations);
    renderPublicNeeds();
    renderPublicDonorRecognition(publicDonations);
    renderPublicDonationList(publicDonations);
    renderPublicDistributions();
    renderPublicProjects();
    renderPublicNews();
    document.querySelectorAll('.public-dashboard-page [aria-busy="true"]').forEach(container => {
        container.setAttribute('aria-busy', 'false');
    });
}

function publicCampaignProgressMarkup(project, donations) {
    const target = Number(project.budget);
    if (!Number.isFinite(target) || target <= 0) return '';
    const raised = donations
        .filter(donation => donation.type === 'cash' && Number(donation.projectId) === Number(project.id))
        .reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
    const percentage = raised / target * 100;
    const progressValue = Math.min(percentage, 100);
    const percentageLabel = `${Number.isInteger(percentage) ? percentage : percentage.toFixed(2)}%`;
    return `<div class="campaign-progress">
        <div class="progress-label"><span>${peso(raised)} raised of ${peso(target)}</span><strong>${percentageLabel}</strong></div>
        <progress max="100" value="${progressValue}" aria-label="${escapeHtml(project.name)} campaign progress">${progressValue}%</progress>
        ${project.deadline ? `<p class="campaign-deadline">Campaign deadline: <strong>${escapeHtml(formatDate(project.deadline))}</strong></p>` : ''}
    </div>`;
}

function renderPublicCampaignProgress(donations) {
    const container = document.getElementById('publicCampaignProgress');
    if (!container) return;
    const campaigns = getProjects().filter(project =>
        String(project.status).toLowerCase() === 'active' &&
        Number.isFinite(Number(project.budget)) &&
        Number(project.budget) > 0
    );
    container.innerHTML = campaigns.map(project => `
        <article class="impact-card">
            <span class="badge badge-success">Active campaign</span>
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.description || 'Community project or activity.')}</p>
            ${publicCampaignProgressMarkup(project, donations)}
        </article>
    `).join('') || '<p class="empty-table">No active campaigns with a fundraising target are currently listed.</p>';
}

function renderPublicProjectTransparency(donations) {
    const container = document.getElementById('publicProjectTransparency');
    if (!container) return;
    const expenses = getExpenses().filter(expense => expense.verified === true);
    const cards = getProjects().map(project => {
        const linkedCashDonations = donations.filter(donation =>
            donation.type === 'cash' && Number(donation.projectId) === Number(project.id)
        );
        const received = linkedCashDonations.reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
        const allocated = linkedCashDonations.reduce((sum, donation) => sum + (Array.isArray(donation.allocations)
            ? donation.allocations.reduce((allocationSum, allocation) => allocationSum + Number(allocation.amount || 0), 0)
            : 0), 0);
        const projectExpenses = expenses
            .filter(expense => Number(expense.projectId) === Number(project.id))
            .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        if (received === 0 && allocated === 0 && projectExpenses === 0) return '';
        return `<article class="impact-card project-transparency-card">
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.description || 'Community project or activity.')}</p>
            <dl class="project-fund-summary">
                <div><dt>Verified donations received</dt><dd>${peso(received)}</dd></div>
                <div><dt>Funds allocated</dt><dd>${peso(allocated)}</dd></div>
                <div><dt>Verified expenses</dt><dd>${peso(projectExpenses)}</dd></div>
                <div><dt>Allocated balance after verified expenses</dt><dd>${peso(allocated - projectExpenses)}</dd></div>
            </dl>
        </article>`;
    }).filter(Boolean);
    container.innerHTML = cards.join('') || '<p class="empty-table">Project funding details will appear when verified project donations, allocations, or expenses are recorded.</p>';
}

function renderPublicNeeds() {
    const container = document.getElementById('publicCurrentNeeds');
    if (!container) return;
    const needs = getInventory().filter(item =>
        item.showPublicNeed === true &&
        Number.isFinite(Number(item.targetQuantity)) &&
        Number(item.targetQuantity) > 0
    );
    container.innerHTML = needs.map(item => {
        const stock = Math.max(0, Number(item.quantity) || 0);
        const target = Number(item.targetQuantity);
        const fulfilled = stock >= target;
        const percentage = Math.min(stock / target * 100, 100);
        const label = fulfilled ? 'Fully supplied' : item.urgent === true ? 'Urgent need' : 'Still needed';
        const statusClass = fulfilled ? 'need-status-complete' : item.urgent === true ? 'need-status-urgent' : 'need-status-open';
        const categoryFilter = { Food: 'Feeding Program', Education: 'Education Fund', Medical: 'Medical Assistance' }[item.category] || item.category;
        const hidden = selectedCategory && categoryFilter !== selectedCategory;
        return `<article class="public-need-card need-card" data-category="${escapeHtml(categoryFilter)}"${hidden ? ' hidden' : ''}>
            <div class="public-need-heading"><h3>${escapeHtml(item.name)}</h3><span class="public-need-status ${statusClass}">${label}</span></div>
            <p>${escapeHtml(item.category)} · ${stock.toLocaleString('en-PH')} of ${target.toLocaleString('en-PH')} ${escapeHtml(item.unit)} received</p>
            <progress max="100" value="${percentage}" aria-label="${escapeHtml(item.name)} need progress">${percentage}%</progress>
            <span class="public-need-progress">${fulfilled ? 'Need fulfilled' : `${(target - stock).toLocaleString('en-PH')} ${escapeHtml(item.unit)} still needed`}</span>
        </article>`;
    }).join('') || '<p class="empty-table">There are no current public needs listed. KBK will update this section when an item and requested quantity are confirmed.</p>';
}

function publicDonorDisplayName(donation) {
    if (donation.publicRecognition !== true || donation.anonymous === true) return 'Anonymous Donor';
    const parts = String(donation.donor || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return 'Anonymous Donor';
    return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function renderPublicDonationList(donations) {
    const body = document.getElementById('publicDonationListBody');
    if (!body) return;
    const approved = donations
        .filter(donation => ['verified', 'allocated', 'distributed', 'completed'].includes(normalizeDonationStatus(donation.status)))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id));
    setText('publicDonationListDescription', `${approved.length} approved ${approved.length === 1 ? 'donation' : 'donations'}`);
    body.innerHTML = approved.map(donation => {
        const status = normalizeDonationStatus(donation.status);
        const donationDetails = donation.type === 'cash'
            ? peso(donation.amount)
            : escapeHtml(formatInKindDonation(donation));
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        return `<tr>
            <td>${escapeHtml(donationReference(donation.id))}</td>
            <td>${escapeHtml(publicDonorDisplayName(donation))}</td>
            <td>${escapeHtml(donation.date ? formatDate(donation.date) : 'Not recorded')}</td>
            <td>${donationDetails}</td>
            <td>${escapeHtml(donation.category || 'Community support')}</td>
            <td><span class="badge badge-success">${escapeHtml(statusLabel)}</span></td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="empty-table">Approved donations will appear here after KBK reviews them.</td></tr>';
}

function renderPublicDonorRecognition(donations) {
    const container = document.getElementById('publicDonorRecognition');
    if (!container) return;
    const verified = donations
        .filter(donation => ['verified', 'allocated', 'distributed', 'completed'].includes(String(donation.status).toLowerCase()))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    container.innerHTML = verified.map(donation => {
        const contribution = donation.type === 'cash'
            ? peso(donation.amount)
            : escapeHtml(formatInKindDonation(donation));
        return `<article class="donor-recognition-card">
            <span>${escapeHtml(publicDonorDisplayName(donation))}</span>
            <strong>${contribution}</strong>
        </article>`;
    }).join('') || '<p class="empty-table">Verified contributions will appear here after review.</p>';
}

function renderPublicProjects() {
    const container = document.getElementById('publicProjectCards');
    if (!container) return;
    const activeCampaignsOnly = new URLSearchParams(location.search).get('status') === 'active';
    const verifiedDonations = getDonations().filter(donation =>
        ['verified', 'allocated', 'distributed', 'completed'].includes(normalizeDonationStatus(donation.status))
    );
    const projects = getProjects().filter(project => {
        const status = String(project.status).toLowerCase();
        return activeCampaignsOnly ? status === 'active' : ['active', 'planned', 'completed'].includes(status);
    });
    setText('publicProjectsHeading', activeCampaignsOnly ? 'Active Campaigns' : 'Projects');
    setText('publicProjectsDescription', activeCampaignsOnly
        ? 'Campaigns currently marked active by KBK.'
        : "Current and completed activities published from KBK's project records.");
    container.innerHTML = projects.map(project => `
        <article class="impact-card">
            <span class="badge ${String(project.status).toLowerCase() === 'active' ? 'badge-success' : 'badge-pending'}">${escapeHtml(project.status)}</span>
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.description || 'Community project or activity.')}</p>
            ${String(project.status).toLowerCase() === 'active' ? publicCampaignProgressMarkup(project, verifiedDonations) : ''}
        </article>
    `).join('') || '<p class="empty-table">No public projects or activities are currently listed.</p>';
}

function renderPublicNews() {
    const container = document.getElementById('publicNewsList');
    if (!container) return;
    const today = new Date().toISOString().slice(0, 10);
    const plannedDistributions = getDistributions()
        .filter(item => String(item.status).toLowerCase() === 'planned' && String(item.date || '') >= today)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const completedProjects = getProjects()
        .filter(project => String(project.status).toLowerCase() === 'completed');
    const completedDistributions = getDistributions()
        .filter(item => ['distributed', 'completed'].includes(String(item.status).toLowerCase()))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 5);
    const announcements = [
        ...plannedDistributions.map(item => ({
            title: 'Upcoming Distribution',
            detail: `${item.category || 'Community support'} — ${formatDate(item.date)}`
        })),
        ...completedProjects.map(project => ({
            title: 'Completed Project',
            detail: project.name
        })),
        ...completedDistributions.map(item => ({
            title: 'Distribution Update',
            detail: `${item.category || 'Community support'} completed on ${formatDate(item.date)}`
        }))
    ];
    container.innerHTML = announcements.map(item => `
        <article class="impact-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>
    `).join('') || '<p class="empty-table">There are no current announcements. Updates will appear here when schedules or activities are recorded by KBK.</p>';
}

function renderPublicImpact(donations) {
    const container = document.getElementById('publicImpactCards');
    if (!container) return;
    const projects = getProjects();
    const distributions = getDistributions().filter(distribution =>
        ['distributed', 'completed'].includes(String(distribution.status).toLowerCase())
    );
    const expenses = getExpenses().filter(expense => expense.verified === true);
    const cards = projects.map(project => {
        const projectDonations = donations.filter(donation => Number(donation.projectId) === Number(project.id));
        const projectExpenses = expenses.filter(expense => Number(expense.projectId) === Number(project.id));
        const projectDistributions = distributions.filter(distribution => Number(distribution.projectId) === Number(project.id));
        if (!projectDonations.length && !projectExpenses.length && !projectDistributions.length) return '';

        const donatedCash = projectDonations
            .filter(donation => donation.type === 'cash')
            .reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
        const usedAmount = projectExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        const beneficiaryCount = new Set(projectDistributions
            .filter(distribution => distribution.beneficiaryId != null)
            .map(distribution => String(distribution.beneficiaryId))).size;
        const outcomes = projectDistributions.map(distribution => {
            const quantity = publicDistributionQuantity(distribution.quantity);
            return `<li>${escapeHtml(publicDistributionCategory(distribution))}${quantity ? ` — ${escapeHtml(quantity)}` : ''}</li>`;
        }).join('');

        return `<article class="impact-card">
            <h3>${escapeHtml(project.name)}</h3>
            <ol class="impact-flow">
                <li><strong>${peso(donatedCash)}</strong><span>linked cash donations</span></li>
                <li><strong>${projectDistributions.length}</strong><span>recorded distributions</span>${outcomes ? `<ul class="impact-outcomes">${outcomes}</ul>` : '<span class="muted-text">No distribution outcomes recorded yet.</span>'}</li>
                <li><strong>${beneficiaryCount}</strong><span>unique beneficiaries in recorded distributions</span></li>
            </ol>
            <p class="impact-expenses">Verified project expenses: <strong>${peso(usedAmount)}</strong></p>
        </article>`;
    }).filter(Boolean);
    container.innerHTML = cards.join('') || '<p class="empty-table">Project-linked impact will appear when donations, expenses, or completed distributions are recorded.</p>';
}

function renderPublicDistributions() {
    const container = document.getElementById('publicDistributionRecords');
    if (!container) return;
    const beneficiaries = new Set(getBeneficiaries()
        .filter(beneficiary => beneficiary.id != null)
        .map(beneficiary => String(beneficiary.id)));
    const distributions = getDistributions().filter(distribution =>
        ['distributed', 'completed'].includes(String(distribution.status).toLowerCase()) &&
        /^\d{4}-\d{2}/.test(String(distribution.date || ''))
    );
    const months = new Map();
    distributions.forEach(distribution => {
        const month = String(distribution.date).slice(0, 7);
        if (!months.has(month)) months.set(month, { items: new Map(), beneficiaries: new Set() });
        const summary = months.get(month);
        const name = publicDistributionCategory(distribution);
        if (!summary.items.has(name)) summary.items.set(name, []);
        const quantity = publicDistributionQuantity(distribution.quantity);
        if (quantity) summary.items.get(name).push(quantity);
        if (distribution.beneficiaryId != null && beneficiaries.has(String(distribution.beneficiaryId))) {
            summary.beneficiaries.add(String(distribution.beneficiaryId));
        }
    });
    const cards = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, summary]) => {
        const monthDate = new Date(`${month}-01T00:00:00`);
        const monthLabel = monthDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
        const items = [...summary.items.entries()].map(([name, quantities]) =>
            `<li><span>${escapeHtml(name)}</span><strong>${quantities.length ? escapeHtml([...new Set(quantities)].join(', ')) : 'Recorded'}</strong></li>`
        ).join('');
        return `<article class="public-distribution-card">
            <h3>${escapeHtml(monthLabel)} Distribution</h3>
            <p>${summary.beneficiaries.size} ${summary.beneficiaries.size === 1 ? 'beneficiary' : 'beneficiaries'} assisted</p>
            <ul>${items}</ul>
        </article>`;
    });
    container.innerHTML = cards.join('') || '<p class="empty-table">No completed distributions have been recorded yet.</p>';
}

function publicDistributionCategory(distribution) {
    return PUBLIC_DISTRIBUTION_CATEGORIES.includes(distribution.category)
        ? distribution.category
        : 'Community assistance';
}

function publicDistributionQuantity(value) {
    const match = String(value || '').trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-z]*)$/i);
    if (!match) return '';
    const unit = match[2].toLowerCase();
    const allowedUnits = ['pack', 'packs', 'set', 'sets', 'kit', 'kits', 'box', 'boxes', 'piece', 'pieces', 'pc', 'pcs', 'bag', 'bags', 'meal', 'meals', 'item', 'items', 'unit', 'units', 'bottle', 'bottles'];
    if (unit && !allowedUnits.includes(unit)) return '';
    return `${match[1]}${unit ? ` ${unit}` : ''}`;
}

function handlePublicAssistanceSubmit(event) {
    void submitPublicAssistanceRequest(event);
}

async function submitPublicAssistanceRequest(event) {
    event.preventDefault();
    const message = document.getElementById('requestFormMessage');
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const contactInput = document.getElementById('requestContact');
    const contact = contactInput.value.trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phonePattern = /^\+?[\d\s().-]{7,20}$/;
    const phoneDigits = contact.replace(/\D/g, '');
    contactInput.setCustomValidity(
        emailPattern.test(contact) || (phonePattern.test(contact) && phoneDigits.length >= 7 && phoneDigits.length <= 15)
            ? ''
            : 'Enter a valid email address or phone number.'
    );
    message.dataset.error = 'false';
    if (!form.reportValidity()) return;

    const request = {
        name: document.getElementById('requestName').value.trim(),
        contact,
        type: document.getElementById('requestType').value,
        description: document.getElementById('requestDescription').value.trim(),
        quantity: document.getElementById('requestQuantity').value.trim()
    };
    if (!request.type || !request.description || !document.getElementById('requestConsent').checked) {
        message.dataset.error = 'true';
        message.textContent = 'Complete the required fields and confirm the privacy notice before submitting.';
        return;
    }

    if (!supabaseClient || supabaseInitializationError) {
        message.dataset.error = 'true';
        message.textContent = 'Online request submission is not available right now. Please contact KBK by email or try again later.';
        return;
    }

    submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    message.textContent = 'Submitting your request securely…';
    try {
        const { error } = await supabaseClient.from('kbk_assistance_requests').insert({
            requester_name: request.name || null,
            contact: request.contact,
            assistance_type: request.type,
            description: request.description,
            quantity: request.quantity || null
        });
        if (error) throw new Error(error.message);
        form.reset();
        message.dataset.error = 'false';
        message.textContent = 'Your request was sent to KBK. An administrator will review it; contact KBK directly if you need urgent help.';
    } catch (error) {
        console.error('Unable to submit assistance request.', error);
        message.dataset.error = 'true';
        message.textContent = 'We could not confirm that your request was sent. Contact KBK before resubmitting to avoid a duplicate request.';
    } finally {
        submitButton.disabled = false;
        form.removeAttribute('aria-busy');
    }
}

function renderAssistanceRequests() {
    const tbody = document.getElementById('assistanceRequestTableBody');
    if (!tbody) return;
    const canReview = getUserRole() !== 'staff';
    if (!canReview) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table">Only active administrators can view assistance request details.</td></tr>';
        return;
    }
    if (remoteAssistanceRequests === null) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-table">The shared request inbox could not be loaded. Check the status message above and try again after correcting the issue.</td></tr>';
        return;
    }
    const requests = (remoteAssistanceRequests || []).slice().sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    tbody.innerHTML = requests.map(request => {
        const submitted = request.submittedAt ? new Date(request.submittedAt).toLocaleString('en-PH') : '—';
        const actions = canReview
            ? `<div class="action-group"><span class="badge badge-pending">${escapeHtml(request.status || 'Pending')}</span>${request.status === 'Pending' ? `<button class="btn btn-primary btn-xs" type="button" data-request-action="Approved" data-request-id="${Number(request.id)}">Approve</button> <button class="btn btn-outline btn-xs" type="button" data-request-action="Declined" data-request-id="${Number(request.id)}">Decline</button>` : ''}<button class="btn btn-outline btn-xs" type="button" data-request-edit="${Number(request.id)}">Edit</button><button class="btn btn-danger btn-xs" type="button" data-request-delete="${Number(request.id)}">Delete</button></div>`
            : `<span class="badge badge-pending">${escapeHtml(request.status || 'Pending')}</span>`;
        return `<tr>
            <td>${escapeHtml(submitted)}</td>
            <td>${escapeHtml(request.name || 'Not provided')}</td>
            <td>${escapeHtml(request.contact)}</td>
            <td>${escapeHtml(request.type)}</td>
            <td>${escapeHtml(request.quantity || '—')}</td>
            <td>${escapeHtml(request.description)}</td>
            <td>${actions}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty-table">No assistance requests have been submitted.</td></tr>';
    tbody.querySelectorAll('[data-request-action]').forEach(button => {
        button.addEventListener('click', () => updateAssistanceRequest(Number(button.dataset.requestId), button.dataset.requestAction));
    });
    tbody.querySelectorAll('[data-request-edit]').forEach(button => button.addEventListener('click', () => {
        if (!canReview) return;
        const request = remoteAssistanceRequests?.find(item => Number(item.id) === Number(button.dataset.requestEdit));
        if (!request) return;
        const updated = promptRecordUpdate(request, [
            { key: 'name', label: 'Requester name' },
            { key: 'contact', label: 'Contact information', required: true },
            { key: 'type', label: 'Assistance type', required: true },
            { key: 'quantity', label: 'Quantity' },
            { key: 'description', label: 'Description', required: true }
        ]);
        if (!updated) return;
        void updateRemoteAssistanceRequest(request, {
            requester_name: updated.name || null,
            contact: updated.contact,
            assistance_type: updated.type,
            quantity: updated.quantity || null,
            description: updated.description
        }, `Updated assistance request from ${updated.name || 'requester'}`);
    }));
    tbody.querySelectorAll('[data-request-delete]').forEach(button => button.addEventListener('click', () => {
        if (!canReview) return;
        const request = remoteAssistanceRequests?.find(item => Number(item.id) === Number(button.dataset.requestDelete));
        if (!request || !window.confirm(`Delete the assistance request from ${request.name || 'this requester'}?`)) return;
        void deleteRemoteAssistanceRequest(request);
    }));
}

async function updateRemoteAssistanceRequest(request, changes, activityMessage) {
    try {
        const { data, error } = await supabaseClient
            .from('kbk_assistance_requests')
            .update(changes)
            .eq('id', request.id)
            .select('id,requester_name,contact,assistance_type,quantity,description,status,submitted_at,reviewed_at')
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error('This request could not be found or you no longer have permission to update it.');
        Object.assign(request, {
            name: data.requester_name || '',
            contact: data.contact,
            type: data.assistance_type,
            quantity: data.quantity || '',
            description: data.description,
            status: data.status,
            submittedAt: data.submitted_at,
            reviewedAt: data.reviewed_at
        });
        logActivity(activityMessage);
        renderAssistanceRequests();
    } catch (error) {
        console.error('Unable to update assistance request.', error);
        window.alert(`Unable to update this request in Supabase: ${error.message}`);
    }
}

async function deleteRemoteAssistanceRequest(request) {
    try {
        const { error } = await supabaseClient
            .from('kbk_assistance_requests')
            .delete()
            .eq('id', request.id);
        if (error) throw new Error(error.message);
        remoteAssistanceRequests = remoteAssistanceRequests.filter(item => item.id !== request.id);
        logActivity(`Deleted assistance request ${request.id}`);
        renderAssistanceRequests();
    } catch (error) {
        console.error('Unable to delete assistance request.', error);
        window.alert(`Unable to delete this request from Supabase: ${error.message}`);
    }
}

function handlePublicFeedbackSubmit(event) {
    void submitPublicFeedback(event);
}

async function submitPublicFeedback(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('feedbackFormMessage');
    const submitButton = form.querySelector('button[type="submit"]');
    const contactInput = document.getElementById('feedbackContact');
    const contact = contactInput.value.trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phonePattern = /^\+?[\d\s().-]{7,20}$/;
    const phoneDigits = contact.replace(/\D/g, '');
    contactInput.setCustomValidity(
        emailPattern.test(contact) || (phonePattern.test(contact) && phoneDigits.length >= 7 && phoneDigits.length <= 15)
            ? ''
            : 'Enter a valid email address or phone number.'
    );
    status.dataset.error = 'false';
    if (!form.reportValidity()) return;

    const entry = {
        name: document.getElementById('feedbackName').value.trim(),
        contact,
        subject: document.getElementById('feedbackSubject').value.trim(),
        message: document.getElementById('feedbackMessage').value.trim()
    };
    if (!entry.contact || !entry.subject || entry.subject.length > 160
        || entry.message.length < 10 || entry.message.length > 2000) {
        status.dataset.error = 'true';
        status.textContent = 'Enter a valid contact method, a subject, and a message between 10 and 2,000 characters.';
        return;
    }
    if (!supabaseClient || supabaseInitializationError) {
        status.dataset.error = 'true';
        status.textContent = `Online message delivery is not available. Please email KBK directly at ${KBK_CONTACT_EMAIL}.`;
        return;
    }

    submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Sending your message securely…';
    try {
        const { error } = await supabaseClient.from('kbk_public_feedback_messages').insert({
            requester_name: entry.name || null,
            contact: entry.contact,
            subject: entry.subject,
            message: entry.message
        });
        if (error) throw new Error(error.message);
        form.reset();
        status.dataset.error = 'false';
        status.textContent = 'Your message was delivered to KBK’s shared admin inbox. This does not send an email notification.';
    } catch (error) {
        console.error('Unable to send public feedback.', error);
        status.dataset.error = 'true';
        status.textContent = `We could not confirm delivery. Please email KBK directly at ${KBK_CONTACT_EMAIL} before resubmitting to avoid a duplicate.`;
    } finally {
        submitButton.disabled = false;
        form.removeAttribute('aria-busy');
    }
}

function renderPublicFeedback() {
    const tbody = document.getElementById('publicFeedbackTableBody');
    if (!tbody) return;
    if (getUserRole() !== 'admin') {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-table">Only active administrators can view contact messages.</td></tr>';
        return;
    }
    if (remoteFeedbackMessages === null) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-table">The shared contact inbox could not be loaded. Check the status message above and confirm the latest database setup has been applied.</td></tr>';
        return;
    }
    const rows = remoteFeedbackMessages.slice().sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    tbody.innerHTML = rows.map(item => `<tr>
        <td>${escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleString('en-PH') : '—')}</td>
        <td>${escapeHtml(item.name || 'Not provided')}</td><td>${escapeHtml(item.contact)}</td>
        <td>${escapeHtml(item.subject)}</td><td>${escapeHtml(item.message)}</td>
        <td><div class="action-group"><span class="badge ${item.status === 'Reviewed' ? 'badge-success' : 'badge-pending'}">${escapeHtml(item.status)}</span>${item.status === 'New' ? `<button class="btn btn-outline btn-xs" type="button" data-feedback-reviewed="${Number(item.id)}">Mark reviewed</button>` : ''}<button class="btn btn-danger btn-xs" type="button" data-feedback-delete="${Number(item.id)}">Delete</button></div></td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-table">No contact messages have been received.</td></tr>';
    tbody.querySelectorAll('[data-feedback-reviewed]').forEach(button => button.addEventListener('click', () => {
        void updateRemoteFeedbackMessage(Number(button.dataset.feedbackReviewed), { status: 'Reviewed' });
    }));
    tbody.querySelectorAll('[data-feedback-delete]').forEach(button => button.addEventListener('click', () => {
        const item = remoteFeedbackMessages.find(record => Number(record.id) === Number(button.dataset.feedbackDelete));
        if (!item || !window.confirm(`Permanently delete the message “${item.subject}”?`)) return;
        void deleteRemoteFeedbackMessage(item);
    }));
}

async function updateRemoteFeedbackMessage(id, changes) {
    try {
        const { data, error } = await supabaseClient
            .from('kbk_public_feedback_messages')
            .update(changes)
            .eq('id', id)
            .select('id,status')
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error('This message could not be found or you no longer have permission to update it.');
        const item = remoteFeedbackMessages.find(record => Number(record.id) === Number(id));
        if (item) item.status = data.status;
        logActivity(`Reviewed public feedback ${id}`);
        renderPublicFeedback();
    } catch (error) {
        console.error('Unable to update public feedback status.', error);
        window.alert(`Unable to update the contact message: ${error.message}`);
    }
}

async function deleteRemoteFeedbackMessage(item) {
    try {
        const { error } = await supabaseClient
            .from('kbk_public_feedback_messages')
            .delete()
            .eq('id', item.id);
        if (error) throw new Error(error.message);
        remoteFeedbackMessages = remoteFeedbackMessages.filter(record => record.id !== item.id);
        logActivity(`Deleted public feedback ${item.id}`);
        renderPublicFeedback();
    } catch (error) {
        console.error('Unable to delete public feedback.', error);
        window.alert(`Unable to delete the contact message: ${error.message}`);
    }
}

function renderInventory() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    const items = getInventory();
    tbody.innerHTML = items.map(item => `<tr>
        <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.category)}</td>
        <td><strong>${escapeHtml(item.quantity)}</strong> ${escapeHtml(item.unit)}</td>
        <td>${item.showPublicNeed === true && Number(item.targetQuantity) > 0
            ? `${Number(item.quantity) >= Number(item.targetQuantity) ? 'Fully supplied' : item.urgent === true ? 'Urgent' : 'Needed'} · ${escapeHtml(item.targetQuantity)} ${escapeHtml(item.unit)}`
            : 'Not listed'}</td>
        <td>${escapeHtml(item.location || '—')}</td>
        <td>${getUserRole() === 'staff' ? 'View only' : `<div class="action-group"><button class="btn btn-outline btn-xs" type="button" data-inventory-adjust="${Number(item.id)}" data-adjustment="-1" aria-label="Remove one ${escapeHtml(item.name)}">-1</button><button class="btn btn-outline btn-xs" type="button" data-inventory-adjust="${Number(item.id)}" data-adjustment="1" aria-label="Add one ${escapeHtml(item.name)}">+1</button><button class="btn btn-outline btn-xs" type="button" data-inventory-edit="${Number(item.id)}">Edit</button><button class="btn btn-danger btn-xs" type="button" data-inventory-delete="${Number(item.id)}">Delete</button></div>`}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-table">No inventory items have been recorded.</td></tr>';
    tbody.querySelectorAll('[data-inventory-adjust]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const inventory = getInventory();
        const item = inventory.find(record => record.id === Number(button.dataset.inventoryAdjust));
        if (!item) return;
        const nextQuantity = Number(item.quantity) + Number(button.dataset.adjustment);
        if (nextQuantity < 0) return;
        item.quantity = nextQuantity;
        try {
            saveStoredList(INVENTORY_KEY, inventory);
        } catch (error) {
            console.error('Unable to update inventory.', error);
            window.alert('Unable to update inventory in browser storage.');
            return;
        }
        logActivity(`Adjusted inventory: ${item.name} (${nextQuantity} ${item.unit})`);
        renderInventory();
        renderPublicNeeds();
    }));
    tbody.querySelectorAll('[data-inventory-edit]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const inventory = getInventory();
        const item = inventory.find(record => record.id === Number(button.dataset.inventoryEdit));
        if (!item) return;
        const updated = promptRecordUpdate(item, [
            { key: 'name', label: 'Item name', required: true },
            { key: 'category', label: 'Category', required: true },
            { key: 'quantity', label: 'Quantity', type: 'number', required: true },
            { key: 'unit', label: 'Unit', required: true },
            { key: 'location', label: 'Storage location' },
            { key: 'targetQuantity', label: 'Requested quantity for public need (0 to hide)', type: 'number' },
            { key: 'showPublicNeed', label: 'Show as a public need? Enter yes or no', type: 'boolean' },
            { key: 'urgent', label: 'Mark as urgent while needed? Enter yes or no', type: 'boolean' }
        ]);
        if (!updated || !Number.isInteger(updated.quantity) || updated.quantity < 0 || !Number.isInteger(updated.targetQuantity) || updated.targetQuantity < 0 || (updated.showPublicNeed && updated.targetQuantity <= 0)) {
            if (updated) window.alert('Inventory stock and requested quantities must be valid whole numbers. A public need must have a requested quantity greater than zero.');
            return;
        }
        inventory[inventory.indexOf(item)] = updated;
        try {
            saveStoredList(INVENTORY_KEY, inventory);
        } catch (error) {
            console.error('Unable to edit inventory item.', error);
            window.alert('Unable to save the inventory changes in browser storage.');
            return;
        }
        logActivity(`Updated inventory item: ${updated.name}`);
        renderInventory();
        renderPublicNeeds();
    }));
    tbody.querySelectorAll('[data-inventory-delete]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const inventory = getInventory();
        const item = inventory.find(record => record.id === Number(button.dataset.inventoryDelete));
        if (!item || !window.confirm(`Delete inventory item ${item.name}?`)) return;
        try {
            saveStoredList(INVENTORY_KEY, inventory.filter(record => record.id !== item.id));
        } catch (error) {
            console.error('Unable to delete inventory item.', error);
            window.alert('Unable to delete this inventory item in browser storage.');
            return;
        }
        logActivity(`Deleted inventory item: ${item.name}`);
        renderInventory();
        renderPublicNeeds();
    }));
}

function renderSystemSettings() {
    if (!document.getElementById('settingsRole')) return;
    setText('settingsRole', 'Administrator');
    setText('settingsUsername', sessionStorage.getItem(USER_KEY) || 'Unknown');
    setText('settingsDonationCount', getDonations().length);
    setText('settingsDonorCount', getDonors().length);
    setText('settingsBeneficiaryCount', getBeneficiaries().length);
    setText('settingsProjectCount', getProjects().length);
    setText('settingsStorageCount', localStorage.length);
}

function handleInventorySubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const inventory = getInventory();
    const item = {
        id: nextId(inventory),
        name: document.getElementById('inventoryName').value.trim(),
        category: document.getElementById('inventoryCategory').value,
        quantity: Number(document.getElementById('inventoryQuantity').value),
        unit: document.getElementById('inventoryUnit').value.trim(),
        location: document.getElementById('inventoryLocation').value.trim(),
        targetQuantity: Number(document.getElementById('inventoryTargetQuantity').value || 0),
        showPublicNeed: document.getElementById('inventoryPublicNeed').checked,
        urgent: document.getElementById('inventoryUrgent').checked
    };
    if (!item.name || !item.category || !Number.isInteger(item.quantity) || item.quantity < 0 || !item.unit ||
        !Number.isInteger(item.targetQuantity) || item.targetQuantity < 0 ||
        (item.showPublicNeed && item.targetQuantity <= 0)) {
        window.alert('Enter valid whole-number stock and requested quantities. A public need must have a requested quantity greater than zero.');
        return;
    }
    try {
        inventory.push(item);
        saveStoredList(INVENTORY_KEY, inventory);
    } catch (error) {
        console.error('Unable to save inventory item.', error);
        window.alert('Unable to save this inventory item in browser storage.');
        return;
    }
    logActivity(`Added inventory item: ${item.name}`);
    event.currentTarget.reset();
    renderInventory();
    renderPublicNeeds();
}

function renderSiteNavigation() {
    const publicMenu = document.querySelector('.navbar-menu');
    const currentPage = location.pathname.split('/').pop() || 'index.html';
    const publicIcons = {
        home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
        giving: '<path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/>',
        category: '<path d="M4 5h16v14H4zM8 9h8m-8 4h8m-8 3h5"/>',
        campaign: '<path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6M3 9l9-6 9 6"/>',
        track: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5m-10-11v5m-2-2h4"/>',
        impact: '<path d="M3 19h18M5 16l4-5 3 2 6-8m0 0v5m0-5h-5"/>',
        projects: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
        distribution: '<path d="M4 12h15m-6-6 6 6-6 6M4 6v12"/>',
        news: '<path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5"/>',
        assistance: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6m5.6 5.6 3.6 3.6m0-12.8-3.6 3.6m-5.6 5.6-3.6 3.6"/>',
        contact: '<path d="M4 5h16v12H9l-5 4zM8 9h8m-8 4h5"/>'
    };
    const publicIconImages = {
        assistance: 'photo.png/get-help-icon.png'
    };
    const publicIcon = name => `<span class="public-nav-icon" aria-hidden="true">${publicIconImages[name]
        ? `<img class="public-nav-icon-image public-nav-icon-image-${name}" src="${publicIconImages[name]}" alt="">`
        : `<svg viewBox="0 0 24 24">${publicIcons[name]}</svg>`}</span>`;
    const publicGroups = [
        { label: 'Home', href: 'index.html', icon: 'home' },
        { label: 'About KBK', href: 'about.html', icon: 'about' },
        { label: 'Donate', href: 'donate.html', icon: 'giving' },
        { label: 'Community Progress', href: 'transparency.html', icon: 'impact' },
        { label: 'News & Updates', href: 'updates.html', icon: 'news' },
        { label: 'Get Help', href: 'assistance.html', icon: 'assistance' },
        { label: 'Contact Us', href: 'contact.html', icon: 'contact' }
    ];
    if (publicMenu) {
        publicMenu.innerHTML = publicGroups.map(group =>
            `<li><a href="${group.href}"${group.href === currentPage ? ' class="active" aria-current="page"' : ''}>${publicIcon(group.icon)}<span>${group.label}</span></a></li>`
        ).join('');
        renderPublicPageLayout(publicMenu);
    }

    const adminMenu = document.querySelector('.sidebar-menu');
    if (!adminMenu) return;
    const adminGroups = [
        { label: null, links: [['Dashboard', 'dashboard.html', 'dashboard']] },
        { label: 'Donations', links: [['Donation Records', 'donations.html', 'donations'], ['Donors', 'donors.html', 'donors']] },
        { label: 'Community', links: [['Requests', 'requests.html', 'requests'], ['Beneficiaries', 'beneficiaries.html', 'beneficiaries'], ['Projects & Campaigns', 'projects.html', 'projects']] },
        { label: 'Operations', links: [['Inventory', 'inventory.html', 'inventory'], ['Allocation & Distribution', 'allocations.html', 'allocations'], ['Expenses', 'expenses.html', 'expenses']] },
        { label: 'Reports & Settings', links: [['Reports', 'reports.html', 'reports'], ['Transparency', 'admin-transparency.html', 'transparency'], ['Activity Log', 'accounts.html#activityLogBody', 'activity'], ['Users & Accounts', 'accounts.html', 'settings'], ['Settings', 'settings.html', 'settings']] }
    ];
    const adminIcons = {
        dashboard: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
        donations: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10m-10 4h6"/>',
        donors: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6m2-8a3 3 0 1 0 0-6m1 9c2 .5 3 2 3 4"/>',
        requests: '<path d="M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5"/>',
        beneficiaries: '<circle cx="12" cy="8" r="3"/><path d="M5 20c0-4 2-6 7-6s7 2 7 6"/>',
        projects: '<path d="M4 6h6v5H4zM14 6h6v5h-6zM4 14h6v5H4zM14 14h6v5h-6z"/>',
        inventory: '<path d="M4 7h16v14H4zM3 3h18v4H3zm5 8h8"/>',
        allocations: '<path d="M4 6h6v5H4zM14 13h6v5h-6zM10 8h4v7m0 0h-4"/>',
        expenses: '<path d="M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h4"/>',
        reports: '<path d="M5 19V5m0 14h15M9 15v-4m4 4V8m4 8v-6"/>',
        transparency: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18m-9-9a14 14 0 0 1 0 18m0-18a14 14 0 0 0 0 18"/>',
        activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="m19 13 2 1-2 4-2-1-2 1v2H9v-2l-2-1-2 1-2-4 2-1v-2l-2-1 2-4 2 1 2-1V4h6v2l2 1 2-1 2 4-2 1z"/>',
        logout: '<path d="M14 5h5v14h-5M10 12h9m-9 0 3-3m-3 3 3 3M5 5h5"/>'
    };
    const iconMarkup = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${adminIcons[key]}</svg>`;
    const adminCurrentPage = location.pathname.split('/').pop() || 'dashboard.html';
    adminMenu.innerHTML = adminGroups.map(group =>
        (group.label ? `<li class="sidebar-group"><span class="sidebar-group-label">${group.label}</span></li>` : '') +
        group.links.map(([label, href, icon]) => {
            const [target, fragment] = href.split('#');
            const [targetPage, query] = target.split('?');
            const queryMatches = new URLSearchParams(query || '').toString() === new URLSearchParams(location.search).toString();
            const active = targetPage === adminCurrentPage &&
                queryMatches &&
                (fragment ? location.hash === `#${fragment}` : !location.hash);
            return `<li><a href="${href}"${active ? ' class="active" aria-current="page"' : ''}><span class="admin-nav-icon">${iconMarkup(icon)}</span><span>${label}</span></a></li>`;
        }).join('')
    ).join('') +
        `<li class="sidebar-account" aria-label="Signed-in account"><span class="sidebar-account-label">Signed in as</span><strong>${escapeHtml(sessionStorage.getItem(USER_KEY) || 'Administrator')}</strong></li>` +
        `<li class="sidebar-utility"><a href="index.html"><span class="admin-nav-icon">${iconMarkup('transparency')}</span><span>View Public Website</span></a></li><li class="sidebar-logout"><a href="login.html?loggedOut=1" id="logoutBtn"><span class="admin-nav-icon">${iconMarkup('logout')}</span><span>Logout</span></a></li>`;
}

function insertAdminPageChrome(section) {
    const main = document.querySelector('.main-content');
    if (!main || main.querySelector('.admin-context-bar')) return;
    const currentUser = sessionStorage.getItem(USER_KEY) || 'Administrator';
    const contextBar = document.createElement('header');
    contextBar.className = 'admin-context-bar';
    contextBar.innerHTML = `
        <nav class="admin-breadcrumb" aria-label="Breadcrumb">
            <a href="dashboard.html">Home</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(section)}</span>
        </nav>
        <div class="admin-context-actions">
            <a class="admin-notification-link" href="donations.html#donation-tracking" aria-label="Pending donation verification">
                <span class="admin-notification-icon" aria-hidden="true">!</span><span>Notifications</span><strong id="adminPendingBadge">0</strong>
            </a>
            <a class="admin-profile-link" href="accounts.html"><span class="admin-profile-avatar" aria-hidden="true">${escapeHtml(currentUser.slice(0, 1).toUpperCase())}</span><span>${escapeHtml(currentUser)}</span></a>
            <a class="admin-context-logout" href="login.html?loggedOut=1">Logout</a>
        </div>`;
    main.prepend(contextBar);
}

function insertAdminPageGuide() {
    const main = document.querySelector('.main-content');
    if (!main || main.querySelector('.admin-page-guide')) return;

    const guides = {
        'dashboard.html': {
            summary: 'Use the overview to spot records that need attention and jump to the right workflow.',
            tips: [
                'Review donations awaiting verification before using funds in allocations.',
                'Use the recent activity list to check what changed and who recorded it.'
            ]
        },
        'donations.html': {
            summary: 'Record incoming cash and item donations, verify them, and keep each donor’s history connected.',
            tips: [
                'Search for an existing donor before creating a new profile to avoid duplicates.',
                'Verify a donation only after checking its details and any supporting receipt.',
                'Use the status filter to review pending, verified, allocated, distributed, completed, or rejected records.'
            ]
        },
        'donors.html': {
            summary: 'Maintain donor contact profiles and review contributions associated with each donor.',
            tips: [
                'Search before adding a profile so contributions remain attached to one donor record.',
                'Keep contact information current and use the donor profile to check contribution history.'
            ]
        },
        'requests.html': {
            summary: 'Review public assistance requests and messages submitted through the contact form.',
            tips: [
                'Assistance request details come from the shared Supabase inbox; only active admins can manage them.',
                'Approve or decline requests after review, and delete sensitive request details when no longer needed.',
                'Contact messages are delivered to the shared inbox; mark them reviewed after follow-up and delete them when no longer needed.',
                'Messages submitted before this inbox was enabled may still exist only in the browser where they were prepared.'
            ]
        },
        'beneficiaries.html': {
            summary: 'Maintain recipient records and a history of assistance provided by KBK.',
            tips: [
                'Search for an existing person before adding a record to reduce duplicates.',
                'Treat names, contact details, and assistance history as confidential; enter only information needed for service delivery.'
            ]
        },
        'projects.html': {
            summary: 'Create and maintain projects that connect donations, budgets, beneficiaries, and distributions.',
            tips: [
                'Use clear project names and descriptions so staff and donors can understand the purpose.',
                'Keep project status and budget accurate; active projects can appear on the public campaign page.',
                'Link relevant donation and distribution records to the correct project.'
            ]
        },
        'inventory.html': {
            summary: 'Track item stock and manage which current needs are displayed publicly.',
            tips: [
                'Update stock after receiving or distributing items so need levels stay accurate.',
                'Show a public need only when its item and target quantity have been confirmed.',
                'Mark urgent needs only when they genuinely require priority.'
            ]
        },
        'allocations.html': {
            summary: 'Assign verified cash donations to a project or purpose and review recorded allocations.',
            tips: [
                'Confirm the donation is verified before allocating its funds.',
                'Check the remaining unallocated amount to avoid allocating more than was received.',
                'Record a specific purpose and date so the allocation can be traced later.'
            ]
        },
        'distributions.html': {
            summary: 'Record items or support delivered to beneficiaries and confirm distribution outcomes.',
            tips: [
                'Record the project, beneficiary, item or amount, quantity, and delivery date.',
                'Mark a distribution complete only after delivery; record confirmation when available.',
                'Public summaries omit recipient names, but keep administrator records confidential.'
            ]
        },
        'expenses.html': {
            summary: 'Record project expenses and verify them after checking receipts or references.',
            tips: [
                'Link each expense to the correct project and keep a useful description and reference.',
                'Verify an expense only after reviewing its supporting evidence.',
                'Only verified expenses are included in public transparency summaries.'
            ]
        },
        'reports.html': {
            summary: 'Generate and download CSV reports for a selected record type and reporting period.',
            tips: [
                'Choose the report type and check the date range before generating the CSV.',
                'Review exported files before sharing; reports may contain personal or operational information.',
                'Store downloaded reports in an access-controlled location.'
            ]
        },
        'admin-transparency.html': {
            summary: 'Preview aggregate donation, allocation, and expense figures shown on the public transparency page.',
            tips: [
                'Check that linked donations, allocations, and verified expenses are recorded consistently.',
                'Use the public view link to see the same summaries visitors can access.',
                'Public summaries exclude private recipient and donor contact information.'
            ]
        },
        'accounts.html': {
            summary: 'Review account guidance, import reviewed legacy data, and inspect the activity log.',
            tips: [
                'Create accounts and assign roles through Supabase Authentication and protected profiles, not this page.',
                'Review the local backup before importing; an import replaces matching shared record lists.',
                'Check the activity log when auditing recent administrative changes.'
            ]
        },
        'settings.html': {
            summary: 'Check the signed-in account, access role, locally cached shared records, and configuration links.',
            tips: [
                'Record counts describe data currently available in this browser and are not a backup status.',
                'Manage user credentials and roles through the linked account administration workflow.',
                'Use the public transparency link to review the visitor-facing data.'
            ]
        }
    };
    const page = location.pathname.split('/').pop()?.toLowerCase() || 'dashboard.html';
    const guideContent = guides[page];
    if (!guideContent) return;

    const guide = document.createElement('aside');
    guide.className = 'admin-page-guide';
    guide.setAttribute('aria-labelledby', 'admin-page-guide-title');
    const heading = document.createElement('h2');
    heading.id = 'admin-page-guide-title';
    heading.textContent = 'How to use this page';
    const summary = document.createElement('p');
    summary.textContent = guideContent.summary;
    const tips = document.createElement('ul');
    guideContent.tips.forEach(tip => {
        const item = document.createElement('li');
        item.textContent = tip;
        tips.append(item);
    });
    guide.append(heading, summary, tips);

    const pageHeader = main.querySelector('.page-header');
    if (pageHeader) pageHeader.after(guide);
    else main.prepend(guide);
}

function renderPublicPageLayout(publicMenu) {
    const body = document.body;
    const nav = publicMenu.closest('.navbar');
    if (!nav) return;
    if (!body.classList.contains('public-dashboard-page') && !body.classList.contains('public-page-layout')) {
        const main = document.querySelector('main');
        if (!main) return;

        const pageHero = [...body.children].find(element => element.classList.contains('hero'));
        if (pageHero) main.prepend(pageHero);

        const heading = pageHero?.querySelector('h1') || main.querySelector('h1, .section-title');
        const pageHeader = document.createElement('header');
        pageHeader.className = 'public-page-header';
        if (heading) {
            const subtitle = heading.nextElementSibling;
            pageHeader.append(heading);
            if (subtitle?.tagName === 'P') pageHeader.append(subtitle);
            if (pageHero && !pageHero.querySelector('h1, p, a, button')) pageHero.remove();
        } else {
            const fallbackHeading = document.createElement('h1');
            fallbackHeading.textContent = document.title.split(/[—|]/)[0].trim();
            pageHeader.append(fallbackHeading);
        }

        const content = document.createElement('div');
        content.className = 'public-page-content';
        body.classList.add('public-page-layout');
        nav.classList.add('public-sidebar');
        nav.setAttribute('aria-label', 'Public navigation');
        body.insertBefore(content, main);
        content.append(pageHeader, main);

        const footer = [...body.children].find(element => element.tagName === 'FOOTER');
        if (footer) content.append(footer);
    }
    initializePublicNavigation(nav);
}

function initializePublicNavigation(nav) {
    const menu = nav.querySelector('.navbar-menu');
    if (!menu) return;
    if (!menu.id) menu.id = 'publicSiteMenu';
    let mobileToggle = document.querySelector('.public-nav-mobile-toggle');
    if (!mobileToggle) {
        mobileToggle = document.createElement('button');
        mobileToggle.className = 'public-nav-mobile-toggle';
        mobileToggle.type = 'button';
        mobileToggle.setAttribute('aria-label', 'Open navigation');
        document.body.append(mobileToggle);
    }
    mobileToggle.setAttribute('aria-controls', menu.id);
    mobileToggle.setAttribute('aria-expanded', String(document.body.classList.contains('public-nav-open')));

    let backdrop = document.querySelector('.public-nav-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('button');
        backdrop.className = 'public-nav-backdrop';
        backdrop.type = 'button';
        backdrop.setAttribute('aria-label', 'Close navigation');
        backdrop.tabIndex = -1;
        document.body.append(backdrop);
    }
    const closeMobileMenu = () => {
        document.body.classList.remove('public-nav-open');
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileToggle.setAttribute('aria-label', 'Open navigation');
    };
    const handleMobileToggle = () => {
        const open = !document.body.classList.contains('public-nav-open');
        document.body.classList.toggle('public-nav-open', open);
        mobileToggle.setAttribute('aria-expanded', String(open));
        mobileToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        if (open) menu.querySelector('a')?.focus();
    };
    mobileToggle.addEventListener('click', handleMobileToggle);
    backdrop.addEventListener('click', closeMobileMenu);
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
        if (window.innerWidth <= 760) closeMobileMenu();
    }));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMobileMenu();
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 760) closeMobileMenu();
        mobileToggle.textContent = document.body.classList.contains('public-nav-open') ? 'Close menu' : 'Menu';
    });
    mobileToggle.textContent = 'Menu';
}

async function updateAssistanceRequest(id, status) {
    if (getUserRole() === 'staff' || !['Approved', 'Declined'].includes(status)) return;
    const request = remoteAssistanceRequests?.find(item => Number(item.id) === Number(id) && item.status === 'Pending');
    if (!request) return;
    try {
        const { data, error } = await supabaseClient
            .from('kbk_assistance_requests')
            .update({ status, reviewed_at: new Date().toISOString() })
            .eq('id', request.id)
            .eq('status', 'Pending')
            .select('id,status,reviewed_at')
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error('This request is no longer pending or you no longer have permission to review it.');
        request.status = data.status;
        request.reviewedAt = data.reviewed_at;
    } catch (error) {
        console.error('Unable to save the assistance request decision.', error);
        window.alert(`Unable to save the request decision to Supabase: ${error.message}`);
        return;
    }
    logActivity(`${status} assistance request ${request.id}`);
    renderAssistanceRequests();
}

function selectCategory(category) {
    selectedCategory = selectedCategory === category ? null : category;
    document.querySelectorAll('.category-card').forEach(card => {
        const active = card.dataset.category === selectedCategory;
        card.classList.toggle('active', active);
        card.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.need-card').forEach(card => {
        card.hidden = Boolean(selectedCategory && card.dataset.category !== selectedCategory);
    });
    renderPublicPage();
    document.getElementById('needs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- RENDER: ADMIN DASHBOARD ---------- */
let editingId = null;
let editingBeneficiaryId = null;
let editingProjectId = null;
let editingDistributionId = null;
let editingExpenseId = null;
let editingInventoryId = null;
let editingAllocationIndex = null;

function renderDashboard() {
    const list = getDonations();
    const stats = computeStats();
    const statusFilter = document.getElementById('donationStatusFilter')?.value || 'all';
    const visibleDonations = statusFilter === 'all'
        ? list
        : list.filter(donation => normalizeDonationStatus(donation.status) === statusFilter);
    const pendingCount = list.filter(donation => normalizeDonationStatus(donation.status) === 'received').length;

    setText('adminTotal', peso(stats.totalCash));
    setText('adminDonors', stats.uniqueDonors);
    setText('adminCashCount', stats.cashCount);
    setText('adminInKind', stats.inKindCount);
    setText('adminTotalCount', visibleDonations.length);
    setText('donationListHeading', 'Donation Tracking');
    const shownLabel = visibleDonations.length === 1 ? 'record' : 'records';
    const pendingLabel = pendingCount === 1 ? 'donation' : 'donations';
    setText('donationListDescription', `${visibleDonations.length} ${shownLabel} shown · ${pendingCount} ${pendingLabel} awaiting verification.`);

    renderAdminOverview();
    renderAdminTable(visibleDonations);
    renderDonorTable();
}

function renderAdminOverview() {
    const list = getDonations();
    const verifiedDonations = list.filter(donation =>
        ['verified', 'allocated', 'distributed', 'completed'].includes(normalizeDonationStatus(donation.status))
    );
    const totalCash = verifiedDonations
        .filter(donation => donation.type === 'cash')
        .reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
    const pendingCount = list.filter(donation => normalizeDonationStatus(donation.status) === 'received').length;
    const activities = getActivityLog();
    const recent = activities.slice(0, 5);

    setText('totalDonations', list.length);
    setText('totalCashReceived', peso(totalCash));
    setText('totalDonatedItems', formatInKindTotals(verifiedDonations));
    setText('donorCount', computeStats(verifiedDonations).uniqueDonors);
    setText('pendingVerificationCount', pendingCount);
    setText('recentActivityCount', activities.length);
    setText('adminPendingBadge', pendingCount);

    const recentDonationsBody = document.getElementById('recentDonationsBody');
    if (recentDonationsBody) {
        const recentDonations = [...list]
            .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id))
            .slice(0, 5);
        setText('dashboardDonationCount', `${list.length} total donation ${list.length === 1 ? 'record' : 'records'}`);
        recentDonationsBody.innerHTML = recentDonations.map(donation => {
            const status = normalizeDonationStatus(donation.status);
            const statusLabel = status === 'received' ? 'Pending' : status.charAt(0).toUpperCase() + status.slice(1);
            const badgeClass = status === 'received' ? 'badge-pending' : status === 'rejected' ? 'badge-rejected' : 'badge-success';
            const amountOrItem = donation.type === 'cash'
                ? peso(donation.amount)
                : escapeHtml(formatInKindDonation(donation));
            return `<tr>
                <td>${donationReference(donation.id)}</td>
                <td>${escapeHtml(getDonationDonorName(donation))}</td>
                <td>${donation.type === 'cash' ? 'Cash' : 'In-kind'}</td>
                <td>${amountOrItem}</td>
                <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="empty-table">No donation records have been added.</td></tr>';
    }

    const activityList = document.getElementById('recentActivityList');
    if (activityList) {
        activityList.innerHTML = recent.map(activity => `
            <li>
                <div class="activity-meta">
                    <span class="activity-tag">Admin</span>
                    <div class="activity-text">
                        <strong>${escapeHtml(activity.action)}</strong>
                        <small>By ${escapeHtml(activity.user)}</small>
                    </div>
                </div>
                <time>${escapeHtml(new Date(activity.date).toLocaleString('en-PH'))}</time>
            </li>
        `).join('') || '<li><span class="activity-text"><strong>No recent activities</strong><small>Updates will appear here.</small></span></li>';
    }

    renderAllocationTable(list);
}

function renderAdminTable(list) {
    const tbody = document.getElementById('adminTableBody');
    if (!tbody) return;

    if (list.length === 0) {
        const statusFilter = document.getElementById('donationStatusFilter')?.value || 'all';
        const emptyMessage = statusFilter === 'received'
            ? 'No donations are awaiting verification.'
            : statusFilter !== 'all'
                ? `No donations currently have the ${escapeHtml(capitalize(statusFilter))} status.`
                : getUserRole() === 'staff' ? 'No donations available yet.' : 'No donations yet. Click "Add Donation" to create one.';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color: var(--gray);">${emptyMessage}</td></tr>`;
        return;
    }

    const isStaff = getUserRole() === 'staff';
    const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = sorted.map(d => {
        const status = normalizeDonationStatus(d.status);
        const statusControl = isStaff
            ? `<span class="badge badge-${status === 'received' ? 'pending' : status === 'rejected' ? 'rejected' : 'success'}">${status === 'received' ? 'Pending' : capitalize(status)}</span>${status === 'rejected' && d.rejectionReason ? `<small class="rejection-reason">${escapeHtml(d.rejectionReason)}</small>` : ''}`
            : `<select class="form-control status-select" data-donation-status="${d.id}" aria-label="Status for ${donationReference(d.id)}">${DONATION_STATUSES.map(stage => `<option value="${stage}" ${stage === status ? 'selected' : ''}>${stage === 'received' ? 'Pending' : capitalize(stage)}</option>`).join('')}</select>${status === 'rejected' && d.rejectionReason ? `<small class="rejection-reason">${escapeHtml(d.rejectionReason)}</small>` : ''}`;
        const canAllocate = !['received', 'rejected'].includes(status);
        const actions = isStaff
            ? '<span class="badge badge-pending">View Only</span>'
            : `<div class="action-group"><button class="btn btn-outline btn-sm" data-donation-action="allocate" data-donation-id="${d.id}" ${d.type !== 'cash' ? 'disabled title="Cash donations only"' : !canAllocate ? 'disabled title="Verify the donation before allocating funds"' : ''}>Allocate</button><button class="btn btn-outline btn-sm" data-donation-action="edit" data-donation-id="${d.id}">Edit</button><button class="btn btn-danger btn-sm" data-donation-action="delete" data-donation-id="${d.id}">Delete</button></div>`;
        return `
        <tr>
            <td><strong>${donationReference(d.id)}</strong></td>
            <td><strong>${escapeHtml(getDonationDonorName(d))}</strong></td>
            <td><span class="badge ${d.type === 'cash' ? 'badge-cash' : 'badge-inkind'}">${d.type === 'cash' ? 'Cash' : 'In-Kind'}</span></td>
            <td>${d.type === 'cash' ? peso(d.amount) : escapeHtml(formatInKindDonation(d))}</td>
            <td>${formatDate(d.date)}</td>
            <td>${escapeHtml(d.category || '—')}</td>
            <td>${statusControl}</td>
            <td>${actions}</td>
        </tr>
    `;
    }).join('');

    tbody.querySelectorAll('[data-donation-action]').forEach(button => {
        button.addEventListener('click', () => {
            const id = Number(button.dataset.donationId);
            if (button.dataset.donationAction === 'allocate') openAllocationModal(id);
            if (button.dataset.donationAction === 'edit') openEditModal(id);
            if (button.dataset.donationAction === 'delete') deleteDonation(id);
        });
    });
    tbody.querySelectorAll('[data-donation-status]').forEach(select => {
        select.addEventListener('change', () => {
            const previousStatus = list.find(donation => donation.id === Number(select.dataset.donationStatus))?.status;
            if (select.value === 'rejected') {
                const reason = window.prompt('Enter the reason for rejecting this donation:');
                if (!reason?.trim()) {
                    select.value = previousStatus || 'received';
                    if (reason !== null) window.alert('A rejection reason is required.');
                    return;
                }
                updateDonationStatus(Number(select.dataset.donationStatus), select.value, reason.trim());
                return;
            }
            updateDonationStatus(Number(select.dataset.donationStatus), select.value);
        });
    });
}

function renderAllocationTable(donations) {
    const tbody = document.getElementById('allocationTableBody');
    if (!tbody) return;
    const cashDonations = donations.filter(d => d.type === 'cash').sort((a, b) => b.date.localeCompare(a.date));
    const isStaff = getUserRole() === 'staff';
    tbody.innerHTML = cashDonations.map(donation => {
        const allocations = Array.isArray(donation.allocations) ? donation.allocations : [];
        const allocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
        const remaining = Math.max(0, Number(donation.amount || 0) - allocated);
        const breakdown = allocations.length
            ? `<ul class="allocation-breakdown">${allocations.map((allocation, index) => `<li><span>${escapeHtml(allocation.purpose)}</span><strong>${peso(allocation.amount)}</strong>${isStaff ? '' : `<div class="action-group"><button type="button" class="btn btn-outline btn-xs" data-allocation-edit="${donation.id}" data-allocation-index="${index}">Edit</button><button type="button" class="btn btn-danger btn-xs" data-allocation-delete="${donation.id}" data-allocation-index="${index}">Delete</button></div>`}</li>`).join('')}</ul>`
            : '<span class="muted-text">No allocations recorded</span>';
        return `<tr>
            <td><strong>${donationReference(donation.id)}</strong></td>
            <td>${escapeHtml(getDonationDonorName(donation))}</td>
            <td>${peso(donation.amount)}</td>
            <td>${peso(allocated)}</td>
            <td>${peso(remaining)}</td>
            <td>${breakdown}</td>
            <td>${isStaff ? '<span class="badge badge-pending">View Only</span>' : `<button type="button" class="btn btn-outline btn-sm" data-allocation-id="${donation.id}" ${remaining <= 0 || ['received', 'rejected'].includes(normalizeDonationStatus(donation.status)) ? 'disabled title="Verify the donation before allocating funds"' : ''}>Add Allocation</button>`}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty-table">No cash donations available for allocation.</td></tr>';
    tbody.querySelectorAll('[data-allocation-id]').forEach(button => {
        button.addEventListener('click', () => openAllocationModal(Number(button.dataset.allocationId)));
    });
    tbody.querySelectorAll('[data-allocation-edit]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getDonations();
        const donation = records.find(item => item.id === Number(button.dataset.allocationEdit));
        const index = Number(button.dataset.allocationIndex);
        const allocation = donation?.allocations?.[index];
        if (!donation || !allocation) return;
        const updated = promptRecordUpdate(allocation, [
            { key: 'purpose', label: 'Allocation purpose', required: true },
            { key: 'amount', label: 'Amount', type: 'number', required: true }
        ]);
        if (!updated || updated.amount <= 0) {
            if (updated) window.alert('Allocation amount must be greater than zero.');
            return;
        }
        const otherAllocations = donation.allocations.reduce((sum, item, allocationIndex) =>
            sum + (allocationIndex === index ? 0 : Number(item.amount || 0)), 0);
        if (otherAllocations + updated.amount > Number(donation.amount || 0) + 0.000001) {
            window.alert(`Allocation exceeds the remaining balance of ${peso(Math.max(0, Number(donation.amount || 0) - otherAllocations))}.`);
            return;
        }
        donation.allocations[index] = updated;
        try {
            saveDonations(records);
        } catch (error) {
            console.error('Unable to update donation allocation.', error);
            window.alert('Unable to save this allocation in browser storage.');
            return;
        }
        logActivity(`Updated allocation for ${donationReference(donation.id)}: ${updated.purpose}`);
        renderDashboard();
        renderPublicPage();
    }));
    tbody.querySelectorAll('[data-allocation-delete]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getDonations();
        const donation = records.find(item => item.id === Number(button.dataset.allocationDelete));
        const index = Number(button.dataset.allocationIndex);
        const allocation = donation?.allocations?.[index];
        if (!donation || !allocation || !window.confirm(`Delete allocation "${allocation.purpose}" from ${donationReference(donation.id)}?`)) return;
        donation.allocations.splice(index, 1);
        try {
            saveDonations(records);
        } catch (error) {
            console.error('Unable to delete donation allocation.', error);
            window.alert('Unable to delete this allocation in browser storage.');
            return;
        }
        logActivity(`Deleted allocation from ${donationReference(donation.id)}: ${allocation.purpose}`);
        renderDashboard();
        renderPublicPage();
    }));
}

function updateDonationStatus(id, status, rejectionReason = '') {
    if (getUserRole() === 'staff' || !DONATION_STATUSES.includes(status)) return;
    const donations = getDonations();
    const donation = donations.find(item => item.id === id);
    if (!donation) return;
    donation.status = status;
    if (status === 'rejected') donation.rejectionReason = rejectionReason;
    try {
        saveDonations(donations);
    } catch (storageError) {
        console.error('Unable to update donation status.', storageError);
        window.alert('Could not save the donation status in browser storage.');
        renderDashboard();
        return;
    }
    logActivity(`Updated donation ${donationReference(id)} status to ${status}${status === 'rejected' ? `: ${rejectionReason}` : ''}`);
    renderDashboard();
    renderPublicPage();
}

function openAllocationModal(id) {
    if (getUserRole() === 'staff') return;
    const donation = getDonations().find(item => item.id === id && item.type === 'cash');
    if (!donation) return;
    if (['received', 'rejected'].includes(normalizeDonationStatus(donation.status))) {
        window.alert('Verify this donation before allocating its funds.');
        return;
    }
    const allocated = (donation.allocations || []).reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    const remaining = Math.max(0, Number(donation.amount || 0) - allocated);
    if (remaining <= 0) {
        window.alert('This donation has no unallocated balance remaining.');
        return;
    }
    document.getElementById('allocationForm').reset();
    document.getElementById('allocationDonationId').value = String(id);
    document.getElementById('allocationAmount').max = remaining.toFixed(2);
    setText('allocationDonationSummary', `${donationReference(id)} · ${getDonationDonorName(donation)} · ${peso(remaining)} remaining`);
    setText('allocationError', '');
    document.getElementById('allocationError').style.display = 'none';
    document.getElementById('allocationModalOverlay').classList.add('active');
}

function closeAllocationModal() {
    document.getElementById('allocationModalOverlay')?.classList.remove('active');
}

function handleAllocationSubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const id = Number(document.getElementById('allocationDonationId').value);
    const purpose = document.getElementById('allocationPurpose').value.trim();
    const amount = Number(document.getElementById('allocationAmount').value);
    const donations = getDonations();
    const donation = donations.find(item => item.id === id && item.type === 'cash');
    const error = document.getElementById('allocationError');
    if (donation && ['received', 'rejected'].includes(normalizeDonationStatus(donation.status))) {
        error.textContent = 'Verify this donation before allocating its funds.';
        error.style.display = 'block';
        return;
    }
    if (!donation || !purpose || !Number.isFinite(amount) || amount <= 0) {
        error.textContent = 'Enter a valid allocation purpose and amount.';
        error.style.display = 'block';
        return;
    }
    const allocated = (donation.allocations || []).reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    if (allocated + amount > Number(donation.amount || 0) + 0.000001) {
        error.textContent = `Allocation exceeds the remaining balance of ${peso(Math.max(0, donation.amount - allocated))}.`;
        error.style.display = 'block';
        return;
    }

    donation.allocations = [...(donation.allocations || []), { purpose, amount, date: new Date().toISOString().slice(0, 10) }];
    if (DONATION_STATUSES.indexOf(normalizeDonationStatus(donation.status)) < DONATION_STATUSES.indexOf('allocated')) {
        donation.status = 'allocated';
    }
    try {
        saveDonations(donations);
    } catch (storageError) {
        error.textContent = 'Could not save this allocation in browser storage. Remove unused data and try again.';
        error.style.display = 'block';
        return;
    }
    logActivity(`Allocated ${peso(amount)} from ${donationReference(id)} to ${purpose}`);
    closeAllocationModal();
    renderDashboard();
    renderPublicPage();
}

/* ---------- MODAL: ADD / EDIT ---------- */
function openAddModal() {
    if (getUserRole() === 'staff') return;
    editingId = null;
    setText('modalTitle', 'Add Donation');
    document.getElementById('donationForm').reset();
    populateDonationDonorOptions();
    document.getElementById('donationDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('donationStatus').value = 'received';
    document.getElementById('rejectionReason').value = '';
    document.getElementById('rejectionReason').required = false;
    document.getElementById('rejectionReasonGroup').hidden = true;
    document.getElementById('donationCustomUnit').hidden = true;
    populateProjectOptions();
    document.getElementById('donationFormError').style.display = 'none';
    updateTypeFields();
    toggleModal(true);
}

function openEditModal(id) {
    if (getUserRole() === 'staff') return;
    const list = getDonations();
    const d = list.find(x => x.id === id);
    if (!d) return;

    editingId = id;
    setText('modalTitle', 'Edit Donation');
    const donorProfile = getDonationDonorProfile(d);
    const matchingDonors = getDonors().filter(donor =>
        String(donor.name || '').trim().toLocaleLowerCase() === String(d.donor || '').trim().toLocaleLowerCase()
    );
    const legacyDonor = donorProfile || (matchingDonors.length === 1 ? matchingDonors[0] : null);
    const donorSelection = d.donorId == null && d.donor === 'Anonymous Donor' && d.anonymous === true
        ? '__anonymous__'
        : legacyDonor ? String(legacyDonor.id) : '__new__';
    document.getElementById('donationDonorSearch').value = '';
    populateDonationDonorOptions(donorSelection);
    document.getElementById('donorName').value = legacyDonor ? '' : (d.donor === 'Anonymous Donor' ? '' : d.donor);
    document.getElementById('donationType').value = d.type;
    document.getElementById('donationAmount').value = d.amount || '';
    const normalizedDonation = normalizeInKindDonation(d);
    document.getElementById('donationItem').value = normalizedDonation.item || '';
    document.getElementById('donationQuantity').value = normalizedDonation.quantity || '';
    const unitSelect = document.getElementById('donationUnit');
    const customUnit = document.getElementById('donationCustomUnit');
    const knownUnit = [...unitSelect.options].some(option => option.value === normalizedDonation.unit);
    unitSelect.value = knownUnit ? normalizedDonation.unit : normalizedDonation.unit ? 'other' : '';
    customUnit.value = knownUnit ? '' : normalizedDonation.unit || '';
    customUnit.hidden = unitSelect.value !== 'other';
    document.getElementById('donationCategory').value = d.category || '';
    document.getElementById('donationProject').value = d.projectId ? String(d.projectId) : '';
    document.getElementById('donationDate').value = d.date;
    document.getElementById('donationStatus').value = normalizeDonationStatus(d.status);
    document.getElementById('rejectionReason').value = d.rejectionReason || '';
    document.getElementById('rejectionReasonGroup').hidden = normalizeDonationStatus(d.status) !== 'rejected';
    document.getElementById('rejectionReason').required = normalizeDonationStatus(d.status) === 'rejected';
    document.getElementById('donorPublicRecognition').checked = d.publicRecognition === true && d.anonymous !== true;
    document.getElementById('donationFormError').style.display = 'none';
    updateTypeFields();
    toggleModal(true);
}

function toggleModal(show) {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.toggle('active', show);
}

/* ---------- FORM SUBMIT ---------- */
function handleFormSubmit(e) {
    e.preventDefault();
    if (getUserRole() === 'staff') return;
    const list = getDonations();
    const error = document.getElementById('donationFormError');
    error.style.display = 'none';

    const data = {
        donorId: null,
        donor: '',
        publicRecognition: document.getElementById('donorPublicRecognition').checked,
        anonymous: false,
        type: document.getElementById('donationType').value,
        amount: parseFloat(document.getElementById('donationAmount').value) || 0,
        item: document.getElementById('donationType').value === 'in-kind' ? document.getElementById('donationItem').value.trim() : '',
        quantity: document.getElementById('donationType').value === 'in-kind' ? Number(document.getElementById('donationQuantity').value) : null,
        unit: document.getElementById('donationType').value === 'in-kind'
            ? document.getElementById('donationUnit').value === 'other'
                ? document.getElementById('donationCustomUnit').value.trim()
                : document.getElementById('donationUnit').value
            : '',
        category: document.getElementById('donationCategory').value,
        projectId: Number(document.getElementById('donationProject')?.value) || null,
        date: document.getElementById('donationDate').value,
        status: document.getElementById('donationStatus').value,
        rejectionReason: document.getElementById('rejectionReason').value.trim()
    };

    const donorSelection = document.getElementById('donorSelection').value;
    if (!donorSelection) {
        error.textContent = 'Select an existing donor, add a new donor, or choose anonymous.';
        error.style.display = 'block';
        document.getElementById('donorSelection').focus();
        return;
    }
    if (donorSelection === '__new__' && !document.getElementById('donorName').value.trim()) {
        error.textContent = 'Enter the new donor’s name.';
        error.style.display = 'block';
        document.getElementById('donorName').focus();
        return;
    }

    if (data.status === 'rejected' && !data.rejectionReason) {
        error.textContent = 'Enter a reason before rejecting this donation.';
        error.style.display = 'block';
        document.getElementById('rejectionReason').focus();
        return;
    }

    if (data.type === 'cash' && data.amount <= 0) {
        error.textContent = 'Enter a cash donation amount greater than zero.';
        error.style.display = 'block';
        return;
    }
    if (data.type === 'in-kind' && !data.item) {
        error.textContent = 'Enter a description for the donated items.';
        error.style.display = 'block';
        return;
    }
    if (data.type === 'in-kind' && (!Number.isFinite(data.quantity) || data.quantity <= 0 || !data.unit)) {
        error.textContent = 'Enter a quantity greater than zero and select its unit.';
        error.style.display = 'block';
        return;
    }

    try {
        Object.assign(data, resolveDonationDonor(
            donorSelection,
            document.getElementById('donorName').value
        ));
        data.publicRecognition = data.anonymous ? false : data.publicRecognition;
    } catch (donorError) {
        error.textContent = donorError.message;
        error.style.display = 'block';
        return;
    }

    if (editingId) {
        const idx = list.findIndex(d => d.id === editingId);
        if (idx < 0) {
            error.textContent = 'This donation record no longer exists. Close the form and try again.';
            error.style.display = 'block';
            return;
        }
        list[idx] = { ...list[idx], ...data };
    } else {
        list.push({ id: nextId(list), ...data });
    }
    const savedDonation = list.find(donation => donation.id === (editingId || list[list.length - 1].id));
    try {
        saveDonations(list);
    } catch (storageError) {
        error.textContent = 'The donation could not be saved in browser storage. Remove unused data and try again.';
        error.style.display = 'block';
        return;
    }
    try {
        syncDonorFromDonation(savedDonation);
    } catch (donorError) {
        console.error('Donation saved, but its donor record could not be updated.', donorError);
        window.alert('The donation was saved, but the donor profile could not be updated in browser storage. Please update the donor record manually.');
    }
    logActivity(`${editingId ? 'Updated' : 'Recorded'} donation ${donationReference(savedDonation.id)}`);
    toggleModal(false);
    renderDashboard();
    renderDonorTable();
    renderPublicPage();
}

/* ---------- DELETE ---------- */
function deleteDonation(id) {
    if (getUserRole() === 'staff') return;
    if (!confirm('Are you sure you want to delete this donation record?')) return;
    const list = getDonations().filter(d => d.id !== id);
    saveDonations(list);
    logActivity(`Deleted donation ${donationReference(id)}`);
    renderDashboard();
    renderPublicPage();
}

/* ---------- TYPE FIELD TOGGLE ---------- */
function updateTypeFields() {
    const type = document.getElementById('donationType')?.value;
    const amountGroup = document.getElementById('amountGroup');
    const itemGroup = document.getElementById('itemGroup');
    if (!amountGroup || !itemGroup) return;
    if (type === 'cash') {
        amountGroup.style.display = 'block';
        itemGroup.style.display = 'none';
        document.getElementById('donationAmount').required = true;
        document.getElementById('donationItem').required = false;
        document.getElementById('donationQuantity').required = false;
        document.getElementById('donationUnit').required = false;
        document.getElementById('donationCustomUnit').required = false;
        document.getElementById('donationCustomUnit').hidden = true;
    } else {
        amountGroup.style.display = 'none';
        itemGroup.style.display = 'block';
        document.getElementById('donationAmount').required = false;
        document.getElementById('donationItem').required = true;
        document.getElementById('donationQuantity').required = true;
        document.getElementById('donationUnit').required = true;
        const customUnit = document.getElementById('donationCustomUnit');
        const useCustomUnit = document.getElementById('donationUnit').value === 'other';
        customUnit.hidden = !useCustomUnit;
        customUnit.required = useCustomUnit;
    }
}

/* ---------- DONOR MANAGEMENT ---------- */
function renderDonorTable() {
    renderDonorContributions();
    const tbody = document.getElementById('donorTableBody');
    if (!tbody) return;

    const searchValue = (document.getElementById('donorSearch')?.value || '').trim().toLowerCase();
    const statusValue = document.getElementById('donorStatusFilter')?.value || 'all';
    const donors = getDonors().filter(donor => {
        const matchesSearch = !searchValue || donor.name.toLowerCase().includes(searchValue) || (donor.organization || '').toLowerCase().includes(searchValue);
        const matchesStatus = statusValue === 'all' || donor.status === statusValue;
        return matchesSearch && matchesStatus;
    }).sort((a, b) => a.name.localeCompare(b.name));

    tbody.innerHTML = donors.map(donor => `
        <tr>
            <td><strong>${escapeHtml(donor.name)}</strong><div style="font-size:0.75rem; color:var(--gray);">${escapeHtml(donor.organization || 'Individual donor')}</div></td>
            <td>${escapeHtml(donor.type)}</td>
            <td>${escapeHtml(donor.email || '—')}<div style="font-size:0.75rem; color:var(--gray);">${escapeHtml(donor.phone || '—')}</div></td>
            <td>${donor.lastDonation ? formatDate(donor.lastDonation) : '—'}</td>
            <td><span class="badge-${donor.status === 'active' ? 'active' : 'inactive'}">${capitalize(donor.status || 'active')}</span></td>
            <td>
                <div class="action-group">
                    <button type="button" class="btn btn-outline btn-xs" data-action="view" data-donor-id="${donor.id}">View</button>
                    ${getUserRole() === 'staff' ? '<span class="badge badge-pending">View Only</span>' : `<button type="button" class="btn btn-outline btn-xs" data-action="edit" data-donor-id="${donor.id}">Edit</button>
                    <button type="button" class="btn btn-outline btn-xs" data-action="toggle" data-donor-id="${donor.id}">${donor.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                    <button type="button" class="btn btn-danger btn-xs" data-action="delete" data-donor-id="${donor.id}">Delete</button>`}
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center; padding:2rem; color: var(--gray);">No donors match the current filter.</td></tr>';

    if (!donors.length) {
        const profileCard = document.getElementById('donorProfileCard');
        if (profileCard) profileCard.textContent = 'No donor selected yet. Add a donor to view their details.';
        return;
    }

    const currentSelection = Number(document.getElementById('donorId')?.value || 0);
    if (currentSelection) {
        showDonorProfile(currentSelection);
    } else {
        showDonorProfile(donors[0].id);
    }

    tbody.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const donorId = Number(btn.dataset.donorId);
            const donor = getDonors().find(item => item.id === donorId);
            if (!donor) return;

            const action = btn.dataset.action;
            if (action === 'edit') {
                populateDonorForm(donor);
            } else if (action === 'view') {
                showDonorProfile(donor.id);
            } else if (action === 'toggle') {
                toggleDonorStatus(donor.id);
            } else if (action === 'delete') {
                deleteDonor(donor.id);
            }
        });
    });
}

function renderDonorContributions() {
    const tbody = document.getElementById('donorContributionsBody');
    if (!tbody) return;

    const searchValue = (document.getElementById('donorSearch')?.value || '').trim().toLowerCase();
    const donorProfiles = getDonors();
    const contributions = new Map();
    getDonations().forEach(donation => {
        const profile = donorProfiles.find(donor =>
            donation.donorId != null
                ? String(donor.id) === String(donation.donorId)
                : String(donor.name || '').trim().toLocaleLowerCase() === String(donation.donor || '').trim().toLocaleLowerCase()
        );
        const name = profile?.name || String(donation.donor || '').trim() || 'Anonymous Donor';
        const key = donation.donorId != null
            ? `id:${donation.donorId}`
            : name === 'Anonymous Donor'
                ? `anonymous:${donation.id}`
                : `name:${String(donation.donor || '').trim().toLocaleLowerCase()}`;
        const organization = String(profile?.organization || '').toLowerCase();
        if (searchValue && !name.toLowerCase().includes(searchValue) && !organization.includes(searchValue)) return;
        if (!contributions.has(key)) contributions.set(key, { name, donations: [] });
        contributions.get(key).donations.push(donation);
    });

    const donors = [...contributions.values()].map(donor => {
        donor.donations.sort((a, b) =>
            String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id)
        );
        return donor;
    }).sort((a, b) =>
        String(b.donations[0]?.date || '').localeCompare(String(a.donations[0]?.date || ''))
        || a.name.localeCompare(b.name)
    );

    tbody.innerHTML = donors.map(({ name, donations }) => {
        const latest = donations[0];
        const contribution = latest.type === 'cash'
            ? peso(latest.amount)
            : formatInKindDonation(latest);
        const status = normalizeDonationStatus(latest.status);
        const statusClass = status === 'received' ? 'pending' : status === 'rejected' ? 'rejected' : 'success';
        return `<tr>
            <td><strong>${escapeHtml(name)}</strong></td>
            <td>${donations.length}</td>
            <td>${escapeHtml(contribution)}</td>
            <td>${latest.date ? formatDate(latest.date) : '—'}</td>
            <td><span class="badge badge-${statusClass}">${escapeHtml(status === 'received' ? 'Pending' : capitalize(status))}</span></td>
        </tr>`;
    }).join('') || `<tr><td colspan="5" class="empty-table">${searchValue ? 'No donors match this search.' : 'No donation records have been added yet.'}</td></tr>`;
}

function populateDonorForm(donor) {
    const fields = {
        donorId: donor.id,
        donorFullName: donor.name,
        donorType: donor.type,
        donorEmail: donor.email || '',
        donorPhone: donor.phone || '',
        donorOrganization: donor.organization || '',
        donorStatus: donor.status || 'active',
        donorLastDonation: donor.lastDonation || ''
    };

    Object.entries(fields).forEach(([id, value]) => {
        const field = document.getElementById(id);
        if (field) field.value = value;
    });

    const formTitle = document.getElementById('donorForm');
    if (formTitle) formTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetDonorForm() {
    document.getElementById('donorForm')?.reset();
    document.getElementById('donorId').value = '';
}

function toggleDonorStatus(donorId) {
    if (getUserRole() === 'staff') return;
    const donors = getDonors();
    const donor = donors.find(item => item.id === donorId);
    if (!donor) return;

    donor.status = donor.status === 'active' ? 'inactive' : 'active';
    try {
        saveDonors(donors);
    } catch (error) {
        console.error('Unable to update donor status.', error);
        window.alert('Unable to save this donor status in browser storage.');
        return;
    }
    renderDonorTable();
    showDonorProfile(donorId);
}

function deleteDonor(donorId) {
    if (getUserRole() === 'staff') return;
    const donors = getDonors();
    const donor = donors.find(item => item.id === donorId);
    if (!donor || !window.confirm(`Delete donor profile for ${donor.name}? Donation records will remain with their saved donor name, but the profile link will be removed.`)) return;
    try {
        const donations = getDonations();
        let changedDonations = false;
        donations.forEach(donation => {
            if (String(donation.donorId) !== String(donorId)) return;
            delete donation.donorId;
            changedDonations = true;
        });
        if (changedDonations) saveDonations(donations);
        saveDonors(donors.filter(item => item.id !== donorId));
    } catch (error) {
        console.error('Unable to delete donor.', error);
        window.alert('Unable to delete this donor in browser storage.');
        return;
    }
    logActivity(`Deleted donor profile: ${donor.name}`);
    resetDonorForm();
    renderDonorTable();
}

function showDonorProfile(donorId) {
    const donor = getDonors().find(item => item.id === donorId);
    const profileCard = document.getElementById('donorProfileCard');
    if (!donor || !profileCard) return;

    const donations = getDonations()
        .filter(item => item.donorId != null
            ? String(item.donorId) === String(donor.id)
            : String(item.donor || '').trim().toLocaleLowerCase() === donor.name.trim().toLocaleLowerCase())
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const totalContribution = donations.filter(item => item.type === 'cash').reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const donationHistory = donations.map(item => {
        const contribution = item.type === 'cash' ? peso(item.amount) : escapeHtml(formatInKindDonation(item));
        return `<li><strong>${escapeHtml(donationReference(item.id))} — ${escapeHtml(capitalize(normalizeDonationStatus(item.status)))}</strong><span>${contribution}</span><small>${escapeHtml(item.category || 'General donation')} · ${formatDate(item.date)}</small></li>`;
    }).join('');

    profileCard.innerHTML = `
        <div class="profile-row"><strong>Name</strong><span>${escapeHtml(donor.name)}</span></div>
        <div class="profile-row"><strong>Type</strong><span>${escapeHtml(donor.type)}</span></div>
        <div class="profile-row"><strong>Contact</strong><span>${escapeHtml(donor.phone || '—')}</span></div>
        <div class="profile-row"><strong>Email</strong><span>${escapeHtml(donor.email || '—')}</span></div>
        <div class="profile-row"><strong>Organization</strong><span>${escapeHtml(donor.organization || '—')}</span></div>
        <div class="profile-row"><strong>Status</strong><span><span class="badge-${donor.status === 'active' ? 'active' : 'inactive'}">${capitalize(donor.status || 'active')}</span></span></div>
        <div class="profile-row"><strong>Cash Given</strong><span>${peso(totalContribution)}</span></div>
        <div class="profile-row"><strong>Donation Count</strong><span>${donations.length}</span></div>
        <h3 class="history-heading">Donation History</h3>
        ${donationHistory ? `<ul class="history-list">${donationHistory}</ul>` : '<p class="muted-text">No donations recorded for this donor yet.</p>'}
    `;
}

function syncDonorFromDonation(donation) {
    const donors = getDonors();
    const donor = donors.find(item => String(item.id) === String(donation.donorId));
    if (!donor || !donation.date) return;
    if (!donor.lastDonation || donation.date > donor.lastDonation) donor.lastDonation = donation.date;
    saveDonors(donors);
}

function handleDonorSubmit(e) {
    e.preventDefault();
    if (getUserRole() === 'staff') return;
    const donorId = Number(document.getElementById('donorId').value || 0);
    const donors = getDonors();
    const donorData = {
        name: document.getElementById('donorFullName').value.trim(),
        type: document.getElementById('donorType').value,
        email: document.getElementById('donorEmail').value.trim(),
        phone: document.getElementById('donorPhone').value.trim(),
        organization: document.getElementById('donorOrganization').value.trim(),
        status: document.getElementById('donorStatus').value,
        lastDonation: document.getElementById('donorLastDonation').value || ''
    };

    if (!donorData.name) return;

    if (donorId) {
        const index = donors.findIndex(item => item.id === donorId);
        if (index >= 0) {
            donors[index] = { ...donors[index], ...donorData };
        }
    } else {
        donors.push({ id: nextId(donors), ...donorData });
    }

    saveDonors(donors);
    if (donorId) {
        const donations = getDonations();
        let changed = false;
        donations.forEach(donation => {
            if (String(donation.donorId) !== String(donorId)) return;
            donation.donor = donorData.name;
            changed = true;
        });
        if (changed) saveDonations(donations);
    }
    logActivity(`${donorId ? 'Updated' : 'Added'} donor ${donorData.name}`);
    resetDonorForm();
    renderDonorTable();
    renderAdminOverview();
}

/* ---------- BENEFICIARY MANAGEMENT ---------- */
function renderBeneficiaryTable() {
    const tbody = document.getElementById('beneficiaryTableBody');
    if (!tbody) return;
    const search = (document.getElementById('beneficiarySearch')?.value || '').trim().toLowerCase();
    const beneficiaries = getBeneficiaries().filter(beneficiary =>
        beneficiary.name.toLowerCase().includes(search) ||
        (beneficiary.location || '').toLowerCase().includes(search) ||
        (beneficiary.type || '').toLowerCase().includes(search)
    ).sort((a, b) => a.name.localeCompare(b.name));

    tbody.innerHTML = beneficiaries.map(beneficiary => `
        <tr>
            <td><strong>${escapeHtml(beneficiary.name)}</strong></td>
            <td>${escapeHtml(beneficiary.type)}</td>
            <td>${escapeHtml(beneficiary.contact || '—')}</td>
            <td>${escapeHtml(beneficiary.location || '—')}</td>
            <td>${beneficiary.assistance.length}</td>
            <td><div class="action-group">
                <button type="button" class="btn btn-outline btn-xs" data-beneficiary-action="view" data-beneficiary-id="${beneficiary.id}">View</button>
                ${getUserRole() === 'staff' ? '<span class="badge badge-pending">View Only</span>' : `<button type="button" class="btn btn-primary btn-xs" data-beneficiary-action="assistance" data-beneficiary-id="${beneficiary.id}">Record Assistance</button><button type="button" class="btn btn-outline btn-xs" data-beneficiary-action="edit" data-beneficiary-id="${beneficiary.id}">Edit</button><button type="button" class="btn btn-danger btn-xs" data-beneficiary-action="delete" data-beneficiary-id="${beneficiary.id}">Delete</button>`}
            </div></td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="empty-table">No beneficiaries match your search.</td></tr>';

    tbody.querySelectorAll('[data-beneficiary-action]').forEach(button => {
        button.addEventListener('click', () => {
            const id = Number(button.dataset.beneficiaryId);
            if (button.dataset.beneficiaryAction === 'view') showBeneficiaryProfile(id);
            if (button.dataset.beneficiaryAction === 'assistance') openAssistanceModal(id);
            if (button.dataset.beneficiaryAction === 'edit') editBeneficiary(id);
            if (button.dataset.beneficiaryAction === 'delete') deleteBeneficiary(id);
        });
    });
    setText('beneficiaryRecordCount', beneficiaries.length);
}

function showBeneficiaryProfile(id) {
    const beneficiary = getBeneficiaries().find(item => item.id === id);
    const profile = document.getElementById('beneficiaryProfile');
    if (!beneficiary || !profile) return;
    const history = beneficiary.assistance.map((item, index) => ({ ...item, historyIndex: index })).sort((a, b) => b.date.localeCompare(a.date));
    profile.innerHTML = `
        <div class="profile-row"><strong>Name</strong><span>${escapeHtml(beneficiary.name)}</span></div>
        <div class="profile-row"><strong>Type</strong><span>${escapeHtml(beneficiary.type)}</span></div>
        <div class="profile-row"><strong>Contact</strong><span>${escapeHtml(beneficiary.contact || '—')}</span></div>
        <div class="profile-row"><strong>Location</strong><span>${escapeHtml(beneficiary.location || '—')}</span></div>
        <div class="profile-row"><strong>Notes</strong><span>${escapeHtml(beneficiary.notes || '—')}</span></div>
        <h3 class="history-heading">Assistance History</h3>
        ${history.length ? `<ul class="history-list">${history.map(item => `<li><strong>${escapeHtml(item.description)}</strong><span>${escapeHtml(item.value || '—')}</span><small>${formatDate(item.date)}</small>${getUserRole() === 'staff' ? '' : `<div class="action-group"><button class="btn btn-outline btn-xs" type="button" data-assistance-edit="${item.historyIndex}" data-beneficiary-id="${id}">Edit</button><button class="btn btn-danger btn-xs" type="button" data-assistance-delete="${item.historyIndex}" data-beneficiary-id="${id}">Delete</button></div>`}</li>`).join('')}</ul>` : '<p class="muted-text">No assistance recorded yet.</p>'}
    `;
    profile.querySelectorAll('[data-assistance-edit]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getBeneficiaries();
        const target = records.find(item => item.id === Number(button.dataset.beneficiaryId));
        const index = Number(button.dataset.assistanceEdit);
        if (!target || !target.assistance[index]) return;
        const updated = promptRecordUpdate(target.assistance[index], [
            { key: 'date', label: 'Assistance date (YYYY-MM-DD)', type: 'date', required: true },
            { key: 'description', label: 'Assistance description', required: true },
            { key: 'value', label: 'Quantity / value', required: true }
        ]);
        if (!updated) return;
        target.assistance[index] = updated;
        try {
            saveBeneficiaries(records);
        } catch (error) {
            console.error('Unable to update assistance history.', error);
            window.alert('Unable to save this assistance history change in browser storage.');
            return;
        }
        logActivity(`Updated assistance history for ${target.name}`);
        showBeneficiaryProfile(target.id);
        renderBeneficiaryTable();
    }));
    profile.querySelectorAll('[data-assistance-delete]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getBeneficiaries();
        const target = records.find(item => item.id === Number(button.dataset.beneficiaryId));
        const index = Number(button.dataset.assistanceDelete);
        if (!target || !target.assistance[index] || !window.confirm('Delete this assistance history entry?')) return;
        target.assistance.splice(index, 1);
        try {
            saveBeneficiaries(records);
        } catch (error) {
            console.error('Unable to delete assistance history.', error);
            window.alert('Unable to delete this assistance history entry in browser storage.');
            return;
        }
        logActivity(`Deleted assistance history for ${target.name}`);
        showBeneficiaryProfile(target.id);
        renderBeneficiaryTable();
    }));
}

function handleBeneficiarySubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const name = document.getElementById('beneficiaryName').value.trim();
    if (!name) return;
    const beneficiaries = getBeneficiaries();
    const existing = beneficiaries.find(item => item.id === editingBeneficiaryId);
    const beneficiary = {
        ...(existing || { id: nextId(beneficiaries), assistance: [] }),
        name,
        type: document.getElementById('beneficiaryType').value,
        contact: document.getElementById('beneficiaryContact').value.trim(),
        location: document.getElementById('beneficiaryLocation').value.trim(),
        notes: document.getElementById('beneficiaryNotes').value.trim()
    };
    if (existing) beneficiaries[beneficiaries.indexOf(existing)] = beneficiary;
    else beneficiaries.push(beneficiary);
    try {
        saveBeneficiaries(beneficiaries);
    } catch (error) {
        window.alert('Unable to save this beneficiary in browser storage.');
        return;
    }
    logActivity(`${existing ? 'Updated' : 'Added'} beneficiary ${name}`);
    resetBeneficiaryForm();
    renderBeneficiaryTable();
    renderAdminOverview();
}

function resetBeneficiaryForm() {
    document.getElementById('beneficiaryForm')?.reset();
    editingBeneficiaryId = null;
    setText('beneficiaryFormTitle', 'Add Beneficiary');
    const cancelButton = document.getElementById('cancelBeneficiaryEdit');
    if (cancelButton) cancelButton.style.display = 'none';
}

function editBeneficiary(id) {
    if (getUserRole() === 'staff') return;
    const beneficiary = getBeneficiaries().find(item => item.id === id);
    if (!beneficiary) return;
    editingBeneficiaryId = id;
    document.getElementById('beneficiaryName').value = beneficiary.name;
    document.getElementById('beneficiaryType').value = beneficiary.type;
    document.getElementById('beneficiaryContact').value = beneficiary.contact || '';
    document.getElementById('beneficiaryLocation').value = beneficiary.location || '';
    document.getElementById('beneficiaryNotes').value = beneficiary.notes || '';
    setText('beneficiaryFormTitle', 'Edit Beneficiary');
    const cancelButton = document.getElementById('cancelBeneficiaryEdit');
    if (cancelButton) cancelButton.style.display = 'inline-flex';
    document.getElementById('beneficiaryForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteBeneficiary(id) {
    if (getUserRole() === 'staff') return;
    const beneficiaries = getBeneficiaries();
    const beneficiary = beneficiaries.find(item => item.id === id);
    if (!beneficiary) return;
    const distributions = getDistributions();
    const linked = distributions.filter(item => Number(item.beneficiaryId) === id);
    const message = linked.length
        ? `Delete ${beneficiary.name}, their assistance history, and ${linked.length} linked distribution record(s)?`
        : `Delete beneficiary ${beneficiary.name} and their assistance history?`;
    if (!window.confirm(message)) return;
    try {
        saveBeneficiaries(beneficiaries.filter(item => item.id !== id));
        if (linked.length) saveStoredList(DISTRIBUTION_KEY, distributions.filter(item => Number(item.beneficiaryId) !== id));
    } catch (error) {
        console.error('Unable to delete beneficiary and linked records.', error);
        window.alert('Unable to delete the beneficiary and linked records in browser storage.');
        return;
    }
    logActivity(`Deleted beneficiary and linked records: ${beneficiary.name}`);
    renderBeneficiaryTable();
    renderDistributionTable();
    renderAdminOverview();
    if (editingBeneficiaryId === id) {
        resetBeneficiaryForm();
    }
}

function openAssistanceModal(id) {
    if (getUserRole() === 'staff') return;
    const beneficiary = getBeneficiaries().find(item => item.id === id);
    if (!beneficiary) return;
    document.getElementById('assistanceForm').reset();
    document.getElementById('assistanceBeneficiaryId').value = String(id);
    document.getElementById('assistanceDate').value = new Date().toISOString().slice(0, 10);
    setText('assistanceBeneficiaryName', beneficiary.name);
    document.getElementById('assistanceModalOverlay').classList.add('active');
}

function closeAssistanceModal() {
    document.getElementById('assistanceModalOverlay')?.classList.remove('active');
}

function handleAssistanceSubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const id = Number(document.getElementById('assistanceBeneficiaryId').value);
    const beneficiaries = getBeneficiaries();
    const beneficiary = beneficiaries.find(item => item.id === id);
    if (!beneficiary) return;
    beneficiary.assistance.push({
        date: document.getElementById('assistanceDate').value,
        description: document.getElementById('assistanceDescription').value.trim(),
        value: document.getElementById('assistanceValue').value.trim()
    });
    try {
        saveBeneficiaries(beneficiaries);
    } catch (error) {
        window.alert('Unable to save this assistance record in browser storage.');
        return;
    }
    logActivity(`Recorded assistance for ${beneficiary.name}: ${document.getElementById('assistanceDescription').value.trim()}`);
    closeAssistanceModal();
    renderBeneficiaryTable();
    showBeneficiaryProfile(id);
}

/* ---------- PROJECT / ACTIVITY MANAGEMENT ---------- */
function populateProjectOptions() {
    document.querySelectorAll('[data-project-select]').forEach(select => {
        const selected = select.value;
        const projects = getProjects();
        select.innerHTML = `<option value="">${select.dataset.placeholder || 'Select project'}</option>` +
            projects.map(project => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join('');
        if (projects.some(project => String(project.id) === selected)) select.value = selected;
    });
}

function renderProjectTable() {
    const tbody = document.getElementById('projectTableBody');
    if (!tbody) return;
    const projects = getProjects();
    const donations = getDonations();
    const distributions = getDistributions();
    const expenses = getExpenses();
    tbody.innerHTML = projects.map(project => {
        const projectDonations = donations.filter(item => Number(item.projectId) === project.id);
        const donated = projectDonations.reduce((sum, item) => sum + (item.type === 'cash' ? Number(item.amount || 0) : 0), 0);
        const projectExpenses = expenses.filter(item => Number(item.projectId) === project.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const beneficiaries = new Set(distributions.filter(item => Number(item.projectId) === project.id).map(item => item.beneficiaryId)).size;
        const distributionCount = distributions.filter(item => Number(item.projectId) === project.id).length;
        return `<tr>
            <td><strong>${escapeHtml(project.name)}</strong><div class="muted-text">${escapeHtml(project.description || '')}</div></td>
            <td>${peso(project.budget)}</td><td>${peso(donated)}</td><td>${peso(projectExpenses)}</td><td>${beneficiaries}</td><td>${distributionCount}</td>
            <td><span class="badge ${project.status === 'Active' ? 'badge-success' : 'badge-pending'}">${escapeHtml(project.status)}</span></td>
            <td>${getUserRole() === 'staff' ? 'View only' : `<div class="action-group"><button class="btn btn-outline btn-xs" data-project-toggle="${project.id}">${project.status === 'Active' ? 'Pause' : 'Activate'}</button><button class="btn btn-outline btn-xs" data-project-edit="${project.id}">Edit</button><button class="btn btn-danger btn-xs" data-project-delete="${project.id}">Delete</button></div>`}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty-table">No projects yet. Add a project to get started.</td></tr>';
    tbody.querySelectorAll('[data-project-toggle]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const list = getProjects();
        const project = list.find(item => item.id === Number(button.dataset.projectToggle));
        if (!project) return;
        project.status = project.status === 'Active' ? 'Paused' : 'Active';
        try {
            saveStoredList(PROJECT_KEY, list);
        } catch (error) {
            console.error('Unable to update project status.', error);
            window.alert('Unable to save this project status in browser storage.');
            return;
        }
        logActivity(`${project.status === 'Active' ? 'Activated' : 'Paused'} project: ${project.name}`);
        renderProjectTable();
        renderAdminOverview();
    }));
    tbody.querySelectorAll('[data-project-edit]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const list = getProjects();
        const project = list.find(item => item.id === Number(button.dataset.projectEdit));
        if (!project) return;
        const updated = promptRecordUpdate(project, [
            { key: 'name', label: 'Project name', required: true },
            { key: 'description', label: 'Description' },
            { key: 'budget', label: 'Budget', type: 'number', required: true },
            { key: 'deadline', label: 'Campaign deadline (YYYY-MM-DD; leave blank if none)', type: 'date' }
        ]);
        if (!updated || updated.budget < 0) {
            if (updated) window.alert('Budget cannot be negative.');
            return;
        }
        list[list.indexOf(project)] = updated;
        try {
            saveStoredList(PROJECT_KEY, list);
        } catch (error) {
            console.error('Unable to update project.', error);
            window.alert('Unable to save this project in browser storage.');
            return;
        }
        logActivity(`Updated project: ${updated.name}`);
        renderProjectTable();
        populateProjectOptions();
        renderAdminOverview();
    }));
    tbody.querySelectorAll('[data-project-delete]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const list = getProjects();
        const project = list.find(item => item.id === Number(button.dataset.projectDelete));
        if (!project || !window.confirm(`Delete project ${project.name}? Linked records will keep their history without a project association.`)) return;
        const distributions = getDistributions();
        const expenses = getExpenses();
        const donations = getDonations();
        distributions.forEach(item => { if (Number(item.projectId) === project.id) item.projectId = null; });
        expenses.forEach(item => { if (Number(item.projectId) === project.id) item.projectId = null; });
        donations.forEach(item => { if (Number(item.projectId) === project.id) item.projectId = null; });
        try {
            saveStoredList(DISTRIBUTION_KEY, distributions);
            saveStoredList(EXPENSE_KEY, expenses);
            saveDonations(donations);
            saveStoredList(PROJECT_KEY, list.filter(item => item.id !== project.id));
        } catch (error) {
            console.error('Unable to delete project and unlink related records.', error);
            window.alert('Unable to delete this project completely. Please check browser storage and try again.');
            return;
        }
        logActivity(`Deleted project: ${project.name}`);
        renderProjectTable();
        renderDistributionTable();
        renderExpenseTable();
        populateProjectOptions();
        renderAdminOverview();
    }));
}

function handleProjectSubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const projects = getProjects();
    const project = {
        id: nextId(projects),
        name: document.getElementById('projectName').value.trim(),
        description: document.getElementById('projectDescription').value.trim(),
        budget: Number(document.getElementById('projectBudget').value),
        status: document.getElementById('projectStatus').value,
        deadline: document.getElementById('projectDeadline').value,
        donationIds: []
    };
    if (!project.name || !Number.isFinite(project.budget) || project.budget < 0) return;
    projects.push(project);
    try {
        saveStoredList(PROJECT_KEY, projects);
    } catch (error) {
        window.alert('Unable to save this project in browser storage.');
        return;
    }
    logActivity(`Created project: ${project.name}`);
    document.getElementById('projectForm').reset();
    renderProjectTable();
    populateProjectOptions();
    renderAdminOverview();
}

/* ---------- DISTRIBUTION MANAGEMENT ---------- */
function populateDistributionOptions() {
    populateProjectOptions();
    const beneficiariesSelect = document.getElementById('distributionBeneficiary');
    if (beneficiariesSelect) {
        beneficiariesSelect.innerHTML = '<option value="">Select beneficiary</option>' + getBeneficiaries().map(beneficiary =>
            `<option value="${beneficiary.id}">${escapeHtml(beneficiary.name)}</option>`
        ).join('');
    }
}

function renderDistributionTable() {
    const tbody = document.getElementById('distributionTableBody');
    if (!tbody) return;
    const projects = getProjects();
    const beneficiaries = getBeneficiaries();
    const distributions = getDistributions().sort((a, b) => b.date.localeCompare(a.date));
    tbody.innerHTML = distributions.map(item => {
        const project = projects.find(record => record.id === Number(item.projectId));
        const beneficiary = beneficiaries.find(record => record.id === Number(item.beneficiaryId));
        return `<tr>
            <td><strong>DST-${String(item.id).padStart(4, '0')}</strong></td><td>${escapeHtml(project?.name || 'Unknown project')}</td>
            <td>${escapeHtml(beneficiary?.name || item.beneficiaryName || 'Unknown beneficiary')}</td>
            <td>${escapeHtml(item.itemAmount)}</td><td>${escapeHtml(item.quantity || '—')}</td><td>${formatDate(item.date)}</td>
            <td>${item.confirmed ? 'Confirmed' : 'Not confirmed'}</td>
            <td>${getUserRole() === 'staff' ? `<span class="badge badge-${item.status.toLowerCase()}">${escapeHtml(item.status)}</span>` : `<div class="action-group"><select class="form-control distribution-status" data-distribution-status="${item.id}">${DISTRIBUTION_STATUSES.map(status => `<option ${status === item.status ? 'selected' : ''}>${status}</option>`).join('')}</select><button class="btn btn-outline btn-xs" type="button" data-distribution-edit="${item.id}">Edit</button><button class="btn btn-danger btn-xs" type="button" data-distribution-delete="${item.id}">Delete</button></div>`}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty-table">No distributions recorded.</td></tr>';
    tbody.querySelectorAll('[data-distribution-status]').forEach(select => select.addEventListener('change', () => {
        if (getUserRole() === 'staff') return;
        const list = getDistributions();
        const item = list.find(record => record.id === Number(select.dataset.distributionStatus));
        if (!item || !DISTRIBUTION_STATUSES.includes(select.value)) return;
        item.status = select.value;
        try {
            saveStoredList(DISTRIBUTION_KEY, list);
        } catch (error) {
            console.error('Unable to update distribution status.', error);
            window.alert('Unable to save this distribution status in browser storage.');
            renderDistributionTable();
            return;
        }
        logActivity(`Updated distribution DST-${String(item.id).padStart(4, '0')} to ${item.status}`);
        renderDistributionTable();
        renderAdminOverview();
    }));
    tbody.querySelectorAll('[data-distribution-edit]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getDistributions();
        const item = records.find(record => record.id === Number(button.dataset.distributionEdit));
        if (!item) return;
        const updated = promptRecordUpdate(item, [
            { key: 'category', label: 'Category', required: true },
            { key: 'itemAmount', label: 'Items / assistance provided', required: true },
            { key: 'quantity', label: 'Quantity' },
            { key: 'date', label: 'Date (YYYY-MM-DD)', type: 'date', required: true }
        ]);
        if (!updated) return;
        const projectId = promptRelatedRecordId('Project ID', item.projectId, getProjects(), true);
        if (projectId === undefined) return;
        const beneficiaryId = promptRelatedRecordId('Beneficiary ID', item.beneficiaryId, getBeneficiaries(), false);
        if (beneficiaryId === undefined) return;
        updated.projectId = projectId;
        updated.beneficiaryId = beneficiaryId;
        updated.beneficiaryName = getBeneficiaries().find(record => record.id === beneficiaryId)?.name || item.beneficiaryName;
        const confirmed = window.prompt('Confirmed? Enter yes or no.', item.confirmed ? 'yes' : 'no');
        if (confirmed === null) return;
        if (!['yes', 'no'].includes(confirmed.trim().toLowerCase())) {
            window.alert('Enter yes or no for confirmation.');
            return;
        }
        updated.confirmed = confirmed.trim().toLowerCase() === 'yes';
        const beneficiaries = getBeneficiaries();
        const previousRecipient = beneficiaries.find(record => Number(record.id) === Number(item.beneficiaryId));
        const recipient = beneficiaries.find(record => Number(record.id) === Number(updated.beneficiaryId));
        const findHistoryIndex = target => {
            if (!target) return -1;
            let index = target.assistance.findIndex(entry => entry.distributionId === item.id);
            if (index < 0) index = target.assistance.findIndex(entry =>
                entry.date === item.date && entry.description === item.itemAmount &&
                entry.value === (item.quantity || item.itemAmount)
            );
            return index;
        };
        if (previousRecipient && previousRecipient.id !== recipient?.id) {
            const previousHistoryIndex = findHistoryIndex(previousRecipient);
            if (previousHistoryIndex >= 0) previousRecipient.assistance.splice(previousHistoryIndex, 1);
        }
        if (recipient) {
            let historyIndex = findHistoryIndex(recipient);
            if (historyIndex < 0) {
                recipient.assistance.push({ distributionId: item.id, date: updated.date, description: updated.itemAmount, value: updated.quantity || updated.itemAmount });
            } else {
                const history = recipient.assistance[historyIndex];
                Object.assign(history, { distributionId: item.id, date: updated.date, description: updated.itemAmount, value: updated.quantity || updated.itemAmount });
            }
        }
        records[records.indexOf(item)] = updated;
        try {
            saveStoredList(DISTRIBUTION_KEY, records);
            saveBeneficiaries(beneficiaries);
        } catch (error) {
            console.error('Unable to update distribution.', error);
            window.alert('Unable to save this distribution in browser storage.');
            return;
        }
        logActivity(`Updated distribution DST-${String(item.id).padStart(4, '0')}`);
        renderDistributionTable();
        renderBeneficiaryTable();
        renderProjectTable();
        renderAdminOverview();
    }));
    tbody.querySelectorAll('[data-distribution-delete]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getDistributions();
        const item = records.find(record => record.id === Number(button.dataset.distributionDelete));
        if (!item || !window.confirm(`Delete distribution DST-${String(item.id).padStart(4, '0')}? Its matching assistance-history entry will also be removed.`)) return;
        const beneficiaries = getBeneficiaries();
        const recipient = beneficiaries.find(record => Number(record.id) === Number(item.beneficiaryId));
        const historyIndex = recipient ? recipient.assistance.findIndex(entry => entry.distributionId === item.id) : -1;
        if (recipient && historyIndex >= 0) recipient.assistance.splice(historyIndex, 1);
        else if (recipient) {
            const legacyIndex = recipient.assistance.findIndex(entry =>
                entry.date === item.date && entry.description === item.itemAmount &&
                entry.value === (item.quantity || item.itemAmount)
            );
            if (legacyIndex >= 0) recipient.assistance.splice(legacyIndex, 1);
        }
        try {
            saveStoredList(DISTRIBUTION_KEY, records.filter(record => record.id !== item.id));
            saveBeneficiaries(beneficiaries);
        } catch (error) {
            console.error('Unable to delete distribution.', error);
            window.alert('Unable to delete this distribution in browser storage.');
            return;
        }
        logActivity(`Deleted distribution DST-${String(item.id).padStart(4, '0')}`);
        renderDistributionTable();
        renderBeneficiaryTable();
        renderProjectTable();
        renderAdminOverview();
    }));
    setText('distributionRecordCount', distributions.length);
}

function handleDistributionSubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const projectId = Number(document.getElementById('distributionProject').value);
    const beneficiaryId = Number(document.getElementById('distributionBeneficiary').value);
    const project = getProjects().find(item => item.id === projectId);
    const beneficiary = getBeneficiaries().find(item => item.id === beneficiaryId);
    if (!project || !beneficiary) return;
    const list = getDistributions();
    const record = {
        id: nextId(list), projectId, beneficiaryId, beneficiaryName: beneficiary.name,
        category: document.getElementById('distributionCategory').value,
        itemAmount: document.getElementById('distributionItemAmount').value.trim(),
        quantity: document.getElementById('distributionQuantity').value.trim(),
        date: document.getElementById('distributionDate').value,
        confirmed: document.getElementById('distributionConfirmed').checked,
        status: document.getElementById('distributionStatus').value
    };
    if (!record.itemAmount) return;
    list.push(record);
    const beneficiaries = getBeneficiaries();
    const recipient = beneficiaries.find(item => item.id === beneficiaryId);
    recipient.assistance.push({ distributionId: record.id, date: record.date, description: record.itemAmount, value: record.quantity || record.itemAmount });
    try {
        saveStoredList(DISTRIBUTION_KEY, list);
        saveBeneficiaries(beneficiaries);
    } catch (error) {
        window.alert('Unable to save this distribution in browser storage.');
        return;
    }
    logActivity(`Recorded distribution DST-${String(record.id).padStart(4, '0')} to ${beneficiary.name}`);
    document.getElementById('distributionForm').reset();
    document.getElementById('distributionDate').value = new Date().toISOString().slice(0, 10);
    renderDistributionTable();
    renderProjectTable();
    renderBeneficiaryTable();
    renderAdminOverview();
}

/* ---------- EXPENSE MANAGEMENT ---------- */
function renderExpenseTable() {
    const tbody = document.getElementById('expenseTableBody');
    if (!tbody) return;
    const projects = getProjects();
    const expenses = getExpenses().sort((a, b) => b.date.localeCompare(a.date));
    tbody.innerHTML = expenses.map(expense => {
        const project = projects.find(item => item.id === Number(expense.projectId));
        const receipt = expense.receipt ? `<a href="${escapeHtml(expense.receipt)}" target="_blank" rel="noopener">View reference</a>` : escapeHtml(expense.reference || '—');
        const verified = expense.verified === true;
        const status = normalizeDonationStatus(d.status) === 'rejected'
            ? '<span class="badge badge-rejected">Rejected</span>'
            : verified ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-pending">Pending verification</span>';
        const action = getUserRole() === 'staff' ? '<span class="badge badge-pending">View only</span>' : `<div class="action-group"><button class="btn ${verified ? 'btn-outline' : 'btn-primary'} btn-xs" type="button" data-expense-verify="${Number(expense.id)}">${verified ? 'Mark Pending' : 'Verify'}</button><button class="btn btn-outline btn-xs" type="button" data-expense-edit="${Number(expense.id)}">Edit</button><button class="btn btn-danger btn-xs" type="button" data-expense-delete="${Number(expense.id)}">Delete</button></div>`;
        return `<tr><td>${escapeHtml(expense.description)}</td><td>${peso(expense.amount)}</td><td>${formatDate(expense.date)}</td><td>${escapeHtml(project?.name || '—')}</td><td>${escapeHtml(expense.category)}</td><td>${receipt}</td><td>${status}</td><td>${action}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="empty-table">No expenses recorded.</td></tr>';
    setText('expenseRecordCount', expenses.length);
    setText('expenseTotal', peso(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0)));
    setText('expenseVerifiedTotal', peso(expenses.filter(item => item.verified === true).reduce((sum, item) => sum + Number(item.amount || 0), 0)));
    tbody.querySelectorAll('[data-expense-verify]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getExpenses();
        const expense = records.find(item => Number(item.id) === Number(button.dataset.expenseVerify));
        if (!expense) return;
        expense.verified = expense.verified !== true;
        try {
            saveStoredList(EXPENSE_KEY, records);
        } catch (error) {
            console.error('Unable to update expense verification.', error);
            window.alert('Unable to save the expense verification status in browser storage.');
            return;
        }
        logActivity(`${expense.verified ? 'Verified' : 'Reopened'} expense: ${expense.description}`);
        renderExpenseTable();
        renderPublicPage();
    }));
    tbody.querySelectorAll('[data-expense-edit]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getExpenses();
        const expense = records.find(item => Number(item.id) === Number(button.dataset.expenseEdit));
        if (!expense) return;
        const updated = promptRecordUpdate(expense, [
            { key: 'description', label: 'Description', required: true },
            { key: 'amount', label: 'Amount', type: 'number', required: true },
            { key: 'date', label: 'Date (YYYY-MM-DD)', type: 'date', required: true },
            { key: 'category', label: 'Category', required: true },
            { key: 'reference', label: 'Receipt / reference' }
        ]);
        if (!updated || updated.amount <= 0) {
            if (updated) window.alert('Expense amount must be greater than zero.');
            return;
        }
        const projectId = promptRelatedRecordId('Project ID', expense.projectId, getProjects(), true);
        if (projectId === undefined) return;
        updated.projectId = projectId;
        updated.verified = false;
        records[records.indexOf(expense)] = updated;
        try {
            saveStoredList(EXPENSE_KEY, records);
        } catch (error) {
            console.error('Unable to update expense.', error);
            window.alert('Unable to save this expense in browser storage.');
            return;
        }
        logActivity(`Updated expense and reset verification: ${updated.description}`);
        renderExpenseTable();
        renderPublicPage();
    }));
    tbody.querySelectorAll('[data-expense-delete]').forEach(button => button.addEventListener('click', () => {
        if (getUserRole() === 'staff') return;
        const records = getExpenses();
        const expense = records.find(item => Number(item.id) === Number(button.dataset.expenseDelete));
        if (!expense || !window.confirm(`Delete expense "${expense.description}"?`)) return;
        try {
            saveStoredList(EXPENSE_KEY, records.filter(item => item.id !== expense.id));
        } catch (error) {
            console.error('Unable to delete expense.', error);
            window.alert('Unable to delete this expense in browser storage.');
            return;
        }
        logActivity(`Deleted expense: ${expense.description}`);
        renderExpenseTable();
        renderPublicPage();
    }));
}

function handleExpenseSubmit(event) {
    event.preventDefault();
    if (getUserRole() === 'staff') return;
    const amount = Number(document.getElementById('expenseAmount').value);
    const description = document.getElementById('expenseDescription').value.trim();
    const date = document.getElementById('expenseDate').value;
    const category = document.getElementById('expenseCategory').value.trim();
    if (!description || !category || !Number.isFinite(amount) || amount <= 0 || !date) return;
    const expenses = getExpenses();
    expenses.push({
        id: nextId(expenses), description, amount, date, category,
        projectId: Number(document.getElementById('expenseProject').value) || null,
        reference: document.getElementById('expenseReference').value.trim(),
        receipt: '',
        verified: false
    });
    try {
        saveStoredList(EXPENSE_KEY, expenses);
    } catch (error) {
        window.alert('Unable to save this expense in browser storage.');
        return;
    }
    logActivity(`Recorded expense: ${description} (${peso(amount)})`);
    document.getElementById('expenseForm').reset();
    document.getElementById('expenseDate').value = new Date().toISOString().slice(0, 10);
    renderExpenseTable();
}

/* ---------- REPORTS ---------- */
function downloadReport() {
    const type = document.getElementById('reportType').value;
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    if (from && to && from > to) {
        setText('reportMessage', 'The start date must be on or before the end date.');
        return;
    }
    const inRange = date => (!from || date >= from) && (!to || date <= to);
    const donations = getDonations();
    const donors = getDonors();
    const beneficiaries = getBeneficiaries();
    const projects = getProjects();
    const distributions = getDistributions();
    const expenses = getExpenses();
    let headers;
    let rows;
    if (type === 'donations') {
        headers = ['Donation ID', 'Donor', 'Type', 'Amount', 'Item', 'Quantity', 'Unit', 'Date', 'Purpose', 'Status'];
        rows = donations.filter(x => inRange(x.date)).map(x => [donationReference(x.id), getDonationDonorName(x), x.type, x.amount, x.item, x.quantity ?? '', x.unit || '', x.date, x.category, x.status]);
    } else if (type === 'donors') {
        headers = ['Name', 'Type', 'Email', 'Phone', 'Organization', 'Status', 'Last Donation'];
        rows = donors.map(x => [x.name, x.type, x.email, x.phone, x.organization, x.status, x.lastDonation]);
    } else if (type === 'beneficiaries') {
        headers = ['Name', 'Type', 'Contact', 'Location', 'Assistance Records'];
        rows = beneficiaries.map(x => [x.name, x.type, x.contact, x.location, x.assistance.length]);
    } else if (type === 'inventory') {
        headers = ['Donation ID', 'Donor', 'Item', 'Quantity', 'Unit', 'Date', 'Status'];
        rows = donations.filter(x => x.type === 'in-kind' && inRange(x.date)).map(x => [donationReference(x.id), getDonationDonorName(x), x.item, x.quantity ?? '', x.unit || '', x.date, x.status]);
    } else if (type === 'distributions') {
        headers = ['Distribution ID', 'Project', 'Beneficiary', 'Item / Amount', 'Quantity', 'Date', 'Confirmed', 'Status'];
        rows = distributions.filter(x => inRange(x.date)).map(x => [x.id, projects.find(p => p.id === Number(x.projectId))?.name, beneficiaries.find(b => b.id === Number(x.beneficiaryId))?.name || x.beneficiaryName, x.itemAmount, x.quantity, x.date, x.confirmed, x.status]);
    } else if (type === 'expenses') {
        headers = ['Description', 'Amount', 'Date', 'Project', 'Category', 'Reference'];
        rows = expenses.filter(x => inRange(x.date)).map(x => [x.description, x.amount, x.date, projects.find(p => p.id === Number(x.projectId))?.name, x.category, x.reference]);
    } else if (type === 'projects') {
        headers = ['Project', 'Budget', 'Donations', 'Expenses', 'Beneficiaries', 'Distributions', 'Status'];
        rows = projects.map(x => [
            x.name, x.budget,
            donations.filter(d => Number(d.projectId) === x.id).reduce((sum, d) => sum + Number(d.amount || 0), 0),
            expenses.filter(e => Number(e.projectId) === x.id).reduce((sum, e) => sum + Number(e.amount || 0), 0),
            new Set(distributions.filter(d => Number(d.projectId) === x.id).map(d => d.beneficiaryId)).size,
            distributions.filter(d => Number(d.projectId) === x.id).length, x.status
        ]);
    } else {
        headers = [type === 'annual' ? 'Year' : 'Month', 'Donation Count', 'Cash Received', 'Expenses'];
        const periods = new Map();
        donations.filter(x => inRange(x.date)).forEach(x => {
            const key = type === 'annual' ? x.date.slice(0, 4) : x.date.slice(0, 7);
            if (!periods.has(key)) periods.set(key, { donations: 0, cash: 0, expenses: 0 });
            const period = periods.get(key);
            period.donations += 1;
            if (x.type === 'cash') period.cash += Number(x.amount || 0);
        });
        expenses.filter(x => inRange(x.date)).forEach(x => {
            const key = type === 'annual' ? x.date.slice(0, 4) : x.date.slice(0, 7);
            if (!periods.has(key)) periods.set(key, { donations: 0, cash: 0, expenses: 0 });
            periods.get(key).expenses += Number(x.amount || 0);
        });
        rows = [...periods.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, data]) => [month, data.donations, data.cash, data.expenses]);
    }
    const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kbk-${type}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setText('reportMessage', `Generated ${rows.length} row(s) for this report.`);
    logActivity(`Generated ${type} report`);
}

/* ---------- USER & ACCOUNT MANAGEMENT ---------- */
function renderAccounts() {
    const tbody = document.getElementById('accountTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="empty-table">User accounts are managed securely in Supabase Authentication. Ask a Supabase project administrator to create users and assign their roles.</td></tr>';
}

async function importLegacyBrowserData() {
    if (getUserRole() !== 'admin' || !supabaseClient || !supabaseUser) {
        window.alert('Only a signed-in Supabase administrator can import browser data.');
        return;
    }
    if (!window.confirm('Import this browser’s saved records into the shared Supabase database? This will replace the matching shared lists. Review the local data first; sample/demo records may also be present. A backup copy will remain in this browser.')) return;

    const button = document.getElementById('importLegacyData');
    const status = document.getElementById('legacyImportStatus');
    button.disabled = true;
    try {
        let importedCount = 0;
        for (const key of SHARED_DATA_KEYS) {
            const backup = localStorage.getItem(`kbk_legacy_backup_${key}`);
            if (!backup) continue;
            let records;
            try {
                records = JSON.parse(backup);
            } catch (error) {
                throw new Error(`The saved ${key} backup is not valid JSON: ${error.message}`);
            }
            if (!Array.isArray(records)) throw new Error(`The saved ${key} backup is not a record list.`);
            localStorage.setItem(key, JSON.stringify(records));
            const pendingWrite = persistSharedData(key, records);
            if (!pendingWrite) throw new Error(`Unable to schedule ${key} for import.`);
            await pendingWrite;
            importedCount += 1;
        }
        status.textContent = importedCount
            ? `Imported ${importedCount} saved record list(s). Backup copies remain in this browser.`
            : 'No saved browser records were found to import.';
    } catch (error) {
        console.error('Legacy browser data import failed.', error);
        status.textContent = `Import stopped: ${error.message}. Some earlier lists may already have been imported.`;
        showSystemStatus(status.textContent, true);
    } finally {
        button.disabled = false;
    }
}

function renderActivityLog() {
    const tbody = document.getElementById('activityLogBody');
    if (!tbody) return;
    tbody.innerHTML = getActivityLog().map(item => `<tr><td>${escapeHtml(item.user)}</td><td>${escapeHtml(item.action)}</td><td>${new Date(item.date).toLocaleString()}</td></tr>`).join('')
        || '<tr><td colspan="3" class="empty-table">No activity recorded yet.</td></tr>';
}

/* ---------- LOGIN ---------- */
async function handleLogin(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const email = usernameInput.value.trim();
    const pass = passwordInput.value;
    const errorMessage = document.getElementById('loginError');
    if (!supabaseClient) {
        errorMessage.textContent = supabaseInitializationError?.message || 'Supabase is not available. Check the project configuration and try again.';
        errorMessage.style.display = 'block';
        return;
    }

    const submit = document.getElementById('loginSubmit');
    submit.disabled = true;
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
        if (error) throw new Error(error.message);
        const { data: profile, error: profileError } = await supabaseClient
            .from('kbk_profiles')
            .select('username,role,active')
            .eq('user_id', data.user.id)
            .maybeSingle();
        if (profileError) throw new Error(`Unable to verify your KBK account: ${profileError.message}`);
        if (!profile || !profile.active || !['admin', 'staff'].includes(String(profile.role).toLowerCase())) {
            await supabaseClient.auth.signOut();
            throw new Error('This account is not active for the KBK system. Contact an administrator.');
        }
        supabaseUser = data.user;
        sessionStorage.setItem(AUTH_KEY, 'true');
        sessionStorage.setItem(ROLE_KEY, String(profile.role).toLowerCase());
        sessionStorage.setItem(USER_KEY, profile.username);
        window.location.replace('dashboard.html');
    } catch (error) {
        console.error('KBK sign-in failed.', error);
        passwordInput.value = '';
        errorMessage.textContent = error.message;
        errorMessage.style.display = 'block';
        passwordInput.focus();
    } finally {
        submit.disabled = false;
    }
}

function toggleLoginPassword() {
    const input = document.getElementById('password');
    const toggle = document.getElementById('togglePassword');
    if (!input || !toggle) return;
    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    toggle.textContent = isVisible ? 'Show' : 'Hide';
    toggle.setAttribute('aria-pressed', String(!isVisible));
}

function initializeLoginPage() {
    if (isLoggedIn() && ['admin', 'staff'].includes(getUserRole())) {
        window.location.replace('dashboard.html');
        return;
    }

    if (new URLSearchParams(location.search).get('loggedOut') === '1') {
        const message = document.getElementById('loginSuccess');
        message.textContent = 'You have been signed out successfully.';
        message.hidden = false;
        history.replaceState(null, '', location.pathname);
    }

    const form = document.getElementById('loginForm');
    const errorMessage = document.getElementById('loginError');
    form?.addEventListener('submit', handleLogin);
    document.getElementById('togglePassword')?.addEventListener('click', toggleLoginPassword);
    form?.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
        errorMessage.style.display = 'none';
    }));
    if (supabaseInitializationError) {
        errorMessage.textContent = supabaseInitializationError.message;
        errorMessage.style.display = 'block';
    }
}

/* ---------- UTILS ---------- */
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function promptRecordUpdate(record, fields) {
    const updates = {};
    for (const field of fields) {
        const current = field.type === 'boolean'
            ? (record[field.key] === true ? 'yes' : 'no')
            : record[field.key] == null ? '' : String(record[field.key]);
        const entered = window.prompt(field.label, current);
        if (entered === null) return null;
        if (field.required && !entered.trim()) {
            window.alert(`${field.label} is required.`);
            return null;
        }
        const value = field.type === 'number' ? Number(entered) : field.type === 'boolean'
            ? entered.trim().toLowerCase() === 'yes'
            : entered.trim();
        if (field.type === 'number' && !Number.isFinite(value)) {
            window.alert(`${field.label} must be a valid number.`);
            return null;
        }
        if (field.type === 'boolean' && !['yes', 'no'].includes(entered.trim().toLowerCase())) {
            window.alert(`${field.label} must be answered yes or no.`);
            return null;
        }
        if (field.type === 'date' && value) {
            const date = new Date(`${value}T00:00:00Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
                window.alert(`${field.label} must be a valid date in YYYY-MM-DD format.`);
                return null;
            }
        }
        updates[field.key] = value;
    }
    return { ...record, ...updates };
}

function promptRelatedRecordId(label, currentId, records, allowNone) {
    const options = records.map(record => `${record.id}: ${record.name}`).join('\n');
    const entered = window.prompt(`${label} — enter an ID${allowNone ? ' or leave blank for none' : ''}.\n${options}`, currentId == null ? '' : String(currentId));
    if (entered === null) return undefined;
    const value = entered.trim();
    if (!value && allowNone) return null;
    const id = Number(value);
    if (!Number.isInteger(id) || !records.some(record => record.id === id)) {
        window.alert(`Choose a valid ${label.toLowerCase()} from the list.`);
        return undefined;
    }
    return id;
}

/* ---------- INIT PER PAGE ---------- */
function toggleSidebar(forceOpen) {
    const sidebar = document.querySelector('.sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;

    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', shouldOpen);
    document.body.classList.toggle('sidebar-open', shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
}

document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.dataset.page;
    renderSiteNavigation();
    await initializeSupabaseForPage(page);

    if (page === 'public') {
        renderPublicPage();
        window.addEventListener('storage', event => {
            const publicDataKeys = [STORAGE_KEY, PROJECT_KEY, DISTRIBUTION_KEY, EXPENSE_KEY, BENEFICIARY_KEY, INVENTORY_KEY];
            if (event.key !== null && !publicDataKeys.includes(event.key)) return;
            renderPublicPage();
        });
        document.getElementById('publicAssistanceForm')?.addEventListener('submit', handlePublicAssistanceSubmit);
        document.getElementById('publicFeedbackForm')?.addEventListener('submit', handlePublicFeedbackSubmit);
        document.querySelectorAll('.category-card').forEach(card => {
            card.addEventListener('click', () => selectCategory(card.dataset.category));
        });
    }

    if (page === 'dashboard') {
        if (supabaseInitializationError) {
            clearAuthSession();
            window.location.replace('login.html');
            return;
        }
        if (!requireAuth()) return;
        const role = getUserRole();
        const section = document.body.dataset.section || 'Dashboard';
        insertAdminPageChrome(section);
        insertAdminPageGuide();
        if (role === 'admin') migrateDonationDonorLinks();
        const welcome = document.querySelector('.page-header h1');
        if (welcome) {
            welcome.textContent = section;
        }

        const addBtn = document.getElementById('openAddModalBtn');
        const addLink = document.getElementById('openAddModal');
        if (role === 'staff') {
            addBtn?.setAttribute('disabled', 'disabled');
            addBtn?.setAttribute('aria-disabled', 'true');
            addBtn?.style.setProperty('opacity', '0.55');
            addBtn?.style.setProperty('cursor', 'not-allowed');
            addLink?.setAttribute('aria-disabled', 'true');
            addLink?.setAttribute('tabindex', '-1');
            addLink?.addEventListener('click', (e) => e.preventDefault());
            document.querySelectorAll('#donorForm input, #donorForm select, #donorForm textarea, #donorForm button, #beneficiaryForm input, #beneficiaryForm select, #beneficiaryForm textarea, #beneficiaryForm button, #assistanceForm input, #assistanceForm select, #assistanceForm textarea, #assistanceForm button, #projectForm input, #projectForm select, #projectForm textarea, #projectForm button, #distributionForm input, #distributionForm select, #distributionForm textarea, #distributionForm button, #expenseForm input, #expenseForm select, #expenseForm textarea, #expenseForm button, #accountForm input, #accountForm select, #accountForm button, #inventoryForm input, #inventoryForm select, #inventoryForm textarea, #inventoryForm button, #addDonorBtn').forEach(control => {
                control.setAttribute('disabled', 'disabled');
            });
        }

        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebarBackdrop = document.getElementById('sidebarBackdrop');
        sidebarToggle?.addEventListener('click', () => toggleSidebar());
        sidebarBackdrop?.addEventListener('click', () => toggleSidebar(false));
        document.querySelectorAll('.sidebar-menu a').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) toggleSidebar(false);
            });
        });

        renderDashboard();
        document.getElementById('donationStatusFilter')?.addEventListener('change', renderDashboard);
        if (section === 'Transparency') renderPublicPage();
        document.getElementById('logoutBtn')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
        document.querySelector('.admin-context-logout')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
        document.getElementById('donorForm')?.addEventListener('submit', handleDonorSubmit);
        document.getElementById('donorSearch')?.addEventListener('input', renderDonorTable);
        document.getElementById('donorStatusFilter')?.addEventListener('change', renderDonorTable);
        document.getElementById('resetDonorForm')?.addEventListener('click', resetDonorForm);
        document.getElementById('addDonorBtn')?.addEventListener('click', () => {
            resetDonorForm();
            document.getElementById('donorFullName')?.focus();
        });
        document.getElementById('beneficiaryForm')?.addEventListener('submit', handleBeneficiarySubmit);
        document.getElementById('cancelBeneficiaryEdit')?.addEventListener('click', resetBeneficiaryForm);
        document.getElementById('beneficiarySearch')?.addEventListener('input', renderBeneficiaryTable);
        document.getElementById('assistanceForm')?.addEventListener('submit', handleAssistanceSubmit);
        document.getElementById('assistanceModalClose')?.addEventListener('click', closeAssistanceModal);
        document.getElementById('assistanceCancel')?.addEventListener('click', closeAssistanceModal);
        document.getElementById('assistanceModalOverlay')?.addEventListener('click', event => {
            if (event.target.id === 'assistanceModalOverlay') closeAssistanceModal();
        });
        document.getElementById('projectForm')?.addEventListener('submit', handleProjectSubmit);
        document.getElementById('inventoryForm')?.addEventListener('submit', handleInventorySubmit);
        document.getElementById('distributionForm')?.addEventListener('submit', handleDistributionSubmit);
        document.getElementById('expenseForm')?.addEventListener('submit', handleExpenseSubmit);
        document.getElementById('importLegacyData')?.addEventListener('click', importLegacyBrowserData);
        if (role !== 'admin') {
            const importButton = document.getElementById('importLegacyData');
            if (importButton) importButton.disabled = true;
        }
        document.getElementById('reportGenerate')?.addEventListener('click', downloadReport);
        renderBeneficiaryTable();
        const assistanceRequestStatus = document.getElementById('assistanceRequestStatus');
        const publicFeedbackStatus = document.getElementById('publicFeedbackStatus');
        if (document.getElementById('assistanceRequestTableBody')) {
            if (role === 'admin') {
                try {
                    await loadAdminAssistanceRequests();
                    if (assistanceRequestStatus) {
                        assistanceRequestStatus.dataset.error = 'false';
                        assistanceRequestStatus.textContent = `${remoteAssistanceRequests.length} request${remoteAssistanceRequests.length === 1 ? '' : 's'} in the shared inbox.`;
                    }
                } catch (error) {
                    console.error('Unable to load the shared assistance request inbox.', error);
                    remoteAssistanceRequests = null;
                    if (assistanceRequestStatus) {
                        assistanceRequestStatus.dataset.error = 'true';
                        assistanceRequestStatus.textContent = `The shared inbox could not be loaded: ${error.message}. Confirm the latest setup SQL has been run and try again.`;
                    }
                }
            } else {
                remoteAssistanceRequests = [];
                if (assistanceRequestStatus) assistanceRequestStatus.textContent = 'Request details are restricted to active administrators.';
            }
        }
        if (document.getElementById('publicFeedbackTableBody')) {
            if (role === 'admin') {
                try {
                    await loadAdminFeedbackMessages();
                    if (publicFeedbackStatus) {
                        publicFeedbackStatus.dataset.error = 'false';
                        publicFeedbackStatus.textContent = `${remoteFeedbackMessages.length} message${remoteFeedbackMessages.length === 1 ? '' : 's'} in the shared inbox.`;
                    }
                } catch (error) {
                    console.error('Unable to load the shared contact inbox.', error);
                    remoteFeedbackMessages = null;
                    if (publicFeedbackStatus) {
                        publicFeedbackStatus.dataset.error = 'true';
                        publicFeedbackStatus.textContent = `The contact inbox could not be loaded: ${error.message}. Confirm the latest database setup has been applied and try again.`;
                    }
                }
            } else {
                remoteFeedbackMessages = [];
                if (publicFeedbackStatus) publicFeedbackStatus.textContent = 'Contact message details are restricted to active administrators.';
            }
        }
        renderAssistanceRequests();
        renderPublicFeedback();
        renderInventory();
        renderSystemSettings();
        renderProjectTable();
        populateProjectOptions();
        populateDistributionOptions();
        renderDistributionTable();
        renderExpenseTable();
        renderAccounts();
        renderActivityLog();
        ['distributionDate', 'expenseDate'].forEach(id => {
            const dateInput = document.getElementById(id);
            if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
        });
    }

    document.getElementById('donationForm')?.addEventListener('submit', handleFormSubmit);
    document.getElementById('donorSelection')?.addEventListener('change', updateDonationDonorFields);
    document.getElementById('donorSelection')?.addEventListener('change', event => {
        const search = document.getElementById('donationDonorSearch');
        if (!event.target.value || !search?.value) return;
        search.value = '';
        populateDonationDonorOptions(event.target.value);
    });
    document.getElementById('donationDonorSearch')?.addEventListener('input', event => {
        populateDonationDonorOptions(document.getElementById('donorSelection').value, event.target.value);
    });
    document.getElementById('donationType')?.addEventListener('change', updateTypeFields);
    document.getElementById('donationUnit')?.addEventListener('change', () => {
        if (document.getElementById('donationType').value === 'in-kind') updateTypeFields();
    });
    document.getElementById('donationStatus')?.addEventListener('change', event => {
        const reasonGroup = document.getElementById('rejectionReasonGroup');
        const reasonInput = document.getElementById('rejectionReason');
        const rejected = event.target.value === 'rejected';
        reasonGroup.hidden = !rejected;
        reasonInput.required = rejected;
        if (rejected) reasonInput.focus();
    });
    document.getElementById('openAddModal')?.addEventListener('click', (e) => {
        e.preventDefault();
        openAddModal();
    });
    document.getElementById('openAddModalBtn')?.addEventListener('click', openAddModal);
    document.getElementById('modalClose')?.addEventListener('click', () => toggleModal(false));
    document.getElementById('modalCancel')?.addEventListener('click', () => toggleModal(false));
    document.getElementById('allocationForm')?.addEventListener('submit', handleAllocationSubmit);
    document.getElementById('allocationModalClose')?.addEventListener('click', closeAllocationModal);
    document.getElementById('allocationCancel')?.addEventListener('click', closeAllocationModal);
    document.getElementById('allocationModalOverlay')?.addEventListener('click', event => {
        if (event.target.id === 'allocationModalOverlay') closeAllocationModal();
    });
    updateTypeFields();

    if (page === 'login') initializeLoginPage();
});