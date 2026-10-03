import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, addDoc, deleteDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ==========================================
// 1. Firebase Configuration & Initialization
// ==========================================
window.appId = 'school-attendance-final-v3';
let isCloudSynced = false;
let unsubscribeLive = null;
let unsubscribeExcuses = null;

const firebaseConfig = {
    apiKey: "AIzaSyCVdLikyOhh7wc29omVblZzNdEG3rakoeA",
    authDomain: "student-absence-8bb60.firebaseapp.com",
    projectId: "student-absence-8bb60",
    storageBucket: "student-absence-8bb60.firebasestorage.app",
    messagingSenderId: "310683889093",
    appId: "1:310683889093:web:2716598d9a7227e504efac"
};

const app = initializeApp(firebaseConfig); 
const auth = getAuth(app); 
window.db = getFirestore(app);

signInAnonymously(auth).catch(err => console.error("Firebase Auth Error:", err));

// Global Modal & Notification Helpers (Available immediately)
window.openModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
};
window.closeModals = function() {
    if (typeof window.closeLiveCameraModal === 'function') {
        window.closeLiveCameraModal();
    }
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
};
const openModal = window.openModal;
const closeModals = window.closeModals;

let notificationTimeout = null;
window.showBottomNotification = function(title, desc, type = 'info', actions = [], duration = 4500) {
    const el = document.getElementById('bottomNotification');
    if (!el) return;
    const titleEl = document.getElementById('bnTitle');
    const descEl = document.getElementById('bnDesc');
    const iconEl = document.getElementById('bnIcon');
    const actionsEl = document.getElementById('bnActions');

    if (titleEl) titleEl.innerText = title || '';
    if (descEl) descEl.innerText = desc || '';

    if (iconEl) {
        if (type === 'success') {
            iconEl.innerText = '✅';
            iconEl.style.background = '#dcfce7';
            iconEl.style.color = '#16a34a';
        } else if (type === 'danger' || type === 'error') {
            iconEl.innerText = '🚨';
            iconEl.style.background = '#fee2e2';
            iconEl.style.color = '#dc2626';
        } else if (type === 'warning') {
            iconEl.innerText = '⏰';
            iconEl.style.background = '#fef3c7';
            iconEl.style.color = '#d97706';
        } else {
            iconEl.innerText = '🔔';
            iconEl.style.background = '#e0e7ff';
            iconEl.style.color = '#4f46e5';
        }
    }

    if (actionsEl) {
        actionsEl.innerHTML = '';
        if (actions && actions.length > 0) {
            actions.forEach(act => {
                const btn = document.createElement('button');
                btn.className = act.className || 'bn-btn bn-btn-secondary';
                btn.innerText = act.label;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (act.onClick) act.onClick();
                    el.classList.remove('active');
                };
                actionsEl.appendChild(btn);
            });
        }
        const closeBtn = document.createElement('button');
        closeBtn.className = 'bn-btn bn-btn-secondary';
        closeBtn.innerText = '✕';
        closeBtn.title = 'إغلاق';
        closeBtn.onclick = () => el.classList.remove('active');
        actionsEl.appendChild(closeBtn);
    }

    el.classList.add('active');

    if (notificationTimeout) clearTimeout(notificationTimeout);
    if (duration > 0) {
        notificationTimeout = setTimeout(() => {
            el.classList.remove('active');
        }, duration);
    }
};
const showBottomNotification = window.showBottomNotification;

// ==========================================
// 2. Global State & Data Models
// ==========================================
const DEFAULT_SHEET_ID = "1ucLRdqi7YbDu8x6NtIjFEqG-gkrricjz";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzKQEMUFaBXlFpKzOdqMDPsMrUtgjmk8ykWsHvFxTOutXTajmeN0A3Uk7DLH7Q5yNiT/exec";

// Official School Administration Email
let officialAdminEmail = localStorage.getItem('school_admin_email') || 'hadi2030mm@gmail.com';
function updateAdminEmailDisplays() {
    const el = document.getElementById('currentAdminEmailDisplay');
    if (el) el.textContent = officialAdminEmail;
    const portalEl = document.getElementById('studentPortalAdminEmailBadge');
    if (portalEl) portalEl.textContent = officialAdminEmail;
}
window.updateAdminEmailDisplays = updateAdminEmailDisplays;

let attendanceData = JSON.parse(localStorage.getItem('student_attendance_v3') || '{}');
let students = JSON.parse(localStorage.getItem('students_list_master_v3') || '[]');

function sanitizeStudent(s) {
    if (!s) return s;
    if (s.id === "ID_17875800661900.18865527437403218" || s.nationalId === "1166423234" || 
        s.class === "جاسم محمد حسن الصفار" || s.class === "جسام محمد حسن الصفار" || 
        (s.name === "ثاني متوسط-د" && (s.class || '').includes("الصفار"))) {
        s.name = "جسام محمد حسن الصفار";
        s.class = "ثاني متوسط-د";
    }
    return s;
}

function sortStudentsAlphabetically(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(sanitizeStudent).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar', { sensitivity: 'base' }));
}

students = sortStudentsAlphabetically(students);
localStorage.setItem('students_list_master_v3', JSON.stringify(students));
let currentSelectedDate = getTodayDate();
let activeFamilyStudents = [];
let currentFamilyIndex = 0;
let cloudExcuses = [];
let exceptionOverrideDates = JSON.parse(localStorage.getItem('holiday_override_dates') || '{}');

function isHolidayDate(dateStr) {
    if (exceptionOverrideDates[dateStr]) return false;
    const parts = dateStr.split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const day = d.getDay();
    return (day === 5 || day === 6); // 5 = الجمعة, 6 = السبت
}

function getTodayDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function updateCloudIndicator(active) {
    isCloudSynced = active;
    const ind = document.getElementById('cloudSyncStatus');
    if (ind) {
        ind.style.backgroundColor = active ? '#10b981' : '#f59e0b';
        ind.style.boxShadow = active ? '0 0 0 3px rgba(16, 185, 129, 0.2)' : '0 0 0 3px rgba(245, 158, 11, 0.2)';
    }
}

// Helper to serialize attendance records to JSON string to prevent Firestore's 40,000 index entries limit
function serializeAttendanceData(recordsObj) {
    try {
        const jsonStr = JSON.stringify(recordsObj || {});
        // Firestore single document string field can hold hundreds of kilobytes
        // If string is under 750,000 chars (~750KB), store in single field
        const CHUNK_SIZE = 750000;
        if (jsonStr.length <= CHUNK_SIZE) {
            return {
                recordsJson: jsonStr,
                recordsChunkCount: 1
            };
        }
        // If exceeding chunk size, partition into multiple string fields
        const count = Math.ceil(jsonStr.length / CHUNK_SIZE);
        const result = { recordsChunkCount: count };
        for (let i = 0; i < count; i++) {
            result[`recordsJson_${i}`] = jsonStr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        }
        return result;
    } catch (e) {
        console.error("Error serializing attendance data:", e);
        return { recordsJson: "{}", recordsChunkCount: 1 };
    }
}

function deserializeAttendanceData(docData) {
    if (!docData) return {};
    // 1. Try chunked string
    if (docData.recordsChunkCount && docData.recordsChunkCount > 1) {
        try {
            let combined = '';
            for (let i = 0; i < docData.recordsChunkCount; i++) {
                combined += (docData[`recordsJson_${i}`] || '');
            }
            return JSON.parse(combined);
        } catch (e) {
            console.error("Error parsing chunked recordsJson:", e);
        }
    }
    // 2. Try single recordsJson string
    if (docData.recordsJson && typeof docData.recordsJson === 'string') {
        try {
            return JSON.parse(docData.recordsJson);
        } catch (e) {
            console.error("Error parsing recordsJson:", e);
        }
    }
    // 3. Fallback to legacy unstringified records object (if present from older versions)
    if (docData.records && typeof docData.records === 'object') {
        return docData.records;
    }
    return {};
}

// Setup real-time listeners
function initCloudListeners() {
    if (unsubscribeLive) unsubscribeLive();
    const liveDocRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'shared_attendance', 'live_state');
    unsubscribeLive = onSnapshot(liveDocRef, (snap) => {
        // Skip processing our own local pending latency-compensation writes to avoid redundant loops
        if (snap.metadata && snap.metadata.hasPendingWrites) {
            return;
        }
        if (snap.exists()) {
            const data = snap.data();
            if (data.students && Array.isArray(data.students)) {
                students = sortStudentsAlphabetically(data.students);
                localStorage.setItem('students_list_master_v3', JSON.stringify(students));
            } else if (data.studentsJson) {
                try {
                    const parsedStudents = JSON.parse(data.studentsJson);
                    if (Array.isArray(parsedStudents)) {
                        students = sortStudentsAlphabetically(parsedStudents);
                        localStorage.setItem('students_list_master_v3', JSON.stringify(students));
                    }
                } catch (e) {
                    console.warn("Failed to parse studentsJson:", e);
                }
            }

            const incomingRecords = deserializeAttendanceData(data);
            if (incomingRecords && typeof incomingRecords === 'object' && Object.keys(incomingRecords).length > 0) {
                attendanceData = { ...attendanceData, ...incomingRecords };
                localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
            }

            lastSyncedDataHash = computeDataHash(students, attendanceData);
            updateCloudIndicator(true);
            updateHistorySelector();
            if (document.getElementById('appContainer').style.display !== 'none') {
                renderTable();
            }
            if (document.getElementById('studentPortalView').style.display !== 'none') {
                renderStudentDashboard(activeFamilyStudents[currentFamilyIndex]);
            }

            // Auto-migrate old Firestore document if it lacks serialized recordsJson or is on older sync version
            if (!data.recordsJson && (!data.syncVersion || data.syncVersion !== '3.1')) {
                syncToCloud(true);
            }
        }
    }, (err) => {
        console.warn("Firestore live snapshot error:", err);
        updateCloudIndicator(false);
    });

    if (unsubscribeExcuses) unsubscribeExcuses();
    const excusesCol = collection(window.db, 'artifacts', window.appId, 'public', 'data', 'excuses');
    unsubscribeExcuses = onSnapshot(excusesCol, (snap) => {
        cloudExcuses = [];
        snap.forEach(d => {
            cloudExcuses.push({ id: d.id, ...d.data() });
        });
        updateExcusesBadge();
        if (document.getElementById('studentPortalView').style.display !== 'none') {
            renderStudentExcuses(activeFamilyStudents[currentFamilyIndex]);
        }
    }, (err) => {
        console.warn("Firestore excuses error:", err);
    });
}

// Robust Cloud Sync Manager (Prevents write stream exhaustion and respects Firestore 1-write/sec limit)
let syncDebounceTimer = null;
let isSyncInProgress = false;
let hasPendingSync = false;
let lastSyncedDataHash = null;
let lastSyncTimestamp = 0;
const MIN_SYNC_INTERVAL_MS = 1200; // Strict limit to prevent single-document write contention
let syncBackoffDelay = 0;

function computeDataHash(studentsArr, attendanceObj) {
    try {
        const sCount = studentsArr ? studentsArr.length : 0;
        const firstId = studentsArr && studentsArr[0] ? studentsArr[0].id : '';
        const lastId = studentsArr && studentsArr[sCount - 1] ? studentsArr[sCount - 1].id : '';
        const attDates = Object.keys(attendanceObj || {});
        let recordsCount = 0;
        attDates.forEach(d => {
            recordsCount += Object.keys(attendanceObj[d] || {}).length;
        });
        return `${sCount}:${firstId}:${lastId}|${attDates.length}:${recordsCount}`;
    } catch {
        return Math.random().toString();
    }
}

async function executeCloudSync() {
    if (isSyncInProgress) {
        hasPendingSync = true;
        return;
    }

    const now = Date.now();
    const elapsed = now - lastSyncTimestamp;
    const requiredInterval = MIN_SYNC_INTERVAL_MS + syncBackoffDelay;
    if (elapsed < requiredInterval) {
        hasPendingSync = true;
        if (!syncDebounceTimer) {
            syncDebounceTimer = setTimeout(() => {
                syncDebounceTimer = null;
                executeCloudSync();
            }, requiredInterval - elapsed);
        }
        return;
    }

    const currentHash = computeDataHash(students, attendanceData);
    if (lastSyncedDataHash && currentHash === lastSyncedDataHash && !hasPendingSync) {
        updateCloudIndicator(true);
        return;
    }

    isSyncInProgress = true;
    hasPendingSync = false;

    try {
        const liveDocRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'shared_attendance', 'live_state');
        const serializedRecords = serializeAttendanceData(attendanceData);
        const serializedStudents = JSON.stringify(students || []);

        // Important: Keep only a shallow summary in records (current day only) for legacy readers,
        // avoiding deep nested objects that trigger Firestore's 40,000 maximum index entries per entity.
        const currentDayRecords = (currentSelectedDate && attendanceData[currentSelectedDate])
            ? { [currentSelectedDate]: attendanceData[currentSelectedDate] }
            : {};

        // Important: Overwrite document without { merge: true } so Firestore completely drops
        // the 40,000+ old nested index entries from the entity on the server.
        await setDoc(liveDocRef, {
            students: students,
            studentsJson: serializedStudents,
            ...serializedRecords,
            records: currentDayRecords,
            lastUpdated: new Date().toISOString(),
            syncVersion: '3.1'
        });

        lastSyncedDataHash = currentHash;
        lastSyncTimestamp = Date.now();
        syncBackoffDelay = 0; // Reset backoff on success
        updateCloudIndicator(true);
    } catch (e) {
        console.error("Cloud sync error:", e);
        updateCloudIndicator(false);
        // Exponential backoff to avoid overloading Firestore backend
        if (e && (e.code === 'resource-exhausted' || (e.message && e.message.includes('resource-exhausted')))) {
            syncBackoffDelay = Math.min(10000, (syncBackoffDelay || 2000) * 2);
            console.warn(`Applying Firestore backoff delay of ${syncBackoffDelay}ms`);
        }
    } finally {
        isSyncInProgress = false;
        if (hasPendingSync) {
            hasPendingSync = false;
            if (!syncDebounceTimer) {
                syncDebounceTimer = setTimeout(() => {
                    syncDebounceTimer = null;
                    executeCloudSync();
                }, MIN_SYNC_INTERVAL_MS + syncBackoffDelay);
            }
        }
    }
}

function syncToCloud(immediate = false) {
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
    }

    if (immediate) {
        return executeCloudSync();
    }

    return new Promise((resolve) => {
        syncDebounceTimer = setTimeout(async () => {
            syncDebounceTimer = null;
            await executeCloudSync();
            resolve();
        }, 1000);
    });
}
window.syncToCloud = syncToCloud;

// ==========================================
// 3. UI Authentication & Navigation
// ==========================================
window.switchLoginTab = function(type) {
    document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'));
    document.getElementById(`form-${type}`).classList.add('active');
};

window.checkAdminLogin = function() {
    const p = document.getElementById('adminPassword').value;
    if (p === 'hadi@') {
        document.getElementById('loginPortal').style.display = 'none';
        document.getElementById('studentPortalView').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        currentSelectedDate = getTodayDate();
        initAdminView();
    } else {
        showAlert('تنبيه', 'كلمة المرور غير صحيحة');
    }
};

window.checkStudentLogin = function() {
    const rawNid = document.getElementById('studentNationalIdInput').value.trim();
    if (!rawNid) {
        showAlert('تنبيه', 'يرجى إدخال رقم السجل المدني');
        return;
    }
    const matched = students.filter(s => String(s.nationalId || '').trim() === rawNid);
    if (matched.length === 0) {
        showAlert('تنبيه', 'لم يتم العثور على طالب مرتبط برقم السجل المدني هذا.');
        return;
    }
    activeFamilyStudents = matched;
    currentFamilyIndex = 0;
    document.getElementById('loginPortal').style.display = 'none';
    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('studentPortalView').style.display = 'block';
    renderStudentDashboard(activeFamilyStudents[0]);
    checkAbsenceNotification(activeFamilyStudents[0]);
};

window.logoutToPortal = function() {
    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('studentPortalView').style.display = 'none';
    document.getElementById('loginPortal').style.display = 'flex';
    document.getElementById('studentNationalIdInput').value = '';
    document.getElementById('adminPassword').value = '';
};

// ==========================================
// 4. Admin Dashboard Operations
// ==========================================
function initAdminView() {
    document.getElementById('currentDate').innerText = formatArabicDate(currentSelectedDate);
    populateClassFilter();
    updateHistorySelector();
    renderTable();
    checkHoliday();
}

window.toArabicDigits = function(num) {
    if (num === null || num === undefined) return '';
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(num).replace(/[0-9]/g, w => arabicDigits[+w]);
};

function formatArabicDateWithDigits(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length !== 3) return window.toArabicDigits(dateStr);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${days[d.getDay()]}، ${window.toArabicDigits(d.getDate())} ${months[d.getMonth()]} ${window.toArabicDigits(d.getFullYear())}م`;
}

function formatArabicDate(dateStr) {
    const parts = dateStr.split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${days[d.getDay()]}، ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function checkHoliday() {
    const isHoliday = isHolidayDate(currentSelectedDate);
    const isOverridden = !!exceptionOverrideDates[currentSelectedDate];
    const existing = document.getElementById('holidayBanner');
    const bulkPresentBtn = document.getElementById('btnBulkPresent');
    const bulkAbsentBtn = document.getElementById('btnBulkAbsent');
    const dayRecords = attendanceData[currentSelectedDate] || {};
    const hasRecords = Object.keys(dayRecords).length > 0;

    if (isHoliday) {
        if (!existing) {
            const banner = document.createElement('div');
            banner.id = 'holidayBanner';
            banner.style.cssText = 'background: #fef3c7; color: #92400e; padding: 14px 20px; border-radius: 12px; margin-bottom: 20px; font-weight: 700; border: 1px solid #fde68a; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; box-shadow: var(--shadow-sm);';
            banner.innerHTML = getHolidayBannerContent(hasRecords);
            const controlsSec = document.querySelector('.controls-section');
            if (controlsSec) controlsSec.prepend(banner);
        } else {
            existing.innerHTML = getHolidayBannerContent(hasRecords);
        }

        // Lock bulk buttons
        if (bulkPresentBtn) {
            bulkPresentBtn.disabled = true;
            bulkPresentBtn.style.opacity = '0.4';
            bulkPresentBtn.style.cursor = 'not-allowed';
            bulkPresentBtn.title = 'معطل: اليوم عطلة رسمية (إجازة نهاية الأسبوع)';
        }
        if (bulkAbsentBtn) {
            bulkAbsentBtn.disabled = true;
            bulkAbsentBtn.style.opacity = '0.4';
            bulkAbsentBtn.style.cursor = 'not-allowed';
            bulkAbsentBtn.title = 'معطل: اليوم عطلة رسمية (إجازة نهاية الأسبوع)';
        }
    } else if (isOverridden) {
        if (!existing) {
            const banner = document.createElement('div');
            banner.id = 'holidayBanner';
            banner.style.cssText = 'background: #eff6ff; color: #1e40af; padding: 14px 20px; border-radius: 12px; margin-bottom: 20px; font-weight: 700; border: 1px solid #bfdbfe; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; box-shadow: var(--shadow-sm);';
            banner.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:22px;">🔓</span>
                    <div>
                        <div style="font-size:15px; font-weight:800;">وضع الرصد الاستثنائي مفعل لهذا اليوم</div>
                        <div style="font-size:12.5px; font-weight:600; color:#2563eb;">تم فتح أزرار التحضير استثنائياً للأنشطة والاختبارات الخاصة.</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button onclick="window.toggleHolidayOverride()" style="background: #2563eb; color:white; border:none; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:800; cursor:pointer; font-family:'Tajawal', sans-serif;">إعادة قفل العطلة 🔒</button>
                </div>
            `;
            const controlsSec = document.querySelector('.controls-section');
            if (controlsSec) controlsSec.prepend(banner);
        }
        if (bulkPresentBtn) { bulkPresentBtn.disabled = false; bulkPresentBtn.style.opacity = '1'; bulkPresentBtn.style.cursor = 'pointer'; bulkPresentBtn.title = ''; }
        if (bulkAbsentBtn) { bulkAbsentBtn.disabled = false; bulkAbsentBtn.style.opacity = '1'; bulkAbsentBtn.style.cursor = 'pointer'; bulkAbsentBtn.title = ''; }
    } else {
        if (existing) existing.remove();
        if (bulkPresentBtn) { bulkPresentBtn.disabled = false; bulkPresentBtn.style.opacity = '1'; bulkPresentBtn.style.cursor = 'pointer'; bulkPresentBtn.title = ''; }
        if (bulkAbsentBtn) { bulkAbsentBtn.disabled = false; bulkAbsentBtn.style.opacity = '1'; bulkAbsentBtn.style.cursor = 'pointer'; bulkAbsentBtn.title = ''; }
    }
}

function getHolidayBannerContent(hasRecords) {
    return `
        <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:22px;">🏖️</span>
            <div>
                <div style="font-size:15px; font-weight:800; color:#92400e;">اليوم عطلة رسمية (إجازة نهاية الأسبوع)</div>
                <div style="font-size:12.5px; font-weight:600; color:#b45309;">تم قفل رصد الغياب تلقائياً حفاظاً على دقة سجلات المواظبة ومنع تسجيل غياب في العطلات.</div>
            </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${hasRecords ? `
                <button onclick="window.clearCurrentDayHolidayRecords()" style="background:#ef4444; color:white; border:none; padding:8px 15px; border-radius:8px; font-size:13px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:6px; font-family:'Tajawal', sans-serif; box-shadow:0 2px 4px rgba(239,68,68,0.2);">
                    مسح تحضير اليوم (عطلة) 🗑️
                </button>
            ` : ''}
            <button onclick="window.toggleHolidayOverride()" style="background:#f59e0b; color:white; border:none; padding:8px 15px; border-radius:8px; font-size:13px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:6px; font-family:'Tajawal', sans-serif; box-shadow:0 2px 4px rgba(245,158,11,0.2);">
                تفعيل رصد استثنائي 🔓
            </button>
        </div>
    `;
}

function populateClassFilter() {
    const sel = document.getElementById('classFilter');
    const rangeSel = document.getElementById('rangeClassFilter');
    const classes = [...new Set(students.map(s => s.class))].filter(Boolean);
    
    let html = '<option value="all">جميع الفصول</option>';
    classes.forEach(c => html += `<option value="${c}">${c}</option>`);
    
    sel.innerHTML = html;
    if (rangeSel) rangeSel.innerHTML = html;
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    const search = document.getElementById('searchInput').value.toLowerCase();
    const classVal = document.getElementById('classFilter').value;
    const statusVal = document.getElementById('statusFilter').value;

    const dayRecords = attendanceData[currentSelectedDate] || {};

    let total = students.length;
    let pCount = 0, aCount = 0, lCount = 0, eCount = 0;

    students.forEach(s => {
        const rec = dayRecords[s.id] || { status: 'none', time: '-' };
        if (rec.status === 'present') pCount++;
        else if (rec.status === 'absent') aCount++;
        else if (rec.status === 'late') lCount++;
        else if (rec.status === 'excused') eCount++;
    });

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-present').innerText = pCount;
    document.getElementById('stat-absent').innerText = aCount;
    const statExcusedEl = document.getElementById('stat-excused');
    if (statExcusedEl) statExcusedEl.innerText = eCount;
    document.getElementById('stat-late').innerText = lCount;

    document.getElementById('stat-present-pct').innerText = total ? `${Math.round((pCount/total)*100)}%` : '0%';
    document.getElementById('stat-absent-pct').innerText = total ? `${Math.round((aCount/total)*100)}%` : '0%';
    const statExcusedPctEl = document.getElementById('stat-excused-pct');
    if (statExcusedPctEl) statExcusedPctEl.innerText = total ? `${Math.round((eCount/total)*100)}%` : '0%';
    document.getElementById('stat-late-pct').innerText = total ? `${Math.round((lCount/total)*100)}%` : '0%';

    // تحديث شارات شريط التوجيه التنفيذي المتقدم
    const todayAbsBadge = document.getElementById('todayAbsentBadge');
    if (todayAbsBadge) todayAbsBadge.innerText = aCount;

    let highAbsCount = 0;
    let highLateCount = 0;
    students.forEach(s => {
        let a = 0, l = 0;
        Object.keys(attendanceData).forEach(d => {
            const st = (attendanceData[d][s.id] || {}).status;
            if (st === 'absent') a++;
            if (st === 'late') l++;
        });
        if (a >= 3) highAbsCount++;
        if (l >= 3) highLateCount++;
    });

    const absPlanBadge = document.getElementById('absencePlanBadge');
    if (absPlanBadge) absPlanBadge.innerText = highAbsCount;

    const tardPlanBadge = document.getElementById('tardinessPlanBadge');
    if (tardPlanBadge) tardPlanBadge.innerText = highLateCount;

    const filtered = students.filter(s => {
        const matchSearch = (s.name || '').toLowerCase().includes(search) || 
                            (s.nationalId || '').includes(search) || 
                            (s.phone || '').includes(search);
        const matchClass = classVal === 'all' || s.class === classVal;
        const curStatus = (dayRecords[s.id] || {}).status || 'none';
        const matchStatus = statusVal === 'all' || curStatus === statusVal;
        return matchSearch && matchClass && matchStatus;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar', { sensitivity: 'base' }));

    const isHolidayLocked = isHolidayDate(currentSelectedDate);

    filtered.forEach(s => {
        const rec = dayRecords[s.id] || { status: 'none', time: '-' };
        const stats = getStudentSummary(s.id);
        const trend = calculateDisciplineTrend(s.id);
        
        // Check if student has an excuse for selected date
        const todayExcuse = cloudExcuses.find(e => (e.studentId === s.id || (e.studentNationalId && String(e.studentNationalId).trim() === String(s.nationalId).trim())) && e.date === currentSelectedDate);
        const hasExcuseAttach = todayExcuse && (todayExcuse.fileUrl || todayExcuse.attachmentUrl || todayExcuse.dataUrl || todayExcuse.file);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 4px; padding: 4px 0;">
                    <span style="font-weight: 800; font-size: 15px; color: var(--text-main); line-height: 1.3;">${s.name}</span>
                    ${todayExcuse ? `
                        <button class="btn" style="background:${todayExcuse.status === 'accepted' ? '#dcfce7' : '#fef3c7'}; color:${todayExcuse.status === 'accepted' ? '#166534' : '#92400e'}; padding:2px 8px; font-size:11px; font-weight:800; border-radius:6px; border:none; display:inline-flex; align-items:center; gap:3px; cursor:pointer;" onclick="${hasExcuseAttach ? `window.viewExcuseAttachmentById('${todayExcuse.id}')` : `window.openAdminExcusesModal()`}" title="معاينة وتحميل عذر الطالب">
                            <span>${hasExcuseAttach ? '📎' : '📋'}</span>
                            <span>${todayExcuse.status === 'accepted' ? 'عذر معتمد' : 'عذر مسجل'}</span>
                        </button>
                    ` : ''}
                    ${stats.absent > 0 ? `<div style="color: #e11d48; font-size: 13px; font-weight: 800; line-height: 1.2; white-space: nowrap;">غياب (${stats.absent})</div>` : ''}
                    <div style="display: flex; justify-content: center; margin-top: 2px;">
                        <span style="font-size: 11.5px; font-weight: 800; padding: 3px 12px; border-radius: 20px; background: ${trend.bg}; color: ${trend.color}; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); white-space: nowrap;">
                            ${trend.label}
                        </span>
                    </div>
                </div>
            </td>
            <td style="font-family: monospace; font-size: 14px; text-align: right;" dir="ltr">${s.nationalId || '-'}</td>
            <td style="font-family: monospace; font-size: 14px; text-align: right;" dir="ltr">${s.phone || '-'}</td>
            <td><span style="background: #f1f5f9; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 700;">${s.class || '-'}</span></td>
            <td>
                <div class="status-toggles" style="${isHolidayLocked ? 'opacity: 0.4;' : ''}">
                    <button class="toggle-btn ${rec.status === 'present' ? 'active-present' : ''}" ${isHolidayLocked ? 'disabled title="الرصد مقفل: اليوم عطلة رسمية" style="cursor: not-allowed;"' : `onclick="window.markStatus('${s.id}', 'present')"`}>ح</button>
                    <button class="toggle-btn ${rec.status === 'absent' ? 'active-absent' : ''}" ${isHolidayLocked ? 'disabled title="الرصد مقفل: اليوم عطلة رسمية" style="cursor: not-allowed;"' : `onclick="window.markStatus('${s.id}', 'absent')"`}>غ</button>
                    <button class="toggle-btn ${rec.status === 'late' ? 'active-late' : ''}" ${isHolidayLocked ? 'disabled title="الرصد مقفل: اليوم عطلة رسمية" style="cursor: not-allowed;"' : `onclick="window.markStatus('${s.id}', 'late')"`}>ت</button>
                    <button class="toggle-btn ${rec.status === 'excused' ? 'active-excused' : ''}" ${isHolidayLocked ? 'disabled title="الرصد مقفل: اليوم عطلة رسمية" style="cursor: not-allowed;"' : `onclick="window.markStatus('${s.id}', 'excused')"`}>ع</button>
                </div>
            </td>
            <td class="time-cell">${rec.time || '-'}</td>
            <td style="text-align: center; white-space: nowrap;">
                ${hasExcuseAttach ? `
                    <button class="edit-btn" style="background: #fee2e2; color: #be123c; border-color: #fecdd3; margin-left: 3px;" onclick="window.viewExcuseAttachmentById('${todayExcuse.id}')" title="استعراض وتحميل التقرير الطبي المرفق">
                        <span style="font-size: 13px;">📎</span>
                    </button>
                ` : ''}
                <button class="edit-btn" style="background: #e0f2fe; color: #0284c7; border-color: #bae6fd; margin-left: 3px;" onclick="window.openStudentReportDirect('${s.id}')" title="تقرير تفصيلي وسجل الانضباط">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                </button>
                <button class="edit-btn" onclick="window.openEditStudent('${s.id}')" title="تعديل">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="delete-btn" onclick="window.deleteStudent('${s.id}')" title="حذف">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function calculateDisciplineTrend(studentId) {
    const stats = getStudentSummary(studentId);

    // غياب 10 أيام فأكثر (سواء كانت متصلة أو منفصلة): مخاطبة جهات الاختصاص وحماية الطفل
    if (stats.absent >= 10) {
        return { 
            label: '🚨 غياب حرج (10 أيام فأكثر - حماية الطفل)', 
            bg: '#fee2e2', 
            color: '#9f1239' 
        };
    }
    // غياب 5 إلى 9 أيام: إحالة إلى لجنة التوجيه وجلسة توعوية
    if (stats.absent >= 5) {
        return { 
            label: '⚠️ غياب متكرر (5 أيام - لجنة التوجيه)', 
            bg: '#ffedd5', 
            color: '#c2410c' 
        };
    }
    // غياب 3 إلى 4 أيام: تحويل للموجه واستدعاء ولي الأمر
    if (stats.absent >= 3) {
        return { 
            label: '⚠️ غياب 3 أيام (تحويل للموجه واستدعاء ولي الأمر)', 
            bg: '#fef3c7', 
            color: '#b45309' 
        };
    }
    // تأخر 3 مرات فأكثر (متتالية أو منقطعة)
    if (stats.late >= 3) {
        return { 
            label: '⏱️ يميل للتأخر الصباحي', 
            bg: '#fef3c7', 
            color: '#b45309' 
        };
    }
    // غياب بعذر مقبول 3 أيام فأكثر (متتالية أو منقطعة)
    if (stats.excused >= 3) {
        return { 
            label: '📋 يميل للغياب المتكرر بعذر', 
            bg: '#e0f2fe', 
            color: '#0284c7' 
        };
    }
    // غياب 1 - 2 يوم
    if (stats.absent > 0) {
        return {
            label: 'ℹ️ غياب أولي (تواصل في نفس اليوم)',
            bg: '#f0fdf4',
            color: '#15803d'
        };
    }
    // دون حد الـ 3 أيام: مواظب ومتميز
    return { 
        label: '⭐ مواظب ومتميز', 
        bg: '#dcfce7', 
        color: '#15803d' 
    };
}

window.handleFilter = function() {
    renderTable();
};

window.clearCurrentDayHolidayRecords = function() {
    showConfirm('مسح سجلات اليوم', `اليوم عطلة رسمية. هل أنت متأكد من رغبتك في مسح وإلغاء جميع سجلات التحضير المرصودة لتاريخ (${currentSelectedDate}) ليعود يوماً خالياً من الرصد؟`, () => {
        delete attendanceData[currentSelectedDate];
        localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
        syncToCloud();
        initAdminView();
        showAlert('تم بنجاح', 'تم مسح سجلات اليوم بنجاح وإلغاء أي رصد خاطئ تم أثناء العطلة ✅');
    });
};

window.toggleHolidayOverride = function() {
    if (exceptionOverrideDates[currentSelectedDate]) {
        delete exceptionOverrideDates[currentSelectedDate];
        localStorage.setItem('holiday_override_dates', JSON.stringify(exceptionOverrideDates));
        initAdminView();
        showAlert('إعادة القفل', 'تمت إعادة قفل رصد الغياب والحضور لهذا اليوم كعطلة رسمية 🔒');
    } else {
        showConfirm('تفعيل الرصد الاستثنائي', 'هل ترغب في فتح وتفعيل رصد الحضور والغياب استثنائياً لهذا اليوم (مثل وجود نشاط مدرسي، مسابقة، أو اختبار في يوم الإجازة)؟', () => {
            exceptionOverrideDates[currentSelectedDate] = true;
            localStorage.setItem('holiday_override_dates', JSON.stringify(exceptionOverrideDates));
            initAdminView();
            showAlert('تم التفعيل', 'تم تفعيل الرصد الاستثنائي لهذا اليوم. أزرار التحضير متاحة الآن ✅');
        });
    }
};

window.markStatus = function(studentId, status) {
    if (isHolidayDate(currentSelectedDate)) {
        exceptionOverrideDates[currentSelectedDate] = true;
        localStorage.setItem('holiday_override_dates', JSON.stringify(exceptionOverrideDates));
        checkHoliday();
    }
    if (!attendanceData[currentSelectedDate]) {
        attendanceData[currentSelectedDate] = {};
    }
    const current = attendanceData[currentSelectedDate][studentId] || {};
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let isNewlyMarked = false;
    if (current.status === status) {
        delete attendanceData[currentSelectedDate][studentId];
    } else {
        attendanceData[currentSelectedDate][studentId] = {
            status: status,
            time: timeStr
        };
        isNewlyMarked = true;
    }
    localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
    renderTable();
    checkHoliday();
    syncToCloud();
    updateHistorySelector();

    // إظهار رسالة منبثقة من أسفل الصفحة لإشعار ولي الأمر بالواتساب فور اختيار الحالة
    if (isNewlyMarked && (status === 'absent' || status === 'late' || status === 'excused')) {
        const student = students.find(s => s.id === studentId);
        if (student) {
            window.showStudentStatusWhatsAppNotification(student, status, timeStr);
        }
    }
};

window.markBulk = function(status) {
    if (isHolidayDate(currentSelectedDate)) {
        exceptionOverrideDates[currentSelectedDate] = true;
        localStorage.setItem('holiday_override_dates', JSON.stringify(exceptionOverrideDates));
        checkHoliday();
    }
    if (!attendanceData[currentSelectedDate]) {
        attendanceData[currentSelectedDate] = {};
    }
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const search = document.getElementById('searchInput').value.toLowerCase();
    const classVal = document.getElementById('classFilter').value;

    students.forEach(s => {
        const matchSearch = (s.name || '').toLowerCase().includes(search) || (s.nationalId || '').includes(search);
        const matchClass = classVal === 'all' || s.class === classVal;
        if (matchSearch && matchClass) {
            attendanceData[currentSelectedDate][s.id] = { status, time: timeStr };
        }
    });
    localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
    renderTable();
    checkHoliday();
    syncToCloud();
    updateHistorySelector();
};

window.syncDirectly = async function() {
    await syncToCloud(true);
    showAlert('نجاح', 'تمت المزامنة المباشرة مع السحابة وقاعدة البيانات بنجاح ✅');
};

// ==========================================
// 5. Time Machine (Archive/History)
// ==========================================
function getArchiveDateList() {
    const datesSet = new Set();
    const currentYear = new Date().getFullYear(); // e.g. 2026
    const today = getTodayDate();
    const todayObj = new Date();

    // 1. إضافة جميع أيام شهر سبتمبر (09) كاملة من 1 إلى 30
    for (let day = 1; day <= 30; day++) {
        const dStr = `${currentYear}-09-${String(day).padStart(2, '0')}`;
        datesSet.add(dStr);
    }

    // 2. إضافة الأيام السابقة من بداية العام الدراسي في شهر أغسطس (من 20 إلى 31)
    for (let day = 20; day <= 31; day++) {
        const dStr = `${currentYear}-08-${String(day).padStart(2, '0')}`;
        datesSet.add(dStr);
    }

    // 3. إضافة أيام الشهر الحالي حتى اليوم الحالي في حال كنا في شهر آخر (مثل أكتوبر، نوفمبر..)
    const curMonth = todayObj.getMonth() + 1;
    if (curMonth !== 9) {
        const curDateNum = todayObj.getDate();
        for (let day = 1; day <= curDateNum; day++) {
            const dStr = `${currentYear}-${String(curMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            datesSet.add(dStr);
        }
    }

    // 4. ضمان وجود تاريخ اليوم والتاريخ المحدد حالياً
    datesSet.add(today);
    if (currentSelectedDate && currentSelectedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        datesSet.add(currentSelectedDate);
    }

    // 5. إضافة أي تواريخ إضافية مسجلة مسبقاً في سجلات الحضور بالنظام
    if (attendanceData && typeof attendanceData === 'object') {
        Object.keys(attendanceData).forEach(d => {
            if (d && d.match(/^\d{4}-\d{2}-\d{2}$/)) {
                datesSet.add(d);
            }
        });
    }

    // ترتيب تنازلي: من الأحدث إلى الأقدم
    return Array.from(datesSet).sort().reverse();
}

function updateHistorySelector() {
    const sel = document.getElementById('historyDateSelector');
    if (!sel) return;

    const dates = getArchiveDateList();
    const today = getTodayDate();

    let html = '<option value="" style="color: #1e293b; background: #f8fafc; font-weight: 800;">📑 سجل الأرشيف ورصد الغياب (شهر 9 والأيام السابقة)</option>';

    dates.forEach(d => {
        const parts = d.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const dayName = dayNames[dateObj.getDay()] || '';

        const isToday = (d === today);
        const dayRecords = attendanceData[d] || {};
        const recordedCount = Object.keys(dayRecords).length;
        const isHoliday = isHolidayDate(d);

        let statusBadge = '';
        let optionStyle = 'color: #1e293b; background: white; font-weight: 700;';

        if (recordedCount > 0) {
            statusBadge = `✓ رُصد (${recordedCount})`;
            if (isHoliday) {
                statusBadge += ' [إجازة]';
            }
        } else if (isHoliday) {
            statusBadge = isToday ? '★ اليوم (إجازة رسمية)' : '🌴 إجازة رسمية';
            optionStyle = 'color: #92400e; background: #fffbeb; font-weight: 700;';
        } else if (isToday) {
            statusBadge = '★ اليوم';
        } else {
            statusBadge = '○ متاح للرصد';
        }

        const isSelected = (d === currentSelectedDate);
        html += `<option value="${d}" ${isSelected ? 'selected' : ''} style="${optionStyle}">${d} | ${dayName} - [ ${statusBadge} ]</option>`;
    });

    sel.innerHTML = html;

    const datePicker = document.getElementById('historyDatePicker');
    if (datePicker) {
        datePicker.value = currentSelectedDate || today;
    }

    const btnReturn = document.getElementById('btnReturnToday');
    const btnDelete = document.getElementById('btnDeleteHistoryDay');
    const isToday = (currentSelectedDate === today);

    if (btnReturn) btnReturn.style.display = isToday ? 'none' : 'inline-flex';
    if (btnDelete) btnDelete.style.display = isToday ? 'none' : 'inline-flex';
}

window.loadHistoricalData = function(d) {
    if (!d) return;
    currentSelectedDate = d;
    if (!attendanceData[d]) {
        attendanceData[d] = {};
    }
    const datePicker = document.getElementById('historyDatePicker');
    if (datePicker) {
        datePicker.value = d;
    }
    initAdminView();
    if (window.showBottomNotification) {
        window.showBottomNotification('الانتقال للأرشيف 📅', `تم فتح سجل تاريخ ${formatArabicDate(d)} للرصد وتعديل الحالات.`, 'info');
    }
};

window.onHistoricalDatePicked = function(d) {
    if (!d) return;
    window.loadHistoricalData(d);
};

window.goToPreviousArchiveDay = function() {
    const dates = getArchiveDateList();
    const curIdx = dates.indexOf(currentSelectedDate);
    if (curIdx < dates.length - 1 && curIdx !== -1) {
        window.loadHistoricalData(dates[curIdx + 1]);
    } else if (curIdx === -1 && dates.length > 0) {
        window.loadHistoricalData(dates[0]);
    } else {
        if (window.showBottomNotification) {
            window.showBottomNotification('تنبيه الأرشيف', 'وصلت إلى أقدم تاريخ متوفر في الأرشيف.', 'info');
        }
    }
};

window.goToNextArchiveDay = function() {
    const dates = getArchiveDateList();
    const curIdx = dates.indexOf(currentSelectedDate);
    if (curIdx > 0) {
        window.loadHistoricalData(dates[curIdx - 1]);
    } else if (curIdx === -1 && dates.length > 0) {
        window.loadHistoricalData(dates[0]);
    } else {
        if (window.showBottomNotification) {
            window.showBottomNotification('تنبيه الأرشيف', 'وصلت إلى أحدث تاريخ متوفر في الأرشيف.', 'info');
        }
    }
};

window.returnToToday = function() {
    currentSelectedDate = getTodayDate();
    const datePicker = document.getElementById('historyDatePicker');
    if (datePicker) {
        datePicker.value = currentSelectedDate;
    }
    initAdminView();
    if (window.showBottomNotification) {
        window.showBottomNotification('العودة لليوم 📌', `تمت العودة لسجل اليوم (${formatArabicDate(currentSelectedDate)}).`, 'success');
    }
};

window.confirmDeleteHistoryDay = function() {
    showConfirm('تأكيد الحذف', `هل أنت متأكد من رغبتك في حذف سجلات تاريخ ${currentSelectedDate} نهائياً؟`, () => {
        delete attendanceData[currentSelectedDate];
        localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
        syncToCloud();
        returnToToday();
    });
};

window.confirmResetMonth = function() {
    showConfirm('تصفير لشهر جديد', 'هل أنت متأكد من تصفير سجلات الحضور لبداية شهر جديد مع الاحتفاظ ببيانات الطلاب؟', () => {
        attendanceData = {};
        localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
        syncToCloud();
        initAdminView();
        showAlert('تم', 'تم تصفير السجلات للشهر الجديد بنجاح ✅');
    });
};

// ==========================================
// 6. Student Management (Add, Edit, Delete)
// ==========================================
window.openAddStudent = function() {
    document.getElementById('addStudentName').value = '';
    document.getElementById('addStudentNationalId').value = '';
    document.getElementById('addStudentClass').value = '';
    document.getElementById('addStudentPhone').value = '';
    openModal('addStudentModal');
};

window.saveNewStudent = function() {
    const name = document.getElementById('addStudentName').value.trim();
    const nid = document.getElementById('addStudentNationalId').value.trim();
    const cls = document.getElementById('addStudentClass').value.trim();
    const phone = document.getElementById('addStudentPhone').value.trim();

    if (!name || !nid) {
        showAlert('تنبيه', 'يرجى إدخال اسم الطالب والسجل المدني على الأقل');
        return;
    }
    const newStudent = {
        id: 's_' + Date.now(),
        name,
        nationalId: nid,
        class: cls,
        phone
    };
    students.push(newStudent);
    students = sortStudentsAlphabetically(students);
    localStorage.setItem('students_list_master_v3', JSON.stringify(students));
    closeModals();
    populateClassFilter();
    renderTable();
    syncToCloud();
    showAlert('نجاح', 'تمت إضافة الطالب بنجاح ✅');
};

window.openEditStudent = function(id) {
    const s = students.find(item => item.id === id);
    if (!s) return;
    document.getElementById('editStudentId').value = s.id;
    document.getElementById('editStudentName').value = s.name || '';
    document.getElementById('editStudentNationalId').value = s.nationalId || '';
    document.getElementById('editStudentClass').value = s.class || '';
    document.getElementById('editStudentPhone').value = s.phone || '';
    openModal('editStudentModal');
};

window.saveStudentEdit = function() {
    const id = document.getElementById('editStudentId').value;
    const s = students.find(item => item.id === id);
    if (!s) return;
    s.name = document.getElementById('editStudentName').value.trim();
    s.nationalId = document.getElementById('editStudentNationalId').value.trim();
    s.class = document.getElementById('editStudentClass').value.trim();
    s.phone = document.getElementById('editStudentPhone').value.trim();

    students = sortStudentsAlphabetically(students);
    localStorage.setItem('students_list_master_v3', JSON.stringify(students));
    closeModals();
    populateClassFilter();
    renderTable();
    syncToCloud();
    showAlert('نجاح', 'تم تحديث بيانات الطالب بنجاح ✅');
};

window.deleteStudent = function(id) {
    showConfirm('تأكيد الحذف', 'هل أنت متأكد من حذف هذا الطالب نهائياً من النظام؟', () => {
        students = students.filter(item => item.id !== id);
        localStorage.setItem('students_list_master_v3', JSON.stringify(students));
        renderTable();
        syncToCloud();
    });
};

// ==========================================
// 7. Student Portal Experience
// ==========================================
function renderStudentDashboard(student) {
    const container = document.getElementById('studentPortalView');
    if (!student) return;

    // Calculate stats
    let totalPresent = 0, totalAbsent = 0, totalLate = 0, totalExcused = 0;
    const dates = Object.keys(attendanceData).sort();
    dates.forEach(d => {
        const st = (attendanceData[d][student.id] || {}).status;
        if (st === 'present') totalPresent++;
        else if (st === 'absent') totalAbsent++;
        else if (st === 'late') totalLate++;
        else if (st === 'excused') totalExcused++;
    });

    const totalRecordedDays = totalPresent + totalAbsent + totalLate + totalExcused;
    const attendancePct = totalRecordedDays ? Math.round(((totalPresent + totalLate) / totalRecordedDays) * 100) : 100;
    const conductPoints = Math.max(0, 100 - (totalAbsent * 2) - (totalLate * 0.5));
    const trend = calculateDisciplineTrend(student.id);

    // Multi-student tabs
    let tabsHtml = '';
    if (activeFamilyStudents.length > 1) {
        tabsHtml = `<div class="pd-student-tabs">`;
        activeFamilyStudents.forEach((st, idx) => {
            tabsHtml += `
                <div class="pd-st-tab ${idx === currentFamilyIndex ? 'active' : ''}" onclick="window.switchFamilyStudent(${idx})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    ${st.name}
                </div>
            `;
        });
        tabsHtml += `</div>`;
    }

    // Timeline dots (last 31 days)
    const recentDays = dates.slice(-31);
    let dotsHtml = '';
    recentDays.forEach(d => {
        const st = (attendanceData[d][student.id] || {}).status || 'none';
        let cls = '';
        if (st === 'present') cls = 'present';
        else if (st === 'absent') cls = 'absent';
        else if (st === 'late') cls = 'late';
        else if (st === 'excused') cls = 'excused';

        dotsHtml += `
            <div class="d-tl-dot ${cls}">
                <div class="d-tl-dot-date">${d.slice(5)}</div>
            </div>
        `;
    });

    container.innerHTML = `
        <div class="pd-layout">
            <aside class="pd-sidebar">
                <div class="pd-logo">
                    <div style="background: var(--primary-light); width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--primary);">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    </div>
                    <span>بوابة الطالب</span>
                </div>
                <div class="pd-nav">
                    <div class="pd-nav-item active" onclick="window.switchStudentSection('dashboard')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        ملخص المواظبة
                    </div>
                    <div class="pd-nav-item" onclick="window.switchStudentSection('records')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        سجل الحضور والغياب
                    </div>
                    <div class="pd-nav-item" onclick="window.switchStudentSection('excuses')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                        الأعذار والمبررات
                    </div>
                </div>
                <div class="pd-student-profile" onclick="window.logoutToPortal()">
                    <div class="pd-sp-info">
                        <div class="pd-sp-name">تسجيل الخروج 🚪</div>
                        <div class="pd-sp-id">العودة للبوابة الرئيسية</div>
                    </div>
                </div>
            </aside>

            <main class="pd-main">
                <div class="pd-global-header">
                    <div>
                        <h2 style="font-size: 20px; font-weight: 800; color: var(--text-main); margin-bottom: 4px;">مرحباً بك يا ولي أمر الطالب</h2>
                        <span style="font-size: 13px; color: var(--text-muted); font-weight: 600;">مدرسة الجشة المتوسطة - الإرشاد الطلابي</span>
                    </div>
                    <div class="pd-user-box">
                        <div class="pd-user-meta">
                            <h4>${student.name}</h4>
                            <p>${student.class || 'متوسط'} | ${student.nationalId}</p>
                        </div>
                        <div class="pd-user-avatar">${student.name.charAt(0)}</div>
                    </div>
                </div>

                ${tabsHtml}

                <div id="sec-dashboard">
                    <div class="d-title-container">
                        <div>
                            <h1>
                                لوحة مؤشرات المواظبة والانضباط
                                <span style="font-size:13px; padding:4px 12px; border-radius:20px; background:${trend.bg}; color:${trend.color}; font-weight:800;">${trend.label}</span>
                            </h1>
                            <p>متابعة تفصيلية لنسبة حضور الطالب وسلوك الانضباط المدرسي</p>
                        </div>
                    </div>

                    <div class="d-cards-grid">
                        <div class="d-card c-present"><div class="d-card-info"><span class="d-card-title">نسبة الحضور التراكمية</span><span class="d-card-value" style="color:var(--success);">${attendancePct}%</span></div><div class="d-card-icon" style="background:var(--success-light); color:var(--success);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div></div>
                        <div class="d-card c-absent"><div class="d-card-info"><span class="d-card-title">أيام الغياب غير المبرر</span><span class="d-card-value" style="color:var(--danger);">${totalAbsent}</span></div><div class="d-card-icon" style="background:var(--danger-light); color:var(--danger);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div></div>
                        <div class="d-card c-late"><div class="d-card-info"><span class="d-card-title">مرات التأخير الصباحي</span><span class="d-card-value" style="color:var(--warning);">${totalLate}</span></div><div class="d-card-icon" style="background:var(--warning-light); color:var(--warning);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div></div>
                        <div class="d-card c-excused"><div class="d-card-info"><span class="d-card-title">الغياب المقبول بعذر</span><span class="d-card-value" style="color:var(--info);">${totalExcused}</span></div><div class="d-card-icon" style="background:var(--info-light); color:var(--info);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div></div>
                    </div>

                    <div class="d-banner">
                        <div class="d-banner-header">
                            <div class="d-banner-title">
                                <h2>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 9 15"></polyline></svg>
                                    مسار الانضباط اليومي
                                </h2>
                                <p>رحلة الحضور اليومي للطالب خلال آخر 31 يوماً مسجلاً</p>
                            </div>
                            <div class="d-banner-legend">
                                <div class="d-bl-item"><div class="d-bl-dot" style="background:var(--success);"></div>حاضر</div>
                                <div class="d-bl-item"><div class="d-bl-dot" style="background:var(--danger);"></div>غائب</div>
                                <div class="d-bl-item"><div class="d-bl-dot" style="background:var(--warning);"></div>متأخر</div>
                                <div class="d-bl-item"><div class="d-bl-dot" style="background:var(--info);"></div>بعذر</div>
                            </div>
                        </div>

                        <div class="d-timeline-wrapper">
                            <div class="d-timeline">
                                <div class="d-tl-line"></div>
                                <div class="d-tl-dots">${dotsHtml}</div>
                            </div>
                        </div>

                        <div class="d-banner-stats">
                            <div class="d-bs-card"><div class="d-bs-title">حضور كامل</div><div class="d-bs-val">${totalPresent}</div></div>
                            <div class="d-bs-card"><div class="d-bs-title">غياب مسجل</div><div class="d-bs-val">${totalAbsent}</div></div>
                            <div class="d-bs-card"><div class="d-bs-title">تأخير مسجل</div><div class="d-bs-val">${totalLate}</div></div>
                            <div class="d-bs-card"><div class="d-bs-title">درجات المواظبة</div><div class="d-bs-val">${conductPoints.toFixed(1)}/100</div></div>
                        </div>
                    </div>
                </div>

                <div id="sec-records" style="display:none;">
                    <div class="d-title-container">
                        <div>
                            <h1>سجل الأيام المسجلة بالكامل</h1>
                            <p>استعراض كافة التواريخ وتفاصيل الحضور والانصراف مع إمكانية رفع عذر للغياب</p>
                        </div>
                    </div>
                    <div class="pd-table-wrapper">
                        <table class="pd-table">
                            <thead>
                                <tr>
                                    <th>التاريخ</th>
                                    <th>اليوم</th>
                                    <th>الحالة</th>
                                    <th>وقت التسجيل</th>
                                    <th>الإجراء المطلوب</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderStudentRecordsTable(student)}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="sec-excuses" style="display:none;">
                    <div class="d-title-container">
                        <div>
                            <h1>الأعذار والمبررات المرفوعة</h1>
                            <p>متابعة حالة الأعذار والتقارير الطبية وملاحظات الإدارة المدرسية</p>
                        </div>
                        <button class="btn" style="background:var(--primary); color:white;" onclick="window.openStudentExcuseModal()">رفع عذر جديد 📎</button>
                    </div>
                    <div id="studentExcusesListContainer" class="pd-excuses-grid"></div>
                </div>
            </main>
        </div>
    `;

    renderStudentExcuses(student);
}

function renderStudentRecordsTable(student) {
    const dates = Object.keys(attendanceData).sort().reverse();
    if (dates.length === 0) {
        return `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد سجلات مسجلة بعد</td></tr>`;
    }
    let rows = '';
    dates.forEach(d => {
        const rec = (attendanceData[d][student.id]) || { status: 'none', time: '-' };
        let statusBadge = '<span style="color:var(--text-muted);">لم يسجل</span>';
        let actionBtn = '-';

        if (rec.status === 'present') statusBadge = '<span style="color:var(--success); font-weight:800;">حاضر ✓</span>';
        else if (rec.status === 'absent') {
            statusBadge = '<span style="color:var(--danger); font-weight:800;">غائب ✗</span>';
            actionBtn = `<button class="pd-btn-excuse" onclick="window.openStudentExcuseModalForDate('${d}')">رفع عذر 📎</button>`;
        }
        else if (rec.status === 'late') {
            statusBadge = '<span style="color:var(--warning); font-weight:800;">متأخر ⏰</span>';
            actionBtn = `<button class="pd-btn-excuse" onclick="window.openStudentExcuseModalForDate('${d}')">رفع عذر 📎</button>`;
        }
        else if (rec.status === 'excused') statusBadge = '<span style="color:var(--info); font-weight:800;">بعذر مقبول 📄</span>';

        const parts = d.split('-');
        const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const dayName = days[new Date(parts[0], parts[1] - 1, parts[2]).getDay()];

        rows += `
            <tr>
                <td style="font-family:monospace; font-weight:bold;">${d}</td>
                <td>${dayName}</td>
                <td>${statusBadge}</td>
                <td style="font-family:monospace;">${rec.time || '-'}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
    });
    return rows;
}

window.switchFamilyStudent = function(index) {
    currentFamilyIndex = index;
    renderStudentDashboard(activeFamilyStudents[index]);
};

window.switchStudentSection = function(sec) {
    ['dashboard', 'records', 'excuses'].forEach(s => {
        const el = document.getElementById(`sec-${s}`);
        if (el) el.style.display = (s === sec) ? 'block' : 'none';
    });
    document.querySelectorAll('.pd-nav-item').forEach((item, idx) => {
        item.classList.remove('active');
        if ((sec === 'dashboard' && idx === 0) || (sec === 'records' && idx === 1) || (sec === 'excuses' && idx === 2)) {
            item.classList.add('active');
        }
    });
};

function checkAbsenceNotification(student) {
    let unexcused = 0;
    Object.keys(attendanceData).forEach(d => {
        if ((attendanceData[d][student.id] || {}).status === 'absent') unexcused++;
    });
    if (unexcused > 0) {
        openModal('absenceAlertModal');
    }
}

window.goToExcusesSection = function() {
    closeModals();
    window.switchStudentSection('excuses');
};

window.closeAbsenceAlert = function() {
    closeModals();
};

// ==========================================
// 8. Excuses Management (Student & Admin)
// ==========================================
function updateExcusesBadge() {
    const badge = document.getElementById('pendingExcusesBadge');
    if (!badge) return;
    const pending = cloudExcuses.filter(e => e.status === 'pending').length;
    if (pending > 0) {
        badge.innerText = pending;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderStudentExcuses(student) {
    const c = document.getElementById('studentExcusesListContainer');
    if (!c || !student) return;

    const list = cloudExcuses.filter(e => String(e.studentNationalId).trim() === String(student.nationalId).trim());
    if (list.length === 0) {
        c.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 40px; color: var(--text-muted); background: white; border-radius: 16px; border: 1px solid var(--border-color);">لا توجد أي أعذار مرفوعة حتى الآن</div>`;
        return;
    }

    let html = '';
    list.forEach(item => {
        let statusBadge = '<span class="pd-ec-badge pending">قيد المراجعة</span>';
        let cardStatusClass = 'status-pending';
        if (item.status === 'accepted') {
            statusBadge = '<span class="pd-ec-badge accepted">مقبول ومبرر ✓</span>';
            cardStatusClass = 'status-accepted';
        } else if (item.status === 'rejected') {
            statusBadge = '<span class="pd-ec-badge rejected">عذر مرفوض ✗</span>';
            cardStatusClass = 'status-rejected';
        }

        html += `
            <div class="pd-excuse-card ${cardStatusClass}">
                <div class="pd-ec-header">
                    <div>
                        <div class="pd-ec-date">${item.date}</div>
                        <div class="pd-ec-title">${item.type || 'عذر غياب'}</div>
                    </div>
                    ${statusBadge}
                </div>
                <div class="pd-ec-body">
                    <p class="pd-ec-desc">${item.desc || 'لا يوجد وصف توضيحي'}</p>
                    ${item.adminReply ? `<div style="margin-top:10px; background:#eff6ff; padding:10px; border-radius:8px; font-size:13px; color:#1e40af;"><strong>رد الإدارة:</strong> ${item.adminReply}</div>` : ''}
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; align-items:center;">
                    ${(item.fileUrl || item.dataUrl) ? `
                        <button class="btn" style="background:#e0f2fe; color:#0284c7; font-size:12.5px; font-weight:700; padding:6px 14px; border-radius:8px; display:inline-flex; align-items:center; gap:5px; border:none;" onclick="window.viewExcuseAttachmentById('${item.id}')">
                            <span>👁️</span><span>استعراض المرفق</span>
                        </button>
                        <button class="btn" style="background:#dcfce7; color:#15803d; font-size:12.5px; font-weight:700; padding:6px 14px; border-radius:8px; display:inline-flex; align-items:center; gap:5px; border:none;" onclick="window.downloadExcuseAttachmentById('${item.id}')">
                            <span>📥</span><span>تحميل المرفق</span>
                        </button>
                    ` : `
                        <span style="font-size:12px; color:#64748b; background:#f1f5f9; padding:5px 12px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
                            <span>📎</span><span>لا يوجد مرفق مسجل</span>
                        </span>
                    `}
                </div>
            </div>
        `;
    });
    c.innerHTML = html;
}

window.openStudentExcuseModalForDate = function(dateStr) {
    window.openStudentExcuseModal();
    document.getElementById('excuseDateInput').value = dateStr;
};

// State for medical excuse attachment & camera stream
let currentExcuseAttachment = null;
let activeCameraStream = null;
let currentCameraFacing = 'environment';

window.openStudentExcuseModal = function() {
    document.getElementById('excuseDateInput').value = getTodayDate();
    document.getElementById('excuseDescInput').value = '';
    window.clearExcuseAttachment();
    updateAdminEmailDisplays();
    openModal('studentExcuseModal');
};

window.handleExcuseFileSelected = function(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    processExcuseFile(file);
};

window.handleExcuseDrop = function(e) {
    e.preventDefault();
    const dropzone = document.getElementById('excuseUploadDropzone');
    if (dropzone) dropzone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processExcuseFile(e.dataTransfer.files[0]);
    }
};

// Helper to optimize and compress images for Firestore to keep property size safely below 1 MiB (max 400KB target)
async function optimizeImageForUpload(fileOrDataUrl, maxDimension = 1200, targetMaxBytes = 400000) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                let width = img.width;
                let height = img.height;

                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, width);
                canvas.height = Math.max(1, height);
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '');
                    return;
                }

                // Fill with white background in case of transparent png
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                let quality = 0.72;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);

                // Iteratively lower quality if still above targetMaxBytes
                let attempts = 0;
                while (dataUrl.length > targetMaxBytes && quality > 0.3 && attempts < 5) {
                    quality -= 0.12;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                    attempts++;
                }

                // If still above targetMaxBytes, downscale resolution further
                if (dataUrl.length > targetMaxBytes) {
                    const scaledCanvas = document.createElement('canvas');
                    scaledCanvas.width = Math.max(1, Math.round(width * 0.7));
                    scaledCanvas.height = Math.max(1, Math.round(height * 0.7));
                    const sCtx = scaledCanvas.getContext('2d');
                    sCtx.fillStyle = '#ffffff';
                    sCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
                    sCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
                    dataUrl = scaledCanvas.toDataURL('image/jpeg', 0.55);
                }

                resolve(dataUrl);
            } catch (err) {
                console.warn('Canvas compression error:', err);
                resolve(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '');
            }
        };

        img.onerror = () => {
            console.warn('Image load error during optimization');
            resolve(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '');
        };

        if (typeof fileOrDataUrl === 'string') {
            img.src = fileOrDataUrl;
        } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
            };
            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };
            reader.readAsDataURL(fileOrDataUrl);
        } else {
            resolve('');
        }
    });
}

async function processExcuseFile(file) {
    if (!file) return;
    const isImg = file.type.startsWith('image/');

    // If it's an image, optimize and compress it automatically to ensure safe cloud storage
    if (isImg) {
        if (window.showBottomNotification) {
            window.showBottomNotification('جاري معالجة الصورة ⏳', 'يتم تحسين وضغط صورة التقرير لسرعة الحفظ بالسحابة...', 'info');
        }
        try {
            const optimizedDataUrl = await optimizeImageForUpload(file, 1200, 400000);
            const approxKb = Math.round((optimizedDataUrl.length * 3 / 4) / 1024);
            currentExcuseAttachment = {
                dataUrl: optimizedDataUrl,
                name: file.name || 'تقرير_طبي.jpg',
                size: `${approxKb} KB`,
                type: 'image/jpeg',
                isCamera: false
            };
            renderExcuseAttachmentPreview();
            if (window.showBottomNotification) {
                window.showBottomNotification('تم إرفاق الصورة بنجاح 📁', `${file.name} (${approxKb} KB)`, 'success');
            }
        } catch (err) {
            console.error('Image optimization failed:', err);
            showAlert('خطأ', 'تعذر معالجة الصورة المرفقة، يرجى اختيار صورة أخرى');
        }
        return;
    }

    // If it's a PDF document:
    // Firestore has a hard property limit of 1,048,487 bytes (~650KB raw file becomes ~900KB Base64).
    const MAX_PDF_RAW_BYTES = 650 * 1024;
    if (file.size > MAX_PDF_RAW_BYTES) {
        showAlert(
            'حجم المستند كبير', 
            `حجم مستند الـ PDF المرفق (${(file.size / 1024).toFixed(0)} كيلوبايت) يتجاوز الحد الأقصى المسموح به في السحابة (الحد الأقصى 650 كيلوبايت لملفات PDF).\n\n💡 نصيحة: يرجى تصوير التقرير الطبي بكاميرا الجهاز مباشرة ليتم ضغطه وحفظه فورياً وبأعلى جودة.`
        );
        const fileInp = document.getElementById('excuseFileInput');
        if (fileInp) fileInp.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        if (dataUrl.length > 850000) {
            showAlert('حجم الملف كبير', 'حجم المرفق يتجاوز الحد الأقصى لقواعد البيانات السحابية. يرجى تصوير التقرير بكاميرا الجهاز مباشرة.');
            return;
        }
        currentExcuseAttachment = {
            dataUrl: dataUrl,
            name: file.name || 'مرفق_عذر_طبي.pdf',
            size: `${(file.size / 1024).toFixed(1)} KB`,
            type: file.type || 'application/pdf',
            isCamera: false
        };
        renderExcuseAttachmentPreview();
        if (window.showBottomNotification) {
            window.showBottomNotification('تم إرفاق المستند 📁', file.name, 'success');
        }
    };
    reader.readAsDataURL(file);
}

function renderExcuseAttachmentPreview() {
    const actions = document.getElementById('excuseUploadActions');
    const card = document.getElementById('excusePreviewCard');
    const thumb = document.getElementById('excusePreviewThumb');
    const icon = document.getElementById('excusePreviewFileIcon');
    const nameEl = document.getElementById('excusePreviewFileName');
    const metaEl = document.getElementById('excusePreviewMeta');
    const badge = document.getElementById('excusePreviewSourceBadge');

    if (!currentExcuseAttachment) {
        if (actions) actions.style.display = 'block';
        if (card) card.style.display = 'none';
        return;
    }

    if (actions) actions.style.display = 'none';
    if (card) card.style.display = 'block';

    if (nameEl) nameEl.textContent = currentExcuseAttachment.name;
    if (metaEl) {
        const typeLabel = currentExcuseAttachment.type.includes('pdf') ? 'مستند PDF' : 'صورة تقرير';
        metaEl.textContent = `${typeLabel} • الحجم: ${currentExcuseAttachment.size}`;
    }
    
    if (badge) {
        badge.textContent = currentExcuseAttachment.isCamera ? '📸 تم الالتقاط بكاميرا الجهاز مباشرة' : '✓ تم إرفاق المستند بنجاح';
    }

    if (currentExcuseAttachment.type.startsWith('image/')) {
        if (thumb) {
            thumb.src = currentExcuseAttachment.dataUrl;
            thumb.style.display = 'block';
        }
        if (icon) icon.style.display = 'none';
    } else {
        if (thumb) thumb.style.display = 'none';
        if (icon) icon.style.display = 'block';
    }
}

window.clearExcuseAttachment = function() {
    currentExcuseAttachment = null;
    const fileInp = document.getElementById('excuseFileInput');
    if (fileInp) fileInp.value = '';
    const camInp = document.getElementById('excuseCameraInput');
    if (camInp) camInp.value = '';
    renderExcuseAttachmentPreview();
};

window.triggerCameraCapture = function() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        window.openLiveCameraModal();
    } else {
        const camInp = document.getElementById('excuseCameraInput');
        if (camInp) camInp.click();
    }
};

window.openLiveCameraModal = async function() {
    const modal = document.getElementById('liveCameraModal');
    const video = document.getElementById('liveCameraVideo');
    if (!modal || !video) return;

    modal.classList.add('active');
    await startCameraStream();
};

async function startCameraStream() {
    const video = document.getElementById('liveCameraVideo');
    if (!video) return;

    if (activeCameraStream) {
        activeCameraStream.getTracks().forEach(track => track.stop());
        activeCameraStream = null;
    }

    try {
        const constraints = {
            video: {
                facingMode: currentCameraFacing,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };

        activeCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = activeCameraStream;
        await video.play();
    } catch (err) {
        console.warn('Live camera stream error or denied:', err);
        window.closeLiveCameraModal();
        const camInp = document.getElementById('excuseCameraInput');
        if (camInp) {
            camInp.click();
        } else {
            showAlert('تنبيه الكاميرا', 'تعذر الوصول المباشر لكاميرا الجهاز، يرجى السماح بصلاحية الكاميرا أو استخدام زر اختيار ملف.');
        }
    }
}

window.closeLiveCameraModal = function() {
    if (activeCameraStream) {
        activeCameraStream.getTracks().forEach(track => track.stop());
        activeCameraStream = null;
    }
    const modal = document.getElementById('liveCameraModal');
    if (modal) modal.classList.remove('active');
};

window.switchCameraFacing = async function() {
    currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
    await startCameraStream();
};

window.takeLiveCameraSnapshot = async function() {
    const video = document.getElementById('liveCameraVideo');
    if (!video || !activeCameraStream) {
        showAlert('خطأ', 'الكاميرا غير نشطة حالياً');
        return;
    }

    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 720;
    const maxDim = 1200;
    if (width > maxDim || height > maxDim) {
        if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
        } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let dataUrl = canvas.toDataURL('image/jpeg', 0.74);
    if (dataUrl.length > 400000) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.55);
    }
    const timeStr = new Date().toLocaleDateString('ar-SA') + '_' + Date.now().toString().slice(-4);

    currentExcuseAttachment = {
        dataUrl: dataUrl,
        name: `تقرير_طبي_كاميرا_${timeStr}.jpg`,
        size: `${Math.round((dataUrl.length * 3 / 4) / 1024)} KB`,
        type: 'image/jpeg',
        isCamera: true
    };

    window.closeLiveCameraModal();
    renderExcuseAttachmentPreview();

    if (window.showBottomNotification) {
        window.showBottomNotification('تم التقاط الصورة 📸', 'تم تصوير التقرير الطبي بنجاح وإرفاقه بالاستمارة', 'success');
    }
};

window.submitStudentExcuse = async function() {
    const date = document.getElementById('excuseDateInput').value;
    const type = document.getElementById('excuseTypeSelect').value;
    const desc = document.getElementById('excuseDescInput').value.trim();
    const student = activeFamilyStudents[currentFamilyIndex];

    if (!currentExcuseAttachment || !currentExcuseAttachment.dataUrl) {
        showAlert('تنبيه', 'المرفق إلزامي! يرجى التقاط صورة المرفق الطبي بالكاميرا أو اختيار ملف من الجهاز.');
        return;
    }

    // Strict safety check for Firestore property limit (1,048,487 bytes)
    const MAX_FIRESTORE_LEN = 850000;
    if (currentExcuseAttachment.dataUrl.length > MAX_FIRESTORE_LEN) {
        if (currentExcuseAttachment.type.startsWith('image/')) {
            currentExcuseAttachment.dataUrl = await optimizeImageForUpload(currentExcuseAttachment.dataUrl, 900, 350000);
        }
        if (currentExcuseAttachment.dataUrl.length > MAX_FIRESTORE_LEN) {
            showAlert('حجم المرفق كبير', 'حجم المرفق الطبي يتجاوز الحد الأقصى المسموح به في السحابة (أقل من 1 ميجابايت). يرجى تصوير التقرير الطبي بكاميرا الجهاز مباشرة ليتم ضغطه وحفظه بنجاح.');
            return;
        }
    }

    showAlert('جاري الرفع', 'يرجى الانتظار، جاري معالجة وحفظ المرفق والعذر...');

    try {
        const excusesCol = collection(window.db, 'artifacts', window.appId, 'public', 'data', 'excuses');
        await addDoc(excusesCol, {
            studentId: student.id,
            studentName: student.name,
            studentNationalId: student.nationalId,
            studentClass: student.class,
            date: date,
            type: type,
            desc: desc,
            fileUrl: currentExcuseAttachment.dataUrl,
            fileName: currentExcuseAttachment.name,
            isCameraCaptured: !!currentExcuseAttachment.isCamera,
            status: 'pending',
            adminReply: '',
            recipientEmail: officialAdminEmail,
            createdAt: new Date().toISOString()
        });
        window.clearExcuseAttachment();
        closeModals();
        showAlert('نجاح', `تم إرسال العذر والمرفق الطبي بنجاح إلى الإدارة المدرسية المعتمدة (${officialAdminEmail}) وحفظه بالسحابة ✅`);
        renderStudentExcuses(student);
    } catch (err) {
        console.error('Submit excuse error:', err);
        if (err && err.message && (err.message.includes('longer than') || err.message.includes('fileUrl') || err.message.includes('1048487'))) {
            showAlert('حجم المرفق كبير', 'حجم ملف المرفق كبير جداً بالنسبة لقاعدة البيانات. يرجى استخدام كاميرا الجهاز لتصوير التقرير الطبي لضغطه وحفظه بنجاح.');
        } else {
            showAlert('خطأ', 'تعذر حفظ العذر، يرجى المحاولة لاحقاً');
        }
    }
};

let adminExcusesActiveTab = 'all';
let adminExcusesSearchQuery = '';
let adminTargetExcuseIdForAttach = null;
let currentViewedAttachment = {
    url: '',
    fileName: 'مرفق_طبي',
    studentName: '',
    date: '',
    type: '',
    rotation: 0
};

window.openAdminExcusesModal = function() {
    adminExcusesActiveTab = 'all';
    adminExcusesSearchQuery = '';
    const searchInp = document.getElementById('adminExcusesSearchInput');
    if (searchInp) searchInp.value = '';
    updateAdminEmailDisplays();
    renderAdminExcusesList();
    openModal('adminExcusesModal');
};

window.setAdminExcusesTab = function(tab) {
    adminExcusesActiveTab = tab;
    renderAdminExcusesList();
};

window.filterAdminExcuses = function() {
    const searchInp = document.getElementById('adminExcusesSearchInput');
    adminExcusesSearchQuery = searchInp ? searchInp.value.trim().toLowerCase() : '';
    renderAdminExcusesList();
};

function renderAdminExcusesList() {
    const c = document.getElementById('adminExcusesContent');
    if (!c) return;

    // 1. Calculate Tab Counts
    const countAll = cloudExcuses.length;
    const countPending = cloudExcuses.filter(e => e.status === 'pending' || !e.status).length;
    const countAccepted = cloudExcuses.filter(e => e.status === 'accepted').length;
    const countRejected = cloudExcuses.filter(e => e.status === 'rejected').length;
    const countWithAttach = cloudExcuses.filter(e => Boolean((e.fileUrl || e.attachmentUrl || e.dataUrl || e.file) && (e.fileUrl || e.attachmentUrl || e.dataUrl || e.file).length > 20)).length;

    const elAll = document.getElementById('count-excuse-all');
    const elPending = document.getElementById('count-excuse-pending');
    const elAccepted = document.getElementById('count-excuse-accepted');
    const elRejected = document.getElementById('count-excuse-rejected');
    const elAttach = document.getElementById('count-excuse-hasAttachment');

    if (elAll) elAll.textContent = countAll;
    if (elPending) elPending.textContent = countPending;
    if (elAccepted) elAccepted.textContent = countAccepted;
    if (elRejected) elRejected.textContent = countRejected;
    if (elAttach) elAttach.textContent = countWithAttach;

    // Update Tab active classes & styling
    document.querySelectorAll('.excuse-filter-tab').forEach(tabBtn => {
        tabBtn.style.background = '#ffffff';
        tabBtn.style.color = '#475569';
        tabBtn.style.border = '1px solid #cbd5e1';
    });
    const currentActiveTabBtn = document.getElementById(`tab-excuse-${adminExcusesActiveTab}`);
    if (currentActiveTabBtn) {
        currentActiveTabBtn.style.background = '#e11d48';
        currentActiveTabBtn.style.color = '#ffffff';
        currentActiveTabBtn.style.border = 'none';
    }

    if (cloudExcuses.length === 0) {
        c.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-muted); background:#f8fafc; border-radius:12px; border:1px dashed #cbd5e1;">
                <div style="font-size:36px; margin-bottom:10px;">📋</div>
                <strong style="font-size:16px; color:#334155; display:block;">لا توجد أي طلبات أعذار مرفوعة حالياً بالسحابة</strong>
                <p style="font-size:13px; margin-top:6px; color:#64748b;">عندما يقوم ولي الأمر أو الطالب برفع عذر غياب من بوابة الطلاب ستظهر فوراً هنا للاعتماد والتحميل.</p>
            </div>
        `;
        return;
    }

    // 2. Filter list based on tab and search
    let filtered = cloudExcuses.filter(e => {
        // Tab filter
        if (adminExcusesActiveTab === 'pending' && e.status !== 'pending' && e.status) return false;
        if (adminExcusesActiveTab === 'accepted' && e.status !== 'accepted') return false;
        if (adminExcusesActiveTab === 'rejected' && e.status !== 'rejected') return false;
        if (adminExcusesActiveTab === 'hasAttachment') {
            const hasAtt = Boolean((e.fileUrl || e.attachmentUrl || e.dataUrl || e.file) && (e.fileUrl || e.attachmentUrl || e.dataUrl || e.file).length > 20);
            if (!hasAtt) return false;
        }

        // Search query filter
        if (adminExcusesSearchQuery) {
            const matchName = (e.studentName || '').toLowerCase().includes(adminExcusesSearchQuery);
            const matchClass = (e.studentClass || '').toLowerCase().includes(adminExcusesSearchQuery);
            const matchNid = (e.studentNationalId || '').includes(adminExcusesSearchQuery);
            const matchDesc = (e.desc || '').toLowerCase().includes(adminExcusesSearchQuery);
            const matchType = (e.type || '').toLowerCase().includes(adminExcusesSearchQuery);
            if (!matchName && !matchClass && !matchNid && !matchDesc && !matchType) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
        c.innerHTML = `
            <div style="text-align:center; padding:35px 20px; color:var(--text-muted); background:#f8fafc; border-radius:12px; border:1px dashed #cbd5e1;">
                <div style="font-size:30px; margin-bottom:8px;">🔍</div>
                <strong style="font-size:15px; color:#334155; display:block;">لا توجد نتائج مطابقة لخيارات التصفية المحددة</strong>
                <button class="btn" style="margin-top:12px; background:#e2e8f0; color:#1e293b; font-size:12px; padding:6px 14px; border-radius:8px;" onclick="window.setAdminExcusesTab('all')">عرض كل الأعذار</button>
            </div>
        `;
        return;
    }

    // 3. Render Excuses Cards
    let html = '';
    filtered.forEach(e => {
        // Resolve student details safely to avoid "undefined - undefined"
        const studentObj = students.find(s => s.id === e.studentId || (e.studentNationalId && String(s.nationalId).trim() === String(e.studentNationalId).trim()) || (e.studentName && s.name === e.studentName));
        const displayClass = (e.studentClass && e.studentClass !== 'undefined') ? e.studentClass : ((studentObj && studentObj.class) ? studentObj.class : 'الصف غير محدد');
        const displayNid = (e.studentNationalId && e.studentNationalId !== 'undefined') ? e.studentNationalId : ((studentObj && studentObj.nationalId) ? studentObj.nationalId : 'غير مسجل');
        
        const fileUrl = e.fileUrl || e.attachmentUrl || e.dataUrl || e.file || '';
        const hasAttachment = Boolean(fileUrl && fileUrl.length > 20);
        const isPdf = fileUrl.includes('pdf') || (e.fileName && e.fileName.toLowerCase().endsWith('.pdf'));

        let statusClass = 'pct-warning';
        let statusText = 'قيد المراجعة';
        if (e.status === 'accepted') {
            statusClass = 'pct-success';
            statusText = 'مقبول ✓';
        } else if (e.status === 'rejected') {
            statusClass = 'pct-danger';
            statusText = 'مرفوض ✗';
        }

        html += `
            <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:12px; padding:16px; margin-bottom:14px; box-shadow:0 1px 3px rgba(0,0,0,0.04); transition:all 0.2s;">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px; flex-wrap:wrap;">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <strong style="font-size:16.5px; color:var(--text-main); font-weight:800;">${e.studentName || 'طالب'}</strong>
                            <span style="background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:6px; font-size:12px; font-weight:700;">${displayClass}</span>
                            <span style="font-size:12px; color:#64748b; font-family:monospace;" dir="ltr">#${displayNid}</span>
                        </div>
                        <div style="font-size:13px; color:var(--primary); font-weight:700; margin-top:5px; display:flex; align-items:center; gap:8px;">
                            <span>${e.type || 'عذر غياب'}</span>
                            <span style="color:#cbd5e1;">•</span>
                            <span style="color:#64748b;">تاريخ الغياب: <strong style="color:#0f172a;">${e.date || '-'}</strong></span>
                            ${e.isCameraCaptured ? `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:11px;">📸 تصوير مباشر</span>` : ''}
                        </div>
                    </div>
                    <span class="pct-badge ${statusClass}" style="font-size:12px; padding:4px 10px;">
                        ${statusText}
                    </span>
                </div>

                <!-- Description -->
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:10px;">
                    <div style="font-size:12px; color:#64748b; margin-bottom:3px; font-weight:700;">المبررات والتفاصيل:</div>
                    <p style="font-size:13.5px; color:#1e293b; margin:0; line-height:1.5;">${e.desc || 'لا يوجد وصف توضيحي مكتوب'}</p>
                </div>

                <!-- حقل كتابة رد الإدارة المباشر وأيقونة تفعيل وحفظ الرد -->
                <div style="background:#f0f7ff; border:1px solid #bfdbfe; border-radius:9px; padding:10px 12px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
                        <label style="font-size:12.5px; font-weight:800; color:#1e40af; display:flex; align-items:center; gap:5px;">
                            <span>💬</span><span>رد وتوجيه الإدارة المدرسية:</span>
                        </label>
                        ${e.adminReply ? `
                            <span style="font-size:11px; background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; border-radius:6px; font-weight:700;">
                                ✓ رد محفوظ ومعتمد لولي الأمر
                            </span>
                        ` : `
                            <span style="font-size:11px; color:#64748b;">(يظهر الرد لولي الأمر والطالب فوراً)</span>
                        `}
                    </div>

                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <div style="flex:1; min-width:230px;">
                            <input 
                                type="text" 
                                id="adminReplyInput_${e.id}" 
                                class="form-input" 
                                style="width:100%; padding:8px 12px; font-size:13px; background:#ffffff; border:1px solid ${e.adminReply ? '#93c5fd' : '#cbd5e1'}; border-radius:7px; box-sizing:border-box;" 
                                placeholder="اكتب رد أو توجيه الإدارة هنا ثم اضغط الزر..." 
                                value="${(e.adminReply || '').replace(/"/g, '&quot;')}"
                                onkeydown="if(event.key === 'Enter') window.saveInlineAdminReply('${e.id}')"
                            />
                        </div>
                        <button 
                            type="button" 
                            class="btn" 
                            id="adminReplyBtn_${e.id}"
                            style="background:linear-gradient(135deg, #0284c7, #0369a1); color:#ffffff; border:none; padding:8px 16px; font-size:12.5px; font-weight:800; border-radius:7px; display:inline-flex; align-items:center; gap:6px; cursor:pointer; box-shadow:0 2px 4px rgba(2,132,199,0.25);" 
                            onclick="window.saveInlineAdminReply('${e.id}')" 
                            title="تفعيل وحفظ رد الإدارة">
                            <span>💬</span><span>كتابة رد الإدارة</span>
                        </button>
                        ${e.adminReply ? `
                            <button 
                                type="button" 
                                class="btn" 
                                style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; padding:8px 12px; font-size:12px; font-weight:700; border-radius:7px; cursor:pointer;" 
                                onclick="window.clearInlineAdminReply('${e.id}')" 
                                title="مسح رد الإدارة الحالي">
                                مسح الرد 🗑️
                            </button>
                        ` : ''}
                    </div>

                    <!-- عبارات سريعة بنقرة واحدة لتسهيل الرد -->
                    <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:8px; align-items:center;">
                        <span style="font-size:11px; color:#64748b; margin-left:4px; font-weight:700;">عبارات سريعة:</span>
                        <button type="button" class="btn" style="background:#ffffff; color:#15803d; border:1px solid #bbf7d0; padding:2px 8px; font-size:11px; border-radius:5px; font-weight:700;" onclick="window.applyQuickReplyToInput('${e.id}', 'تم قبول العذر واعتماده رسمياً، مع تمنياتنا للطالب بالتوفيق.')">
                            ✓ تم قبول العذر واعتماده
                        </button>
                        <button type="button" class="btn" style="background:#ffffff; color:#1e40af; border:1px solid #bfdbfe; padding:2px 8px; font-size:11px; border-radius:5px; font-weight:700;" onclick="window.applyQuickReplyToInput('${e.id}', 'يرجى مراجعة وكيل شؤون الطلاب وإحضار التقرير الطبي الأصلي.')">
                            📄 إحضار التقرير الأصلي
                        </button>
                        <button type="button" class="btn" style="background:#ffffff; color:#b91c1c; border:1px solid #fecaca; padding:2px 8px; font-size:11px; border-radius:5px; font-weight:700;" onclick="window.applyQuickReplyToInput('${e.id}', 'نأمل إعادة إرفاق تقرير طبي رسمي واضح ومختوم.')">
                            ⚠️ التقرير غير واضح
                        </button>
                    </div>
                </div>

                <!-- Attachment Box -->
                <div style="background:${hasAttachment ? '#f0fdf4' : '#fff1f2'}; border:1px solid ${hasAttachment ? '#bbf7d0' : '#fecdd3'}; border-radius:8px; padding:10px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:18px;">${hasAttachment ? (isPdf ? '📄' : '🖼️') : '⚠️'}</span>
                        <div>
                            <strong style="font-size:13px; color:${hasAttachment ? '#166534' : '#991b1b'}; display:block;">
                                ${hasAttachment ? (isPdf ? 'مستند تقرير طبي (PDF) متوفر' : 'صورة التقرير الطبي متوفرة') : 'لا يوجد ملف مرفق مرفوع مع هذا العذر'}
                            </strong>
                            <div style="font-size:11.5px; color:${hasAttachment ? '#15803d' : '#be123c'};">
                                ${hasAttachment ? (e.fileName || 'المرفق جاهز للمعاينة والتحميل والطباعة') : 'يمكنك إرفاق صورة أو مستند التقرير الطبي لهذا الطالب يدوياً'}
                            </div>
                        </div>
                    </div>

                    <!-- Attachment Direct Actions -->
                    <div style="display:flex; gap:8px; align-items:center;">
                        ${hasAttachment ? `
                            <button class="btn" style="background:#0284c7; color:#ffffff; padding:6px 14px; font-size:12.5px; font-weight:700; border-radius:7px; display:inline-flex; align-items:center; gap:5px; border:none; box-shadow:0 2px 4px rgba(2,132,199,0.25);" onclick="window.viewExcuseAttachmentById('${e.id}')" title="معاينة المرفق وتكبيره">
                                <span>👁️</span><span>استعراض المرفق</span>
                            </button>
                            <button class="btn" style="background:#059669; color:#ffffff; padding:6px 14px; font-size:12.5px; font-weight:700; border-radius:7px; display:inline-flex; align-items:center; gap:5px; border:none; box-shadow:0 2px 4px rgba(5,150,105,0.25);" onclick="window.downloadExcuseAttachmentById('${e.id}')" title="تنزيل الملف إلى جهازك">
                                <span>📥</span><span>تحميل المرفق</span>
                            </button>
                        ` : `
                            <button class="btn" style="background:#ffffff; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; font-size:12px; font-weight:700; border-radius:7px; display:inline-flex; align-items:center; gap:5px;" onclick="window.promptAttachFileToExcuse('${e.id}')">
                                <span>📎</span><span>إرفاق تقرير الآن</span>
                            </button>
                        `}
                    </div>
                </div>

                <!-- Admin Decisions and Status Actions -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-top:10px; border-top:1px solid #f1f5f9;">
                    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                        <button class="btn" style="background:${e.status === 'accepted' ? '#15803d' : '#dcfce7'}; color:${e.status === 'accepted' ? '#ffffff' : '#166534'}; padding:6px 13px; font-size:12.5px; font-weight:700; border-radius:7px; border:none;" onclick="window.updateExcuseStatus('${e.id}', 'accepted')">
                            قبول العذر ✓
                        </button>
                        <button class="btn" style="background:${e.status === 'rejected' ? '#b91c1c' : '#fee2e2'}; color:${e.status === 'rejected' ? '#ffffff' : '#991b1b'}; padding:6px 13px; font-size:12.5px; font-weight:700; border-radius:7px; border:none;" onclick="window.updateExcuseStatus('${e.id}', 'rejected')">
                            رفض العذر ✗
                        </button>
                    </div>

                    <button class="btn" style="background:#f8fafc; color:#64748b; padding:6px 12px; font-size:12px; border-radius:7px; border:1px solid #e2e8f0;" onclick="window.deleteExcuse('${e.id}')">
                        حذف 🗑️
                    </button>
                </div>
            </div>
        `;
    });

    c.innerHTML = html;
}

window.downloadExcuseAttachmentById = function(id) {
    const item = cloudExcuses.find(x => x.id === id);
    const fileUrl = item ? (item.fileUrl || item.attachmentUrl || item.dataUrl || item.file) : null;
    if (!item || !fileUrl) {
        showAlert('تنبيه', 'لا يوجد ملف مرفق متاح للتحميل في هذا الطلب.');
        return;
    }

    const ext = fileUrl.includes('pdf') ? 'pdf' : 'jpg';
    const cleanStudentName = (item.studentName || 'طالب').replace(/\s+/g, '_');
    const fileName = item.fileName || `تقرير_طبي_${cleanStudentName}_${item.date || 'عذر'}.${ext}`;

    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (window.showBottomNotification) {
        window.showBottomNotification('تم بدء التحميل 📥', fileName, 'success');
    }
};

window.downloadAllAvailableAttachments = function() {
    const withAttachments = cloudExcuses.filter(e => {
        const url = e.fileUrl || e.attachmentUrl || e.dataUrl || e.file;
        return Boolean(url && url.length > 20);
    });

    if (withAttachments.length === 0) {
        showAlert('تنبيه', 'لا توجد أي مرفقات مرفوعة حالياً للتحميل');
        return;
    }

    showAlert('جاري التحميل', `سيتم بدء تنزيل ${withAttachments.length} مرفق تباعاً إلى جهازك...`);

    withAttachments.forEach((item, index) => {
        setTimeout(() => {
            window.downloadExcuseAttachmentById(item.id);
        }, index * 450);
    });
};

window.promptAttachFileToExcuse = function(excuseId) {
    adminTargetExcuseIdForAttach = excuseId;
    const fileInp = document.getElementById('adminAttachFileInput');
    if (fileInp) {
        fileInp.value = '';
        fileInp.click();
    }
};

window.handleAdminAttachFileSelected = async function(input) {
    if (!input.files || input.files.length === 0 || !adminTargetExcuseIdForAttach) return;
    const file = input.files[0];
    const isImg = file.type.startsWith('image/');
    showAlert('جاري الحفظ', 'يتم تحسين وحفظ المرفق في السحابة...');

    try {
        let finalDataUrl = '';
        if (isImg) {
            finalDataUrl = await optimizeImageForUpload(file, 1200, 400000);
        } else {
            if (file.size > 650 * 1024) {
                showAlert('حجم الملف كبير', 'الحد الأقصى لملفات الـ PDF هو 650 كيلوبايت.');
                return;
            }
            finalDataUrl = await new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload = e => res(e.target.result);
                reader.onerror = rej;
                reader.readAsDataURL(file);
            });
        }

        const docRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'excuses', adminTargetExcuseIdForAttach);
        await updateDoc(docRef, {
            fileUrl: finalDataUrl,
            fileName: file.name || 'تقرير_طبي_مرفق.jpg'
        });

        const target = cloudExcuses.find(x => x.id === adminTargetExcuseIdForAttach);
        if (target) {
            target.fileUrl = finalDataUrl;
            target.fileName = file.name || 'تقرير_طبي_مرفق.jpg';
        }

        closeModals();
        openModal('adminExcusesModal');
        renderAdminExcusesList();
        showAlert('نجاح', 'تم إرفاق الملف وحفظه بنجاح في السحابة ✅');
    } catch (err) {
        console.error('Attach file error:', err);
        showAlert('خطأ', 'تعذر إرفاق الملف بالسحابة، يرجى المحاولة لاحقاً');
    }
};

window.applyQuickReplyToInput = function(id, text) {
    const textInp = document.getElementById(`adminReplyInput_${id}`);
    if (textInp) {
        textInp.value = text;
        textInp.focus();
        textInp.style.borderColor = '#0284c7';
    }
};

window.saveInlineAdminReply = function(id) {
    const textInp = document.getElementById(`adminReplyInput_${id}`);
    const btn = document.getElementById(`adminReplyBtn_${id}`);
    const replyText = textInp ? textInp.value.trim() : '';

    if (!replyText) {
        if (textInp) {
            textInp.focus();
            textInp.style.borderColor = '#ef4444';
            setTimeout(() => { textInp.style.borderColor = '#cbd5e1'; }, 1500);
        }
        if (window.showBottomNotification) {
            window.showBottomNotification('تنبيه ⚠️', 'يرجى كتابة نص الرد في الحقل أو اختيار رد جاهز أولاً', 'info');
        }
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span><span>جاري الحفظ...</span>';
    }

    window.saveAdminReply(id, replyText);
};

window.clearInlineAdminReply = function(id) {
    const textInp = document.getElementById(`adminReplyInput_${id}`);
    if (textInp) textInp.value = '';
    window.saveAdminReply(id, '');
};

let currentAdminReplyExcuseId = null;

window.openAdminReplyModal = function(id) {
    currentAdminReplyExcuseId = id;
    const item = cloudExcuses.find(x => x.id === id);
    if (!item) return;

    const infoEl = document.getElementById('adminReplyModalStudentInfo');
    if (infoEl) {
        const studentObj = students.find(s => s.id === item.studentId || (item.studentNationalId && String(s.nationalId).trim() === String(item.studentNationalId).trim()));
        const displayClass = item.studentClass || (studentObj ? studentObj.class : '');
        infoEl.textContent = `الطالب: ${item.studentName || 'غير محدد'} ${displayClass ? `(${displayClass})` : ''} — تاريخ الغياب: ${item.date || '-'}`;
    }

    const textInp = document.getElementById('adminReplyTextInput');
    if (textInp) {
        textInp.value = item.adminReply || '';
        setTimeout(() => {
            textInp.focus();
        }, 120);
    }

    const clearBtn = document.getElementById('adminReplyClearBtn');
    if (clearBtn) {
        clearBtn.style.display = item.adminReply ? 'inline-block' : 'none';
    }

    const el = document.getElementById('adminReplyModal');
    if (el) el.classList.add('active');
};

window.closeAdminReplyModal = function() {
    currentAdminReplyExcuseId = null;
    const el = document.getElementById('adminReplyModal');
    if (el) el.classList.remove('active');
};

window.insertQuickReply = function(text) {
    const textInp = document.getElementById('adminReplyTextInput');
    if (textInp) {
        textInp.value = text;
        textInp.focus();
        const clearBtn = document.getElementById('adminReplyClearBtn');
        if (clearBtn) clearBtn.style.display = 'inline-block';
    }
};

window.clearCurrentAdminReply = function() {
    if (!currentAdminReplyExcuseId) return;
    const targetId = currentAdminReplyExcuseId;
    const textInp = document.getElementById('adminReplyTextInput');
    if (textInp) textInp.value = '';
    window.closeAdminReplyModal();
    window.saveAdminReply(targetId, '');
};

window.submitAdminReplyFromModal = function() {
    if (!currentAdminReplyExcuseId) return;
    const targetId = currentAdminReplyExcuseId;
    const textInp = document.getElementById('adminReplyTextInput');
    const replyText = textInp ? textInp.value.trim() : '';
    window.closeAdminReplyModal();
    window.saveAdminReply(targetId, replyText);
};

window.promptAdminReplyToExcuse = function(id) {
    window.openAdminReplyModal(id);
};

window.saveAdminReply = async function(id, replyText) {
    try {
        const item = cloudExcuses.find(x => x.id === id);
        if (item) {
            item.adminReply = replyText;
        }
        renderAdminExcusesList();

        if (window.db && window.appId) {
            const docRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'excuses', id);
            await updateDoc(docRef, { adminReply: replyText });
        }

        if (window.showBottomNotification) {
            window.showBottomNotification(
                replyText ? 'تم حفظ الرد 💬' : 'تم مسح الرد',
                replyText ? 'تم توثيق رد إدارة المدرسة ويظهر لولي الأمر فوراً' : 'تمت إزالة رد الإدارة السابق',
                'success'
            );
        }
    } catch (e) {
        console.error('Save admin reply error:', e);
        renderAdminExcusesList();
    }
};

window.updateExcuseStatus = async function(id, status) {
    try {
        const docRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'excuses', id);
        await updateDoc(docRef, { status: status });
        
        // Update local item
        const item = cloudExcuses.find(x => x.id === id);
        if (item) item.status = status;

        // If accepted, update student status in attendanceData for that date to 'excused'
        if (item && status === 'accepted' && item.date && attendanceData[item.date]) {
            if (attendanceData[item.date][item.studentId]) {
                attendanceData[item.date][item.studentId].status = 'excused';
                localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
                syncToCloud();
                renderTable();
            }
        }
        renderAdminExcusesList();
        if (window.showBottomNotification) {
            window.showBottomNotification(
                status === 'accepted' ? 'تم قبول العذر ✓' : 'تم رفض العذر ✗',
                `تم تحديث حالة عذر ${item ? item.studentName : ''}`,
                status === 'accepted' ? 'success' : 'info'
            );
        }
    } catch (e) {
        console.error(e);
        showAlert('خطأ', 'تعذر تحديث حالة العذر');
    }
};

window.deleteExcuse = async function(id) {
    showConfirm('تأكيد الحذف', 'هل أنت متأكد من رغبتك في حذف هذا العذر نهائياً من السحابة؟', async () => {
        try {
            const docRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'excuses', id);
            await deleteDoc(docRef);
            cloudExcuses = cloudExcuses.filter(x => x.id !== id);
            renderAdminExcusesList();
            if (window.showBottomNotification) {
                window.showBottomNotification('تم الحذف 🗑️', 'تم حذف العذر بنجاح', 'info');
            }
        } catch (e) {
            console.error(e);
            showAlert('خطأ', 'تعذر حذف العذر');
        }
    });
};

window.viewAttachment = function(url, metadata = {}) {
    if (!url) {
        showAlert('تنبيه', 'لا يوجد ملف مرفق للعرض');
        return;
    }
    const c = document.getElementById('attachmentContent');
    if (!c) return;

    currentViewedAttachment = {
        url: url,
        fileName: metadata.fileName || 'تقرير_طبي',
        studentName: metadata.studentName || '',
        date: metadata.date || '',
        type: metadata.type || 'عذر طبي',
        rotation: 0
    };

    const titleEl = document.getElementById('attachmentModalTitle');
    const subEl = document.getElementById('attachmentModalSubtitle');
    if (titleEl) {
        titleEl.textContent = metadata.studentName ? `استعراض مرفق الطالب: ${metadata.studentName}` : 'استعراض المرفق الطبي';
    }
    if (subEl) {
        subEl.textContent = `${metadata.type || 'عذر'} • التاريخ: ${metadata.date || '-'} • الملف: ${metadata.fileName || 'مرفق'}`;
    }

    const isImg = url.startsWith('data:image') || url.includes('.jpg') || url.includes('.png') || url.includes('.jpeg') || !url.includes('pdf');

    if (isImg) {
        c.innerHTML = `
            <div style="position:relative; max-width:100%; display:inline-block;">
                <img id="currentAttachmentImg" src="${url}" style="max-width:100%; max-height:55vh; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08); transition:transform 0.3s ease; transform:rotate(0deg);" alt="مرفق التقرير الطبي">
            </div>
        `;
        const rotBtn = document.getElementById('attachmentRotateBtn');
        if (rotBtn) rotBtn.style.display = 'inline-flex';
    } else {
        c.innerHTML = `<iframe src="${url}" style="width:100%; height:55vh; border:none; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.08);"></iframe>`;
        const rotBtn = document.getElementById('attachmentRotateBtn');
        if (rotBtn) rotBtn.style.display = 'none';
    }

    openModal('attachmentModal');
};

window.viewExcuseAttachmentById = function(id) {
    const item = cloudExcuses.find(x => x.id === id);
    const fileUrl = item ? (item.fileUrl || item.attachmentUrl || item.dataUrl || item.file) : null;
    if (item && fileUrl) {
        window.viewAttachment(fileUrl, {
            fileName: item.fileName || `عذر_${item.studentName}_${item.date}`,
            studentName: item.studentName,
            date: item.date,
            type: item.type
        });
    } else {
        showAlert('تنبيه', 'تعذر العثور على المرفق المطلوب أو لا يوجد ملف مرفق مسجل لهذا الطلب.');
    }
};

window.downloadCurrentAttachment = function() {
    if (!currentViewedAttachment || !currentViewedAttachment.url) {
        showAlert('تنبيه', 'لا يوجد ملف مرفق نشط للتحميل');
        return;
    }
    const ext = currentViewedAttachment.url.includes('pdf') ? 'pdf' : 'jpg';
    let safeName = currentViewedAttachment.fileName || 'مرفق_طبي';
    if (!safeName.includes('.')) safeName += `.${ext}`;

    const a = document.createElement('a');
    a.href = currentViewedAttachment.url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (window.showBottomNotification) {
        window.showBottomNotification('تم التحميل 📥', `تم تنزيل ${safeName}`, 'success');
    }
};

window.rotateCurrentAttachment = function() {
    currentViewedAttachment.rotation = (currentViewedAttachment.rotation + 90) % 360;
    const img = document.getElementById('currentAttachmentImg');
    if (img) {
        img.style.transform = `rotate(${currentViewedAttachment.rotation}deg)`;
    }
};

window.printCurrentAttachment = function() {
    if (!currentViewedAttachment || !currentViewedAttachment.url) return;
    const win = window.open('', '_blank');
    if (!win) {
        showAlert('تنبيه', 'يرجى السماح بالنوافذ المنبثقة للطباعة');
        return;
    }
    const isImg = !currentViewedAttachment.url.includes('pdf');
    win.document.write(`
        <html dir="rtl">
        <head>
            <title>طباعة المرفق الطبي - ${currentViewedAttachment.studentName || ''}</title>
            <style>
                body { font-family: system-ui, sans-serif; margin: 20px; text-align: center; }
                .header { margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                img { max-width: 95%; max-height: 85vh; transform: rotate(${currentViewedAttachment.rotation}deg); }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>المملكة العربية السعودية - مدرسة الجشة المتوسطة</h2>
                <h3>مرفق التقرير الطبي للطالب: ${currentViewedAttachment.studentName || '-'} (التاريخ: ${currentViewedAttachment.date || '-'})</h3>
            </div>
            ${isImg ? `<img src="${currentViewedAttachment.url}">` : `<iframe src="${currentViewedAttachment.url}" style="width:100%; height:90vh; border:none;"></iframe>`}
            <script>
                window.onload = function() { window.print(); };
            <\/script>
        </body>
        </html>
    `);
    win.document.close();
};

window.openAttachmentInNewTab = function() {
    if (!currentViewedAttachment || !currentViewedAttachment.url) return;
    const win = window.open();
    if (win) {
        if (!currentViewedAttachment.url.includes('pdf')) {
            win.document.write(`<title>المرفق الطبي</title><body style="margin:0; background:#0f172a; display:flex; justify-content:center; align-items:center; min-height:100vh;"><img src="${currentViewedAttachment.url}" style="max-width:100%; max-height:100vh; transform:rotate(${currentViewedAttachment.rotation}deg);"></body>`);
        } else {
            win.location.href = currentViewedAttachment.url;
        }
    }
};

// ==========================================
// 8.6 Admin Official Email & Excuses Linking
// ==========================================
window.promptChangeAdminEmail = function() {
    const newEmail = prompt('أدخل البريد الإلكتروني المعتمد لإدارة المدرسة لاستلام ومتابعة الأعذار:', officialAdminEmail);
    if (newEmail !== null && newEmail.trim() !== '') {
        const cleaned = newEmail.trim().toLowerCase();
        officialAdminEmail = cleaned;
        localStorage.setItem('school_admin_email', cleaned);
        updateAdminEmailDisplays();
        if (window.showBottomNotification) {
            window.showBottomNotification('تم تحديث البريد ✉️', `تم ربط البريد المعتمد: ${cleaned}`, 'success');
        }
    }
};

window.openGoogleDriveTroubleshootModal = function() {
    openModal('googleDriveTroubleshootModal');
};

window.sendExcusesReportByEmail = function() {
    let list = [...cloudExcuses];
    const from = document.getElementById('exportExcuseFrom')?.value;
    const to = document.getElementById('exportExcuseTo')?.value;
    if (from && to) {
        list = list.filter(e => e.date >= from && e.date <= to);
    }

    if (list.length === 0) {
        showAlert('تنبيه', 'لا توجد أعذار مسجلة ضمن النطاق أو الفلتر المحدد لإرسالها.');
        return;
    }

    let subject = `تقرير الأعذار والمبررات الطبية - مدرسة الجشة المتوسطة (${currentSelectedDate})`;
    let body = `السلام عليكم ورحمة الله وبركاته،\n\n`;
    body += `المكرم مدير / وكيل شؤون الطلاب بمدرسة الجشة المتوسطة المحترم،\n`;
    body += `تجدون أدناه بيان ملخص الأعذار والمبررات الطبية المسجلة والمرفوعة عبر نظام الحضور والانضباط المدرسي:\n\n`;
    body += `-----------------------------------------\n`;
    body += `• إجمالي الأعذار المسجلة: ${list.length}\n`;
    body += `• التاريخ: ${currentSelectedDate}\n`;
    body += `• البريد المعتمد للمتابعة: ${officialAdminEmail}\n`;
    body += `-----------------------------------------\n\n`;
    body += `تفاصيل الطلاب والأعذار:\n\n`;

    list.forEach((e, idx) => {
        const studentObj = students.find(s => s.id === e.studentId || (e.studentNationalId && String(s.nationalId).trim() === String(e.studentNationalId).trim()));
        const displayClass = e.studentClass || (studentObj ? studentObj.class : '-');
        const displayNid = e.studentNationalId || (studentObj ? studentObj.nationalId : '-');
        const hasAttach = Boolean(e.fileUrl || e.attachmentUrl || e.dataUrl || e.file);
        const statusAr = e.status === 'accepted' ? 'مقبول ✓' : (e.status === 'rejected' ? 'مرفوض ✗' : 'قيد المراجعة ⏳');

        body += `${idx + 1}. الطالب: ${e.studentName || 'غير مسجل'}\n`;
        body += `   - الصف: ${displayClass}\n`;
        body += `   - السجل المدني: ${displayNid}\n`;
        body += `   - تاريخ الغياب: ${e.date || '-'}\n`;
        body += `   - نوع العذر: ${e.type || 'عذر غياب'}\n`;
        body += `   - الحالة: ${statusAr}\n`;
        body += `   - المبررات والتفاصيل: ${e.desc || 'لا يوجد وصف توضيحي'}\n`;
        body += `   - المرفق الطبي: ${hasAttach ? '✓ مرفق رسمي متوفر ومحفوظ بالسحابة' : 'لا يوجد مرفق مرفوع'}\n`;
        if (e.adminReply) {
            body += `   - ملاحظة الإدارة: ${e.adminReply}\n`;
        }
        body += `\n`;
    });

    body += `-----------------------------------------\n`;
    body += `نظام الحضور والانضباط المدرسي المطور - مدرسة الجشة المتوسطة\n`;

    const mailtoUrl = `mailto:${officialAdminEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;

    if (window.showBottomNotification) {
        window.showBottomNotification('تم تجهيز البريد ✉️', `تم فتح تطبيق البريد للإرسال إلى: ${officialAdminEmail}`, 'success');
    }
};

window.sendSingleExcuseEmail = function(id) {
    const e = cloudExcuses.find(x => x.id === id);
    if (!e) return;

    const studentObj = students.find(s => s.id === e.studentId || (e.studentNationalId && String(s.nationalId).trim() === String(e.studentNationalId).trim()));
    const displayClass = e.studentClass || (studentObj ? studentObj.class : '-');
    const displayNid = e.studentNationalId || (studentObj ? studentObj.nationalId : '-');
    const hasAttach = Boolean(e.fileUrl || e.attachmentUrl || e.dataUrl || e.file);
    const statusAr = e.status === 'accepted' ? 'مقبول ✓' : (e.status === 'rejected' ? 'مرفوض ✗' : 'قيد المراجعة ⏳');

    let subject = `عذر طبي - الطالب: ${e.studentName} (${displayClass}) - تاريخ: ${e.date}`;
    let body = `المكرم مدير / وكيل المدرسة المحترم،\n\n`;
    body += `بيانات عذر الغياب / التأخير المرفوع:\n`;
    body += `-----------------------------------------\n`;
    body += `• اسم الطالب: ${e.studentName}\n`;
    body += `• الصف: ${displayClass}\n`;
    body += `• السجل المدني: ${displayNid}\n`;
    body += `• تاريخ الغياب: ${e.date}\n`;
    body += `• نوع العذر: ${e.type}\n`;
    body += `• الحالة الحالية: ${statusAr}\n`;
    body += `• التفاصيل والمبررات: ${e.desc || 'لا يوجد تفاصيل إضافية'}\n`;
    body += `• المرفق الطبي: ${hasAttach ? '✓ التقرير الطبي مرفوع بالسحابة ومعتمد للنظام' : 'لا يوجد مرفق مرفوع'}\n`;
    if (e.adminReply) {
        body += `• ملاحظات الإدارة: ${e.adminReply}\n`;
    }
    body += `-----------------------------------------\n`;
    body += `المرسل إليه: إدارة المدرسة (${officialAdminEmail})\n`;

    const mailtoUrl = `mailto:${officialAdminEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
    
    if (window.showBottomNotification) {
        window.showBottomNotification('تم تجهيز البريد ✉️', `تم فتح رسالة العذر للإرسال إلى: ${officialAdminEmail}`, 'success');
    }
};

window.emailCurrentAttachment = function() {
    if (!currentViewedAttachment || !currentViewedAttachment.url) {
        showAlert('تنبيه', 'لا يوجد مرفق نشط للمشاركة');
        return;
    }
    let subject = `مرفق تقرير طبي - الطالب: ${currentViewedAttachment.studentName || ''} (${currentViewedAttachment.date || ''})`;
    let body = `السلام عليكم ورحمة الله وبركاته،\n\n`;
    body += `بيانات المرفق الطبي المستعرض:\n`;
    body += `• اسم الطالب: ${currentViewedAttachment.studentName || '-'}\n`;
    body += `• نوع العذر: ${currentViewedAttachment.type || '-'}\n`;
    body += `• تاريخ الغياب: ${currentViewedAttachment.date || '-'}\n`;
    body += `• اسم الملف: ${currentViewedAttachment.fileName || '-'}\n`;
    body += `• المرفق محفوظ بالسحابة الرسمية للنظام ويمكن الاطلاع عليه وتحميله من لوحة إدارة واستعراض الأعذار.\n\n`;
    body += `إدارة مدرسة الجشة المتوسطة (${officialAdminEmail})`;

    const mailtoUrl = `mailto:${officialAdminEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
};

// ==========================================
// 9. Tools, Modals & Official Reports
// ==========================================
window.openToolsModal = function() { openModal('toolsModal'); };
window.openTodayReportModal = function() {
    const c = document.getElementById('todayReportContent');
    const dayRecords = attendanceData[currentSelectedDate] || {};
    let present = [], absent = [], late = [];

    students.forEach(s => {
        const st = (dayRecords[s.id] || {}).status;
        if (st === 'present') present.push(s);
        else if (st === 'absent') absent.push(s);
        else if (st === 'late') late.push(s);
    });

    c.innerHTML = `
        <div style="text-align:right; font-size:15px; line-height:1.8;">
            <p><strong>تاريخ اليوم:</strong> ${currentSelectedDate}</p>
            <p><strong>إجمالي الطلاب المسجلين:</strong> ${students.length}</p>
            <p style="color:var(--success);"><strong>عدد الحاضرين:</strong> ${present.length}</p>
            <p style="color:var(--danger);"><strong>عدد الغائبين:</strong> ${absent.length}</p>
            <p style="color:var(--warning);"><strong>عدد المتأخرين:</strong> ${late.length}</p>
        </div>
    `;
    openModal('todayReportModal');
};

window.openDateModal = function() {
    document.getElementById('fromDate').value = currentSelectedDate;
    document.getElementById('toDate').value = currentSelectedDate;
    openModal('dateModal');
};

function getDateRangeReportData(from, to, cls) {
    const relevantDates = Object.keys(attendanceData).filter(d => d >= from && d <= to).sort();
    let absentMap = {};
    let absentDatesMap = {};
    let excusedMap = {};
    let lateMap = {};

    relevantDates.forEach(d => {
        students.forEach(s => {
            if (cls !== 'all' && s.class !== cls) return;
            const rec = (attendanceData[d] || {})[s.id] || {};
            const st = rec.status;
            if (st === 'absent') {
                absentMap[s.id] = (absentMap[s.id] || 0) + 1;
                if (!absentDatesMap[s.id]) absentDatesMap[s.id] = [];
                absentDatesMap[s.id].push(d);
            } else if (st === 'excused') {
                excusedMap[s.id] = (excusedMap[s.id] || 0) + 1;
            } else if (st === 'late') {
                lateMap[s.id] = (lateMap[s.id] || 0) + 1;
            }
        });
    });

    const sidList = Object.keys(absentMap);
    // ترتيب تنازلي حسب أيام الغياب ثم أبجدياً
    sidList.sort((a, b) => {
        const diff = absentMap[b] - absentMap[a];
        if (diff !== 0) return diff;
        const sA = students.find(item => item.id === a);
        const sB = students.find(item => item.id === b);
        return (sA?.name || '').localeCompare(sB?.name || '', 'ar');
    });

    const reportStudents = sidList.map((sid, idx) => {
        const s = students.find(item => item.id === sid) || { id: sid, name: 'طالب غير مسجل', class: '-', nationalId: '-' };
        const daysCount = absentMap[sid];
        const dates = absentDatesMap[sid] || [];
        
        // الإجراء وفق لائحة السلوك والمواظبة بوزارة التعليم
        let procedure = 'تنبيه شفهي ومتابعة';
        let procedureColor = '#059669';
        if (daysCount >= 10) {
            procedure = 'إحالة للجنة التوجيه وقرار حسم';
            procedureColor = '#be123c';
        } else if (daysCount >= 5) {
            procedure = 'استدعاء ولي أمر وخطة علاجية';
            procedureColor = '#e11d48';
        } else if (daysCount >= 3) {
            procedure = 'إشعار خطي أول لولي الأمر';
            procedureColor = '#d97706';
        }

        return {
            index: idx + 1,
            student: s,
            absentDays: daysCount,
            excusedDays: excusedMap[sid] || 0,
            lateDays: lateMap[sid] || 0,
            dates: dates,
            procedure,
            procedureColor
        };
    });

    const totalAbsentDays = Object.values(absentMap).reduce((sum, val) => sum + val, 0);
    const classLabel = cls === 'all' ? 'جميع الفصول' : cls;

    return {
        from,
        to,
        cls,
        classLabel,
        relevantDatesCount: relevantDates.length,
        students: reportStudents,
        totalStudentsWithAbsence: reportStudents.length,
        totalAbsentDays
    };
}

function buildDateRangeReportHtml(data, isForWord = false) {
    if (!data.students || data.students.length === 0) {
        if (isForWord) {
            return `
                <div style="text-align: center; padding: 25px; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; color: #008375;">
                    <p style="font-size: 13pt; font-weight: bold; margin: 0;">لا توجد أي حالات غياب مسجلة خلال الفترة المحددة</p>
                    <p style="color: #64748b; font-size: 10.5pt; margin-top: 5px;">من: ${data.from} إلى: ${data.to} — (${data.classLabel})</p>
                </div>
            `;
        }
        return `
            <div style="text-align: center; padding: 35px 20px; font-family: 'Tajawal', sans-serif !important; font-size: 10.5pt !important; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; color: #166534;">
                <div style="font-size: 36px; margin-bottom: 8px;">✅</div>
                <div style="font-weight: 800; font-size: 13pt; color: #008375;">لا توجد أي حالات غياب مسجلة خلال هذه الفترة!</div>
                <div style="color: #475569; font-size: 10.5pt; margin-top: 6px;">
                    الفترة من <strong>${data.from}</strong> إلى <strong>${data.to}</strong> — (${data.classLabel})
                </div>
            </div>
        `;
    }

    if (isForWord) {
        // Formatted specifically for Microsoft Word
        let wordHtml = `
            <!-- بطاقة ملخص إحصائية الفترة -->
            <table border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; border: 1pt solid #008375; margin-bottom: 15px; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; direction: rtl; text-align: center;">
                <tr style="background-color: #f0fdf4;">
                    <td style="border: 1pt solid #008375; padding: 6px; font-size: 10.5pt;">
                        <strong>نطاق الفترة:</strong> من ${data.from} إلى ${data.to}
                    </td>
                    <td style="border: 1pt solid #008375; padding: 6px; font-size: 10.5pt;">
                        <strong>الفصل:</strong> ${data.classLabel}
                    </td>
                    <td style="border: 1pt solid #008375; padding: 6px; font-size: 10.5pt;">
                        <strong>الطلاب الغائبون:</strong> <span style="color: #008375; font-weight: bold;">${data.totalStudentsWithAbsence} طالب</span>
                    </td>
                    <td style="border: 1pt solid #008375; padding: 6px; font-size: 10.5pt;">
                        <strong>مجموع أيام الغياب:</strong> <span style="color: #b91c1c; font-weight: bold;">${data.totalAbsentDays} يوم</span>
                    </td>
                </tr>
            </table>

            <!-- جدول إحصائية غياب الطلاب بتنسيق وألوان وزارة التعليم وخط تجوال حجم 10.5 -->
            <table border="1" cellpadding="6" cellspacing="0" class="content-table" style="width: 100%; border-collapse: collapse; border: 1.5pt solid #008375; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; font-size: 10.5pt !important; direction: rtl; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #008375; color: #ffffff;">
                        <th style="background-color: #008375; color: #ffffff; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; border: 1pt solid #00675b; padding: 8px 4px; text-align: center; width: 35px;">م</th>
                        <th style="background-color: #008375; color: #ffffff; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; border: 1pt solid #00675b; padding: 8px 6px; text-align: right;">اسم الطالب</th>
                        <th style="background-color: #008375; color: #ffffff; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; border: 1pt solid #00675b; padding: 8px 6px; text-align: center; width: 90px;">الصف</th>
                        <th style="background-color: #008375; color: #ffffff; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; border: 1pt solid #00675b; padding: 8px 6px; text-align: center; width: 80px;">أيام الغياب</th>
                        <th style="background-color: #008375; color: #ffffff; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; border: 1pt solid #00675b; padding: 8px 6px; text-align: center;">تواريخ الغياب في الفترة</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.students.forEach((row, idx) => {
            const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            const datesFormatted = row.dates.length > 0 ? row.dates.join(' ، ') : '-';
            wordHtml += `
                <tr style="background-color: ${bg};">
                    <td style="border: 1pt solid #cbd5e1; padding: 6px 4px; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; color: #475569;">${row.index}</td>
                    <td style="border: 1pt solid #cbd5e1; padding: 6px 8px; text-align: right; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; color: #0f172a;">${row.student.name}</td>
                    <td style="border: 1pt solid #cbd5e1; padding: 6px 6px; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; color: #334155;">${row.student.class || '-'}</td>
                    <td style="border: 1pt solid #cbd5e1; padding: 6px 6px; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; color: #b91c1c;">${row.absentDays}</td>
                    <td style="border: 1pt solid #cbd5e1; padding: 6px 6px; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 9.5pt; color: #475569; direction: ltr;">${datesFormatted}</td>
                </tr>
            `;
        });

        wordHtml += `
                </tbody>
                <tfoot>
                    <tr style="background-color: #e6f4f2; font-weight: bold;">
                        <td colspan="3" style="border: 1.5pt solid #008375; padding: 8px 10px; text-align: right; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; color: #00675b;">
                            إجمالي عدد الطلاب المتغيبين: ${data.totalStudentsWithAbsence} طالب
                        </td>
                        <td style="border: 1.5pt solid #008375; padding: 8px 6px; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; color: #b91c1c;">
                            ${data.totalAbsentDays}
                        </td>
                        <td style="border: 1.5pt solid #008375; padding: 8px 10px; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; color: #00675b;">
                            مجموع أيام الغياب للفترة المحددة
                        </td>
                    </tr>
                </tfoot>
            </table>
        `;
        return wordHtml;
    }

    // Interactive Modal / Web View
    let html = `
        <div class="moe-summary-strip">
            <div class="moe-summary-item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                <span>الفترة:</span>
                <span class="val">${data.from} إلى ${data.to}</span>
            </div>
            <div class="moe-summary-item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                <span>الفصل:</span>
                <span class="val">${data.classLabel}</span>
            </div>
            <div class="moe-summary-item">
                <span>الطلاب الغائبون:</span>
                <span class="val">${data.totalStudentsWithAbsence} طالب</span>
            </div>
            <div class="moe-summary-item">
                <span>مجموع أيام الغياب:</span>
                <span class="val" style="color: #b91c1c; border-color: #fca5a5; background: #fff1f2;">${data.totalAbsentDays} يوم</span>
            </div>
        </div>

        <div style="overflow-x: auto; border: 1px solid #008375; border-radius: 8px;">
            <table class="moe-report-table" style="margin-top: 0;">
                <thead>
                    <tr>
                        <th style="width: 40px;">م</th>
                        <th style="text-align: right; min-width: 160px;">اسم الطالب</th>
                        <th style="width: 95px;">الصف</th>
                        <th style="width: 85px;">أيام الغياب</th>
                        <th style="min-width: 160px;">تواريخ الغياب في الفترة</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.students.forEach(row => {
        const datesFormatted = row.dates.length > 0 ? row.dates.join(' ، ') : '-';
        html += `
            <tr>
                <td style="text-align: center; font-weight: bold; color: #475569;">${row.index}</td>
                <td style="font-weight: 700; color: #0f172a;">${row.student.name}</td>
                <td style="text-align: center; color: #334155;">${row.student.class || '-'}</td>
                <td style="text-align: center; font-weight: 800; color: #dc2626; font-size: 11pt;">${row.absentDays}</td>
                <td style="text-align: center; font-size: 9.5pt; color: #475569; direction: ltr;">${datesFormatted}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="text-align: right; padding: 10px; font-size: 10.5pt;">
                            إجمالي عدد الطلاب المتغيبين في الفترة: <strong>${data.totalStudentsWithAbsence} طالب</strong>
                        </td>
                        <td style="text-align: center; font-weight: 800; color: #dc2626; font-size: 11pt;">
                            ${data.totalAbsentDays}
                        </td>
                        <td style="text-align: center; font-size: 10.5pt;">
                            مجموع أيام الغياب المسجلة للفترة
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;

    return html;
}

window.generateDateRangeReport = function() {
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const cls = document.getElementById('rangeClassFilter').value;
    const c = document.getElementById('dateRangeReportContent');

    if (!from || !to) {
        if (window.showAlert) {
            showAlert('تنبيه', 'يرجى اختيار تاريخ البداية وتاريخ النهاية أولاً.');
        } else {
            alert('يرجى اختيار تاريخ البداية وتاريخ النهاية أولاً.');
        }
        return;
    }

    const reportData = getDateRangeReportData(from, to, cls);
    c.innerHTML = buildDateRangeReportHtml(reportData, false);
    document.getElementById('dateRangeReportContainer').style.display = 'block';
};

window.openStudentModal = function() {
    const sel = document.getElementById('studentSelectDropdown');
    let html = '<option value="">-- يرجى الاختيار --</option>';
    const sorted = [...students].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar', { sensitivity: 'base' }));
    sorted.forEach(s => {
        html += `<option value="${s.id}">${s.name} (${s.class || ''})</option>`;
    });
    sel.innerHTML = html;
    document.getElementById('reportCaptureArea').style.display = 'none';
    openModal('studentModal');
};

window.openStudentReportDirect = function(sid) {
    window.openStudentModal();
    const sel = document.getElementById('studentSelectDropdown');
    if (sel) {
        sel.value = sid;
        window.previewStudentReport(sid);
    }
};

window.previewStudentReport = function(sid) {
    if (!sid) {
        document.getElementById('reportCaptureArea').style.display = 'none';
        return;
    }
    const s = students.find(item => item.id === sid);
    if (!s) return;

    let absent = 0, late = 0, present = 0, excused = 0;
    const dates = Object.keys(attendanceData).sort();
    const studentHistory = [];

    dates.forEach(d => {
        const rec = (attendanceData[d] || {})[s.id];
        if (rec && rec.status && rec.status !== 'none') {
            if (rec.status === 'absent') absent++;
            else if (rec.status === 'late') late++;
            else if (rec.status === 'present') present++;
            else if (rec.status === 'excused') excused++;

            studentHistory.push({
                date: d,
                status: rec.status,
                time: rec.time || '-'
            });
        }
    });

    const trend = calculateDisciplineTrend(s.id);
    const dayRec = (attendanceData[currentSelectedDate] || {})[s.id] || { status: 'none', time: '-' };

    document.getElementById('sr-name').innerText = s.name || '-';
    document.getElementById('sr-nid').innerText = s.nationalId || '-';
    document.getElementById('sr-class').innerText = s.class || '-';
    document.getElementById('sr-phone').innerText = s.phone || '-';
    
    const trendEl = document.getElementById('sr-trend');
    if (trendEl) {
        trendEl.innerText = trend.label;
        trendEl.style.background = trend.bg;
        trendEl.style.color = trend.color;
    }

    document.getElementById('sr-date').innerText = currentSelectedDate;
    
    let statusText = 'لم يسجل اليوم';
    let statusColor = '#64748b';
    if (isHolidayDate(currentSelectedDate)) {
        statusText = 'إجازة رسمية 🏖️';
        statusColor = '#d97706';
    } else if (dayRec.status === 'present') { statusText = 'حاضر ✓'; statusColor = '#15803d'; }
    else if (dayRec.status === 'absent') { statusText = 'غائب ✗'; statusColor = '#b91c1c'; }
    else if (dayRec.status === 'late') { statusText = 'متأخر ⏰'; statusColor = '#b45309'; }
    else if (dayRec.status === 'excused') { statusText = 'غياب بعذر 📋'; statusColor = '#0369a1'; }
    
    const srStatusEl = document.getElementById('sr-status');
    if (srStatusEl) {
        srStatusEl.innerText = statusText;
        srStatusEl.style.color = statusColor;
    }

    if (document.getElementById('sr-present-count')) document.getElementById('sr-present-count').innerText = present;
    if (document.getElementById('sr-absences')) document.getElementById('sr-absences').innerText = absent;
    if (document.getElementById('sr-late-count')) document.getElementById('sr-late-count').innerText = late;
    if (document.getElementById('sr-excused-count')) document.getElementById('sr-excused-count').innerText = excused;

    // Timeline dots (سجل الانضباط الأخير)
    const sjPath = document.getElementById('sj-dots-path');
    if (sjPath) {
        // Collect dates for recent timeline: include recorded dates + recent days up to currentSelectedDate
        const datesSet = new Set(Object.keys(attendanceData));
        datesSet.add(currentSelectedDate);

        // Also ensure the last 7 calendar days leading up to currentSelectedDate are represented
        const currD = new Date(currentSelectedDate + 'T00:00:00');
        for (let i = 0; i < 7; i++) {
            const temp = new Date(currD);
            temp.setDate(temp.getDate() - i);
            const y = temp.getFullYear();
            const m = String(temp.getMonth() + 1).padStart(2, '0');
            const d = String(temp.getDate()).padStart(2, '0');
            datesSet.add(`${y}-${m}-${d}`);
        }

        const sortedTimelineDates = Array.from(datesSet).sort().slice(-12);

        let dotsHtml = '';
        sortedTimelineDates.forEach(dateStr => {
            const rec = (attendanceData[dateStr] || {})[s.id] || {};
            const isHoliday = isHolidayDate(dateStr);

            let bg = '#334155';
            let title = 'لم يسجل';
            let icon = '—';
            let titleColor = '#94a3b8';

            if (isHoliday) {
                bg = '#475569';
                title = 'إجازة رسمية';
                icon = '🏖️';
                titleColor = '#fcd34d';
            } else if (rec.status === 'present') {
                bg = '#10b981'; title = 'حاضر'; icon = '✓'; titleColor = '#34d399';
            } else if (rec.status === 'absent') {
                bg = '#f43f5e'; title = 'غائب'; icon = '✗'; titleColor = '#fb7185';
            } else if (rec.status === 'late') {
                bg = '#f59e0b'; title = 'متأخر'; icon = '⏰'; titleColor = '#fbbf24';
            } else if (rec.status === 'excused') {
                bg = '#0ea5e9'; title = 'بعذر'; icon = 'ع'; titleColor = '#38bdf8';
            }

            const parts = dateStr.split('-');
            const shortDate = parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateStr;

            dotsHtml += `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 54px; flex-shrink: 0;">
                    <div style="width: 34px; height: 34px; border-radius: 50%; background: ${bg}; color: white; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; border: 2px solid ${isHoliday ? '#f59e0b' : '#ffffff'}; box-shadow: 0 2px 8px rgba(0,0,0,0.25);">
                        ${icon}
                    </div>
                    <span style="font-size: 11px; font-weight: 700; color: #cbd5e1; font-family: monospace; direction: ltr;">${shortDate}</span>
                    <span style="font-size: 10px; font-weight: 700; color: ${titleColor}; white-space: nowrap;">${title}</span>
                </div>
            `;
        });
        sjPath.innerHTML = dotsHtml;
    }

    // Recent days table
    const recentTableEl = document.getElementById('sr-recent-days-table');
    if (recentTableEl) {
        const tableEntries = studentHistory.length > 0 
            ? [...studentHistory].reverse().slice(0, 6)
            : [{ date: currentSelectedDate, status: dayRec.status, time: dayRec.time || '-' }];

        let tHtml = `
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: right;">
                <thead>
                    <tr style="background: #008375; color: #ffffff;">
                        <th style="padding: 9px 12px; font-weight: 800; color: #ffffff;">التاريخ</th>
                        <th style="padding: 9px 12px; font-weight: 800; color: #ffffff;">اليوم</th>
                        <th style="padding: 9px 12px; font-weight: 800; color: #ffffff;">الحالة</th>
                        <th style="padding: 9px 12px; font-weight: 800; color: #ffffff; text-align: center;">وقت الرصد</th>
                    </tr>
                </thead>
                <tbody>
        `;
        const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        tableEntries.forEach(entry => {
            const dObj = new Date(entry.date + 'T00:00:00');
            const dayName = !isNaN(dObj) ? dayNames[dObj.getDay()] : '-';
            const isHoliday = isHolidayDate(entry.date);

            let badge = '';
            if (isHoliday) {
                badge = '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">إجازة رسمية 🏖️</span>';
            } else if (entry.status === 'present') {
                badge = '<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">حاضر ✓</span>';
            } else if (entry.status === 'absent') {
                badge = '<span style="background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">غائب ✗</span>';
            } else if (entry.status === 'late') {
                badge = '<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">متأخر ⏰</span>';
            } else if (entry.status === 'excused') {
                badge = '<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">بعذر 📋</span>';
            } else {
                badge = '<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">لم يسجل</span>';
            }

            tHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 8px 12px; font-family: monospace; font-weight: 700; color: #334155;">${entry.date}</td>
                    <td style="padding: 8px 12px; color: #64748b;">${dayName}</td>
                    <td style="padding: 8px 12px;">${badge}</td>
                    <td style="padding: 8px 12px; text-align: center; color: #64748b; font-family: monospace;">${entry.time || '-'}</td>
                </tr>
            `;
        });
        tHtml += `</tbody></table>`;
        recentTableEl.innerHTML = tHtml;
    }

    // تعبئة الإجراءات الواجب اتخاذها تجاه غياب الطالب بحذافيرها وفق تعميم الوزارة
    const actionSection = document.getElementById('sr-absence-action-section');
    const actionBadge = document.getElementById('sr-absence-action-badge');
    const actionBody = document.getElementById('sr-absence-action-body');
    if (actionSection && actionBody) {
        if (absent >= 10) {
            actionSection.style.display = 'block';
            actionSection.style.borderColor = '#e11d48';
            if (actionBadge) {
                actionBadge.innerText = '10 أيام غياب فأكثر (المستوى 3)';
                actionBadge.style.background = '#ffe4e6';
                actionBadge.style.color = '#9f1239';
            }
            actionBody.innerHTML = `
                <div style="font-weight: 800; color: #9f1239; margin-bottom: 6px; font-size: 13.5px;">الإجراءات الواجب اتخاذها بحذافيرها (10 أيام غياب - متصلة أو منفصلة):</div>
                <ul style="margin: 0; padding-right: 20px; color: #1e293b; line-height: 1.8;">
                    <li>في حال الاشتباه بتعرض الطالب للإهمال <strong>تخاطب المدرسة الجهات ذات الاختصاص</strong> حيال تطبيق ما ورد في <strong>نظام حماية الطفل ونظام الحماية من الإيذاء ولائحتهما التنفيذية</strong>، و<strong>إشعار إدارة التعليم بذلك</strong>.</li>
                    <li><strong>تتخذ المدرسة الإجراءات النظامية المطلوبة</strong> بالتنسيق والمتابعة مع الجهات ذات الاختصاص المذكورة في الفقرة السابقة حيال ما تم من إجراءات للحالات المحالة لهم.</li>
                </ul>
                <div style="margin-top: 8px; font-weight: 800; color: #008375; font-size: 12.5px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; align-items: center; gap: 6px;">
                    <span>🌱</span>
                    <span>الركيزة الأساسية: استمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها.</span>
                </div>
            `;
        } else if (absent >= 5) {
            actionSection.style.display = 'block';
            actionSection.style.borderColor = '#ea580c';
            if (actionBadge) {
                actionBadge.innerText = '5 أيام غياب (المستوى 2)';
                actionBadge.style.background = '#ffedd5';
                actionBadge.style.color = '#c2410c';
            }
            actionBody.innerHTML = `
                <div style="font-weight: 800; color: #c2410c; margin-bottom: 6px; font-size: 13.5px;">الإجراءات الواجب اتخاذها بحذافيرها (5 أيام غياب - متصلة أو منفصلة):</div>
                <ul style="margin: 0; padding-right: 20px; color: #1e293b; line-height: 1.8;">
                    <li>في حال عدم التزام ولي الأمر بالخطة التربوية (<strong>خطة التعلم في أيام الغياب</strong>)، <strong>يُحال الطالب إلى لجنة التوجيه الطلابي</strong>، ويتم <strong>تنظيم جلسة توعوية مع ولي الأمر</strong>؛ للتأكيد على أهمية اتباع الخطط التربوية والعلاجية.</li>
                </ul>
                <div style="margin-top: 8px; font-weight: 800; color: #008375; font-size: 12.5px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; align-items: center; gap: 6px;">
                    <span>🌱</span>
                    <span>الركيزة الأساسية: استمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها.</span>
                </div>
            `;
        } else if (absent >= 3) {
            actionSection.style.display = 'block';
            actionSection.style.borderColor = '#f59e0b';
            if (actionBadge) {
                actionBadge.innerText = '3 أيام غياب (المستوى 1)';
                actionBadge.style.background = '#fef3c7';
                actionBadge.style.color = '#b45309';
            }
            actionBody.innerHTML = `
                <div style="font-weight: 800; color: #b45309; margin-bottom: 6px; font-size: 13.5px;">الإجراءات الواجب اتخاذها بحذافيرها (3 أيام غياب - متصلة أو منفصلة):</div>
                <ul style="margin: 0; padding-right: 20px; color: #1e293b; line-height: 1.8;">
                    <li><strong>تحويل الطالب للموجه الطلابي</strong> لتقديم الدعم والخدمات التربوية المناسبة له (<strong>خطة التعلم في أيام الغياب</strong>)، ودراسة الحالة إذا احتاج الأمر.</li>
                    <li><strong>استدعاء ولي الأمر، ويعقد اجتماع حضوري معه يتضمن ما يلي:</strong>
                        <ul style="margin-top: 4px; padding-right: 18px; list-style-type: circle; color: #334155;">
                            <li>إبلاغه بالإجراءات المترتبة على غياب ابنه.</li>
                            <li>تقييم الخدمات التربوية والخطة العلاجية المقدمة للطالب، وتحديثها بما يلزم وفق الحالة.</li>
                        </ul>
                    </li>
                </ul>
                <div style="margin-top: 8px; font-weight: 800; color: #008375; font-size: 12.5px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; align-items: center; gap: 6px;">
                    <span>🌱</span>
                    <span>الركيزة الأساسية: استمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها.</span>
                </div>
            `;
        } else if (dayRec.status === 'absent' || absent > 0) {
            actionSection.style.display = 'block';
            actionSection.style.borderColor = '#008375';
            if (actionBadge) {
                actionBadge.innerText = 'إجراء فوري في نفس يوم الغياب';
                actionBadge.style.background = '#ecfdf5';
                actionBadge.style.color = '#047857';
            }
            actionBody.innerHTML = `
                <div style="font-weight: 800; color: #065f46; margin-bottom: 4px; font-size: 13.5px;">التوجيه الوزاري المعتمد بنفس اليوم:</div>
                <p style="margin: 0; color: #1e293b; line-height: 1.7;">
                    📞 <strong>التواصل مع ولي الأمر في نفس اليوم الذي تغيب فيه الطالب من خلال الرسالة النصية أو المكالمة الهاتفية للاستفسار عن سبب الغياب.</strong>
                </p>
                <div style="margin-top: 8px; font-weight: 800; color: #008375; font-size: 12.5px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; align-items: center; gap: 6px;">
                    <span>🌱</span>
                    <span>استمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها.</span>
                </div>
            `;
        } else {
            actionSection.style.display = 'none';
        }
    }

    document.getElementById('reportCaptureArea').style.display = 'block';
    document.getElementById('captureStudentReportBtn').style.display = 'flex';
    if (document.getElementById('printStudentReportBtn')) {
        document.getElementById('printStudentReportBtn').style.display = 'flex';
    }
    document.getElementById('draftAiBtn').style.display = 'flex';
};

window.printStudentReportCard = function() {
    const el = document.getElementById('studentReportCard');
    if (!el) return;

    const sid = document.getElementById('studentSelectDropdown').value;
    const s = students.find(item => item.id === sid);
    const studentName = s ? s.name.replace(/\s+/g, '_') : 'طالب';
    const filename = `تقرير_انضباط_${studentName}_${currentSelectedDate}.pdf`;

    if (window.showBottomNotification) {
        window.showBottomNotification('جاري إنشاء تقرير PDF 📥', 'يتم الآن تصدير تقرير الطالب بهوية وزارة التعليم...', 'info');
    }

    // Clone and build standalone container for PDF export
    const cardClone = el.cloneNode(true);
    cardClone.style.boxShadow = 'none';
    cardClone.style.border = '1px solid #cbd5e1';

    const reportHtml = `
        <div class="official-pdf-page" style="direction: rtl; text-align: right; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; color: #0f172a; background: #ffffff; width: 794px; box-sizing: border-box; padding: 12px;">
            ${cardClone.outerHTML}
        </div>
    `;

    window.exportHtmlToPdf(reportHtml, filename, {
        margin: [5, 5, 5, 5],
        padding: '10px 14px'
    });
};

window.captureStudentReport = function() {
    const el = document.getElementById('studentReportCard');
    if (!el) return;

    const sid = document.getElementById('studentSelectDropdown').value;
    const s = students.find(item => item.id === sid);
    const studentName = s ? s.name.replace(/\s+/g, '_') : 'طالب';

    if (window.html2canvas) {
        const btn = document.getElementById('captureStudentReportBtn');
        const origText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = 'جاري إنشاء وحفظ الصورة... ⏳';
            btn.disabled = true;
        }

        window.html2canvas(el, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            scrollX: 0,
            scrollY: 0,
            logging: false
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `تقرير_انضباط_${studentName}_${currentSelectedDate}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            if (btn) {
                btn.innerHTML = origText;
                btn.disabled = false;
            }
            showAlert('تم بنجاح', 'تم حفظ صورة التقرير وسجل الانضباط الأخير بنجاح 📸✅');
        }).catch(err => {
            console.error('HTML2Canvas Error:', err);
            if (btn) {
                btn.innerHTML = origText;
                btn.disabled = false;
            }
            showAlert('تنبيه', 'حدثت مشكلة أثناء حفظ الصورة. يرجى المحاولة مرة أخرى.');
        });
    } else {
        showAlert('خطأ', 'مكتبة معالجة الصور غير متوفرة حالياً.');
    }
};

window.draftParentMessage = function() {
    const name = document.getElementById('sr-name').innerText;
    const phone = document.getElementById('sr-phone').innerText;
    const cls = document.getElementById('sr-class').innerText;
    const absencesStr = document.getElementById('sr-absences').innerText;
    const absent = parseInt(absencesStr, 10) || 0;

    let msg = '';
    if (absent >= 10) {
        msg = `السلام عليكم ورحمة الله وبركاته،\nالمكرم ولي أمر الطالب: ${name} (الصف: ${cls})\n\nنفيدكم بأن عدد أيام غياب ابنكم بلغ (${absent}) يوماً (سواء كانت متصلة أو منفصلة).\nونظراً لبلوغ الحد الحرج، وتطبيقاً لتنظيم وزارة التعليم، نأمل منكم الحضور العاجل إلى المدرسة لمقابلة إدارة المدرسة والتوجيه الطلابي قبل استكمال الإجراءات النظامية المعتمدة ومخاطبة الجهات ذات الاختصاص حيال تطبيق نظام حماية الطفل ونظام الحماية من الإيذاء ولائحتهما التنفيذية وإشعار إدارة التعليم بذلك.\nنؤكد دائماً حرصنا على استمرارية تقديم الخدمات التعليمية لابنكم وعدم التسبب في انقطاعها.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدير المدرسة: أحمد بن ناصر الدوسري\nمدرسة الجشة المتوسطة`;
    } else if (absent >= 5) {
        msg = `السلام عليكم ورحمة الله وبركاته،\nالمكرم ولي أمر الطالب: ${name} (الصف: ${cls})\n\nنفيدكم بأن عدد أيام غياب ابنكم بلغ (${absent}) أيام (سواء كانت متصلة أو منفصلة).\nوحيث لم يتم الالتزام بالخطة التربوية (خطة التعلم في أيام الغياب)، فقد تمت إحالة الطالب إلى لجنة التوجيه الطلابي بالمدرسة. ونرجو منكم الحضور للمدرسة لحضور جلسة توعوية للتأكيد على أهمية اتباع الخطط التربوية والعلاجية واستمرارية تقديم الخدمات التعليمية لابنكم.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة`;
    } else if (absent >= 3) {
        msg = `السلام عليكم ورحمة الله وبركاته،\nالمكرم ولي أمر الطالب: ${name} (الصف: ${cls})\n\nنفيدكم بأن عدد أيام غياب ابنكم بلغ (${absent}) أيام (سواء كانت متصلة أو منفصلة).\nووفق تنظيم وزارة التعليم، تم تحويل الطالب للموجه الطلابي لتقديم الدعم والخدمات التربوية المناسبة له (خطة التعلم في أيام الغياب). ونرجو منكم الحضور للمدرسة لعقد اجتماع حضوري يتضمن إبلاغكم بالإجراءات المترتبة على الغياب وتقييم وتحديث الخطة العلاجية والخدمات التربوية المقدمة لابنكم بما يضمن استمرارية تعليمه وعدم انقطاعه.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة`;
    } else {
        msg = `السلام عليكم ورحمة الله وبركاته،\nالمكرم ولي أمر الطالب: ${name} (الصف: ${cls})\n\nنفيدكم بتغيب ابنكم عن المدرسة لتاريخ اليوم (${currentSelectedDate}).\nنأمل منكم التكرم بإشعارنا بسبب الغياب أو رفع العذر المقبول لتوثيقه، مع تأكيد حرصنا على استمرارية تقديم الخدمات التعليمية لابنكم.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة`;
    }
    
    document.getElementById('aiMessageText').innerText = msg;
    document.getElementById('aiMessageResult').style.display = 'block';

    if (phone && phone.startsWith('05')) {
        const waUrl = `https://wa.me/966${phone.substring(1)}?text=${encodeURIComponent(msg)}`;
        window.open(waUrl, '_blank');
    }
};

window.copyAiMessage = function() {
    const txt = document.getElementById('aiMessageText').innerText;
    navigator.clipboard.writeText(txt).then(() => showAlert('تم', 'تم نسخ نص الرسالة بنجاح'));
};

window.openRiskModal = function() {
    const c = document.getElementById('riskContent');
    let riskList = [];
    students.forEach(s => {
        let count = 0;
        Object.keys(attendanceData).forEach(d => {
            if ((attendanceData[d][s.id] || {}).status === 'absent') count++;
        });
        if (count >= 3) {
            riskList.push({ ...s, count });
        }
    });

    riskList.sort((a, b) => b.count - a.count);

    if (riskList.length === 0) {
        c.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">لا يوجد طلاب تجاوزوا 3 أيام غياب حالياً 🎉</div>`;
    } else {
        let html = `
            <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; color: #065f46;">
                📌 <strong>التنظيم المعتمد لتكرار الغياب:</strong> (3 أيام: تحويل واستدعاء) | (5 أيام: لجنة توجيه وجلسة توعوية) | (10 أيام: إجراءات نظامية وحماية الطفل).
            </div>
            <table style="width:100%; border-collapse:collapse; text-align:right; font-size: 13.5px;">
                <thead>
                    <tr style="border-bottom:2px solid #cbd5e1; background: #f8fafc;">
                        <th style="padding: 8px;">اسم الطالب</th>
                        <th style="padding: 8px;">الصف</th>
                        <th style="padding: 8px; text-align:center;">أيام الغياب</th>
                        <th style="padding: 8px;">المستوى والإجراء المعتمد</th>
                        <th style="padding: 8px; text-align:center;">إجراء</th>
                    </tr>
                </thead>
                <tbody>
        `;
        riskList.forEach(item => {
            let badge = '';
            if (item.count >= 10) {
                badge = '<span style="background: #ffe4e6; color: #9f1239; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 11.5px;">🔴 10 أيام (حماية الطفل)</span>';
            } else if (item.count >= 5) {
                badge = '<span style="background: #ffedd5; color: #c2410c; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 11.5px;">🟠 5 أيام (لجنة التوجيه)</span>';
            } else {
                badge = '<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 11.5px;">🟡 3 أيام (استدعاء ولي الأمر)</span>';
            }
            html += `
                <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding: 8px; font-weight: 700;">${item.name}</td>
                    <td style="padding: 8px;">${item.class}</td>
                    <td style="padding: 8px; text-align:center; color:#e11d48; font-weight:800; font-size:15px;">${item.count}</td>
                    <td style="padding: 8px;">${badge}</td>
                    <td style="padding: 8px; text-align:center;">
                        <button class="btn" style="background: var(--primary); color: white; padding: 4px 8px; font-size: 11.5px;" onclick="window.openStudentRemedialCard('${item.id}', 'absence')">
                            الخطة 📝
                        </button>
                    </td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        c.innerHTML = html;
    }
    openModal('riskModal');
};

window.openPdfPrintModal = function() { openModal('pdfPrintModal'); };

window.printHtmlDocument = function(contentHtml, docTitle = 'تقرير_مدرسي') {
    if (window.showBottomNotification) {
        window.showBottomNotification('جاري فتح أمر الطباعة 🖨️', 'يرجى اختيار الطابعة أو حفظ بتنسيق PDF في نافذة الطباعة', 'info');
    }

    // 1. Populate #printArea for browser @media print
    const printArea = document.getElementById('printArea');
    if (printArea) {
        printArea.innerHTML = contentHtml;
    }

    // 2. Prepare isolated iframe with non-zero dimensions (required by Chrome)
    let iframe = document.getElementById('printIsolatedIframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'printIsolatedIframe';
        iframe.style.position = 'fixed';
        iframe.style.left = '-9999px';
        iframe.style.top = '0';
        iframe.style.width = '1000px';
        iframe.style.height = '1400px';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        document.body.appendChild(iframe);
    }

    const printDoc = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="utf-8">
            <title>${docTitle}</title>
            <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
            <style>
                @page {
                    size: A4 portrait;
                    margin: 8mm 10mm 8mm 10mm;
                }
                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    font-family: 'Tajawal', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }
                :root {
                    --bg-body: #ffffff;
                    --bg-card: #ffffff;
                    --text-main: #0f172a;
                    --text-muted: #475569;
                    --border-color: #cbd5e1;
                    --primary: #1e3a8a;
                    --primary-light: #e0e7ff;
                    --danger: #e11d48;
                    --danger-light: #ffe4e6;
                    --success: #15803d;
                    --success-light: #dcfce7;
                    --warning: #d97706;
                    --warning-light: #fef3c7;
                }
                body {
                    margin: 0;
                    padding: 8px 12px;
                    direction: rtl;
                    text-align: right;
                    color: #0f172a;
                    background: #ffffff;
                    font-size: 13px;
                    line-height: 1.6;
                }
                .official-letterhead {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 2px solid #0f172a;
                    padding-bottom: 10px;
                    margin-bottom: 14px;
                }
                .letterhead-right, .letterhead-left {
                    font-size: 12px;
                    font-weight: 700;
                    line-height: 1.5;
                }
                .letterhead-center {
                    text-align: center;
                }
                .letterhead-center h2 {
                    margin: 0 0 4px 0;
                    font-size: 18px;
                    color: #0f172a;
                    font-weight: 800;
                }
                .letterhead-center .sub {
                    font-size: 12.5px;
                    color: #475569;
                    font-weight: 600;
                }
                .doc-box {
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    padding: 10px 14px;
                    margin-bottom: 12px;
                    background: #f8fafc;
                }
                .html2pdf__page-break {
                    page-break-before: always !important;
                    break-before: page !important;
                    display: block;
                    height: 0;
                    margin: 0;
                    padding: 0;
                    border: none;
                }
                .official-pdf-page {
                    page-break-inside: avoid;
                    break-inside: avoid;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 8px 0;
                }
                th, td {
                    padding: 6px 8px;
                    text-align: right;
                    font-size: 11.5px;
                }
                .sig-container {
                    margin-top: 25px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    font-weight: bold;
                    font-size: 12.5px;
                    page-break-inside: avoid;
                }
                .sig-box {
                    text-align: center;
                    width: 32%;
                }
                @media print {
                    body {
                        padding: 0;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                }
            </style>
        </head>
        <body>
            ${contentHtml}
        </body>
        </html>
    `;

    try {
        const iDoc = iframe.contentWindow.document;
        iDoc.open();
        iDoc.write(printDoc);
        iDoc.close();

        setTimeout(() => {
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (err) {
                console.warn('Iframe print error, falling back to window.print():', err);
                window.print();
            }
        }, 350);
    } catch (e) {
        console.warn('Iframe access error, falling back to window.print():', e);
        window.print();
    }
};

// Universal, rock-solid PDF exporter using html2canvas & jsPDF with blank page detection and print fallback
window.exportHtmlToPdf = async function(htmlContent, filename, customOpt = {}) {
    const jsPdfClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;

    if (!window.html2canvas || !jsPdfClass) {
        console.warn('html2canvas or jsPDF is not available, falling back to direct browser print');
        if (window.showBottomNotification) {
            window.showBottomNotification('طباعة التقرير 🖨️', 'جاري فتح نافذة الطباعة للحفظ بتنسيق PDF...', 'info');
        }
        window.printHtmlDocument(htmlContent, filename.replace(/\.pdf$/i, ''));
        return;
    }

    if (window.showBottomNotification) {
        window.showBottomNotification('جاري إنشاء ملف PDF 📥', 'يتم معالجة التقرير بدقة عالية بهوية وزارة التعليم...', 'info');
    }

    // Helper to verify canvas actually contains rendered pixels (not a blank white rectangle)
    function isCanvasBlank(canvas) {
        if (!canvas || !canvas.width || !canvas.height) return true;
        try {
            const ctx = canvas.getContext('2d');
            const stepX = Math.max(1, Math.floor(canvas.width / 20));
            const stepY = Math.max(1, Math.floor(canvas.height / 20));
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let nonWhitePixels = 0;
            for (let y = stepY; y < canvas.height - stepY; y += stepY) {
                for (let x = stepX; x < canvas.width - stepX; x += stepX) {
                    const idx = (y * canvas.width + x) * 4;
                    const r = imgData[idx];
                    const g = imgData[idx + 1];
                    const b = imgData[idx + 2];
                    const a = imgData[idx + 3];
                    if (a > 30 && (r < 245 || g < 245 || b < 245)) {
                        nonWhitePixels++;
                        if (nonWhitePixels > 4) return false; // Contains genuine content!
                    }
                }
            }
            return nonWhitePixels <= 4;
        } catch (e) {
            // In case of any cross-origin restrictions, do not treat as blank
            return false;
        }
    }

    // Create an isolated, visible render container in document.body
    const renderContainer = document.createElement('div');
    renderContainer.id = 'cleanPdfExportContainer_' + Date.now();
    renderContainer.style.position = 'fixed';
    renderContainer.style.top = '0';
    renderContainer.style.left = '0';
    renderContainer.style.width = '794px'; // Exactly 210mm at standard 96 DPI
    renderContainer.style.background = '#ffffff';
    renderContainer.style.color = '#0f172a';
    renderContainer.style.margin = '0';
    renderContainer.style.padding = customOpt.padding || '0';
    renderContainer.style.boxSizing = 'border-box';
    renderContainer.style.direction = 'rtl';
    renderContainer.style.textAlign = 'right';
    renderContainer.style.fontFamily = "'Tajawal', Arial, Tahoma, sans-serif";
    renderContainer.style.zIndex = '999999999';
    renderContainer.style.opacity = '1';
    renderContainer.style.visibility = 'visible';
    renderContainer.style.pointerEvents = 'none';

    if (typeof htmlContent === 'string') {
        renderContainer.innerHTML = htmlContent;
    } else if (htmlContent instanceof HTMLElement) {
        renderContainer.appendChild(htmlContent.cloneNode(true));
    }

    document.body.appendChild(renderContainer);

    try {
        // Wait for web fonts & DOM layout
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }
        await new Promise(r => setTimeout(r, 150));

        const pageElements = renderContainer.querySelectorAll('.official-pdf-page');

        const doc = new jsPdfClass({
            orientation: customOpt.orientation || 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true
        });

        const pageWidthMm = 210;
        const pageHeightMm = 297;
        const marginX = (customOpt.margin && customOpt.margin[1] !== undefined) ? customOpt.margin[1] : 4;
        const marginY = (customOpt.margin && customOpt.margin[0] !== undefined) ? customOpt.margin[0] : 4;
        const availableWidthMm = pageWidthMm - (marginX * 2);
        const availableHeightMm = pageHeightMm - (marginY * 2);

        if (pageElements && pageElements.length > 0) {
            // Render structured pages individually
            for (let i = 0; i < pageElements.length; i++) {
                const pageEl = pageElements[i];
                if (i > 0) doc.addPage();

                const canvas = await window.html2canvas(pageEl, {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: false,
                    windowWidth: 794
                });

                if (isCanvasBlank(canvas)) {
                    console.warn(`Canvas for page ${i + 1} was detected as blank white.`);
                    throw new Error('BLANK_CANVAS_DETECTED');
                }

                const imgData = canvas.toDataURL('image/jpeg', 0.96);
                const aspect = canvas.height / canvas.width;
                let imgW = availableWidthMm;
                let imgH = imgW * aspect;
                if (imgH > availableHeightMm) {
                    imgH = availableHeightMm;
                    imgW = imgH / aspect;
                }
                const posX = marginX + ((availableWidthMm - imgW) / 2);
                const posY = marginY;

                doc.addImage(imgData, 'JPEG', posX, posY, imgW, imgH);
            }
        } else {
            // Single container or continuous report
            const canvas = await window.html2canvas(renderContainer, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false,
                windowWidth: 794,
                width: renderContainer.offsetWidth || 794,
                height: renderContainer.offsetHeight || renderContainer.scrollHeight
            });

            if (isCanvasBlank(canvas)) {
                console.warn('Rendered canvas was detected as blank white.');
                throw new Error('BLANK_CANVAS_DETECTED');
            }

            const totalHeightMm = (canvas.height / canvas.width) * availableWidthMm;

            if (totalHeightMm <= availableHeightMm) {
                // Single page fits entirely
                const imgData = canvas.toDataURL('image/jpeg', 0.96);
                doc.addImage(imgData, 'JPEG', marginX, marginY, availableWidthMm, totalHeightMm);
            } else {
                // Multi-page slicing
                const pageHeightInCanvasPx = (availableHeightMm / availableWidthMm) * canvas.width;
                let currentY = 0;
                let pageIndex = 0;

                while (currentY < canvas.height) {
                    if (pageIndex > 0) doc.addPage();
                    const sliceH = Math.min(pageHeightInCanvasPx, canvas.height - currentY);
                    const sliceCanvas = document.createElement('canvas');
                    sliceCanvas.width = canvas.width;
                    sliceCanvas.height = sliceH;
                    const sCtx = sliceCanvas.getContext('2d');
                    sCtx.fillStyle = '#ffffff';
                    sCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                    sCtx.drawImage(canvas, 0, currentY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

                    const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.96);
                    const sliceHeightMm = (sliceH / canvas.width) * availableWidthMm;
                    doc.addImage(sliceData, 'JPEG', marginX, marginY, availableWidthMm, sliceHeightMm);

                    currentY += sliceH;
                    pageIndex++;
                }
            }
        }

        // Save PDF directly to user's device
        doc.save(filename);

        if (window.showBottomNotification) {
            window.showBottomNotification('تم تصدير PDF بنجاح ✅', `تم حفظ وتنزيل الملف: ${filename}`, 'success');
        }
    } catch (err) {
        console.error('Direct PDF export error, triggering native print-to-PDF:', err);
        if (window.showBottomNotification) {
            window.showBottomNotification('جاري فتح الطباعة للحفظ كـ PDF 🖨️', 'سيتم فتح نافذة الطباعة الرسمية لاختيار "حفظ كـ PDF" بجودة فائقة', 'warning');
        }
        window.printHtmlDocument(htmlContent, filename.replace(/\.pdf$/i, ''));
    } finally {
        if (renderContainer.parentNode) {
            renderContainer.parentNode.removeChild(renderContainer);
        }
    }
};

function getDailyAttendanceOfficialHtml() {
    const filtered = getFilteredStudents();
    const totalStudents = filtered.length;
    const summary = calculateDailySummary();

    let pages = [];
    if (totalStudents <= 18) {
        pages.push({
            pageNumber: 1,
            totalPages: 1,
            isFirst: true,
            isLast: true,
            rows: filtered
        });
    } else {
        const page1Count = 15;
        const page1Students = filtered.slice(0, page1Count);
        const remainingStudents = filtered.slice(page1Count);
        const perPage = 20;
        const subPages = [];
        for (let i = 0; i < remainingStudents.length; i += perPage) {
            subPages.push(remainingStudents.slice(i, i + perPage));
        }
        const totalPages = 1 + subPages.length;

        pages.push({
            pageNumber: 1,
            totalPages: totalPages,
            isFirst: true,
            isLast: false,
            rows: page1Students
        });

        subPages.forEach((list, idx) => {
            const pageNum = idx + 2;
            pages.push({
                pageNumber: pageNum,
                totalPages: totalPages,
                isFirst: false,
                isLast: pageNum === totalPages,
                rows: list
            });
        });
    }

    let fullHtml = `<div style="direction: rtl; text-align: right; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; color: #0f172a; background: #ffffff; width: 794px; margin: 0; padding: 0;">`;

    pages.forEach((page) => {
        const startIdx = page.isFirst ? 0 : (15 + (page.pageNumber - 2) * 20);
        
        let rowsHtml = '';
        page.rows.forEach((s, idx) => {
            const rowNum = startIdx + idx + 1;
            const att = attendanceData[s.id] || { status: 'none', excuse: '', notes: '' };
            let statusText = 'غير مسجل';
            let statusColor = '#64748b';
            let statusBg = '#f8fafc';
            if (att.status === 'present') { statusText = 'حاضر ✓'; statusColor = '#008375'; statusBg = '#f0fdf4'; }
            else if (att.status === 'absent') { statusText = 'غائب ✗'; statusColor = '#dc2626'; statusBg = '#fef2f2'; }
            else if (att.status === 'late') { statusText = 'متأخر ⏰'; statusColor = '#d97706'; statusBg = '#fffbeb'; }

            rowsHtml += `<tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                <td style="text-align:center; padding: 5px 6px; border: 1px solid #cbd5e1; font-size: 11px;">${rowNum}</td>
                <td style="padding: 5px 8px; border: 1px solid #cbd5e1; font-size: 11px;"><strong>${s.name}</strong></td>
                <td style="text-align:center; padding: 5px 6px; border: 1px solid #cbd5e1; font-size: 11px;">${s.class}</td>
                <td style="text-align:center; padding: 5px 6px; border: 1px solid #cbd5e1; font-size: 11px; font-family: Arial, sans-serif;">${s.nationalId}</td>
                <td style="text-align:center; color:${statusColor}; background:${statusBg}; font-weight:bold; padding: 5px 6px; border: 1px solid #cbd5e1; font-size: 11px;">${statusText}</td>
                <td style="padding: 5px 8px; border: 1px solid #cbd5e1; font-size: 10.5px; color: #334155;">${att.excuse || att.notes || '-'}</td>
            </tr>`;
        });

        fullHtml += `
            <div class="official-pdf-page" style="page-break-inside: avoid; break-inside: avoid; background: #ffffff; padding: 14px 18px; margin: 0; box-sizing: border-box; width: 794px;">
        `;

        if (page.isFirst) {
            fullHtml += `
                <!-- الترويسة الوزارية الرسمية المعتمدة -->
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                    <tr>
                        <td style="text-align: right; width: 33%; font-size: 10.5pt; font-weight: bold; line-height: 1.5; color: #00675b; vertical-align: top;">
                            المملكة العربية السعودية<br>
                            وزارة التعليم<br>
                            الإدارة العامة للتعليم بمحافظة الأحساء<br>
                            مدرسة الجشة المتوسطة
                        </td>
                        <td style="text-align: center; width: 34%; vertical-align: top; padding: 0 4px;">
                            <div style="font-size: 15pt; font-weight: 800; color: #008375; margin-bottom: 3px;">
                                كشف الحضور والغياب اليومي
                            </div>
                            <div style="font-size: 10.5pt; color: #1e293b; font-weight: 700; margin-bottom: 2px;">
                                <span>التاريخ:</span>
                                <span dir="ltr" style="display: inline-block; font-family: Arial, sans-serif; font-weight: bold; color: #00675b; padding: 0 3px;">${currentSelectedDate}</span>
                            </div>
                            <div style="font-size: 10pt; color: #475569; font-weight: 600;">
                                <span>الصف / الفصل:</span> <span style="color: #008375; font-weight: bold;">${currentSelectedClass === 'all' ? 'جميع الفصول' : currentSelectedClass}</span>
                            </div>
                        </td>
                        <td style="text-align: left; width: 33%; font-size: 10pt; line-height: 1.6; color: #334155; vertical-align: top;">
                            <div><span>الموجه الطلابي:</span> <span style="font-weight: bold; color: #0f172a;">عبدالهادي المحسن</span></div>
                            <div><span>مدير المدرسة:</span> <span style="font-weight: bold; color: #0f172a;">أحمد بن ناصر الدوسري</span></div>
                            <div style="font-size: 9pt; color: #64748b;">صفحة ${page.pageNumber} من ${page.totalPages}</div>
                        </td>
                    </tr>
                </table>

                <!-- الشريط الزخرفي لهوية الوزارة -->
                <div style="height: 3px; background: linear-gradient(90deg, #008375, #d97706); margin-bottom: 10px; border-radius: 2px;"></div>

                <!-- شريط الإحصائيات الموجزة -->
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px;">
                    <tr>
                        <td style="padding: 7px 10px; text-align: center; font-size: 11px; font-weight: 800; color: #0f172a; border-left: 1px solid #e2e8f0;">
                            إجمالي الطلاب: <span style="color: #008375;">${summary.total}</span>
                        </td>
                        <td style="padding: 7px 10px; text-align: center; font-size: 11px; font-weight: 800; color: #008375; border-left: 1px solid #e2e8f0;">
                            الحضور: <span>${summary.present}</span> (${summary.presentRate}%)
                        </td>
                        <td style="padding: 7px 10px; text-align: center; font-size: 11px; font-weight: 800; color: #dc2626; border-left: 1px solid #e2e8f0;">
                            الغياب: <span>${summary.absent}</span> (${summary.absentRate}%)
                        </td>
                        <td style="padding: 7px 10px; text-align: center; font-size: 11px; font-weight: 800; color: #d97706;">
                            التأخر: <span>${summary.late}</span> (${summary.lateRate}%)
                        </td>
                    </tr>
                </table>
            `;
        } else {
            fullHtml += `
                <!-- ترويسة مختصرة للصفحات اللاحقة -->
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 2px solid #008375;">
                    <tr>
                        <td style="text-align: right; width: 40%; font-size: 9.5pt; font-weight: bold; color: #00675b;">
                            مدرسة الجشة المتوسطة | كشف الحضور والغياب اليومي (${currentSelectedDate})
                        </td>
                        <td style="text-align: center; width: 30%; font-size: 9.5pt; font-weight: bold; color: #475569;">
                            الصف: ${currentSelectedClass === 'all' ? 'جميع الفصول' : currentSelectedClass}
                        </td>
                        <td style="text-align: left; width: 30%; font-size: 9pt; color: #64748b;">
                            صفحة ${page.pageNumber} من ${page.totalPages}
                        </td>
                    </tr>
                </table>
            `;
        }

        fullHtml += `
            <!-- جدول الطلاب -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                <thead>
                    <tr style="background: #00675b; color: #ffffff;">
                        <th style="width: 5%; text-align:center; padding: 6px 4px; font-size: 11px; border: 1px solid #005a4f;">م</th>
                        <th style="width: 28%; text-align:right; padding: 6px 8px; font-size: 11px; border: 1px solid #005a4f;">اسم الطالب</th>
                        <th style="width: 14%; text-align:center; padding: 6px 4px; font-size: 11px; border: 1px solid #005a4f;">الصف</th>
                        <th style="width: 16%; text-align:center; padding: 6px 4px; font-size: 11px; border: 1px solid #005a4f;">السجل المدني</th>
                        <th style="width: 13%; text-align:center; padding: 6px 4px; font-size: 11px; border: 1px solid #005a4f;">الحالة</th>
                        <th style="width: 24%; text-align:right; padding: 6px 8px; font-size: 11px; border: 1px solid #005a4f;">العذر والملاحظات</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;

        if (page.isLast) {
            fullHtml += `
                <!-- التوقيعات الرسمية المعتمدة -->
                <div style="margin-top: 18px; padding-top: 10px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: flex-start; font-weight: bold; font-size: 11.5px; page-break-inside: avoid;">
                    <div style="text-align: center; width: 32%;">
                        <div style="color: #475569; margin-bottom: 4px;">الموجه الطلابي</div>
                        <div style="color: #00675b; font-size: 12px;">عبدالهادي بن محمد المحسن</div>
                    </div>
                    <div style="text-align: center; width: 32%;">
                        <div style="color: #475569; margin-bottom: 4px;">الختم الرسمي للمدرسة</div>
                        <div style="border: 1px dashed #cbd5e1; width: 75px; height: 50px; margin: 0 auto; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #94a3b8;">محل الختم</div>
                    </div>
                    <div style="text-align: center; width: 32%;">
                        <div style="color: #475569; margin-bottom: 4px;">مدير المدرسة</div>
                        <div style="color: #00675b; font-size: 12px;">أحمد بن ناصر الدوسري</div>
                    </div>
                </div>
            `;
        }

        fullHtml += `</div>`; // إغلاق official-pdf-page
    });

    fullHtml += `</div>`;
    return fullHtml;
}

window.executeDirectPrint = function() {
    const html = getDailyAttendanceOfficialHtml();
    window.printHtmlDocument(html, `كشف_الحضور_${currentSelectedDate}`);
};

window.executePdfDownload = function() {
    const html = getDailyAttendanceOfficialHtml();
    if (window.showBottomNotification) {
        window.showBottomNotification('جاري تجهيز التقرير 📥', 'يتم الآن تصدير كشف الحضور بصيغة PDF بدقة عالية...', 'info');
    }
    window.exportHtmlToPdf(html, `تقرير_الحضور_${currentSelectedDate}.pdf`, {
        margin: [5, 5, 5, 5],
        padding: '14px 18px'
    });
};

// Word export template with Saudi Ministry of Education letterhead & Tajawal 10.5pt font
function generateWordLetterhead(title, subtitle = '') {
    return `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
        <meta charset='utf-8'>
        <title>${title}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
            @page {
                size: A4 portrait;
                margin: 1.2cm;
                mso-header-margin: 1cm;
                mso-footer-margin: 1cm;
            }
            body {
                font-family: 'Tajawal', Arial, Tahoma, sans-serif !important;
                font-size: 10.5pt !important;
                direction: rtl;
                text-align: right;
                color: #1e293b;
                line-height: 1.5;
            }
            .header-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
            .header-table td { vertical-align: middle; }
            .content-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 14px;
                font-family: 'Tajawal', Arial, Tahoma, sans-serif !important;
                font-size: 10.5pt !important;
                mso-table-lspace: 0pt;
                mso-table-rspace: 0pt;
            }
            .content-table th {
                background-color: #008375 !important;
                color: #ffffff !important;
                font-family: 'Tajawal', Arial, Tahoma, sans-serif !important;
                font-size: 10.5pt !important;
                font-weight: 700;
                padding: 7px 6px;
                border: 1px solid #00675b;
                text-align: center;
            }
            .content-table td {
                border: 1px solid #cbd5e1;
                padding: 6px 8px;
                font-family: 'Tajawal', Arial, Tahoma, sans-serif !important;
                font-size: 10.5pt !important;
                color: #1e293b;
                vertical-align: middle;
            }
            .content-table tr:nth-child(even) td {
                background-color: #f8fafc;
            }
            .signatures { width: 100%; margin-top: 35px; text-align: center; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; font-size: 10.5pt !important; }
            .signatures td { border: none !important; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; font-size: 10.5pt !important; }
        </style>
        </head>
        <body>
            <table class="header-table" style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                <tr>
                    <td style="text-align: right; width: 33%; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; font-weight: bold; line-height: 1.4; color: #00675b;">
                        المملكة العربية السعودية<br>
                        وزارة التعليم<br>
                        الإدارة العامة للتعليم بمحافظة الأحساء<br>
                        مدرسة الجشة المتوسطة
                    </td>
                    <td style="text-align: center; width: 34%; vertical-align: middle;">
                        <div style="font-family: 'Tajawal', Arial, sans-serif; font-size: 14pt; font-weight: 800; color: #008375; margin-bottom: 4px;">
                            ${title}
                        </div>
                        ${subtitle ? `<div style="font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; color: #475569; font-weight: 600;">${subtitle}</div>` : ''}
                    </td>
                    <td style="text-align: left; width: 33%; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #334155;">
                        <strong>التاريخ:</strong> ${currentSelectedDate}<br>
                        <strong>الموجه الطلابي:</strong> عبدالهادي المحسن
                    </td>
                </tr>
            </table>
            <!-- شريط ألوان وزارة التعليم السعودية (أخضر بترولي + ذهبي) بديل الخط الأسود المفرغ -->
            <table style="width:100%; border-collapse:collapse; margin-bottom: 15px;">
                <tr><td style="height:3.5px; background-color:#008375; border:none; padding:0;"></td></tr>
                <tr><td style="height:1.5px; background-color:#d4af37; border:none; padding:0;"></td></tr>
            </table>
    `;
}

function generateWordFooter() {
    return `
            <table class="signatures" style="width: 100%; margin-top: 35px; border-collapse: collapse; font-family: 'Tajawal', Arial, Tahoma, sans-serif; font-size: 10.5pt;">
                <tr>
                    <td style="width: 33%; text-align: center; border: none; font-size: 10.5pt;">
                        <strong>الموجه الطلابي</strong><br><br>
                        عبدالهادي بن محمد المحسن<br>
                        ...............................
                    </td>
                    <td style="width: 33%; text-align: center; border: none; font-size: 10.5pt;">
                        <strong>وكيل شؤون الطلاب</strong><br><br>
                        ...............................<br>
                        ...............................
                    </td>
                    <td style="width: 33%; text-align: center; border: none; font-size: 10.5pt;">
                        <strong>مدير المدرسة</strong><br><br>
                        ...............................<br>
                        ...............................
                    </td>
                </tr>
            </table>
            <div style="margin-top: 25px; text-align: center; font-size: 9pt; color: #64748b; font-family: 'Tajawal', Arial, sans-serif; border-top: 1px dashed #cbd5e1; padding-top: 8px;">
                نظام رصد الحضور والانضباط المدرسي — مدرسة الجشة المتوسطة — وزارة التعليم
            </div>
        </body>
        </html>
    `;
}

window.exportTodayWordReport = function() {
    let title = `تقرير إحصائية الحضور اليومية (${currentSelectedDate})`;
    let body = generateWordLetterhead(title);
    body += `<table class="content-table"><thead><tr><th>م</th><th>اسم الطالب</th><th>الصف</th><th>الحالة</th><th>وقت الرصد</th></tr></thead><tbody>`;

    const dayRecords = attendanceData[currentSelectedDate] || {};
    students.forEach((s, idx) => {
        const rec = dayRecords[s.id] || { status: 'لم يسجل', time: '-' };
        let stArabic = rec.status === 'present' ? 'حاضر' : (rec.status === 'absent' ? 'غائب' : (rec.status === 'late' ? 'متأخر' : (rec.status === 'excused' ? 'بعذر' : 'لم يسجل')));
        body += `<tr><td>${idx + 1}</td><td>${s.name}</td><td>${s.class}</td><td>${stArabic}</td><td>${rec.time}</td></tr>`;
    });

    body += `</tbody></table>` + generateWordFooter();
    downloadWordDoc(body, `تقرير_اليوم_${currentSelectedDate}.doc`);
};

window.exportRiskReportToWord = function() {
    let title = `تقرير متابعة تكرار الغياب والإجراءات الوزارية المعتمدة`;
    let subtitle = `المستويات المعتمدة: (3 أيام: تحويل واستدعاء) - (5 أيام: لجنة التوجيه) - (10 أيام: حماية الطفل)`;
    let body = generateWordLetterhead(title, subtitle);
    body += `
        <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 14px; margin-bottom: 15px; font-family: 'Tajawal', Arial, sans-serif; font-size: 10pt; line-height: 1.6;">
            <strong>توجيه وزاري معتمد:</strong> يتم التعامل مع الطالب الذي يتكرر غيابه بعذر مقبول (سواء كانت أيام الغياب متصلة أو منفصلة) وفق تنظيم وزارة التعليم، مع التأكيد على التواصل الفوري بنفس اليوم واستمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها.
        </div>
        <table class="content-table">
            <thead>
                <tr>
                    <th style="width: 5%;">م</th>
                    <th style="width: 22%;">اسم الطالب</th>
                    <th style="width: 14%;">السجل المدني</th>
                    <th style="width: 12%;">الصف</th>
                    <th style="width: 13%;">رقم الجوال</th>
                    <th style="width: 10%;">أيام الغياب</th>
                    <th style="width: 24%;">المستوى والإجراء المعتمد</th>
                </tr>
            </thead>
            <tbody>
    `;

    let countIdx = 1;
    const sortedStudents = [...students].map(s => {
        let c = 0;
        Object.keys(attendanceData).forEach(d => {
            if ((attendanceData[d][s.id] || {}).status === 'absent') c++;
        });
        return { ...s, count: c };
    }).filter(s => s.count >= 3).sort((a, b) => b.count - a.count);

    sortedStudents.forEach(s => {
        let actionText = '';
        if (s.count >= 10) {
            actionText = '🔴 10 أيام: مخاطبة جهات الاختصاص (حماية الطفل) وإشعار إدارة التعليم';
        } else if (s.count >= 5) {
            actionText = '🟠 5 أيام: إحالة إلى لجنة التوجيه الطلابي وجلسة توعوية لولي الأمر';
        } else {
            actionText = '🟡 3 أيام: تحويل للموجه واستدعاء ولي الأمر لاجتماع حضوري';
        }
        body += `<tr><td style="text-align: center;">${countIdx++}</td><td><strong>${s.name}</strong></td><td>${s.nationalId}</td><td>${s.class}</td><td style="direction: ltr; text-align: right;">${s.phone}</td><td style="color:#b91c1c; font-weight:bold; text-align: center; font-size: 12pt;">${s.count}</td><td style="font-size: 9.5pt;">${actionText}</td></tr>`;
    });

    body += `</tbody></table>` + generateWordFooter();
    downloadWordDoc(body, `تقرير_متابعة_تكرار_الغياب_${currentSelectedDate}.doc`);
};

window.exportGeneralReportToWord = function() {
    window.exportTodayWordReport();
};

window.exportDateRangeToWord = function() {
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const cls = document.getElementById('rangeClassFilter').value;
    
    if (!from || !to) {
        if (window.showAlert) {
            showAlert('تنبيه', 'يرجى تحديد تاريخ البداية والنهاية أولاً.');
        } else {
            alert('يرجى تحديد تاريخ البداية والنهاية أولاً.');
        }
        return;
    }

    const reportData = getDateRangeReportData(from, to, cls);
    const title = `تقرير إحصائية غياب الطلاب للفترة من ${from} إلى ${to}`;
    const subtitle = `الفصل: ${reportData.classLabel} — مجموع أيام الغياب: ${reportData.totalAbsentDays} يوم`;

    let body = generateWordLetterhead(title, subtitle);
    body += buildDateRangeReportHtml(reportData, true);
    body += generateWordFooter();
    
    downloadWordDoc(body, `تقرير_إحصائية_الغياب_من_${from}_إلى_${to}.doc`);
};

function buildDateRangeOfficialDocumentHtml(reportData, title) {
    const students = reportData.students || [];
    const totalStudents = students.length;

    // Split rows into clean logical pages to guarantee pristine layout & no awkward page breaks
    // Page 1: Ministry Letterhead + Dual Brand Stripes + 4 Summary Cards + Table Header + up to 13 students
    // Subsequent pages: Compact Official Sub-Header + Brand Stripe + Table Header + up to 18 students
    let pages = [];
    if (totalStudents <= 15) {
        pages.push({
            pageNumber: 1,
            totalPages: 1,
            isFirst: true,
            isLast: true,
            rows: students
        });
    } else {
        const page1Count = 13;
        const page1Students = students.slice(0, page1Count);
        const remainingStudents = students.slice(page1Count);
        const perPage = 18;
        const subPages = [];
        for (let i = 0; i < remainingStudents.length; i += perPage) {
            subPages.push(remainingStudents.slice(i, i + perPage));
        }
        const totalPages = 1 + subPages.length;

        pages.push({
            pageNumber: 1,
            totalPages: totalPages,
            isFirst: true,
            isLast: false,
            rows: page1Students
        });

        subPages.forEach((list, idx) => {
            const pageNum = idx + 2;
            pages.push({
                pageNumber: pageNum,
                totalPages: totalPages,
                isFirst: false,
                isLast: pageNum === totalPages,
                rows: list
            });
        });
    }

    let fullHtml = `
        <div style="direction: rtl; text-align: right; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; color: #0f172a; background: #ffffff; width: 794px; margin: 0; padding: 0;">
    `;

    pages.forEach((page) => {
        if (!page.isFirst) {
            fullHtml += `
                <div class="html2pdf__page-break" style="page-break-before: always; break-before: page; margin: 0; padding: 0; height: 0; line-height: 0;"></div>
            `;
        }

        fullHtml += `
            <div class="official-pdf-page" style="page-break-inside: avoid; break-inside: avoid; background: #ffffff; padding: 8px 14px; margin: 0; box-sizing: border-box; width: 794px;">
        `;

        if (page.isFirst) {
            fullHtml += `
                <!-- الترويسة الوزارية المعتمدة للصفحة الأولى -->
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                    <tr>
                        <td style="text-align: right; width: 33%; font-size: 10.5pt; font-weight: bold; line-height: 1.5; color: #00675b; vertical-align: top;">
                            المملكة العربية السعودية<br>
                            وزارة التعليم<br>
                            الإدارة العامة للتعليم بمحافظة الأحساء<br>
                            مدرسة الجشة المتوسطة
                        </td>
                        <td style="text-align: center; width: 34%; vertical-align: top; padding: 0 4px;">
                            <div style="font-size: 14.5pt; font-weight: 800; color: #008375; margin-bottom: 4px;">
                                تقرير إحصائية غياب الطلاب
                            </div>
                            <div style="font-size: 10.5pt; color: #1e293b; font-weight: 700; margin-bottom: 3px;">
                                <span>الفترة من:</span>
                                <span dir="ltr" style="display: inline-block; font-family: Arial, sans-serif; font-weight: bold; color: #00675b; padding: 0 3px;">${reportData.from}</span>
                                <span>إلى:</span>
                                <span dir="ltr" style="display: inline-block; font-family: Arial, sans-serif; font-weight: bold; color: #00675b; padding: 0 3px;">${reportData.to}</span>
                            </div>
                            <div style="font-size: 10pt; color: #475569; font-weight: 600;">
                                <span>الصف / الفصل:</span> <span style="color: #008375; font-weight: bold;">${reportData.classLabel}</span>
                            </div>
                        </td>
                        <td style="text-align: left; width: 33%; font-size: 10pt; line-height: 1.6; color: #334155; vertical-align: top;">
                            <div><span>تاريخ التقرير:</span> <span dir="ltr" style="font-family: Arial, sans-serif; font-weight: bold;">${currentSelectedDate}</span></div>
                            <div><span>الموجه الطلابي:</span> <span style="font-weight: bold;">عبدالهادي المحسن</span></div>
                        </td>
                    </tr>
                </table>

                <!-- شريط الهوية البصرية لوزارة التعليم (أخضر بترولي + ذهبي) -->
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">
                    <tr><td style="height: 3.5px; background-color: #008375; border: none; padding: 0;"></td></tr>
                    <tr><td style="height: 1.5px; background-color: #d4af37; border: none; padding: 0;"></td></tr>
                </table>

                <!-- بطاقات ملخص إحصائية الفترة بتصميم رأسي واضح ومتقن -->
                <table style="width: 100%; border-collapse: separate; border-spacing: 6px; margin-bottom: 12px; text-align: center;">
                    <tr>
                        <td style="background-color: #f0fdf4; border: 1.5px solid #008375; border-radius: 6px; padding: 7px 6px; width: 25%;">
                            <div style="font-size: 9.5pt; color: #00675b; font-weight: 700; margin-bottom: 2px;">نطاق الفترة</div>
                            <div dir="ltr" style="font-size: 9.5pt; font-weight: bold; color: #0f172a; font-family: Arial, sans-serif;">${reportData.from} &rarr; ${reportData.to}</div>
                        </td>
                        <td style="background-color: #f0fdf4; border: 1.5px solid #008375; border-radius: 6px; padding: 7px 6px; width: 25%;">
                            <div style="font-size: 9.5pt; color: #00675b; font-weight: 700; margin-bottom: 2px;">الفصل المحدد</div>
                            <div style="font-size: 10pt; font-weight: bold; color: #0f172a;">${reportData.classLabel}</div>
                        </td>
                        <td style="background-color: #f0fdf4; border: 1.5px solid #008375; border-radius: 6px; padding: 7px 6px; width: 25%;">
                            <div style="font-size: 9.5pt; color: #00675b; font-weight: 700; margin-bottom: 2px;">الطلاب الغائبون</div>
                            <div style="font-size: 11.5pt; font-weight: 800; color: #008375;">${reportData.totalStudentsWithAbsence} <span style="font-size: 9pt; font-weight: normal;">طالب</span></div>
                        </td>
                        <td style="background-color: #fef2f2; border: 1.5px solid #ef4444; border-radius: 6px; padding: 7px 6px; width: 25%;">
                            <div style="font-size: 9.5pt; color: #b91c1c; font-weight: 700; margin-bottom: 2px;">مجموع أيام الغياب</div>
                            <div style="font-size: 11.5pt; font-weight: 800; color: #b91c1c;">${reportData.totalAbsentDays} <span style="font-size: 9pt; font-weight: normal;">يوم</span></div>
                        </td>
                    </tr>
                </table>
            `;
        } else {
            fullHtml += `
                <!-- ترويسة مختصرة ومرتبة للصفحات التابعة -->
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
                    <tr>
                        <td style="text-align: right; width: 33%; font-size: 9.5pt; font-weight: bold; color: #00675b;">
                            مدرسة الجشة المتوسطة — وزارة التعليم
                        </td>
                        <td style="text-align: center; width: 34%; font-size: 10.5pt; font-weight: bold; color: #008375;">
                            تقرير إحصائية غياب الطلاب (تابع)
                        </td>
                        <td style="text-align: left; width: 33%; font-size: 9pt; color: #475569;">
                            الفصل: <strong>${reportData.classLabel}</strong> | صفحة ${page.pageNumber} من ${page.totalPages}
                        </td>
                    </tr>
                </table>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                    <tr><td style="height: 2px; background-color: #008375; border: none; padding: 0;"></td></tr>
                </table>
            `;
        }

        // جدول الطلاب مع تكرار ترويسة الأعمدة في كل صفحة
        fullHtml += `
            <table style="width: 100%; border-collapse: collapse; border: 1.5px solid #008375; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; font-size: 10pt !important; margin-top: 4px;">
                <thead>
                    <tr style="background-color: #008375; color: #ffffff;">
                        <th style="background-color: #008375; color: #ffffff; border: 1px solid #00675b; padding: 7px 5px; text-align: center; width: 35px; font-weight: bold;">م</th>
                        <th style="background-color: #008375; color: #ffffff; border: 1px solid #00675b; padding: 7px 10px; text-align: right; font-weight: bold;">اسم الطالب</th>
                        <th style="background-color: #008375; color: #ffffff; border: 1px solid #00675b; padding: 7px 6px; text-align: center; width: 90px; font-weight: bold;">الصف</th>
                        <th style="background-color: #008375; color: #ffffff; border: 1px solid #00675b; padding: 7px 6px; text-align: center; width: 80px; font-weight: bold;">أيام الغياب</th>
                        <th style="background-color: #008375; color: #ffffff; border: 1px solid #00675b; padding: 7px 8px; text-align: center; font-weight: bold;">تواريخ الغياب في الفترة</th>
                    </tr>
                </thead>
                <tbody>
        `;

        page.rows.forEach((row, idx) => {
            const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            const datesFormatted = row.dates && row.dates.length > 0 ? row.dates.join(' ، ') : '-';
            fullHtml += `
                <tr style="background-color: ${bg};">
                    <td style="border: 1px solid #cbd5e1; padding: 5px 4px; text-align: center; font-weight: bold; color: #475569;">${row.index}</td>
                    <td style="border: 1px solid #cbd5e1; padding: 5px 10px; text-align: right; font-weight: bold; color: #0f172a;">${row.student.name}</td>
                    <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; color: #334155;">${row.student.class || '-'}</td>
                    <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; font-weight: bold; color: #b91c1c;">${row.absentDays}</td>
                    <td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; font-size: 9pt; color: #475569; direction: ltr; font-family: Arial, sans-serif;">${datesFormatted}</td>
                </tr>
            `;
        });

        fullHtml += `
                </tbody>
        `;

        if (page.isLast) {
            fullHtml += `
                <tfoot>
                    <tr style="background-color: #e6f4f2; font-weight: bold;">
                        <td colspan="3" style="border: 1.5px solid #008375; padding: 7px 10px; text-align: right; color: #00675b; font-size: 10pt;">
                            إجمالي عدد الطلاب المتغيبين في الفترة: <strong>${reportData.totalStudentsWithAbsence} طالب</strong>
                        </td>
                        <td style="border: 1.5px solid #008375; padding: 7px 6px; text-align: center; color: #b91c1c; font-weight: bold; font-size: 11pt;">
                            ${reportData.totalAbsentDays}
                        </td>
                        <td style="border: 1.5px solid #008375; padding: 7px 8px; text-align: center; color: #00675b; font-size: 10pt;">
                            مجموع أيام الغياب للفترة
                        </td>
                    </tr>
                </tfoot>
            `;
        }

        fullHtml += `
            </table>
        `;

        if (page.isLast) {
            fullHtml += `
                <!-- شريط التواقيع الوزاري المعتمد -->
                <table style="width: 100%; margin-top: 25px; border-collapse: collapse; text-align: center; font-family: 'Tajawal', Arial, sans-serif; font-size: 10.5pt; page-break-inside: avoid; break-inside: avoid;">
                    <tr>
                        <td style="width: 33%; border: none; font-size: 10.5pt;">
                            <strong>الموجه الطلابي</strong><br><br>
                            عبدالهادي بن محمد المحسن<br>
                            ...............................
                        </td>
                        <td style="width: 33%; border: none; font-size: 10.5pt;">
                            <strong>وكيل شؤون الطلاب</strong><br><br>
                            ...............................<br>
                            ...............................
                        </td>
                        <td style="width: 33%; border: none; font-size: 10.5pt;">
                            <strong>مدير المدرسة</strong><br><br>
                            أحمد بن ناصر الدوسري<br>
                            ...............................
                        </td>
                    </tr>
                </table>

                <div style="margin-top: 18px; text-align: center; font-size: 8.5pt; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
                    نظام رصد الحضور والانضباط المدرسي — مدرسة الجشة المتوسطة — وزارة التعليم
                </div>
            `;
        } else {
            fullHtml += `
                <div style="margin-top: 10px; text-align: center; font-size: 8.5pt; color: #64748b;">
                    صفحة ${page.pageNumber} من ${page.totalPages}
                </div>
            `;
        }

        fullHtml += `
            </div>
        `;
    });

    fullHtml += `
        </div>
    `;

    return fullHtml;
}

window.exportDateRangeToPdf = function() {
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const cls = document.getElementById('rangeClassFilter').value;

    if (!from || !to) {
        if (window.showAlert) {
            showAlert('تنبيه', 'يرجى تحديد تاريخ البداية والنهاية أولاً.');
        } else {
            alert('يرجى تحديد تاريخ البداية والنهاية أولاً.');
        }
        return;
    }

    const reportData = getDateRangeReportData(from, to, cls);
    const title = `تقرير إحصائية غياب الطلاب للفترة من ${from} إلى ${to}`;
    const filename = `تقرير_إحصائية_الغياب_من_${from}_إلى_${to}.pdf`;

    if (window.showBottomNotification) {
        window.showBottomNotification('جاري إنشاء ملف PDF 📥', 'يتم الآن تصدير تقرير منسق بدقة عالية، يرجى الانتظار...', 'info');
    }

    const docHtml = buildDateRangeOfficialDocumentHtml(reportData, title);

    window.exportHtmlToPdf(docHtml, filename, {
        margin: [4, 4, 4, 4],
        padding: '0px',
        pagebreak: {
            mode: ['css', 'legacy'],
            before: '.html2pdf__page-break'
        }
    });
};

window.printDateRangeReport = function() {
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const cls = document.getElementById('rangeClassFilter').value;

    if (!from || !to) {
        if (window.showAlert) {
            showAlert('تنبيه', 'يرجى تحديد تاريخ البداية والنهاية أولاً.');
        } else {
            alert('يرجى تحديد تاريخ البداية والنهاية أولاً.');
        }
        return;
    }

    const reportData = getDateRangeReportData(from, to, cls);
    const title = `تقرير إحصائية غياب الطلاب للفترة من ${from} إلى ${to}`;
    const printableHtml = buildDateRangeOfficialDocumentHtml(reportData, title);

    window.printHtmlDocument(printableHtml, `تقرير_إحصائية_الغياب_${from}_إلى_${to}`);
};

window.exportExcusesToWord = function() {
    let title = `تقرير الأعذار والمبررات المرفوعة`;
    let body = generateWordLetterhead(title);
    body += `<table class="content-table"><thead><tr><th>م</th><th>اسم الطالب</th><th>الصف</th><th>التاريخ</th><th>نوع العذر</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>`;

    cloudExcuses.forEach((e, idx) => {
        let stArabic = e.status === 'accepted' ? 'مقبول' : (e.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة');
        body += `<tr><td>${idx + 1}</td><td>${e.studentName}</td><td>${e.studentClass}</td><td>${e.date}</td><td>${e.type}</td><td>${stArabic}</td><td>${e.desc || ''}</td></tr>`;
    });

    body += `</tbody></table>` + generateWordFooter();
    downloadWordDoc(body, `تقرير_الأعذار_${currentSelectedDate}.doc`);
};

function downloadWordDoc(html, filename) {
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// 9.5 Executive Guidance Tools (تنبيهات الغياب، الرسوم البيانية، الخطط العلاجية)
// ==========================================

let currentAlertTab = 'daily';
let currentChartRange = 'today';
let currentAbsRemTab = 'stages';
let currentTardRemTab = 'stages';
let currentIndividualStudentId = null;
let currentIndividualPlanType = 'absence';

let chartStatusInstance = null;
let chartClassInstance = null;
let chartTimelineInstance = null;

function sanitizePhoneNumber(rawPhone) {
    let p = String(rawPhone || '').replace(/[^0-9]/g, '');
    if (p.startsWith('05')) {
        p = '966' + p.substring(1);
    } else if (p.startsWith('5')) {
        p = '966' + p;
    }
    return p;
}

// Helper: Calculate total stats for all students
function getStudentSummary(studentId) {
    let absent = 0, late = 0, present = 0, excused = 0;
    Object.keys(attendanceData).forEach(d => {
        const rec = attendanceData[d][studentId];
        if (rec) {
            if (rec.status === 'absent') {
                if (rec.excuse) {
                    excused++;
                } else {
                    absent++;
                }
            } else if (rec.status === 'excused') {
                excused++;
            } else if (rec.status === 'late') {
                late++;
            } else if (rec.status === 'present') {
                present++;
            }
        }
    });
    return { absent, late, present, excused };
}

// توليد نص رسالة الواتساب الرسمية الموجهة لولي الأمر حسب الحالة
window.generateWhatsAppMessage = function(student, status, timeStr, stats) {
    if (!stats) stats = getStudentSummary(student.id);
    const dateFormatted = formatArabicDate(currentSelectedDate);
    const nowTime = timeStr || new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

    if (status === 'absent') {
        return `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class || '-'})\n\nنفيدكم بغياب ابنكم عن مدرسة الجشة المتوسطة لهذا اليوم (${dateFormatted}).\n[مجموع أيام الغياب التراكمي: ${stats.absent} أيام].\n\nنأمل منكم المتابعة والاطلاع وحث الطالب على الالتزام والمواظبة اليومية، وتزويد المدرسة بالعذر المقبول إن وجد لتوثيقه رسمياً في منصة المدرسة ونظام نور.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - الأحساء\nقسم التوجيه الطلابي`;
    } else if (status === 'late') {
        return `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class || '-'})\n\nنفيدكم بتأخر ابنكم عن الاصطفاف الصباحي وبداية اليوم الدراسي بمدرسة الجشة المتوسطة لهذا اليوم (${dateFormatted}) في تمام الساعة (${nowTime}).\n[مجموع مرات التأخر المسجلة: ${stats.late} مرات].\n\nنظراً لأهمية الطابور الصباحي وحضور الحصة الأولى في التحصيل الدراسي، نأمل منكم حث ابنكم على الحضور المبكر دعماً لانضباطه ومواظبته.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - الأحساء\nقسم التوجيه الطلابي`;
    } else if (status === 'excused') {
        return `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class || '-'})\n\nنفيدكم بأنه تم قيد وتوثيق غياب ابنكم: ${student.name} (الصف: ${student.class || '-'}) لتاريخ (${dateFormatted}) كـ [غياب بعذر مقبول وموثق] في سجلات مدرسة الجشة المتوسطة.\n[مجموع الغياب التراكمي: ${stats.absent} أيام].\n\nشاكرين ومقدرين لكم تواصلكم الفعّال وحرصكم المستمر على توثيق غياب الطالب ومتابعته.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - الأحساء\nقسم التوجيه الطلابي`;
    } else {
        return `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name}\n\nإشعار من مدرسة الجشة المتوسطة بشأن حالة الطالب ليوم (${dateFormatted}).\n\nالموجه الطلابي: عبدالهادي المحسن`;
    }
};

window.sendStudentDirectWhatsApp = function(studentId, status, timeStr) {
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    const stats = getStudentSummary(studentId);
    const message = window.generateWhatsAppMessage(student, status, timeStr, stats);
    const phone = sanitizePhoneNumber(student.phone);

    if (!phone) {
        navigator.clipboard.writeText(message);
        window.showBottomNotification('📱 تم نسخ الرسالة', `رقم جوال الطالب (${student.name}) غير مسجل في النظام. تم نسخ نص الإشعار لتتمكن من إرساله يدوياً.`, 'info', [], 4000);
        return;
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
};

window.showStudentStatusWhatsAppNotification = function(student, status, timeStr) {
    const stats = getStudentSummary(student.id);
    let title = '';
    let type = 'info';

    if (status === 'absent') {
        title = `تم رصد غياب الطالب: ${student.name}`;
        type = 'danger';
    } else if (status === 'late') {
        title = `تم رصد تأخر الطالب: ${student.name}`;
        type = 'warning';
    } else if (status === 'excused') {
        title = `تم رصد غياب بعذر: ${student.name}`;
        type = 'info';
    }

    const phoneDisplay = student.phone ? student.phone : 'غير مسجل';
    const desc = `الفصل: ${student.class || '-'} | 📱 الجوال: ${phoneDisplay} | الغياب التراكمي: ${stats.absent} | التأخر: ${stats.late}`;

    const actions = [
        {
            label: 'إرسال واتساب لولي الأمر 💬',
            className: 'bn-btn bn-btn-whatsapp',
            onClick: () => {
                window.sendStudentDirectWhatsApp(student.id, status, timeStr);
            }
        },
        {
            label: 'نسخ الرسالة 📋',
            className: 'bn-btn bn-btn-secondary',
            onClick: () => {
                const msg = window.generateWhatsAppMessage(student, status, timeStr, stats);
                navigator.clipboard.writeText(msg);
                window.showBottomNotification('تم النسخ بنجاح 📋', 'تم نسخ نص الإشعار إلى الحافظة بنجاح.', 'success', [], 3000);
            }
        }
    ];

    window.showBottomNotification(title, desc, type, actions, 12000);
};

// ------------------------------------------
// A. تنبيهات وإشعارات الغياب
// ------------------------------------------
window.openAbsenceAlertsModal = function() {
    window.switchAlertTab(currentAlertTab || 'daily');
    window.openModal('absenceAlertsModal');
};

window.switchAlertTab = function(tab) {
    currentAlertTab = tab;
    const btnDaily = document.getElementById('alertTabDailyBtn');
    const btnCum = document.getElementById('alertTabCumulativeBtn');
    if (btnDaily && btnCum) {
        if (tab === 'daily') {
            btnDaily.classList.add('active');
            btnCum.classList.remove('active');
        } else {
            btnDaily.classList.remove('active');
            btnCum.classList.add('active');
        }
    }
    renderAbsenceAlerts();
};

function renderAbsenceAlerts() {
    const container = document.getElementById('absenceAlertsContent');
    const countDailySpan = document.getElementById('alertDailyCount');
    const countCumSpan = document.getElementById('alertCumulativeCount');
    if (!container) return;

    const dayRecords = attendanceData[currentSelectedDate] || {};
    const absentToday = students.filter(s => (dayRecords[s.id] || {}).status === 'absent');
    
    // Cumulative students with >= 3 days
    const cumulativeStudents = students.map(s => {
        const stats = getStudentSummary(s.id);
        return { ...s, totalAbsent: stats.absent, totalLate: stats.late };
    }).filter(s => s.totalAbsent >= 1).sort((a, b) => b.totalAbsent - a.totalAbsent);

    const highCumulativeCount = cumulativeStudents.filter(s => s.totalAbsent >= 3).length;

    if (countDailySpan) countDailySpan.innerText = absentToday.length;
    if (countCumSpan) countCumSpan.innerText = highCumulativeCount;

    if (currentAlertTab === 'daily') {
        if (absentToday.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 35px 20px; background: #f0fdf4; border-radius: 12px; border: 1px dashed #86efac; margin: 10px 0;">
                    <div style="font-size: 40px; margin-bottom: 10px;">🌟</div>
                    <h4 style="color: #166534; font-size: 17px; font-weight: 800; margin: 0 0 6px 0;">لا يوجد غياب مسجل لتاريخ اليوم!</h4>
                    <p style="color: #15803d; font-size: 14px; margin: 0;">جميع طلاب المدرسة حاضرون أو لم يتم رصد أي غياب بعد لتاريخ (${currentSelectedDate}).</p>
                </div>
            `;
            return;
        }

        let html = `<div style="display: flex; flex-direction: column; gap: 10px;">`;
        absentToday.forEach(s => {
            const stats = getStudentSummary(s.id);
            const excuse = cloudExcuses.find(e => e.studentName === s.name && e.date === currentSelectedDate);
            const excuseBadge = excuse ? `<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">عذر: ${excuse.type}</span>` : '';

            html += `
                <div style="background: #ffffff; border: 1px solid #fecdd3; border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; box-shadow: var(--shadow-sm);">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <strong style="font-size: 15px; color: var(--text-main);">${s.name}</strong>
                            <span style="background: #f1f5f9; color: var(--text-muted); padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 700;">${s.class}</span>
                            ${excuseBadge}
                        </div>
                        <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 4px; display: flex; gap: 15px; flex-wrap: wrap;">
                            <span>📱 الجوال: <strong style="color: var(--text-main); direction: ltr; display: inline-block;">${s.phone || 'غير مسجل'}</strong></span>
                            <span>📊 الغياب التراكمي: <strong style="color: #e11d48;">${stats.absent} أيام</strong></span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn" style="background: #25d366; color: white; padding: 6px 12px; font-size: 12.5px; font-weight: 700; border: none; display: flex; align-items: center; gap: 5px;" onclick="window.sendStudentAbsenceWhatsApp('${s.id}')">
                            💬 إشعار واتساب
                        </button>
                        <button class="btn" style="background: #f8fafc; color: var(--text-main); border: 1px solid var(--border-color); padding: 6px 10px; font-size: 12.5px; font-weight: 700;" onclick="window.openStudentRemedialCard('${s.id}', 'absence')">
                            📋 خطة العلاج
                        </button>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        container.innerHTML = html;
    } else {
        // Cumulative warnings
        if (cumulativeStudents.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 30px; background: #f8fafc; border-radius: 12px; border: 1px dashed var(--border-color);">
                    <p style="color: var(--text-muted); margin: 0;">لا يوجد طلاب لديهم أيام غياب مسجلة في النظام.</p>
                </div>
            `;
            return;
        }

        let html = `<div style="display: flex; flex-direction: column; gap: 10px;">`;
        cumulativeStudents.forEach(s => {
            let stageBadge = '';
            let borderColor = '#e2e8f0';
            if (s.totalAbsent >= 10) {
                stageBadge = `<span style="background: #ffe4e6; color: #9f1239; padding: 3px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 800;">🔴 10 أيام فأكثر (المستوى 3: حماية الطفل وإدارة التعليم)</span>`;
                borderColor = '#fecdd3';
            } else if (s.totalAbsent >= 5) {
                stageBadge = `<span style="background: #ffedd5; color: #c2410c; padding: 3px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 800;">🟠 5 أيام (المستوى 2: لجنة التوجيه وجلسة توعوية)</span>`;
                borderColor = '#fed7aa';
            } else if (s.totalAbsent >= 3) {
                stageBadge = `<span style="background: #fef3c7; color: #b45309; padding: 3px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 800;">🟡 3 أيام (المستوى 1: تحويل للموجه واستدعاء ولي الأمر)</span>`;
                borderColor = '#fde68a';
            } else {
                stageBadge = `<span style="background: #e0f2fe; color: #0369a1; padding: 3px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 800;">🔵 غياب أولي (تواصل في نفس اليوم)</span>`;
            }

            html += `
                <div style="background: #ffffff; border: 1px solid ${borderColor}; border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <strong style="font-size: 15px; color: var(--text-main);">${s.name}</strong>
                            <span style="background: #f1f5f9; color: var(--text-muted); padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 700;">${s.class}</span>
                            ${stageBadge}
                        </div>
                        <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 4px; display: flex; gap: 15px; flex-wrap: wrap;">
                            <span>السجل: <strong style="color: var(--text-main);">${s.nationalId}</strong></span>
                            <span>إجمالي الغياب: <strong style="color: #e11d48; font-size: 14px;">${s.totalAbsent} يوم</strong> (متصلة أو منفصلة)</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn" style="background: #25d366; color: white; padding: 6px 12px; font-size: 12.5px; font-weight: 700; border: none;" onclick="window.sendStudentAbsenceWhatsApp('${s.id}', true)">
                            💬 إشعار رسمي
                        </button>
                        <button class="btn" style="background: var(--primary); color: white; padding: 6px 12px; font-size: 12.5px; font-weight: 700; border: none;" onclick="window.openStudentRemedialCard('${s.id}', 'absence')">
                            📝 فتح الخطة العلاجية
                        </button>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        container.innerHTML = html;
    }
}

window.sendStudentAbsenceWhatsApp = function(studentId, isCumulative = false) {
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    const stats = getStudentSummary(studentId);
    let phone = sanitizePhoneNumber(student.phone);

    let message = '';
    if (isCumulative) {
        if (stats.absent >= 10) {
            message = `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class})\n\nنفيدكم بأن مجموع أيام غياب ابنكم بلغ (${stats.absent}) يوماً (سواء كانت متصلة أو منفصلة).\nونظراً لبلوغ الحد الحرج، وتطبيقاً لتنظيم وزارة التعليم، نأمل منكم الحضور العاجل لإدارة المدرسة لمقابلة إدارة المدرسة والتوجيه الطلابي قبل استكمال الإجراءات النظامية المعتمدة ومخاطبة الجهات ذات الاختصاص حيال تطبيق نظام حماية الطفل ونظام الحماية من الإيذاء وإشعار إدارة التعليم بذلك.\nنؤكد دائماً حرصنا على استمرارية تقديم الخدمات التعليمية لابنكم.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدير المدرسة: أحمد بن ناصر الدوسري\nمدرسة الجشة المتوسطة - قسم التوجيه الطلابي`;
        } else if (stats.absent >= 5) {
            message = `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class})\n\nنفيدكم بأن مجموع أيام غياب ابنكم بلغ (${stats.absent}) أيام (سواء كانت متصلة أو منفصلة).\nوحيث لم يتم الالتزام بالخطة التربوية (خطة التعلم في أيام الغياب)، فقد تمت إحالة الطالب إلى لجنة التوجيه الطلابي بالمدرسة. ونرجو منكم الحضور لحضور جلسة توعوية للتأكيد على أهمية اتباع الخطط التربوية والعلاجية واستمرارية تقديم الخدمات التعليمية لابنكم.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - قسم التوجيه الطلابي`;
        } else if (stats.absent >= 3) {
            message = `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class})\n\nنفيدكم بأن مجموع أيام غياب ابنكم بلغ (${stats.absent}) أيام (سواء كانت متصلة أو منفصلة).\nووفق تنظيم وزارة التعليم، تم تحويل الطالب للموجه الطلابي لتقديم الدعم والخدمات التربوية المناسبة له (خطة التعلم في أيام الغياب). ونرجو منكم الحضور للمدرسة لعقد اجتماع حضوري يتضمن إبلاغكم بالإجراءات المترتبة على الغياب وتقييم وتحديث الخطة العلاجية والخدمات التربوية المقدمة لابنكم بما يضمن استمرارية تعليمه وعدم انقطاعه.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - قسم التوجيه الطلابي`;
        } else {
            message = `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class})\n\nنفيدكم بأن مجموع أيام غياب ابنكم بلغ (${stats.absent}) أيام. نأمل منكم حث ابنكم على الالتزام والمواظبة اليومية والتواصل مع الموجه الطلابي لبحث أسباب الغياب وتفادي استمرار تكراره.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - قسم التوجيه الطلابي`;
        }
    } else {
        message = `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class})\n\nنفيدكم بتغيب ابنكم عن مدرسة الجشة المتوسطة لهذا اليوم (${currentSelectedDate}) [مجموع أيام الغياب التراكمي: ${stats.absent} أيام].\nنأمل التكرم بالاطلاع والتواصل معنا لإشعارنا بسبب الغياب أو رفع العذر المقبول عبر منصة المدرسة لتوثيقه، مع تأكيد حرصنا على استمرارية تقديم الخدمات التعليمية لابنكم.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - قسم التوجيه الطلابي`;
    }

    if (!phone) {
        navigator.clipboard.writeText(message);
        showBottomNotification('📱 تم نسخ نص التنبيه بنجاح', 'رقم الجوال غير مسجل في النظام، يمكنك لصق الرسالة في واتساب مباشرة.', 'info');
        return;
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
};

window.openAllAbsentWhatsAppDrafts = function() {
    const dayRecords = attendanceData[currentSelectedDate] || {};
    const absentToday = students.filter(s => (dayRecords[s.id] || {}).status === 'absent');
    if (absentToday.length === 0) {
        showBottomNotification('لا يوجد غياب', 'لا يوجد طلاب غائبين في تاريخ اليوم.', 'info');
        return;
    }

    let report = `قائمة رسائل تنبيهات غائبي اليوم (${currentSelectedDate}) بمدرسة الجشة المتوسطة:\n\n`;
    absentToday.forEach((s, idx) => {
        report += `${idx + 1}. الطالب: ${s.name} - الصف: ${s.class} - الجوال: ${s.phone}\n`;
    });
    navigator.clipboard.writeText(report);
    showBottomNotification('📋 تم نسخ حصر الغائبين', `تم نسخ كشف (${absentToday.length}) طالب غائب مع أرقام الجوال بنجاح.`, 'success');
};

window.exportAbsenceAlertsToWord = function() {
    let title = `كشف تنبيهات وإشعارات الغياب المدرسي (${currentSelectedDate})`;
    let body = generateWordLetterhead(title);

    const dayRecords = attendanceData[currentSelectedDate] || {};
    const absentToday = students.filter(s => (dayRecords[s.id] || {}).status === 'absent');

    body += `
        <p style="font-weight: bold; margin-bottom: 10px;">أولاً: قائمة الطلاب الغائبين في تاريخ (${currentSelectedDate}):</p>
        <table class="content-table">
            <thead>
                <tr>
                    <th>م</th>
                    <th>اسم الطالب</th>
                    <th>الصف</th>
                    <th>السجل المدني</th>
                    <th>رقم الجوال</th>
                    <th>الغياب التراكمي</th>
                    <th>الإجراء الإرشادي</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (absentToday.length === 0) {
        body += `<tr><td colspan="7" style="text-align: center;">لا يوجد غياب مسجل لهذا اليوم.</td></tr>`;
    } else {
        absentToday.forEach((s, idx) => {
            const stats = getStudentSummary(s.id);
            body += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${s.name}</td>
                    <td>${s.class}</td>
                    <td>${s.nationalId}</td>
                    <td>${s.phone}</td>
                    <td style="color: red; font-weight: bold;">${stats.absent}</td>
                    <td>إشعار واتساب لولي الأمر</td>
                </tr>
            `;
        });
    }

    body += `</tbody></table>`;
    body += generateWordFooter();
    downloadWordDoc(body, `تنبيهات_الغياب_${currentSelectedDate}.doc`);
};

window.printAbsenceAlerts = function() {
    const dayRecords = attendanceData[currentSelectedDate] || {};
    const absentToday = students.filter(s => (dayRecords[s.id] || {}).status === 'absent');

    let rowsHtml = '';
    if (absentToday.length === 0) {
        rowsHtml = `<tr><td colspan="6" style="text-align:center; padding:12px; color:#64748b;">لا يوجد غياب مسجل لتاريخ اليوم المحدد (${currentSelectedDate}).</td></tr>`;
    } else {
        absentToday.forEach((s, idx) => {
            const stats = getStudentSummary(s.id);
            rowsHtml += `
                <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td><strong>${s.name}</strong></td>
                    <td style="text-align:center;">${s.class}</td>
                    <td style="text-align:center;">${s.nationalId}</td>
                    <td style="text-align:center;">${s.phone || '-'}</td>
                    <td style="text-align:center; color:#dc2626; font-weight:bold;">${stats.absent}</td>
                </tr>
            `;
        });
    }

    const html = `
        <div class="official-letterhead">
            <div class="letterhead-right">
                المملكة العربية السعودية<br>
                وزارة التعليم<br>
                الإدارة العامة للتعليم بمحافظة الأحساء<br>
                مدرسة الجشة المتوسطة - قسم التوجيه الطلابي
            </div>
            <div class="letterhead-center">
                <h2>كشف تنبيهات وإشعارات الغياب اليومي</h2>
                <div class="sub">التاريخ: ${currentSelectedDate} | عدد الطلاب الغائبين: (${absentToday.length}) طالب</div>
            </div>
            <div class="letterhead-left" style="text-align: left;">
                الموجه الطلابي: عبدالهادي المحسن<br>
                مدير المدرسة: أحمد بن ناصر الدوسري
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width: 5%; text-align:center;">م</th>
                    <th style="width: 32%;">اسم الطالب</th>
                    <th style="width: 15%; text-align:center;">الصف</th>
                    <th style="width: 18%; text-align:center;">السجل المدني</th>
                    <th style="width: 18%; text-align:center;">رقم جوال ولي الأمر</th>
                    <th style="width: 12%; text-align:center;">الغياب التراكمي</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>

        <div class="sig-container">
            <div class="sig-box">
                الموجه الطلابي بالمدرسة<br><br>
                <strong>عبدالهادي بن محمد المحسن</strong>
            </div>
            <div class="sig-box">
                ختم المدرسة الرسمي<br><br>
                ( ............................ )
            </div>
            <div class="sig-box">
                مدير مدرسة الجشة المتوسطة<br><br>
                <strong>أحمد بن ناصر الدوسري</strong>
            </div>
        </div>
    `;

    window.printHtmlDocument(html, `كشف_تنبيهات_الغياب_${currentSelectedDate}`);
};

// ------------------------------------------
// B. الرسوم البيانية والإحصائيات (Chart.js)
// ------------------------------------------
let currentChartClassStats = {};
let currentChartSelectedRange = 'today';

window.openChartsModal = function() {
    window.openModal('chartsModal');
    setTimeout(() => {
        window.updateChartsRange(currentChartRange || 'today');
    }, 150);
};

window.updateChartsRange = function(range) {
    currentChartRange = range;
    ['chartRangeToday', 'chartRangeWeek', 'chartRangeAll'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.remove('active');
    });

    if (range === 'today') {
        document.getElementById('chartRangeToday')?.classList.add('active');
        document.getElementById('chartsActiveDate').innerText = currentSelectedDate;
    } else if (range === 'week') {
        document.getElementById('chartRangeWeek')?.classList.add('active');
        document.getElementById('chartsActiveDate').innerText = 'آخر 7 أيام عمل مسجلة';
    } else {
        document.getElementById('chartRangeAll')?.classList.add('active');
        document.getElementById('chartsActiveDate').innerText = 'جميع الأيام (أرشيف كامل)';
    }

    renderCharts(range);
};

function renderCharts(range) {
    currentChartSelectedRange = range;
    let targetDates = [];
    const allDates = Object.keys(attendanceData).sort();

    if (range === 'today') {
        targetDates = [currentSelectedDate];
    } else if (range === 'week') {
        targetDates = allDates.slice(-7);
        if (targetDates.length === 0) targetDates = [currentSelectedDate];
    } else {
        targetDates = allDates.length > 0 ? allDates : [currentSelectedDate];
    }

    // Accumulate counts
    let totalPresent = 0, totalAbsent = 0, totalLate = 0, totalExcused = 0;
    let totalEntries = 0;

    const classStats = {};
    const timelineData = [];

    // Initialize all existing classes so 100% present classes are recognized
    const allClasses = [...new Set(students.map(s => s.class))].filter(Boolean).sort();
    allClasses.forEach(c => {
        classStats[c] = {
            name: c,
            present: 0,
            absent: 0,
            late: 0,
            total: 0,
            absentRecords: [],
            lateRecords: [],
            allStudents: []
        };
    });

    students.forEach(s => {
        if (s.class && classStats[s.class]) {
            classStats[s.class].allStudents.push(s);
        }
    });

    targetDates.forEach(d => {
        const dayRecs = attendanceData[d] || {};
        let dPres = 0, dAbs = 0, dLate = 0;

        students.forEach(s => {
            const r = dayRecs[s.id];
            if (r) {
                totalEntries++;
                if (!classStats[s.class]) {
                    classStats[s.class] = {
                        name: s.class,
                        present: 0,
                        absent: 0,
                        late: 0,
                        total: 0,
                        absentRecords: [],
                        lateRecords: [],
                        allStudents: []
                    };
                }
                classStats[s.class].total++;

                if (r.status === 'present') {
                    totalPresent++;
                    dPres++;
                    classStats[s.class].present++;
                } else if (r.status === 'absent') {
                    totalAbsent++;
                    dAbs++;
                    classStats[s.class].absent++;
                    classStats[s.class].absentRecords.push({
                        student: s,
                        date: d,
                        excuse: r.excuse,
                        excuseReason: r.excuseReason || r.note || ''
                    });
                } else if (r.status === 'late') {
                    totalLate++;
                    dLate++;
                    classStats[s.class].late++;
                    classStats[s.class].lateRecords.push({
                        student: s,
                        date: d,
                        minutes: r.lateMinutes || 0
                    });
                }

                if (r.excuse) totalExcused++;
            }
        });

        timelineData.push({ date: d, present: dPres, absent: dAbs, late: dLate });
    });

    const safeTotal = totalEntries > 0 ? totalEntries : 1;
    const pPct = Math.round((totalPresent / safeTotal) * 100);
    const aPct = Math.round((totalAbsent / safeTotal) * 100);
    const lPct = Math.round((totalLate / safeTotal) * 100);
    const ePct = totalAbsent > 0 ? Math.round((totalExcused / totalAbsent) * 100) : 0;

    document.getElementById('chartMetricPresent').innerText = `${pPct}%`;
    document.getElementById('chartMetricAbsent').innerText = `${aPct}%`;
    document.getElementById('chartMetricLate').innerText = `${lPct}%`;
    document.getElementById('chartMetricExcused').innerText = `${ePct}%`;

    currentChartClassStats = classStats;

    // Update counselor indicators for most and least absent classes
    updateCounselorClassIndicators(classStats, range);

    // 1. Chart: Status Doughnut
    const ctxStatus = document.getElementById('chartStatusDistribution');
    if (ctxStatus && window.Chart) {
        if (chartStatusInstance) chartStatusInstance.destroy();
        chartStatusInstance = new Chart(ctxStatus, {
            type: 'doughnut',
            data: {
                labels: ['حاضر', 'غائب', 'متأخر'],
                datasets: [{
                    data: [totalPresent, totalAbsent, totalLate],
                    backgroundColor: ['#10b981', '#f43f5e', '#f59e0b'],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Tajawal', size: 13 } } }
                },
                cutout: '65%'
            }
        });
    }

    // 2. Chart: Class Comparison Bar
    const ctxClass = document.getElementById('chartClassComparison');
    if (ctxClass && window.Chart) {
        if (chartClassInstance) chartClassInstance.destroy();
        const classes = Object.keys(classStats).sort();
        const absData = classes.map(c => classStats[c].absent);
        const lateData = classes.map(c => classStats[c].late);

        chartClassInstance = new Chart(ctxClass, {
            type: 'bar',
            data: {
                labels: classes.length > 0 ? classes : ['لا توجد فصول'],
                datasets: [
                    {
                        label: 'الغياب',
                        data: absData.length > 0 ? absData : [0],
                        backgroundColor: '#f43f5e',
                        borderRadius: 6
                    },
                    {
                        label: 'التأخر',
                        data: lateData.length > 0 ? lateData : [0],
                        backgroundColor: '#f59e0b',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { family: 'Tajawal', size: 12 } } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { font: { family: 'Tajawal' } } }
                }
            }
        });
    }

    // 3. Chart: Timeline Line Chart
    const ctxTime = document.getElementById('chartTimelineTrend');
    if (ctxTime && window.Chart) {
        if (chartTimelineInstance) chartTimelineInstance.destroy();
        chartTimelineInstance = new Chart(ctxTime, {
            type: 'line',
            data: {
                labels: timelineData.map(t => t.date),
                datasets: [
                    {
                        label: 'الحضور',
                        data: timelineData.map(t => t.present),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'الغياب',
                        data: timelineData.map(t => t.absent),
                        borderColor: '#f43f5e',
                        backgroundColor: 'rgba(244, 63, 94, 0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'التأخر الصباحي',
                        data: timelineData.map(t => t.late),
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { family: 'Tajawal', size: 12 } } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { font: { family: 'Tajawal' } } }
                }
            }
        });
    }
}

// ------------------------------------------
// مؤشرات متابعة الفصول للموجه الطلابي
// ------------------------------------------
function updateCounselorClassIndicators(classStats, range) {
    const classList = Object.keys(classStats).map(name => {
        const c = classStats[name];
        const safeTotal = c.total > 0 ? c.total : 1;
        const absentRate = c.total > 0 ? Math.round((c.absent / safeTotal) * 1000) / 10 : 0;
        const presentRate = c.total > 0 ? Math.round((c.present / safeTotal) * 1000) / 10 : (c.total === 0 ? 100 : 0);
        const lateRate = c.total > 0 ? Math.round((c.late / safeTotal) * 1000) / 10 : 0;
        return {
            name,
            total: c.total,
            present: c.present,
            absent: c.absent,
            late: c.late,
            absentRate,
            presentRate,
            lateRate,
            absentRecords: c.absentRecords || [],
            lateRecords: c.lateRecords || [],
            allStudents: c.allStudents || []
        };
    });

    const elHighestClass = document.getElementById('chartHighestAbsentClass');
    const elHighestBadge = document.getElementById('chartHighestAbsentBadge');
    const elHighestDetails = document.getElementById('chartHighestAbsentDetails');
    const btnFilterHighest = document.getElementById('btnFilterHighestAbsentClass');
    const btnPrintHighest = document.getElementById('btnPrintHighestSessionBtn');

    const elLowestClass = document.getElementById('chartLowestAbsentClass');
    const elLowestBadge = document.getElementById('chartLowestAbsentBadge');
    const elLowestDetails = document.getElementById('chartLowestAbsentDetails');
    const btnFilterLowest = document.getElementById('btnFilterLowestAbsentClass');
    const btnPrintLowest = document.getElementById('btnPrintMorningPraiseBtn');

    if (classList.length === 0) {
        if (elHighestClass) elHighestClass.innerText = 'لا توجد فصول';
        if (elLowestClass) elLowestClass.innerText = 'لا توجد فصول';
        return;
    }

    // 1. الفصل الأكثر غياباً (أولوية المتابعة والتدخل)
    const sortedByAbsence = [...classList].sort((a, b) => (b.absent - a.absent) || (b.absentRate - a.absentRate));
    const highestClass = sortedByAbsence[0];

    if (highestClass && highestClass.absent > 0) {
        const highestCount = highestClass.absent;
        const tiedClasses = sortedByAbsence.filter(c => c.absent === highestCount);

        if (tiedClasses.length === 1) {
            if (elHighestClass) elHighestClass.innerText = highestClass.name;
            if (elHighestBadge) elHighestBadge.innerText = `${highestClass.absent} حالة غياب (${highestClass.absentRate}%)`;
            if (elHighestDetails) {
                elHighestDetails.innerHTML = `
                    سجل هذا الفصل أعلى معدل غياب بالمدرسة بإجمالي <strong>${highestClass.absent}</strong> حالة غياب من أصل ${highestClass.total} رصد (نسبة الغياب: <strong style="color: #e11d48;">${highestClass.absentRate}%</strong> | نسبة الحضور: <strong>${highestClass.presentRate}%</strong> | حالات التأخر: <strong>${highestClass.late}</strong>).
                `;
            }
            if (btnFilterHighest) {
                btnFilterHighest.style.display = 'inline-block';
                btnFilterHighest.dataset.className = highestClass.name;
                btnFilterHighest.innerText = `متابعة طلاب (${highestClass.name}) 🔍`;
            }
            if (btnPrintHighest) {
                btnPrintHighest.style.display = 'inline-block';
            }
        } else {
            const names = tiedClasses.map(c => c.name).join(' و ');
            if (elHighestClass) elHighestClass.innerText = names;
            if (elHighestBadge) elHighestBadge.innerText = `${highestCount} غياب لكل فصل`;
            if (elHighestDetails) {
                elHighestDetails.innerHTML = `
                    تشترك هذه الفصول في أعلى معدل غياب بالمدرسة بإجمالي <strong>${highestCount}</strong> حالة غياب لكل منها (نسبة غياب: <strong>${highestClass.absentRate}%</strong> | نسبة الحضور: <strong>${highestClass.presentRate}%</strong>).
                `;
            }
            if (btnFilterHighest) {
                btnFilterHighest.style.display = 'inline-block';
                btnFilterHighest.dataset.className = tiedClasses[0].name;
                btnFilterHighest.innerText = `متابعة طلاب (${tiedClasses[0].name}) 🔍`;
            }
            if (btnPrintHighest) {
                btnPrintHighest.style.display = 'inline-block';
            }
        }
    } else {
        if (elHighestClass) elHighestClass.innerText = 'انضباط كامل لكافة الفصول 🌟';
        if (elHighestBadge) elHighestBadge.innerText = '0 غياب (100% مواظبة)';
        if (elHighestDetails) {
            elHighestDetails.innerHTML = `
                لا يوجد أي غياب مسجل في أي فصل دراسي خلال هذه الفترة. جميع فصول المدرسة حققت نسبة حضور وانضباط كاملة 100%.
            `;
        }
        if (btnFilterHighest) {
            btnFilterHighest.style.display = 'none';
        }
        if (btnPrintHighest) {
            btnPrintHighest.style.display = 'none';
        }
    }

    // 2. الفصل الأقل غياباً (الأكثر انضباطاً ومواظبة)
    const sortedByLowestAbsence = [...classList].sort((a, b) => (a.absent - b.absent) || (b.presentRate - a.presentRate));
    const lowestClass = sortedByLowestAbsence[0];

    if (lowestClass) {
        const lowestCount = lowestClass.absent;
        const zeroAbsClasses = sortedByLowestAbsence.filter(c => c.absent === lowestCount);

        if (lowestCount === 0) {
            if (zeroAbsClasses.length === 1) {
                if (elLowestClass) elLowestClass.innerText = lowestClass.name;
                if (elLowestBadge) elLowestBadge.innerText = '🌟 0 غياب (انضباط 100%)';
                if (elLowestDetails) {
                    elLowestDetails.innerHTML = `
                        الفصل الأكثر تميزاً بالمدرسة: حقق انضباطاً ومواظبة كاملة بنسبة حضور <strong>100%</strong> بدون تسجيل أي حالة غياب.
                    `;
                }
                if (btnFilterLowest) {
                    btnFilterLowest.style.display = 'inline-block';
                    btnFilterLowest.dataset.className = lowestClass.name;
                    btnFilterLowest.innerText = `استعراض (${lowestClass.name}) 🔍`;
                }
            } else if (zeroAbsClasses.length <= 3) {
                const names = zeroAbsClasses.map(c => c.name).join(' ، ');
                if (elLowestClass) elLowestClass.innerText = names;
                if (elLowestBadge) elLowestBadge.innerText = `🌟 0 غياب (${zeroAbsClasses.length} فصول متميزة)`;
                if (elLowestDetails) {
                    elLowestDetails.innerHTML = `
                        حققت هذه الفصول نسبة انضباط كاملة ومواظبة نموذجية بدون أي حالة غياب (نسبة الحضور: <strong>100%</strong>).
                    `;
                }
                if (btnFilterLowest) {
                    btnFilterLowest.style.display = 'inline-block';
                    btnFilterLowest.dataset.className = zeroAbsClasses[0].name;
                    btnFilterLowest.innerText = `استعراض (${zeroAbsClasses[0].name}) 🔍`;
                }
            } else {
                const names = zeroAbsClasses.slice(0, 2).map(c => c.name).join(' ، ') + ` و ${zeroAbsClasses.length - 2} فصول أخرى`;
                if (elLowestClass) elLowestClass.innerText = names;
                if (elLowestBadge) elLowestBadge.innerText = `🌟 0 غياب (${zeroAbsClasses.length} فصول)`;
                if (elLowestDetails) {
                    elLowestDetails.innerHTML = `
                        حققت <strong>${zeroAbsClasses.length}</strong> فصول نسبة انضباط نموذجية كاملة (100% حضور) دون تسجيل أي حالة غياب.
                    `;
                }
                if (btnFilterLowest) {
                    btnFilterLowest.style.display = 'inline-block';
                    btnFilterLowest.dataset.className = zeroAbsClasses[0].name;
                    btnFilterLowest.innerText = `استعراض (${zeroAbsClasses[0].name}) 🔍`;
                }
            }
        } else {
            if (elLowestClass) elLowestClass.innerText = lowestClass.name;
            if (elLowestBadge) elLowestBadge.innerText = `🌟 ${lowestCount} غياب فقط (حضور ${lowestClass.presentRate}%)`;
            if (elLowestDetails) {
                elLowestDetails.innerHTML = `
                    الفصل الأقل غياباً والأعلى مواظبة بالمدرسة بإجمالي <strong>${lowestCount}</strong> غياب فقط ونسبة حضور بلغت <strong>${lowestClass.presentRate}%</strong>.
                `;
            }
            if (btnFilterLowest) {
                btnFilterLowest.style.display = 'inline-block';
                btnFilterLowest.dataset.className = lowestClass.name;
                btnFilterLowest.innerText = `استعراض (${lowestClass.name}) 🔍`;
            }
        }
        if (btnPrintLowest) {
            btnPrintLowest.style.display = 'inline-block';
        }
    }

    // 3. تحديث جدول الترتيب والتفاصيل الإرشادية لجميع الفصول
    renderClassesBreakdownTable(sortedByAbsence);
}

function renderClassesBreakdownTable(sortedClasses) {
    const tbody = document.getElementById('classesBreakdownTableBody');
    if (!tbody) return;

    let html = '';
    sortedClasses.forEach((c, idx) => {
        let statusBadge = '';
        let rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

        if (c.absent >= 5 || c.absentRate >= 15) {
            statusBadge = '<span style="background: #ffe4e6; color: #9f1239; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 11px;">عمل جلسات جماعية وتحذير 🚨</span>';
        } else if (c.absent >= 2 || c.absentRate >= 5) {
            statusBadge = '<span style="background: #fef3c7; color: #b45309; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 11px;">جلسة توجيه بالانضباط ⚠️</span>';
        } else if (c.absent > 0) {
            statusBadge = '<span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 11px;">متابعة توعوية اعتيادية ℹ️</span>';
        } else {
            statusBadge = '<span style="background: #d1fae5; color: #065f46; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 11px;">شكرهم في الطابور الصباحي 🌟</span>';
        }

        const absColor = c.absent > 0 ? '#e11d48' : '#059669';
        const lateColor = c.late > 0 ? '#d97706' : '#64748b';

        html += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 10px; font-weight: 800; color: #64748b; text-align: center;">${idx + 1}</td>
                <td style="padding: 8px 10px; font-weight: 800; color: #1e3a8a;">${c.name}</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 800; color: ${absColor}; font-size: 13.5px;">${c.absent}</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 700; color: ${absColor};">${c.absentRate}%</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 700; color: ${lateColor};">${c.late}</td>
                <td style="padding: 8px 10px; text-align: center; font-weight: 800; color: #059669;">${c.presentRate}%</td>
                <td style="padding: 8px 10px; text-align: center;">${statusBadge}</td>
                <td style="padding: 8px 10px; text-align: center;">
                    <button class="btn" style="background: var(--primary); color: white; padding: 3px 8px; font-size: 11px; border-radius: 6px; font-weight: 700; cursor: pointer;" onclick="window.showClassCounselorFollowup('${c.name}')">
                        متابعة 📋
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

window.toggleClassesBreakdownTable = function() {
    const container = document.getElementById('classesBreakdownContainer');
    const btnText = document.getElementById('toggleClassesTableBtnText');
    if (!container) return;

    if (container.style.display === 'none' || !container.style.display) {
        container.style.display = 'block';
        if (btnText) btnText.innerText = '🔼 إخفاء تفاصيل وترتيب الفصول';
    } else {
        container.style.display = 'none';
        if (btnText) btnText.innerText = '📋 عرض تفاصيل وترتيب جميع الفصول';
    }
};

let currentModalCounselorClass = '';

window.showClassCounselorFollowup = function(className) {
    if (!className) return;
    currentModalCounselorClass = className;

    const stats = currentChartClassStats[className];
    const modal = document.getElementById('classCounselorModal');
    if (!modal) return;

    const elTitle = document.getElementById('classCounselorTitle');
    const elSub = document.getElementById('classCounselorSubtitle');
    if (elTitle) elTitle.innerText = `متابعة انضباط طلاب فصل: ${className}`;
    
    let rangeLabel = 'اليوم المحدد';
    if (currentChartSelectedRange === 'week') rangeLabel = 'آخر 7 أيام عمل';
    else if (currentChartSelectedRange === 'all') rangeLabel = 'الأرشيف الشهري الكامل';
    if (elSub) elSub.innerText = `النطاق الزمني: ${rangeLabel} | مدرسة الجشة المتوسطة - وحدة التوجيه الطلابي`;

    // Filter main table button
    const btnFilterMain = document.getElementById('btnFilterMainTableFromClassModal');
    if (btnFilterMain) {
        btnFilterMain.onclick = () => {
            window.filterByClassFromCharts(className);
        };
    }

    // Quick Stats Grid
    const classTotal = stats ? stats.total : 0;
    const classPres = stats ? stats.present : 0;
    const classAbs = stats ? stats.absent : 0;
    const classLate = stats ? stats.late : 0;
    const safeTotal = classTotal > 0 ? classTotal : 1;
    const presRate = Math.round((classPres / safeTotal) * 100);
    const absRate = Math.round((classAbs / safeTotal) * 100);

    const statsGrid = document.getElementById('classCounselorStatsGrid');
    if (statsGrid) {
        statsGrid.innerHTML = `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px; text-align: center;">
                <span style="font-size: 11px; color: #15803d; font-weight: 700; display: block;">نسبة الحضور</span>
                <strong style="font-size: 17px; color: #166534;">${presRate}%</strong>
            </div>
            <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 8px; text-align: center;">
                <span style="font-size: 11px; color: #9f1239; font-weight: 700; display: block;">إجمالي الغياب</span>
                <strong style="font-size: 17px; color: #e11d48;">${classAbs} (${absRate}%)</strong>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px; text-align: center;">
                <span style="font-size: 11px; color: #b45309; font-weight: 700; display: block;">حالات التأخر</span>
                <strong style="font-size: 17px; color: #d97706;">${classLate}</strong>
            </div>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 8px; text-align: center;">
                <span style="font-size: 11px; color: #1e40af; font-weight: 700; display: block;">إجمالي طلاب الفصل</span>
                <strong style="font-size: 17px; color: #1d4ed8;">${stats ? stats.allStudents.length : 0} طالب</strong>
            </div>
        `;
    }

    // Students list
    const area = document.getElementById('classCounselorStudentsArea');
    const tableBadge = document.getElementById('classCounselorTableBadge');

    const classStudents = students.filter(s => s.class === className);
    const absRecs = stats ? (stats.absentRecords || []) : [];
    const absentStudentIds = new Set(absRecs.map(r => r.student.id));

    if (tableBadge) {
        tableBadge.innerText = `${absRecs.length} حالة غياب مسجلة في هذا النطاق`;
    }

    if (classStudents.length === 0) {
        if (area) area.innerHTML = `<div style="padding: 20px; text-align: center; color: #64748b;">لا يوجد طلاب مسجلون في هذا الفصل.</div>`;
    } else if (area) {
        const sortedStudents = [...classStudents].sort((a, b) => {
            const aIsAbs = absentStudentIds.has(a.id) ? 1 : 0;
            const bIsAbs = absentStudentIds.has(b.id) ? 1 : 0;
            if (bIsAbs !== aIsAbs) return bIsAbs - aIsAbs;
            const aSummary = getStudentSummary(a.id);
            const bSummary = getStudentSummary(b.id);
            return (bSummary.absent - aSummary.absent) || (a.name || '').localeCompare(b.name || '', 'ar');
        });

        let html = `
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: right;">
                <thead style="background: #f1f5f9; color: #334155; position: sticky; top: 0; z-index: 2;">
                    <tr>
                        <th style="padding: 8px 10px; border-bottom: 1px solid #cbd5e1;">الطالب</th>
                        <th style="padding: 8px 10px; border-bottom: 1px solid #cbd5e1; text-align: center;">حالة النطاق</th>
                        <th style="padding: 8px 10px; border-bottom: 1px solid #cbd5e1; text-align: center;">الغياب التراكمي</th>
                        <th style="padding: 8px 10px; border-bottom: 1px solid #cbd5e1; text-align: center;">المستوى الوزاري</th>
                        <th style="padding: 8px 10px; border-bottom: 1px solid #cbd5e1; text-align: center;">ولي الأمر</th>
                        <th style="padding: 8px 10px; border-bottom: 1px solid #cbd5e1; text-align: center;">إجراءات الموجه</th>
                    </tr>
                </thead>
                <tbody>
        `;

        sortedStudents.forEach(s => {
            const summary = getStudentSummary(s.id);
            const isCurrentlyAbsent = absentStudentIds.has(s.id);
            const currentRec = absRecs.find(r => r.student.id === s.id);

            let statusHtml = '';
            if (isCurrentlyAbsent) {
                const excuseText = currentRec && currentRec.excuse ? ' (بعذر 📝)' : ' (بدون عذر ❌)';
                statusHtml = `<span style="background: #ffe4e6; color: #9f1239; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 11px;">غائب${excuseText}</span>`;
            } else {
                statusHtml = `<span style="background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;">حاضر ✅</span>`;
            }

            // Ministerial Action Level (3, 5, 10 days)
            let levelBadge = '';
            if (summary.absent >= 10) {
                levelBadge = '<span style="background: #ffe4e6; color: #9f1239; padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 10.5px;">المستوى 3 (حماية الطفل)</span>';
            } else if (summary.absent >= 5) {
                levelBadge = '<span style="background: #ffedd5; color: #c2410c; padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 10.5px;">المستوى 2 (لجنة التوجيه)</span>';
            } else if (summary.absent >= 3) {
                levelBadge = '<span style="background: #fef3c7; color: #b45309; padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 10.5px;">المستوى 1 (استدعاء)</span>';
            } else if (summary.absent > 0) {
                levelBadge = '<span style="background: #ecfdf5; color: #047857; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10.5px;">تواصل فوري</span>';
            } else {
                levelBadge = '<span style="color: #64748b; font-size: 10.5px;">منتظم ⭐</span>';
            }

            const phone = s.phone || '';
            const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
            const hasPhone = cleanPhone.length >= 9;

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: ${isCurrentlyAbsent ? '#fff5f5' : '#ffffff'};">
                    <td style="padding: 8px 10px;">
                        <div style="font-weight: 800; color: #0f172a;">${s.name}</div>
                        <div style="font-size: 10.5px; color: #64748b;">هوية: ${s.nationalId || '-'}</div>
                    </td>
                    <td style="padding: 8px 10px; text-align: center;">${statusHtml}</td>
                    <td style="padding: 8px 10px; text-align: center; font-weight: 800; color: #e11d48; font-size: 13px;">${summary.absent}</td>
                    <td style="padding: 8px 10px; text-align: center;">${levelBadge}</td>
                    <td style="padding: 8px 10px; text-align: center;">
                        ${hasPhone ? `
                            <button class="btn" style="background: #25d366; color: white; padding: 3px 8px; font-size: 11px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" onclick="window.sendStudentAbsenceWhatsApp('${s.id}', '${currentSelectedDate}')" title="إرسال إشعار وزاري عبر واتساب">
                                💬 واتساب
                            </button>
                        ` : '<span style="color: #94a3b8; font-size: 11px;">لا يوجد رقم</span>'}
                    </td>
                    <td style="padding: 8px 10px; text-align: center;">
                        <div style="display: flex; gap: 4px; justify-content: center;">
                            <button class="btn" style="background: #0284c7; color: white; padding: 3px 7px; font-size: 11px; border-radius: 6px; cursor: pointer;" onclick="window.openStudentRemedialCard('${s.id}', 'absence')" title="استمارة الخطة الفردية المعتمدة">
                                📝 استمارة الخطة
                            </button>
                            <button class="btn" style="background: #f1f5f9; color: #1e293b; border: 1px solid #cbd5e1; padding: 3px 7px; font-size: 11px; border-radius: 6px; cursor: pointer;" onclick="window.previewStudentReport('${s.id}')" title="سجل وبطاقة الطالب">
                                📄 التقرير
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        area.innerHTML = html;
    }

    window.openModal('classCounselorModal');
};

window.closeClassCounselorModal = function() {
    const el = document.getElementById('classCounselorModal');
    if (el) el.classList.remove('active');
};

window.filterByClassFromCharts = function(className) {
    window.closeClassCounselorModal();
    window.closeModals();
    const sel = document.getElementById('classFilter');
    if (sel) {
        sel.value = className;
        renderTable();
        const table = document.getElementById('tableBody');
        if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.showBottomNotification('تصفية الفصل', `تم عرض طلاب فصل: ${className} في جدول الرصد`, 'info');
    }
};

window.exportGroupGuidanceSessionPdf = function(className) {
    const targetClass = className || currentModalCounselorClass || (document.getElementById('btnFilterHighestAbsentClass') ? document.getElementById('btnFilterHighestAbsentClass').dataset.className : '');
    if (!targetClass) {
        window.showBottomNotification('تنبيه', 'يرجى تحديد الفصل المراد إعداد محضر الجلسة الجماعية له', 'warning');
        return;
    }

    const classStats = (currentChartClassStats && currentChartClassStats[targetClass]) ? currentChartClassStats[targetClass] : { absent: 0, present: 0, total: 0, absentRate: 0, late: 0 };
    const classStudents = students.filter(s => s.class === targetClass);

    if (window.showBottomNotification) {
        window.showBottomNotification('جاري إنشاء ملف PDF 📥', `يتم الآن تصدير محضر الجلسة الجماعية لفصل (${targetClass}) بصيغة PDF...`, 'info');
    }

    const contentHtml = `
        <div class="official-pdf-page" style="direction: rtl; text-align: right; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; color: #0f172a; background: #ffffff; width: 794px; box-sizing: border-box; padding: 22px 26px; line-height: 1.55;">
            <!-- ترويسة وزارة التعليم الرسمية -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; direction: rtl;">
                <div style="text-align: right; font-size: 12.5px; font-weight: 700; color: #1e3a8a; line-height: 1.5;">
                    المملكة العربية السعودية<br>
                    وزارة التعليم<br>
                    الإدارة العامة للتعليم بمحافظة الأحساء<br>
                    مدرسة الجشة المتوسطة
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 19px; font-weight: 900; color: #0f172a; margin-bottom: 4px;">محضر تنفيذ جلسة إرشادية جماعية</div>
                    <div style="font-size: 13px; font-weight: 800; color: #b91c1c; background: #fee2e2; padding: 3px 14px; border-radius: 6px; display: inline-block;">
                        (التحذير من الغياب والتأكيد على الانضباط المدرسي)
                    </div>
                </div>
                <div style="text-align: left; font-size: 12px; color: #475569; line-height: 1.6; direction: rtl;">
                    التاريخ: ${formatArabicDateWithDigits(currentSelectedDate)}<br>
                    الفصل المستهدف: <strong style="color: #0f172a; font-size: 13.5px;">${targetClass}</strong><br>
                    عدد طلاب الفصل: ${window.toArabicDigits(classStudents.length)} طالب
                </div>
            </div>

            <!-- بطاقة بيانات الجلسة والمبررات -->
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin-bottom: 14px; font-size: 12.5px; direction: rtl; text-align: right;">
                <div style="font-weight: 800; color: #1e3a8a; margin-bottom: 6px; font-size: 13px;">📌 مبررات انعقاد الجلسة الإرشادية الجماعية:</div>
                <div style="line-height: 1.65; color: #334155;">
                    استناداً إلى مؤشرات الرصد اليومي والمواظبة بمدرسة الجشة المتوسطة، وبناءً على تسجيل حالات غياب بفصل <strong>(${targetClass})</strong> بلغت (<strong>${window.toArabicDigits(classStats.absent)}</strong> حالة غياب بنسبة <strong>${window.toArabicDigits(classStats.absentRate || 0)}٪</strong>)، وانطلاقاً من الدور التربوي لوحدة التوجيه الطلابي في تعزيز السلوك الإيجابي والحد من الهدر التعليمي؛ فقد عُقدت هذه الجلسة الجماعية مع طلاب الفصل لتحذيرهم من الغياب وحثهم على الانضباط والمواظبة الكاملة.
                </div>
            </div>

            <!-- محاور الجلسة الإرشادية مع ترقيم عربي RTL صريح -->
            <div style="margin-bottom: 14px; direction: rtl; text-align: right;">
                <div style="font-size: 13px; font-weight: 800; color: #0f172a; border-right: 4px solid #0284c7; padding-right: 8px; margin-bottom: 10px;">
                    📋 محاور الجلسة الإرشادية مع طلاب الفصل:
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; align-items: flex-start; gap: 10px; direction: rtl; text-align: right;">
                        <span style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; border-radius: 6px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; margin-top: 1px;">١</span>
                        <div style="flex: 1; font-size: 12px; color: #334155; line-height: 1.65; text-align: right;">
                            <strong style="color: #0f172a;">التحذير الصريح من عواقب الغياب:</strong> توضيح ما يترتب على الغياب المتكرر من فجوة تعليمية تؤثر سلباً على الفهم والاستيعاب والدرجات الفصلية.
                        </div>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 10px; direction: rtl; text-align: right;">
                        <span style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; border-radius: 6px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; margin-top: 1px;">٢</span>
                        <div style="flex: 1; font-size: 12px; color: #334155; line-height: 1.65; text-align: right;">
                            <strong style="color: #0f172a;">توضيح لائحة السلوك والمواظبة المعتمدة من وزارة التعليم:</strong> إحاطة الطلاب بالإجراءات الوزارية النظامية الصارمة (إشعار وإنذار عند ${window.toArabicDigits(3)} أيام، استدعاء ولي الأمر وتوقيع العقد عند ${window.toArabicDigits(5)} أيام، الإحالة لإدارة التعليم وحماية الطفل عند ${window.toArabicDigits(10)} أيام مع تطبيق الحسم من درجات المواظبة).
                        </div>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 10px; direction: rtl; text-align: right;">
                        <span style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; border-radius: 6px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; margin-top: 1px;">٣</span>
                        <div style="flex: 1; font-size: 12px; color: #334155; line-height: 1.65; text-align: right;">
                            <strong style="color: #0f172a;">أهمية الحضور الصباحي والانضباط الذاتي:</strong> ترسيخ قيمة الانضباط كخلق إسلامي وسلوك حضاري يُبنى عليه مستقبل الطالب.
                        </div>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 10px; direction: rtl; text-align: right;">
                        <span style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; border-radius: 6px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; margin-top: 1px;">٤</span>
                        <div style="flex: 1; font-size: 12px; color: #334155; line-height: 1.65; text-align: right;">
                            <strong style="color: #0f172a;">التواصل والشراكة مع الأسرة:</strong> التأكيد على إشعار ولي الأمر فورياً عند أي غياب أو تأخر صباحي.
                        </div>
                    </div>

                    <div style="display: flex; align-items: flex-start; gap: 10px; direction: rtl; text-align: right;">
                        <span style="background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; font-weight: 800; border-radius: 6px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; margin-top: 1px;">٥</span>
                        <div style="flex: 1; font-size: 12px; color: #334155; line-height: 1.65; text-align: right;">
                            <strong style="color: #0f172a;">مناقشة التحديات والحلول:</strong> الاستماع لمرئيات الطلاب وإيجاد حلول لأي صعوبات قد تعيق حضورهم المبكر والمنتظم.
                        </div>
                    </div>
                </div>
            </div>

            <!-- التوصيات والقرارات -->
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px; direction: rtl; text-align: right;">
                <div style="font-weight: 800; color: #92400e; margin-bottom: 4px;">⚖️ التوصيات والقرارات:</div>
                <ul style="margin: 0; padding-right: 18px; color: #78350f; line-height: 1.6;">
                    <li>التزام كافة طلاب الفصل بالحضور اليومي المبكر وعدم التغيب إطلاقاً إلا بتقرير طبي رسمي من منصة (صحتي).</li>
                    <li>متابعة مستمرة ويومية من رائد الفصل والموجه الطلابي لحضور وغياب طلاب الفصل.</li>
                    <li>تطبيق الإجراءات واللوائح النظامية بحق أي طالب يتكرر غيابه دون عذر.</li>
                </ul>
            </div>

            <!-- جدول توقيعات عينة من طلاب الفصل بالتعهد -->
            <div style="margin-bottom: 18px; direction: rtl;">
                <div style="font-size: 12.5px; font-weight: 800; color: #0f172a; margin-bottom: 6px; text-align: right;">
                    ✍️ إقرار وتعهد طلاب الفصل بالحضور والانضباط:
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: right; direction: rtl;">
                    <thead>
                        <tr style="background: #f1f5f9;">
                            <th style="border: 1px solid #cbd5e1; padding: 5px 8px; width: 40px; text-align: center;">م</th>
                            <th style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right;">اسم الطالب</th>
                            <th style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; width: 150px;">التعهد</th>
                            <th style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; width: 120px;">التوقيع</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${classStudents.slice(0, 8).map((s, idx) => `
                            <tr>
                                <td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; font-weight: 700;">${window.toArabicDigits(idx + 1)}</td>
                                <td style="border: 1px solid #cbd5e1; padding: 5px 8px; font-weight: 700; text-align: right;">${s.name}</td>
                                <td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; color: #059669; font-weight: 600;">أتعهد بالانضباط والمواظبة</td>
                                <td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center;">...........................</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- التوقيعات الرسمية -->
            <div style="display: flex; justify-content: space-between; text-align: center; margin-top: 18px; font-size: 12.5px; padding-top: 10px; border-top: 1px solid #cbd5e1; direction: rtl;">
                <div>
                    <strong>رائد الفصل</strong><br><br>
                    الاسم: .................................<br>
                    التوقيع: .................................
                </div>
                <div>
                    <strong>الموجه الطلابي</strong><br><br>
                    <strong>عبدالهادي المحسن</strong><br>
                    التوقيع: .................................
                </div>
                <div>
                    <strong>مدير مدرسة الجشة المتوسطة</strong><br><br>
                    <strong>أحمد بن ناصر الدوسري</strong><br>
                    التوقيع: .................................
                </div>
            </div>
        </div>
    `;

    const filename = `محضر_جلسة_جماعية_${targetClass}_${currentSelectedDate}.pdf`;
    window.exportHtmlToPdf(contentHtml, filename, {
        margin: [5, 5, 5, 5],
        padding: '10px 14px'
    });
};
window.printGroupGuidanceSession = window.exportGroupGuidanceSessionPdf;

window.exportMorningPraisePdf = function(className) {
    const targetClass = className || currentModalCounselorClass || (document.getElementById('btnFilterLowestAbsentClass') ? document.getElementById('btnFilterLowestAbsentClass').dataset.className : '');
    if (!targetClass) {
        window.showBottomNotification('تنبيه', 'يرجى تحديد الفصل المراد إعداد كلمة شكر الطابور الصباحي له', 'warning');
        return;
    }

    const classStats = (currentChartClassStats && currentChartClassStats[targetClass]) ? currentChartClassStats[targetClass] : { absent: 0, present: 0, total: 0, absentRate: 0, presentRate: 100 };

    if (window.showBottomNotification) {
        window.showBottomNotification('جاري إنشاء ملف PDF 📥', `يتم الآن تصدير كلمة شكر الطابور لفصل (${targetClass}) بصيغة PDF...`, 'info');
    }

    const contentHtml = `
        <div class="official-pdf-page" style="direction: rtl; text-align: right; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; color: #0f172a; background: #ffffff; width: 794px; box-sizing: border-box; padding: 22px 26px; line-height: 1.7;">
            <!-- ترويسة وزارة التعليم الرسمية -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 18px; direction: rtl;">
                <div style="text-align: right; font-size: 12.5px; font-weight: 700; color: #065f46; line-height: 1.5;">
                    المملكة العربية السعودية<br>
                    وزارة التعليم<br>
                    الإدارة العامة للتعليم بمحافظة الأحساء<br>
                    مدرسة الجشة المتوسطة
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 20px; font-weight: 900; color: #065f46; margin-bottom: 4px;">🌟 كلمة شكر وتكريم في الطابور الصباحي 🌟</div>
                    <div style="font-size: 13px; font-weight: 800; color: #047857; background: #d1fae5; padding: 3px 16px; border-radius: 6px; display: inline-block;">
                        وسام التميز والانضباط المدرسي للفصل النموذجي
                    </div>
                </div>
                <div style="text-align: left; font-size: 12px; color: #475569; line-height: 1.6; direction: rtl;">
                    التاريخ: ${formatArabicDateWithDigits(currentSelectedDate)}<br>
                    الفصل المكرم: <strong style="color: #065f46; font-size: 14px;">${targetClass}</strong><br>
                    نسبة الحضور: <strong style="color: #059669; font-size: 14px;">${window.toArabicDigits(classStats.presentRate || 100)}٪</strong>
                </div>
            </div>

            <!-- نص كلمة الإذاعة المدرسية والطابور الصباحي -->
            <div style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 18px; margin-bottom: 18px; direction: rtl; text-align: right;">
                <div style="font-size: 15px; font-weight: 800; color: #166534; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                    <span>🎤 نص كلمة الشكر والثناء للإلقاء في الإذاعة والطابور الصباحي:</span>
                </div>
                <div style="font-size: 13.5px; color: #14532d; text-align: justify; line-height: 1.9;">
                    <strong>بسم الله الرحمن الرحيم، والصلاة والسلام على أشرف الأنبياء والمرسلين...</strong><br>
                    مديرنا الفاضل، أساتذتي الكرام، إخواني الطلاب.. السلام عليكم ورحمة الله وبركاته،<br>
                    إن الانضباط المدرسي هو ركيزة التفوق وعنوان النجاح، والالتزام بالحضور اليومي المبكر يعكس وعي الطالب وحرص أسرته الكريمة واهتمام معلميه.<br>
                    ويسر إدارة مدرسة الجشة المتوسطة ووحدة التوجيه الطلابي في هذا الصباح المشرق أن تقف وقفة فخر واعتزاز لتقديم 
                    <strong style="color: #065f46; font-size: 15px; text-decoration: underline;">أسمى عبارات الشكر والتقدير والتكريم لطلاب فصل (${targetClass}) ورائد فصلهم الفاضل</strong>، 
                    لحصولهم عن جدارة واستحقاق على وسام التميز والمواظبة والانضباط المدرسي وتحقيق أعلى معدلات الحضور بنسبة 
                    <strong>(${window.toArabicDigits(classStats.presentRate || 100)}٪)</strong>، مسجلين النموذج الأروع كأقل فصول المدرسة غياباً.<br>
                    إننا إذ نشيد بهذا التميز المشرف، نبارك لطلاب الفصل هذا الإنجاز، وندعو كافة فصول المدرسة للاقتداء بهم ليكون الانضباط شعارنا اليومي دائماً وأبداً.
                    <br><br>
                    <strong>والسلام عليكم ورحمة الله وبركاته.</strong>
                </div>
            </div>

            <!-- شهادة التكريم والتقدير للفصل -->
            <div style="border: 2px dashed #059669; border-radius: 12px; padding: 18px; text-align: center; background: #fafafa; margin-bottom: 22px;">
                <div style="font-size: 13.5px; font-weight: 700; color: #065f46;">شهادة شكر وتقدير للفصل المتميز</div>
                <div style="font-size: 19px; font-weight: 900; color: #0f172a; margin: 8px 0;">
                    تُمنح هذه الشهادة لطلاب فصل: <span style="color: #059669;">${targetClass}</span>
                </div>
                <div style="font-size: 13px; color: #475569; max-width: 550px; margin: 0 auto;">
                    تقديراً لجهودهم وتفاعلهم الإيجابي والتزامهم الكامل بالحضور اليومي والمواظبة المتميزة، سائلين الله لهم دوام التفوق والنجاح.
                </div>
            </div>

            <!-- التوقيعات الرسمية -->
            <div style="display: flex; justify-content: space-between; text-align: center; margin-top: 20px; font-size: 13px; padding-top: 10px; border-top: 1px solid #cbd5e1;">
                <div>
                    <strong>رائد الفصل</strong><br><br>
                    .....................................
                </div>
                <div>
                    <strong>الموجه الطلابي</strong><br><br>
                    <strong>عبدالهادي المحسن</strong>
                </div>
                <div>
                    <strong>مدير مدرسة الجشة المتوسطة</strong><br><br>
                    <strong>أحمد بن ناصر الدوسري</strong>
                </div>
            </div>
        </div>
    `;

    const filename = `كلمة_شكر_طابور_${targetClass}_${currentSelectedDate}.pdf`;
    window.exportHtmlToPdf(contentHtml, filename, {
        margin: [5, 5, 5, 5],
        padding: '10px 14px'
    });
};
window.printMorningPraise = window.exportMorningPraisePdf;

// ------------------------------------------
// C. الخطة العلاجية للحد من الغياب المدرسي
// ------------------------------------------
window.openAbsenceRemedialModal = function() {
    window.switchAbsRemTab(currentAbsRemTab || 'stages');
    window.openModal('absenceRemedialModal');
};

window.switchAbsRemTab = function(tab) {
    currentAbsRemTab = tab;
    const btnStages = document.getElementById('absRemTabStagesBtn');
    const btnStudents = document.getElementById('absRemTabStudentsBtn');
    const btnGoals = document.getElementById('absRemTabGoalsBtn');

    [btnStages, btnStudents, btnGoals].forEach(b => b?.classList.remove('active'));

    const stagesDiv = document.getElementById('absRemStagesContent');
    const studentsDiv = document.getElementById('absRemStudentsContent');
    const goalsDiv = document.getElementById('absRemGoalsContent');

    if (stagesDiv) stagesDiv.style.display = 'none';
    if (studentsDiv) studentsDiv.style.display = 'none';
    if (goalsDiv) goalsDiv.style.display = 'none';

    if (tab === 'stages') {
        btnStages?.classList.add('active');
        if (stagesDiv) stagesDiv.style.display = 'block';
    } else if (tab === 'students') {
        btnStudents?.classList.add('active');
        if (studentsDiv) studentsDiv.style.display = 'block';
        renderAbsenceRemedialStudents();
    } else {
        btnGoals?.classList.add('active');
        if (goalsDiv) goalsDiv.style.display = 'block';
    }
};

function renderAbsenceRemedialStudents() {
    const container = document.getElementById('absRemStudentsContent');
    const countBadge = document.getElementById('absRemStudentCount');
    if (!container) return;

    const list = students.map(s => {
        const stats = getStudentSummary(s.id);
        return { ...s, totalAbsent: stats.absent };
    }).filter(s => s.totalAbsent >= 1).sort((a, b) => b.totalAbsent - a.totalAbsent);

    if (countBadge) countBadge.innerText = list.length;

    if (list.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; background: #f8fafc; border-radius: 12px;">
                <p style="color: var(--text-muted); margin: 0;">لا يوجد طلاب مستهدفون بالخطة العلاجية حتى الآن.</p>
            </div>
        `;
        return;
    }

    let html = `
        <table class="report-table" style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
            <thead>
                <tr style="background: #f1f5f9; text-align: right;">
                    <th style="padding: 10px;">الطالب</th>
                    <th style="padding: 10px;">الصف</th>
                    <th style="padding: 10px; text-align: center;">أيام الغياب</th>
                    <th style="padding: 10px;">المستوى الإرشادي المحدد</th>
                    <th style="padding: 10px; text-align: center;">الإجراءات</th>
                </tr>
            </thead>
            <tbody>
    `;

    list.forEach(s => {
        let levelText = '';
        let levelColor = '#0369a1';
        let levelBg = '#e0f2fe';

        if (s.totalAbsent >= 10) {
            levelText = 'المستوى 3 (10 أيام فأكثر: حماية الطفل وإدارة التعليم)';
            levelColor = '#9f1239';
            levelBg = '#ffe4e6';
        } else if (s.totalAbsent >= 5) {
            levelText = 'المستوى 2 (5 أيام: لجنة التوجيه وجلسة توعوية)';
            levelColor = '#c2410c';
            levelBg = '#ffedd5';
        } else if (s.totalAbsent >= 3) {
            levelText = 'المستوى 1 (3 أيام: تحويل للموجه واستدعاء ولي الأمر)';
            levelColor = '#b45309';
            levelBg = '#fef3c7';
        } else {
            levelText = 'إجراء فوري (التواصل في نفس اليوم)';
            levelColor = '#047857';
            levelBg = '#ecfdf5';
        }

        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px; font-weight: 700;">${s.name}</td>
                <td style="padding: 10px;">${s.class}</td>
                <td style="padding: 10px; text-align: center; color: #e11d48; font-weight: 800; font-size: 15px;">${s.totalAbsent}</td>
                <td style="padding: 10px;">
                    <span style="background: ${levelBg}; color: ${levelColor}; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block;">
                        ${levelText}
                    </span>
                </td>
                <td style="padding: 10px; text-align: center;">
                    <button class="btn" style="background: var(--primary); color: white; padding: 4px 10px; font-size: 12px;" onclick="window.openStudentRemedialCard('${s.id}', 'absence')">
                        استمارة الخطة 📝
                    </button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

window.exportAbsenceRemedialPlanWord = function() {
    let title = `وثيقة الخطة العلاجية والإجراءات الوزارية المعتمدة للحد من الغياب المدرسي`;
    let subtitle = `وفق تنظيم وزارة التعليم للتعامل مع غياب الطلاب (3 - 5 - 10 أيام)`;
    let body = generateWordLetterhead(title, subtitle);

    body += `
        <div style="font-size: 14px; line-height: 1.8; margin-bottom: 20px;">
            <p><strong>المقدمة والركيزة الأساسية:</strong> تم إعداد وتطبيق هذه الخطة الإرشادية بمدرسة الجشة المتوسطة بهدف معالجة أسباب تكرار الغياب، ورفع التحصيل الدراسي، وتفعيل الشراكة الإيجابية مع الأسرة. ونؤكد على المرتكز الوزاري الثابت: <strong>«استمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها»</strong> مع التواصل مع ولي الأمر في نفس اليوم الذي تغيب فيه الطالب عبر الرسالة النصية أو المكالمة الهاتفية للاستفسار عن سبب الغياب.</p>
            
            <h4 style="color: #065f46; margin: 15px 0 8px 0;">أولاً: مصفوفة الإجراءات والتدخلات الواجب اتخاذها بحذافيرها:</h4>
            <table class="content-table">
                <thead>
                    <tr>
                        <th style="width: 22%;">المستوى والتصنيف</th>
                        <th style="width: 18%;">أيام الغياب</th>
                        <th style="width: 60%;">الإجراءات النظامية والتربوية الواجب اتخاذها بحذافيرها</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight: bold; color: #047857;">التوجيه الأولي العام</td>
                        <td>نفس يوم الغياب (1-2 يوم)</td>
                        <td>التواصل مع ولي الأمر في نفس اليوم الذي تغيب فيه الطالب من خلال الرسالة النصية أو المكالمة الهاتفية للاستفسار عن سبب الغياب.</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; color: #b45309;">المستوى الأول</td>
                        <td>3 أيام غياب<br><span style="font-size: 9pt; color: #64748b;">(متصلة أو منفصلة)</span></td>
                        <td>
                            1. تحويل الطالب للموجه الطلابي لتقديم الدعم والخدمات التربوية المناسبة له (خطة التعلم في أيام الغياب)، ودراسة الحالة إذا احتاج الأمر.<br>
                            2. استدعاء ولي الأمر، ويعقد اجتماع حضوري معه يتضمن: إبلاغه بالإجراءات المترتبة على غياب ابنه، وتقييم الخدمات التربوية والخطة العلاجية المقدمة للطالب، وتحديثها بما يلزم وفق الحالة.
                        </td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; color: #c2410c;">المستوى الثاني</td>
                        <td>5 أيام غياب<br><span style="font-size: 9pt; color: #64748b;">(متصلة أو منفصلة)</span></td>
                        <td>في حال عدم التزام ولي الأمر بالخطة التربوية (خطة التعلم في أيام الغياب)، يُحال الطالب إلى لجنة التوجيه الطلابي، ويتم تنظيم جلسة توعوية مع ولي الأمر؛ للتأكيد على أهمية اتباع الخطط التربوية والعلاجية.</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold; color: #9f1239;">المستوى الثالث</td>
                        <td>10 أيام غياب فأكثر<br><span style="font-size: 9pt; color: #64748b;">(متصلة أو منفصلة)</span></td>
                        <td>
                            1. في حال الاشتباه بتعرض الطالب للإهمال تخاطب المدرسة الجهات ذات الاختصاص حيال تطبيق ما ورد في نظام حماية الطفل ونظام الحماية من الإيذاء ولائحتهما التنفيذية، وإشعار إدارة التعليم بذلك.<br>
                            2. تتخذ المدرسة الإجراءات النظامية المطلوبة بالتنسيق والمتابعة مع الجهات ذات الاختصاص المذكورة في الفقرة السابقة حيال ما تم من إجراءات للحالات المحالة لهم.
                        </td>
                    </tr>
                </tbody>
            </table>

            <h4 style="color: #065f46; margin: 20px 0 8px 0;">ثانياً: خطة التعلم في أيام الغياب والتعزيز التربوي:</h4>
            <ul style="line-height: 1.8; font-size: 13px;">
                <li>متابعة الفاقد التعليمي والواجبات عبر منصة مدرستي لضمان استمرارية تقديم الخدمات التعليمية للطالب وعدم انقطاعها.</li>
                <li>عقد جلسات التوعية مع أولياء الأمور لبيان أثر الغياب على التفوق الدراسي والانضباط.</li>
                <li>تكريم الطلاب المنضبطين في الطابور الصباحي ومنح حوافز تشجيعية للفصول الأكثر مواظبة.</li>
            </ul>
        </div>
    `;

    body += generateWordFooter();
    downloadWordDoc(body, `الخطة_العلاجية_للغياب_${currentSelectedDate}.doc`);
};

window.printAbsenceRemedialPlan = function() {
    const html = `
        <div class="official-letterhead">
            <div class="letterhead-right">
                المملكة العربية السعودية<br>
                وزارة التعليم<br>
                الإدارة العامة للتعليم بمحافظة الأحساء<br>
                مدرسة الجشة المتوسطة - قسم التوجيه الطلابي
            </div>
            <div class="letterhead-center">
                <h2>الخطة الإجرائية والعلاجية للتعامل مع غياب الطلاب</h2>
                <div class="sub">وفق الإجراءات والضوابط المعتمدة بحذافيرها (3 - 5 - 10 أيام) | التاريخ: ${currentSelectedDate}</div>
            </div>
            <div class="letterhead-left" style="text-align: left;">
                إعداد: الموجه الطلابي<br>
                <strong>عبدالهادي بن محمد المحسن</strong><br>
                الاعتماد: مدير المدرسة<br>
                <strong>أحمد بن ناصر الدوسري</strong>
            </div>
        </div>

        <div class="doc-box" style="border-right: 4px solid #008375; background: #f0fdf4; margin-bottom: 12px; padding: 10px 14px;">
            <strong style="color: #065f46; display: block; margin-bottom: 4px; font-size: 13.5px;">🌱 الركيزة الأساسية والتوجيه الأولي العام:</strong>
            <div style="font-size: 12.5px; color: #1e293b; line-height: 1.8;">
                • <strong>التواصل الفوري:</strong> التواصل مع ولي الأمر في نفس اليوم الذي تغيب فيه الطالب من خلال الرسالة النصية أو المكالمة الهاتفية للاستفسار عن سبب الغياب.<br>
                • <strong>المرتكز النظامي:</strong> استمرارية تقديم الخدمات التعليمية وعدم التسبب في انقطاعها ومتابعة خطة التعلم في أيام الغياب.
            </div>
        </div>

        <div class="doc-box" style="border-right: 4px solid #0284c7;">
            <strong style="color: #0369a1; display: block; margin-bottom: 6px; font-size: 13px;">أولاً: مصفوفة الإجراءات الواجب اتخاذها بحذافيرها (سواء كانت أيام الغياب متصلة أو منفصلة):</strong>
            <table>
                <thead>
                    <tr>
                        <th style="width: 20%;">المستوى</th>
                        <th style="width: 16%; text-align: center;">أيام الغياب</th>
                        <th>الإجراءات النظامية والتربوية الواجب اتخاذها بحذافيرها</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>المستوى الأول</strong></td>
                        <td style="text-align: center; font-weight: bold; color: #b45309;">3 أيام</td>
                        <td>
                            1. <strong>تحويل الطالب للموجه الطلابي</strong> لتقديم الدعم والخدمات التربوية المناسبة له (خطة التعلم في أيام الغياب)، ودراسة الحالة إذا احتاج الأمر.<br>
                            2. <strong>استدعاء ولي الأمر، ويعقد اجتماع حضوري معه يتضمن:</strong> إبلاغه بالإجراءات المترتبة على غياب ابنه، وتقييم الخدمات التربوية والخطة العلاجية المقدمة للطالب، وتحديثها بما يلزم وفق الحالة.
                        </td>
                    </tr>
                    <tr>
                        <td><strong>المستوى الثاني</strong></td>
                        <td style="text-align: center; font-weight: bold; color: #c2410c;">5 أيام</td>
                        <td>
                            في حال عدم التزام ولي الأمر بالخطة التربوية (خطة التعلم في أيام الغياب)، <strong>يُحال الطالب إلى لجنة التوجيه الطلابي</strong>، ويتم <strong>تنظيم جلسة توعوية مع ولي الأمر</strong>؛ للتأكيد على أهمية اتباع الخطط التربوية والعلاجية.
                        </td>
                    </tr>
                    <tr>
                        <td><strong>المستوى الثالث</strong></td>
                        <td style="text-align: center; font-weight: bold; color: #9f1239;">10 أيام فأكثر</td>
                        <td>
                            1. في حال الاشتباه بتعرض الطالب للإهمال <strong>تخاطب المدرسة الجهات ذات الاختصاص حيال تطبيق ما ورد في نظام حماية الطفل ونظام الحماية من الإيذاء ولائحتهما التنفيذية</strong>، و<strong>إشعار إدارة التعليم بذلك</strong>.<br>
                            2. <strong>تتخذ المدرسة الإجراءات النظامية المطلوبة</strong> بالتنسيق والمتابعة مع الجهات ذات الاختصاص المذكورة في الفقرة السابقة حيال ما تم من إجراءات للحالات المحالة لهم.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="doc-box" style="border-right: 4px solid #059669;">
            <strong style="color: #065f46; display: block; margin-bottom: 6px; font-size: 13px;">ثانياً: خطة التعلم في أيام الغياب وآليات المتابعة:</strong>
            <div style="font-size: 12px; line-height: 1.8;">
                • إتاحة وتكليف الطالب بالواجبات والمهام التعليمية والدروس عبر منصة مدرستي لضمان عدم انقطاع تحصيله الدراسي.<br>
                • متابعة الموجه الطلابي لجلسات التوعية مع أولياء الأمور وتوثيق التعهدات والخطط العلاجية.<br>
                • تطبيق آليات التعزيز والتحفيز وتكريم الطلاب المنضبطين في الطابور الصباحي.
            </div>
        </div>

        <div class="sig-container">
            <div class="sig-box">
                الموجه الطلابي بالمدرسة<br><br>
                <strong>عبدالهادي بن محمد المحسن</strong><br>
                التوقيع: ............................
            </div>
            <div class="sig-box">
                ختم المدرسة الرسمي<br><br>
                ( ............................ )
            </div>
            <div class="sig-box">
                مدير مدرسة الجشة المتوسطة<br><br>
                <strong>أحمد بن ناصر الدوسري</strong><br>
                التوقيع: ............................
            </div>
        </div>
    `;

    window.printHtmlDocument(html, `الخطة_العلاجية_للغياب_${currentSelectedDate}`);
};

// ------------------------------------------
// D. الخطة العلاجية للحد من التأخر الصباحي (فرسان البكور)
// ------------------------------------------
window.openTardinessRemedialModal = function() {
    window.switchTardRemTab(currentTardRemTab || 'stages');
    window.openModal('tardinessRemedialModal');
};

window.switchTardRemTab = function(tab) {
    currentTardRemTab = tab;
    const btnStages = document.getElementById('tardRemTabStagesBtn');
    const btnStudents = document.getElementById('tardRemTabStudentsBtn');
    const btnCharter = document.getElementById('tardRemTabCharterBtn');

    [btnStages, btnStudents, btnCharter].forEach(b => b?.classList.remove('active'));

    const stagesDiv = document.getElementById('tardRemStagesContent');
    const studentsDiv = document.getElementById('tardRemStudentsContent');
    const charterDiv = document.getElementById('tardRemCharterContent');

    if (stagesDiv) stagesDiv.style.display = 'none';
    if (studentsDiv) studentsDiv.style.display = 'none';
    if (charterDiv) charterDiv.style.display = 'none';

    if (tab === 'stages') {
        btnStages?.classList.add('active');
        if (stagesDiv) stagesDiv.style.display = 'block';
    } else if (tab === 'students') {
        btnStudents?.classList.add('active');
        if (studentsDiv) studentsDiv.style.display = 'block';
        renderTardinessRemedialStudents();
    } else {
        btnCharter?.classList.add('active');
        if (charterDiv) charterDiv.style.display = 'block';
    }
};

function renderTardinessRemedialStudents() {
    const container = document.getElementById('tardRemStudentsContent');
    const countBadge = document.getElementById('tardRemStudentCount');
    if (!container) return;

    const list = students.map(s => {
        const stats = getStudentSummary(s.id);
        return { ...s, totalLate: stats.late };
    }).filter(s => s.totalLate >= 1).sort((a, b) => b.totalLate - a.totalLate);

    if (countBadge) countBadge.innerText = list.length;

    if (list.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; background: #f8fafc; border-radius: 12px;">
                <p style="color: var(--text-muted); margin: 0;">لا يوجد طلاب متأخرون صباحاً مسجلون في النظام.</p>
            </div>
        `;
        return;
    }

    let html = `
        <table class="report-table" style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
            <thead>
                <tr style="background: #f1f5f9; text-align: right;">
                    <th style="padding: 10px;">الطالب</th>
                    <th style="padding: 10px;">الصف</th>
                    <th style="padding: 10px; text-align: center;">مرات التأخر</th>
                    <th style="padding: 10px;">مستوى العلاج الصباحي</th>
                    <th style="padding: 10px; text-align: center;">الإجراءات</th>
                </tr>
            </thead>
            <tbody>
    `;

    list.forEach(s => {
        let levelText = '';
        let levelColor = '#0369a1';
        let levelBg = '#e0f2fe';

        if (s.totalLate >= 10) {
            levelText = 'المرحلة 4: حسم مواظبة واستدعاء نهائي';
            levelColor = '#9f1239';
            levelBg = '#ffe4e6';
        } else if (s.totalLate >= 7) {
            levelText = 'المرحلة 3: فرسان البكور والتعاقد السلوكي';
            levelColor = '#c2410c';
            levelBg = '#ffedd5';
        } else if (s.totalLate >= 4) {
            levelText = 'المرحلة 2: تعديل النوم وإشراك في الطابور';
            levelColor = '#b45309';
            levelBg = '#fef3c7';
        } else {
            levelText = 'المرحلة 1: توجيه واستقبال إيجابي';
            levelColor = '#0369a1';
            levelBg = '#e0f2fe';
        }

        html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px; font-weight: 700;">${s.name}</td>
                <td style="padding: 10px;">${s.class}</td>
                <td style="padding: 10px; text-align: center; color: #b45309; font-weight: 800;">${s.totalLate}</td>
                <td style="padding: 10px;">
                    <span style="background: ${levelBg}; color: ${levelColor}; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 12px;">
                        ${levelText}
                    </span>
                </td>
                <td style="padding: 10px; text-align: center;">
                    <button class="btn" style="background: #f59e0b; color: white; padding: 4px 10px; font-size: 12px;" onclick="window.openStudentRemedialCard('${s.id}', 'tardiness')">
                        ميثاق الانضباط 📝
                    </button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

window.exportTardinessRemedialPlanWord = function() {
    let title = `الخطة العلاجية للحد من التأخر الصباحي (مبادرة فرسان البكور)`;
    let body = generateWordLetterhead(title);

    body += `
        <div style="font-size: 14px; line-height: 1.8; margin-bottom: 20px;">
            <p><strong>مبادرة فرسان البكور:</strong> خطة إرشادية متكاملة لغرس قيمة البكور والانضباط الصباحي لدى طلاب مدرسة الجشة المتوسطة، والحد من التأخر عن الطابور الصباحي عبر التدخل التربوي المتدرج والشراكة المنزلية الفاعلة.</p>
            
            <h4 style="color: #92400e; margin: 15px 0 8px 0;">أولاً: خطة معالجة التأخر الصباحي المتدرجة:</h4>
            <table class="content-table">
                <thead>
                    <tr>
                        <th style="width: 25%;">المرحلة</th>
                        <th style="width: 20%;">مرات التأخر</th>
                        <th style="width: 55%;">الإجراءات العلاجية ومبادرات التحفيز</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight: bold;">المرحلة 1: الاستقبال والتسجيل</td>
                        <td>1 - 3 مرات</td>
                        <td>استقبال تربوي هادئ، إشعار فوري لولي الأمر بوقت الوصول، توجيه بأهمية التمارين والإذاعة الصباحية.</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold;">المرحلة 2: تنظيم النوم والإرشاد</td>
                        <td>4 - 6 مرات</td>
                        <td>جلسة إرشاد فردية لبحث السهر والهواتف الذكية، تزويد الأسرة بجدول تنظيم النوم، تكليف الطالب بمهام صباحية محفزة.</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold;">المرحلة 3: التعاقد ومبادرة البكور</td>
                        <td>7 - 9 مرات</td>
                        <td>استدعاء ولي الأمر وتوقيع عقد التزام البكور المدرسي، إدراج الطالب في حوافز فرسان البكور عند التحسن.</td>
                    </tr>
                    <tr>
                        <td style="font-weight: bold;">المرحلة 4: الحزم وتطبيق اللائحة</td>
                        <td>10 مرات فأكثر</td>
                        <td>تطبيق حسم (0.5) درجة عن كل تأخر غير مبرر وفق لائحة السلوك والمواظبة، إشعار نهائي لولي الأمر بالدرجات.</td>
                    </tr>
                </tbody>
            </table>

            <h4 style="color: #92400e; margin: 20px 0 8px 0;">ثانياً: ميثاق الانضباط الصباحي ومواعيد الحضور المبكر:</h4>
            <ul style="line-height: 1.8; font-size: 13px;">
                <li>يبدأ الاصطفاف الصباحي في تمام الساعة 6:45 صباحاً ويُعد الحضور قبله واجباً سلوكياً وتربوياً.</li>
                <li>النوم المبكر قبل الساعة 9:30 مساءً ينعكس مباشرة على النشاط الذهني والبدني للتحصيل الدراسي.</li>
                <li>يُكرم شهرياً "فرسان البكور" الأكثر التزاماً بالحضور المبكر بجوائز وشهادات تميز في الطابور المدرسي.</li>
            </ul>
        </div>
    `;

    body += generateWordFooter();
    downloadWordDoc(body, `خطة_علاج_التأخر_الصباحي_${currentSelectedDate}.doc`);
};

window.printTardinessRemedialPlan = function() {
    const html = `
        <div class="official-letterhead">
            <div class="letterhead-right">
                المملكة العربية السعودية<br>
                وزارة التعليم<br>
                الإدارة العامة للتعليم بمحافظة الأحساء<br>
                مدرسة الجشة المتوسطة - قسم التوجيه الطلابي
            </div>
            <div class="letterhead-center">
                <h2>خطة علاج التأخر الصباحي - مبادرة "فرسان البكور"</h2>
                <div class="sub">العام الدراسي 1448هـ | التاريخ: ${currentSelectedDate}</div>
            </div>
            <div class="letterhead-left" style="text-align: left;">
                إعداد: الموجه الطلابي<br>
                <strong>عبدالهادي بن محمد المحسن</strong><br>
                الاعتماد: مدير المدرسة<br>
                <strong>أحمد بن ناصر الدوسري</strong>
            </div>
        </div>

        <div class="doc-box" style="border-right: 4px solid #f59e0b;">
            <strong style="color: #b45309; display: block; margin-bottom: 6px; font-size: 13px;">أولاً: مراحل وخطة معالجة التأخر الصباحي (4 مستويات إجرائية):</strong>
            <table>
                <thead>
                    <tr>
                        <th style="width: 25%;">المرحلة والتصنيف</th>
                        <th style="width: 15%; text-align: center;">مرات التأخر</th>
                        <th>الإجراءات التربوية والإرشادية المعتمدة</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>المرحلة 1: الاستقبال والتوجيه</strong></td>
                        <td style="text-align: center;">1 - 3 مرات</td>
                        <td>تسجيل وقت الدخول، استقبال تربوي هادئ عند البوابة، إرسال إشعار فوري لولي الأمر عبر النظام، حث الطالب على التبكير.</td>
                    </tr>
                    <tr>
                        <td><strong>المرحلة 2: التعاقد وتنظيم النوم</strong></td>
                        <td style="text-align: center;">4 - 6 مرات</td>
                        <td>جلسة إرشادية لبحث أسباب السهر والنوم المتأخر، استدعاء ولي الأمر، توقيع ميثاق الانضباط الصباحي وجدول تنظيم النوم.</td>
                    </tr>
                    <tr>
                        <td><strong>المرحلة 3: بطاقة البكور والتحفيز</strong></td>
                        <td style="text-align: center;">7 - 9 مرات</td>
                        <td>إشراك الطالب في برنامج فرسان البكور، بطاقة توقيع يومية مع مناوب الصباح، تكليف بمهام قيادية في الطابور الصباحي.</td>
                    </tr>
                    <tr>
                        <td><strong>المرحلة 4: التدابير النظامية</strong></td>
                        <td style="text-align: center;">10 مرات فأكثر</td>
                        <td>تطبيق حسم درجات المواظبة بحسب قواعد السلوك، دراسة حالة مفصلة لدى الموجه الطلابي، العرض على إدارة المدرسة لاتخاذ الإجراءات النظامية.</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="doc-box" style="border-right: 4px solid #10b981;">
            <strong style="color: #047857; display: block; margin-bottom: 6px; font-size: 13px;">ثانياً: ميثاق الانضباط الصباحي ومواعيد الحضور المبكر:</strong>
            <div style="font-size: 12px; line-height: 1.8;">
                • يبدأ الاصطفاف الصباحي في تمام الساعة 6:45 صباحاً ويُعد الحضور قبله واجباً سلوكياً وتربوياً.<br>
                • النوم المبكر قبل الساعة 9:30 مساءً ينعكس مباشرة على النشاط الذهني والبدني للتحصيل الدراسي.<br>
                • يُكرم شهرياً "فرسان البكور" الأكثر التزاماً بالحضور المبكر بجوائز وشهادات تميز في الطابور المدرسي.
            </div>
        </div>

        <div class="sig-container">
            <div class="sig-box">
                الموجه الطلابي بالمدرسة<br><br>
                <strong>عبدالهادي بن محمد المحسن</strong><br>
                التوقيع: ............................
            </div>
            <div class="sig-box">
                ختم المدرسة الرسمي<br><br>
                ( ............................ )
            </div>
            <div class="sig-box">
                مدير مدرسة الجشة المتوسطة<br><br>
                <strong>أحمد بن ناصر الدوسري</strong><br>
                التوقيع: ............................
            </div>
        </div>
    `;

    window.printHtmlDocument(html, `خطة_علاج_التأخر_الصباحي_${currentSelectedDate}`);
};

// ------------------------------------------
// E. استمارة رعاية ومتابعة الحالة الفردية للطالب
// ------------------------------------------
window.openStudentRemedialCard = function(studentId, type = 'absence') {
    currentIndividualStudentId = studentId;
    currentIndividualPlanType = type;

    const student = students.find(s => s.id === studentId);
    if (!student) return;

    const stats = getStudentSummary(studentId);
    const container = document.getElementById('individualPlanPrintArea');
    if (!container) return;

    const isAbsence = type === 'absence';
    const issueTitle = isAbsence ? 'معالجة تكرار الغياب المدرسي' : 'معالجة تكرار التأخر الصباحي (برنامج البكور)';
    const countLabel = isAbsence ? 'مجموع أيام الغياب' : 'مجموع مرات التأخر';
    const currentCount = isAbsence ? stats.absent : stats.late;

    let targetStage = '';
    let stageColor = '#1d4ed8';
    let stageBg = '#eff6ff';
    let stageBorder = '#bfdbfe';

    if (isAbsence) {
        if (currentCount >= 10) {
            targetStage = 'المستوى الثالث (10 أيام غياب فأكثر: مخاطبة جهات الاختصاص وحماية الطفل)';
            stageColor = '#9f1239';
            stageBg = '#ffe4e6';
            stageBorder = '#fecdd3';
        } else if (currentCount >= 5) {
            targetStage = 'المستوى الثاني (5 أيام غياب: إحالة للجنة التوجيه وجلسة توعوية)';
            stageColor = '#c2410c';
            stageBg = '#ffedd5';
            stageBorder = '#fed7aa';
        } else if (currentCount >= 3) {
            targetStage = 'المستوى الأول (3 أيام غياب: تحويل للموجه واستدعاء ولي الأمر)';
            stageColor = '#b45309';
            stageBg = '#fef3c7';
            stageBorder = '#fde68a';
        } else {
            targetStage = 'التوجيه الأولي العام (التواصل في نفس اليوم بالرسالة أو المكالمة)';
            stageColor = '#047857';
            stageBg = '#ecfdf5';
            stageBorder = '#a7f3d0';
        }
    } else {
        if (currentCount >= 10) targetStage = 'المرحلة الرابعة (تدابير نظامية وقواعد السلوك)';
        else if (currentCount >= 7) targetStage = 'المرحلة الثالثة (دعم أكاديمي وسلوكي مكثف)';
        else if (currentCount >= 4) targetStage = 'المرحلة الثانية (إرشاد فردي وتعاقد أسري)';
        else targetStage = 'المرحلة الأولى (توجيه ومتابعة أولية)';
    }

    let procedureHtml = '';
    if (isAbsence) {
        let actionItems = '';
        if (currentCount >= 10) {
            actionItems = `
                <li style="margin-bottom: 6px;">في حال الاشتباه بتعرض الطالب للإهمال <strong>تخاطب المدرسة الجهات ذات الاختصاص</strong> حيال تطبيق ما ورد في <strong>نظام حماية الطفل ونظام الحماية من الإيذاء ولائحتهما التنفيذية</strong>، و<strong>إشعار إدارة التعليم بذلك</strong>.</li>
                <li><strong>تتخذ المدرسة الإجراءات النظامية المطلوبة</strong> بالتنسيق والمتابعة مع الجهات ذات الاختصاص المذكورة في الفقرة السابقة حيال ما تم من إجراءات للحالات المحالة لهم.</li>
            `;
        } else if (currentCount >= 5) {
            actionItems = `
                <li>في حال عدم التزام ولي الأمر بالخطة التربوية (<strong>خطة التعلم في أيام الغياب</strong>)، <strong>يُحال الطالب إلى لجنة التوجيه الطلابي</strong>، ويتم <strong>تنظيم جلسة توعوية مع ولي الأمر</strong>؛ للتأكيد على أهمية اتباع الخطط التربوية والعلاجية.</li>
            `;
        } else if (currentCount >= 3) {
            actionItems = `
                <li style="margin-bottom: 6px;"><strong>تحويل الطالب للموجه الطلابي</strong> لتقديم الدعم والخدمات التربوية المناسبة له (<strong>خطة التعلم في أيام الغياب</strong>)، ودراسة الحالة إذا احتاج الأمر.</li>
                <li><strong>استدعاء ولي الأمر، ويعقد اجتماع حضوري معه يتضمن ما يلي:</strong>
                    <ul style="margin-top: 4px; padding-right: 18px; list-style-type: circle; color: #334155;">
                        <li>إبلاغه بالإجراءات المترتبة على غياب ابنه.</li>
                        <li>تقييم الخدمات التربوية والخطة العلاجية المقدمة للطالب، وتحديثها بما يلزم وفق الحالة.</li>
                    </ul>
                </li>
            `;
        } else {
            actionItems = `
                <li><strong>التواصل مع ولي الأمر في نفس اليوم</strong> الذي تغيب فيه الطالب من خلال الرسالة النصية أو المكالمة الهاتفية للاستفسار عن سبب الغياب.</li>
            `;
        }

        procedureHtml = `
            <div style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; line-height: 1.7; background: #ffffff;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <strong style="color: #0f172a; font-size: 13px;">الإجراءات الواجب اتخاذها بحذافيرها (وفق تنظيم وزارة التعليم):</strong>
                    <span style="background: #f0fdf4; color: #047857; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; border: 1px solid #bbf7d0;">
                        استمرارية تقديم الخدمات التعليمية وعدم انقطاعها 🌱
                    </span>
                </div>
                <div style="background: #f8fafc; border-right: 3px solid #008375; padding: 6px 10px; margin-bottom: 8px; font-size: 12px; color: #334155;">
                    📌 <strong>التوجيه الأولي العام:</strong> التواصل مع ولي الأمر في نفس اليوم الذي تغيب فيه الطالب عبر الرسالة النصية أو المكالمة الهاتفية للاستفسار عن سبب الغياب.
                </div>
                <ul style="margin: 0; padding-right: 20px; color: #1e293b;">
                    ${actionItems}
                </ul>
            </div>
            <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; line-height: 1.65; background: #ffffff;">
                <strong style="color: #0f172a; display: block; margin-bottom: 4px; font-size: 13px;">تشخيص الحالة وخطة التعلم في أيام الغياب:</strong>
                <ul style="margin: 0; padding-right: 20px; color: #334155;">
                    <li>دراسة أسباب الغياب سواء كانت (أيام متصلة أو منفصلة) والتحقق من المبررات المقدمة.</li>
                    <li><strong>خطة التعلم في أيام الغياب:</strong> تمكين الطالب من الدروس والواجبات المفقودة عبر منصة مدرستي لضمان استمرارية التعلم.</li>
                    <li>تنسيق الشراكة التربوية المستمرة مع ولي الأمر وتوثيق متابعة الخطة العلاجية.</li>
                </ul>
            </div>
        `;
    } else {
        procedureHtml = `
            <div style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 12.5px; line-height: 1.65; background: #ffffff;">
                <strong style="color: #0f172a; display: block; margin-bottom: 4px; font-size: 13px;">تشخيص الحالة والعوامل المؤثرة:</strong>
                <ul style="margin: 0; padding-right: 20px; color: #334155;">
                    <li>دراسة عادات النوم والسهر واستخدام الأجهزة الذكية ليلاً.</li>
                    <li>بحث ترتيبات النقل المدرسي والمواصلات الصباحية.</li>
                    <li>تنسيق الشراكة مع ولي الأمر لتوحيد جهود المتابعة والانضباط الصباحي.</li>
                </ul>
            </div>
        `;
    }

    container.innerHTML = `
        <div style="border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 14px; text-align: center;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; font-weight: 700; color: #334155; line-height: 1.6;">
                <div style="text-align: right; white-space: nowrap; min-width: 200px;">
                    المملكة العربية السعودية<br>
                    وزارة التعليم<br>
                    <span style="white-space: nowrap; display: inline-block;">الإدارة العامة للتعليم بمحافظة الأحساء</span><br>
                    مدرسة الجشة المتوسطة
                </div>
                <div style="text-align: center; flex: 1; padding: 0 10px;">
                    <h3 style="margin: 0 0 6px 0; color: #1e3a8a; font-size: 18px; font-weight: 800;">استمارة خطة المتابعة والعلاج الفردي</h3>
                    <div style="font-size: 12px; color: #64748b; font-weight: 700;">العام الدراسي 1448هـ | التاريخ: ${currentSelectedDate}</div>
                </div>
                <div style="min-width: 200px; visibility: hidden;" aria-hidden="true">
                    <!-- spacer لضمان توسيط العنوان بدقة في المنتصف -->
                </div>
            </div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px; color: #0f172a;">
                <div>اسم الطالب: <strong style="color: #0f172a;">${student.name}</strong></div>
                <div>الصف والفصل: <strong style="color: #0f172a;">${student.class}</strong></div>
                <div>السجل المدني: <strong style="color: #0f172a;">${student.nationalId || 'غير مسجل'}</strong></div>
                <div>رقم جوال ولي الأمر: <strong style="direction: ltr; display: inline-block; color: #0f172a;">${student.phone || 'غير مسجل'}</strong></div>
            </div>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 12px;">
            <div style="flex: 1; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 10px; padding: 10px 12px; text-align: center;">
                <span style="font-size: 12px; color: #9f1239; font-weight: 700; display: block; margin-bottom: 2px;">${countLabel}</span>
                <strong style="font-size: 22px; color: #e11d48; line-height: 1;">${currentCount}</strong>
            </div>
            <div style="flex: 2; background: ${stageBg}; border: 1px solid ${stageBorder}; border-radius: 10px; padding: 10px 12px; text-align: center;">
                <span style="font-size: 12px; color: ${stageColor}; font-weight: 700; display: block; margin-bottom: 2px;">المستوى الإجرائي والتنظيمي المعتمد للطالب</span>
                <strong style="font-size: 13.5px; color: ${stageColor}; line-height: 1.4;">${targetStage}</strong>
            </div>
        </div>

        ${procedureHtml}

        <div style="border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: 12.5px; line-height: 1.65;">
            <strong style="color: #166534; display: block; margin-bottom: 4px; font-size: 13px;">ميثاق الالتزام والتعهد التربوي:</strong>
            <p style="margin: 0; color: #15803d; line-height: 1.6;">
                أتعهد أنا الطالب/ <strong>${student.name}</strong> وبإشراف ومتابعة ولي أمري بالالتزام التام بمواعيد الحضور والمواظبة اليومية وعدم ${isAbsence ? 'الغياب' : 'التأخر الصباحي'}، والالتزام بمتابعة خطة التعلم والواجبات لضمان استمرارية التحصيل والتفوق الدراسي.
            </p>
        </div>

        <table style="width: 100%; margin-top: 14px; border-top: 1px dashed #cbd5e1; padding-top: 10px; border-collapse: collapse; page-break-inside: avoid;">
            <tr>
                <td style="width: 33.33%; text-align: center; vertical-align: top; font-size: 12.5px; font-weight: 700; color: #0f172a; padding: 6px 4px;">
                    <div>توقيع ولي أمر الطالب</div>
                    <div style="margin-top: 25px; color: #64748b;">..................................</div>
                </td>
                <td style="width: 33.33%; text-align: center; vertical-align: top; font-size: 12.5px; font-weight: 700; color: #0f172a; padding: 6px 4px;">
                    <div>الموجه الطلابي</div>
                    <div style="color: #1e3a8a; font-weight: 800; margin-top: 5px;">عبدالهادي بن محمد المحسن</div>
                    <div style="margin-top: 6px; color: #64748b;">..................................</div>
                </td>
                <td style="width: 33.33%; text-align: center; vertical-align: top; font-size: 12.5px; font-weight: 700; color: #0f172a; padding: 6px 4px;">
                    <div>مدير المدرسة</div>
                    <div style="color: #1e3a8a; font-weight: 800; margin-top: 5px;">أحمد بن ناصر الدوسري</div>
                    <div style="margin-top: 6px; color: #64748b;">..................................</div>
                </td>
            </tr>
        </table>
    `;

    window.openModal('individualPlanModal');
};

window.printIndividualPlan = function() {
    const container = document.getElementById('individualPlanPrintArea');
    if (!container) return;

    const student = students.find(s => s.id === currentIndividualStudentId);
    const studentName = student ? student.name : 'طالب';

    // Print exact container contents directly without altering format
    window.printHtmlDocument(container.innerHTML, `استمارة_متابعة_${studentName}_${currentSelectedDate}`);
};

window.downloadIndividualPlanPdf = function() {
    const container = document.getElementById('individualPlanPrintArea');
    if (!container) return;

    const student = students.find(s => s.id === currentIndividualStudentId);
    const studentName = student ? student.name : 'طالب';
    const filename = `استمارة_متابعة_${studentName}_${currentSelectedDate}.pdf`;

    if (window.showBottomNotification) {
        window.showBottomNotification('جاري تجهيز الاستمارة 📥', 'يتم الآن إنشاء وتصدير استمارة الطالب بصيغة PDF بدقة عالية...', 'info');
    }

    const planHtml = `
        <div class="official-pdf-page" style="direction: rtl; text-align: right; font-family: 'Tajawal', Arial, Tahoma, sans-serif !important; color: #0f172a; background: #ffffff; width: 794px; box-sizing: border-box; padding: 16px 20px;">
            ${container.innerHTML}
        </div>
    `;

    window.exportHtmlToPdf(planHtml, filename, {
        margin: [5, 5, 5, 5],
        padding: '16px 20px'
    });
};

window.sendIndividualPlanWhatsApp = function() {
    if (!currentIndividualStudentId) return;
    const student = students.find(s => s.id === currentIndividualStudentId);
    if (!student) return;

    const stats = getStudentSummary(student.id);
    const isAbsence = currentIndividualPlanType === 'absence';
    const phone = sanitizePhoneNumber(student.phone);

    let msg = `السلام عليكم ورحمة الله وبركاته\nالمكرم ولي أمر الطالب: ${student.name} (الصف: ${student.class})\n\nنفيدكم بأنه تم إدراج ابنكم في الخطة الإرشادية الفردية لـ(${isAbsence ? 'معالجة الغياب المدرسي' : 'معالجة التأخر الصباحي - فرسان البكور'}) بمدرسة الجشة المتوسطة [الإحصائية: ${isAbsence ? stats.absent + ' أيام غياب' : stats.late + ' مرات تأخر'}].\n\nنأمل التكرم بالتعاون معنا لتنفيذ توصيات الخطة ومتابعة مواظبة الطالب يومياً حفاظاً على مستواه العلمي ودرجات المواظبة.\n\nالموجه الطلابي: عبدالهادي بن محمد المحسن\nمدرسة الجشة المتوسطة - قسم التوجيه الطلابي`;

    if (!phone) {
        navigator.clipboard.writeText(msg);
        showBottomNotification('📱 تم نسخ النص', 'تم نسخ رسالة الخطة الفردية لعدم توفر رقم جوال مسجل.', 'info');
        return;
    }

    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`, '_blank');
};

// ==========================================
// 10. Data Backup & Excel Import
// ==========================================
window.backupData = function() {
    const backup = {
        students,
        attendanceData,
        backupDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `نسخة_احتياطية_مدرسة_الجشة_${getTodayDate()}.json`;
    a.click();
};

window.restoreBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.students && data.attendanceData) {
                students = sortStudentsAlphabetically(data.students);
                attendanceData = data.attendanceData;
                localStorage.setItem('students_list_master_v3', JSON.stringify(students));
                localStorage.setItem('student_attendance_v3', JSON.stringify(attendanceData));
                syncToCloud();
                initAdminView();
                showAlert('نجاح', 'تمت استعادة البيانات بنجاح ✅');
            } else {
                showAlert('خطأ', 'ملف النسخة الاحتياطية غير صالح');
            }
        } catch (err) {
            showAlert('خطأ', 'تعذر قراءة ملف النسخة الاحتياطية');
        }
    };
    reader.readAsText(file);
};

window.importStudents = function(event) {
    const file = event.target.files[0];
    if (!file || !window.XLSX) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = window.XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

            let imported = [];
            // Parse headers
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;
                const name = row[0] || row[1] || '';
                const nid = row[1] || row[0] || '';
                const cls = row[2] || 'عام';
                const phone = row[3] || '';
                if (name) {
                    imported.push({
                        id: 's_' + Date.now() + '_' + i,
                        name: String(name).trim(),
                        nationalId: String(nid).trim(),
                        class: String(cls).trim(),
                        phone: String(phone).trim()
                    });
                }
            }

            if (imported.length > 0) {
                showConfirm('استيراد إكسل', `تم العثور على ${imported.length} طالب. هل تريد استبدال القائمة الحالية (نعم) أو الإضافة إليها (إلغاء)?`, () => {
                    students = sortStudentsAlphabetically(imported);
                    localStorage.setItem('students_list_master_v3', JSON.stringify(students));
                    syncToCloud();
                    populateClassFilter();
                    renderTable();
                    showAlert('نجاح', `تم استيراد ${imported.length} طالب بنجاح ✅`);
                });
            }
        } catch (err) {
            showAlert('خطأ', 'تعذر قراءة ملف إكسل');
        }
    };
    reader.readAsArrayBuffer(file);
};

window.confirmDeleteAllData = function() {
    showConfirm('تأكيد التصفير الشامل', 'تحذير: هذا الإجراء سيمسح جميع بيانات الطلاب وسجلات الحضور نهائياً! هل أنت متأكد؟', () => {
        students = [];
        attendanceData = {};
        localStorage.clear();
        syncToCloud();
        initAdminView();
        showAlert('تم', 'تم مسح جميع البيانات بنجاح');
    });
};

// ==========================================
// 11. Modal Helpers & Alert System
// ==========================================
window.openModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
};

window.closeModals = function() {
    if (typeof window.closeLiveCameraModal === 'function') {
        window.closeLiveCameraModal();
    }
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
};

window.showAlert = function(title, msg) {
    document.getElementById('customAlertTitle').innerText = title;
    document.getElementById('customAlertMessage').innerText = msg;
    const btnBox = document.getElementById('customAlertButtons');
    btnBox.innerHTML = `<button class="modal-btn" style="max-width: 120px;" onclick="window.closeModals()">حسناً</button>`;
    window.openModal('customAlertModal');
};
const showAlert = window.showAlert;

window.showConfirm = function(title, msg, onConfirm) {
    document.getElementById('customAlertTitle').innerText = title;
    document.getElementById('customAlertMessage').innerText = msg;
    const btnBox = document.getElementById('customAlertButtons');
    btnBox.innerHTML = `
        <button class="modal-btn" style="max-width: 120px; background: var(--danger);" id="confirmBtnYes">تأكيد</button>
        <button class="modal-btn" style="max-width: 120px; background: #f1f5f9; color: var(--text-main);" onclick="window.closeModals()">إلغاء</button>
    `;
    document.getElementById('confirmBtnYes').onclick = () => {
        window.closeModals();
        onConfirm();
    };
    window.openModal('customAlertModal');
};
const showConfirm = window.showConfirm;

// ==========================================
// 12. App Initialization
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    updateAdminEmailDisplays();
    initCloudListeners();
});
