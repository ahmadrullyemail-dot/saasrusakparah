import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import Presensi from './Presensi.jsx';
import { APP_THEMES, NAVIGATION_TABS, STATUS_LABELS, USER_ROLE_LABELS } from './config.js';
import { addDaysToDate, api, compressProfilePhoto, documentState, documentTypeName, excelDateString, localDateString } from './lib/hrd.js';
import { AuthScreen } from './components/AuthScreen.jsx';
import { AttendancePanel } from './components/AttendancePanel.jsx';
import { WorkersPanel } from './components/WorkersPanel.jsx';
import { AttendanceLocationsMap } from './components/AttendanceLocationsMap.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { StatCard, StatusBadge } from './components/StatCard.jsx';
import { WorkerModal } from './components/WorkerModal.jsx';

function WorkspaceApp() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [workers, setWorkers] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [documentTypesLoading, setDocumentTypesLoading] = useState(true);
  const [attendanceDate, setAttendanceDate] = useState(localDateString());
  const [attendanceMonth, setAttendanceMonth] = useState(localDateString().slice(0, 7));
  const [attendanceData, setAttendanceData] = useState({ attendance_date: '', records: [] });
  const [monthlyAttendance, setMonthlyAttendance] = useState({ month: '', days_in_month: 0, records: [] });
  const [attendanceLinks, setAttendanceLinks] = useState({});
  const [attendanceStatusDrafts, setAttendanceStatusDrafts] = useState({});
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [monthlyAttendanceLoading, setMonthlyAttendanceLoading] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendancePageSize, setAttendancePageSize] = useState(25);
  const [attendancePage, setAttendancePage] = useState(1);
  const [reviewingAttendance, setReviewingAttendance] = useState(null);
  const [attendanceSettings, setAttendanceSettings] = useState({
    salt_configured: false,
    anti_mock_location_enabled: false,
    updated_at: null,
  });
  const [attendanceLocations, setAttendanceLocations] = useState([]);
  const [documentSettings, setDocumentSettings] = useState({ warning_threshold_days: 30, updated_at: null });
  const [subscription, setSubscription] = useState(null);
  const [summary, setSummary] = useState(null);
  const [activityHistory, setActivityHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [filter, setFilter] = useState('all');
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerImportResult, setWorkerImportResult] = useState(null);
  const [scheduledInactiveDate, setScheduledInactiveDate] = useState(localDateString());
  const [profileWorkerSearch, setProfileWorkerSearch] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem('hrd-app-theme');
    return APP_THEMES.some(({ id }) => id === savedTheme) ? savedTheme : 'standard';
  });
  const [workerModalOpen, setWorkerModalOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState(null);
  const [documentStatus, setDocumentStatus] = useState('pending');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const workerImportInputRef = useRef(null);
  const realtimeRefreshTimerRef = useRef(null);
  const realtimeContextRef = useRef({ activeTab, attendanceDate, attendanceMonth });
  realtimeContextRef.current = { activeTab, attendanceDate, attendanceMonth };

  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch((requestError) => {
        setUser(null);
        if (requestError.status !== 401) setSessionError(requestError.message);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshDashboard().catch(showError);
    refreshWorkers().catch(showError);
    refreshSubscription().catch(showError);
    refreshDepartments().catch(showError);
    refreshDocumentTypes()
      .catch(showError)
      .finally(() => setDocumentTypesLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const socket = io({
      withCredentials: true,
      ...(import.meta.env.DEV ? {} : { transports: ['polling'] }),
    });
    let mounted = true;
    let reconnectTimer;
    const scheduleSync = () => {
      if (realtimeRefreshTimerRef.current) window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(async () => {
        try {
          const refreshTasks = [refreshDashboard(), refreshWorkers(), refreshSubscription()];
          const current = realtimeContextRef.current;
          if (current.activeTab === 'attendance') {
            refreshTasks.push(
              api(`/attendance?date=${encodeURIComponent(current.attendanceDate)}`).then((data) => {
                setAttendanceData(data);
                setAttendanceSettings((settings) => ({ ...settings, salt_configured: data.salt_configured }));
              }),
              api(`/attendance/month?month=${encodeURIComponent(current.attendanceMonth)}`).then(setMonthlyAttendance)
            );
          }
          if (current.activeTab === 'settings' && user.role === 'admin') {
            refreshTasks.push(
              refreshDocumentTypes(),
              api('/admin/attendance-settings').then(setAttendanceSettings),
              api('/admin/attendance-locations').then(setAttendanceLocations),
              api('/admin/document-settings').then(setDocumentSettings)
            );
          }
          if (current.activeTab === 'history' && ['admin', 'hr_manager'].includes(user.role)) {
            refreshTasks.push(api('/history?limit=100').then(setActivityHistory));
          }
          await Promise.all(refreshTasks);
        } catch (requestError) {
          if (mounted) showError(requestError);
        }
      }, 100);
    };
    const setConnected = () => {
      setRealtimeConnected(true);
      scheduleSync();
    };
    const setDisconnected = (reason) => {
      setRealtimeConnected(false);
      if (reason === 'io server disconnect') {
        reconnectTimer = window.setTimeout(() => {
          if (mounted) socket.connect();
        }, 1000);
      }
    };
    const eventNames = [
      'worker_changed',
      'attendance_updated',
      'approval_updated',
      'documents_updated',
      'dashboard_updated',
      'settings_updated',
      'user_changed',
      'history_updated',
    ];
    socket.on('connect', setConnected);
    socket.on('disconnect', setDisconnected);
    socket.on('connect_error', setDisconnected);
    eventNames.forEach((eventName) => socket.on(eventName, scheduleSync));
    return () => {
      mounted = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (realtimeRefreshTimerRef.current) window.clearTimeout(realtimeRefreshTimerRef.current);
      socket.disconnect();
      setRealtimeConnected(false);
    };
  }, [user]);

  useEffect(() => {
    window.localStorage.setItem('hrd-app-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!user || activeTab !== 'overview') return undefined;
    const refreshMetrics = () => {
      if (document.visibilityState === 'visible') {
        Promise.all([refreshDashboard(), refreshSubscription()]).catch(showError);
      }
    };
    document.addEventListener('visibilitychange', refreshMetrics);
    window.addEventListener('focus', refreshMetrics);
    const intervalId = window.setInterval(refreshMetrics, 15000);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshMetrics);
      window.removeEventListener('focus', refreshMetrics);
    };
  }, [activeTab, user]);

  useEffect(() => {
    if (!user || !['admin', 'hr_manager'].includes(user.role) || activeTab !== 'history') return undefined;
    let cancelled = false;
    const refreshHistory = async () => {
      setHistoryLoading(true);
      try {
        const rows = await api('/history?limit=100');
        if (!cancelled) setActivityHistory(rows);
      } catch (requestError) {
        if (!cancelled) showError(requestError);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    refreshHistory();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshHistory();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTab, user]);

  useEffect(() => {
    if (!user || activeTab !== 'attendance') return;
    setAttendanceLoading(true);
    setAttendanceStatusDrafts({});
    api(`/attendance?date=${encodeURIComponent(attendanceDate)}`)
      .then((data) => {
        setAttendanceData(data);
        setAttendanceSettings((current) => ({ ...current, salt_configured: data.salt_configured }));
      })
      .catch(showError)
      .finally(() => setAttendanceLoading(false));
  }, [activeTab, attendanceDate, user]);

  useEffect(() => {
    if (!user || activeTab !== 'attendance') return;
    setMonthlyAttendanceLoading(true);
    api(`/attendance/month?month=${encodeURIComponent(attendanceMonth)}`)
      .then(setMonthlyAttendance)
      .catch(showError)
      .finally(() => setMonthlyAttendanceLoading(false));
  }, [activeTab, attendanceMonth, user]);

  useEffect(() => {
    if (!user || user.role !== 'admin' || activeTab !== 'settings') return;
    setAdminUsersLoading(true);
    Promise.all([
      api('/admin/users'),
      api('/admin/attendance-settings'),
      api('/admin/attendance-locations'),
      api('/admin/document-settings'),
    ])
      .then(([users, settings, locations, documentSettingsResponse]) => {
        setAdminUsers(users);
        setAttendanceSettings(settings);
        setAttendanceLocations(locations);
        setDocumentSettings(documentSettingsResponse);
      })
      .catch(showError)
      .finally(() => setAdminUsersLoading(false));
  }, [activeTab, user]);

  useEffect(() => {
    if (!selectedId || !user) {
      setSelectedWorker(null);
      return;
    }
    api(`/workers/${selectedId}`)
      .then(setSelectedWorker)
      .catch(showError);
  }, [selectedId, user, workers]);

  async function refreshDashboard() {
    setSummary(await api('/dashboard'));
  }

  async function refreshSubscription() {
    setSubscription(await api('/subscription'));
  }

  async function refreshWorkers() {
    setWorkers(await api('/workers'));
  }

  async function refreshDepartments() {
    setDepartmentOptions(await api('/departments'));
  }

  async function refreshDocumentTypes() {
    setDocumentTypes(await api('/document-types'));
  }

  async function createAttendanceLink(workerId) {
    setError('');
    setNotice('');
    try {
      const { token, worker_id: linkedWorkerId } = await api(`/workers/${workerId}/attendance-link`, { method: 'POST' });
      const link = `${window.location.origin}/presensi?worker_id=${encodeURIComponent(linkedWorkerId)}&token=${encodeURIComponent(token)}`;
      setAttendanceLinks((current) => ({ ...current, [workerId]: link }));
      setNotice('Tautan presensi statis berhasil dimuat. Tautan akan tetap sama hingga salt perusahaan dirotasi.');
    } catch (requestError) {
      if (requestError.code === 'ATTENDANCE_SALT_NOT_CONFIGURED') {
        setError('Tautan presensi belum dapat dibuat. Admin perlu membuka Pengaturan → Pengaturan Presensi lalu membuat salt perusahaan terlebih dahulu.');
        setNotice('');
      } else {
        showError(requestError);
      }
    }
  }

  async function rotateAttendanceSalt() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const settings = await api('/admin/attendance-settings/salt', {
        method: 'POST',
        body: JSON.stringify({ confirm_rotation: true }),
      });
      setAttendanceSettings(settings);
      setAttendanceLinks({});
      setAttendanceData((current) => ({
        ...current,
        records: current.records.map((record) => ({ ...record, has_attendance_link: false })),
      }));
      setNotice('Salt perusahaan diperbarui. Buat dan bagikan ulang link statis pekerja.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function updateAttendanceSecurity(antiMockLocationEnabled) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const settings = await api('/admin/attendance-settings', {
        method: 'PATCH',
        body: JSON.stringify({ anti_mock_location_enabled: antiMockLocationEnabled }),
      });
      setAttendanceSettings(settings);
      setNotice(`Anti-Mock Location ${settings.anti_mock_location_enabled ? 'diaktifkan' : 'dinonaktifkan'}.`);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function revokeAttendanceLink(workerId) {
    setError('');
    setNotice('');
    try {
      await api(`/workers/${workerId}/attendance-link`, { method: 'DELETE' });
      setAttendanceLinks((current) => {
        const next = { ...current };
        delete next[workerId];
        return next;
      });
      setNotice('Tautan presensi berhasil dicabut.');
    } catch (requestError) {
      showError(requestError);
    }
  }

  async function createAttendanceLocation(location) {
    setError('');
    setNotice('');
    try {
      const created = await api('/admin/attendance-locations', {
        method: 'POST',
        body: JSON.stringify(location),
      });
      setAttendanceLocations((current) => [...current, created].sort((first, second) => first.name.localeCompare(second.name)));
      setNotice('Lokasi geofence berhasil ditambahkan.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    }
  }

  async function deleteAttendanceLocation(locationId) {
    setError('');
    setNotice('');
    try {
      await api(`/admin/attendance-locations/${locationId}`, { method: 'DELETE' });
      setAttendanceLocations((current) => current.filter((location) => location.id !== locationId));
      setNotice('Lokasi geofence berhasil dihapus.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    }
  }

  async function decideAttendanceRequest(workerId, decision, requestDate = attendanceDate) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api(`/attendance/${workerId}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ attendance_date: requestDate, decision }),
      });
      const [data, monthlyData] = await Promise.all([
        api(`/attendance?date=${encodeURIComponent(attendanceDate)}`),
        api(`/attendance/month?month=${encodeURIComponent(attendanceMonth)}`),
      ]);
      setAttendanceData(data);
      setMonthlyAttendance(monthlyData);
      setNotice(decision === 'approve' ? 'Pengajuan presensi disetujui.' : 'Pengajuan presensi ditolak.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function copyAttendanceLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Tautan presensi disalin.');
      setError('');
    } catch {
      setError('Tautan tidak dapat disalin otomatis. Pilih dan salin tautan yang ditampilkan.');
      setNotice('');
    }
  }

  async function saveAttendanceStatus(workerId) {
    const status = attendanceStatusDrafts[workerId];
    if (!status) return;
    setError('');
    setNotice('');
    try {
      await api(`/attendance/${workerId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ attendance_date: attendanceDate, status }),
      });
      setAttendanceData((current) => ({
        ...current,
        records: current.records.map((record) => (
          record.worker_id === workerId
            ? { ...record, status, check_in_time: null, check_out_time: null }
            : record
        )),
      }));
      const monthlyData = await api(`/attendance/month?month=${encodeURIComponent(attendanceMonth)}`);
      setMonthlyAttendance(monthlyData);
      setAttendanceStatusDrafts((current) => {
        const next = { ...current };
        delete next[workerId];
        return next;
      });
      setNotice('Status presensi berhasil diperbarui.');
    } catch (requestError) {
      showError(requestError);
    }
  }

  function showError(requestError) {
    setError(requestError.message || 'Terjadi kesalahan.');
    setNotice('');
  }

  function handleTabKeyDown(event) {
    const navigationTabs = NAVIGATION_TABS.filter((tab) => !tab.managerOnly || user?.role !== 'viewer');
    const currentIndex = navigationTabs.findIndex((tab) => tab.id === activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % navigationTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + navigationTabs.length) % navigationTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = navigationTabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = navigationTabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`tab-${nextTab.id}`)?.focus();
  }

  async function reloadData() {
    await Promise.all([refreshDashboard(), refreshWorkers(), refreshDepartments(), refreshSubscription()]);
  }

  function openWorkerModal() {
    if (workerQuotaFull) {
      showError(new Error(`Kuota paket Free sudah penuh (${subscription.active_workers}/${subscription.worker_limit} pekerja aktif).`));
      return;
    }
    setError('');
    setEditingWorker(null);
    setWorkerModalOpen(true);
  }

  function closeWorkerModal() {
    if (busy) return;
    setWorkerModalOpen(false);
    setEditingWorker(null);
    setError('');
  }

  async function handleCreateWorker(event) {
    event.preventDefault();
    if (workerQuotaFull) {
      showError(new Error(`Kuota paket Free sudah penuh (${subscription.active_workers}/${subscription.worker_limit} pekerja aktif).`));
      return;
    }
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(formElement);
    const requiredDocumentTypes = form.getAll('required_document_types');
    try {
      const worker = await api('/workers', {
        method: 'POST',
        body: JSON.stringify({
          full_name: form.get('full_name'),
          email: form.get('email'),
          phone_number: form.get('phone_number'),
          national_id: form.get('national_id') || null,
          address: form.get('address') || null,
          department: form.get('department'),
          position: form.get('position'),
          work_location: form.get('work_location') || null,
          contract_type: form.get('contract_type'),
          offer_date: form.get('offer_date') || null,
          join_date: form.get('join_date') || null,
          salary_rate: form.get('salary_rate') || null,
          required_document_types: requiredDocumentTypes,
        }),
      });
      formElement.reset();
      await reloadData();
      setSelectedId(worker.id);
      setWorkerModalOpen(false);
      setNotice('Data pekerja berhasil ditambahkan.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  function openEditWorker(worker) {
    if (user.role !== 'admin') return;
    setError('');
    setEditingWorker(worker);
    setWorkerModalOpen(true);
  }

  async function handleEditWorker(event) {
    event.preventDefault();
    if (!editingWorker || user.role !== 'admin') return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/workers/${encodeURIComponent(editingWorker.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: form.get('full_name'),
          email: form.get('email'),
          phone_number: form.get('phone_number'),
          national_id: form.get('national_id') || null,
          address: form.get('address') || null,
          department: form.get('department'),
          position: form.get('position'),
          work_location: form.get('work_location') || null,
          contract_type: form.get('contract_type'),
          offer_date: form.get('offer_date') || null,
          join_date: form.get('join_date') || null,
          salary_rate: form.get('salary_rate') || null,
          required_document_types: form.getAll('required_document_types'),
        }),
      });
      setWorkerModalOpen(false);
      setEditingWorker(null);
      await reloadData();
      setNotice('Data pekerja berhasil diperbarui.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function createWorkerWorkbook(rows) {
    const { default: ExcelJS } = await import('exceljs');
    const columns = [
      'full_name', 'email', 'phone_number', 'national_id', 'address', 'department',
      'position', 'work_location', 'contract_type', 'offer_date', 'join_date',
      'salary_rate', 'required_document_types',
    ];
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pekerja');
    worksheet.columns = columns.map((key) => ({ header: key, key, width: Math.max(18, key.length + 2) }));
    worksheet.addRows(rows);
    const content = await workbook.xlsx.writeBuffer();
    const downloadUrl = URL.createObjectURL(new Blob([content], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `data-pekerja-${localDateString()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  }

  async function handleImportWorkers(file) {
    if (user.role !== 'admin') return;
    setWorkerImportResult(null);
    if (!/\.xlsx$/i.test(file.name)) {
      showError(new Error('Pilih berkas Excel dengan format .xlsx.'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showError(new Error('Ukuran berkas Excel maksimal 10 MB.'));
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error('Workbook tidak memiliki sheet untuk diimpor.');
      if (worksheet.rowCount > 501 || worksheet.columnCount > 100) {
        throw new Error('Workbook dibatasi hingga 500 baris data dan 100 kolom.');
      }
      if (worksheet.rowCount < 2) throw new Error('Sheet Excel belum berisi data pekerja.');
      const sourceHeaders = worksheet.getRow(1).values.slice(1).map((value) => String(value || ''));
      const sourceRows = [];
      for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        const values = row.values.slice(1);
        if (values.every((value) => value == null || value === '')) continue;
        sourceRows.push(Object.fromEntries(sourceHeaders.map((header, index) => {
          const cellValue = values[index];
          return [header, cellValue && typeof cellValue === 'object' && !(cellValue instanceof Date)
            ? (cellValue.text || cellValue.result || '')
            : cellValue ?? ''];
        })));
      }
      if (!sourceRows.length) throw new Error('Sheet Excel belum berisi data pekerja.');
      if (sourceRows.length > 500) throw new Error('Maksimal 500 baris pekerja per proses impor.');

      const aliases = {
        full_name: ['full_name', 'nama', 'nama_lengkap'],
        email: ['email'],
        phone_number: ['phone_number', 'telepon', 'nomor_telepon', 'whatsapp'],
        national_id: ['national_id', 'nik', 'nik_ktp'],
        address: ['address', 'alamat'],
        department: ['department', 'departemen', 'divisi'],
        position: ['position', 'posisi', 'jabatan'],
        work_location: ['work_location', 'lokasi_kerja'],
        contract_type: ['contract_type', 'jenis_kontrak'],
        offer_date: ['offer_date', 'tanggal_offering'],
        join_date: ['join_date', 'tanggal_mulai'],
        salary_rate: ['salary_rate', 'gaji', 'rate'],
        required_document_types: ['required_document_types', 'dokumen_wajib'],
      };
      const normalizeHeader = (header) => String(header).trim().toLocaleLowerCase('id-ID')
        .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
      const workersToImport = sourceRows.map((sourceRow) => {
        const normalizedRow = Object.fromEntries(Object.entries(sourceRow).map(([key, value]) => [normalizeHeader(key), value]));
        const valueFor = (field) => {
          const alias = aliases[field].find((key) => Object.hasOwn(normalizedRow, key));
          return alias ? normalizedRow[alias] : '';
        };
        const text = (field) => {
          const value = valueFor(field);
          return value === '' || value == null ? null : String(value).trim();
        };
        const documentTypesValue = text('required_document_types');
        return {
          full_name: text('full_name') || '',
          email: text('email') || '',
          phone_number: text('phone_number') || '',
          national_id: text('national_id'),
          address: text('address'),
          department: text('department') || '',
          position: text('position') || '',
          work_location: text('work_location'),
          contract_type: (text('contract_type') || 'pkwt').toLocaleLowerCase('id-ID').replace(/[\s-]+/g, '_'),
          offer_date: excelDateString(valueFor('offer_date')),
          join_date: excelDateString(valueFor('join_date')),
          salary_rate: text('salary_rate'),
          required_document_types: documentTypesValue
            ? documentTypesValue.split(',').map((type) => type.trim().toLocaleLowerCase('id-ID')).filter(Boolean)
            : [],
        };
      });
      const requestBody = JSON.stringify({ workers: workersToImport });
      if (new TextEncoder().encode(requestBody).byteLength > 900 * 1024) {
        throw new Error('Data yang akan dikirim terlalu besar. Pecah impor menjadi beberapa file yang lebih kecil.');
      }
      const result = await api('/admin/workers/import', {
        method: 'POST',
        body: requestBody,
      });
      setWorkerImportResult(result);
      if (result.created.length) await reloadData();
      setNotice(`Impor selesai: ${result.created.length} ditambahkan, ${result.skipped.length} dilewati, ${result.errors.length} bermasalah.`);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveProfile(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const profile = await api('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: form.get('full_name'),
        }),
      });
      setUser((current) => ({ ...current, ...profile }));
      setNotice('Profil berhasil diperbarui.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadProfilePhoto(file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      showError(new Error('Pilih berkas gambar JPG atau PNG.'));
      return false;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const preparedFile = await compressProfilePhoto(file);
      const formData = new FormData();
      formData.append('photo', preparedFile);
      const profile = await api('/profile/photo', { method: 'POST', body: formData });
      setUser((current) => ({ ...current, ...profile }));
      setNotice('Foto profil berhasil diperbarui.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/profile/password', {
        method: 'PATCH',
        body: JSON.stringify({
          current_password: form.get('current_password'),
          new_password: form.get('new_password'),
          confirm_password: form.get('confirm_password'),
        }),
      });
      formElement.reset();
      setNotice(result.message);
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateUser(payload) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      setAdminUsers(await api('/admin/users'));
      setNotice('Akun user berhasil dibuat.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateUser(userId, changes) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(changes) });
      setAdminUsers(await api('/admin/users'));
      setNotice('Pengaturan akun berhasil diperbarui.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(userId, newPassword) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api(`/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: newPassword }),
      });
      setNotice(result.message);
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDocumentType(name) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/document-types', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await refreshDocumentTypes();
      setNotice('Jenis dokumen berhasil ditambahkan.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateDocumentType(code, changes) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/document-types/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      await Promise.all([refreshDocumentTypes(), refreshWorkers(), refreshDashboard()]);
      setNotice('Jenis dokumen berhasil diperbarui.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDocumentSettings(warningThresholdDays) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const settings = await api('/admin/document-settings', {
        method: 'PATCH',
        body: JSON.stringify({ warning_threshold_days: warningThresholdDays }),
      });
      setDocumentSettings(settings);
      await refreshDashboard();
      setNotice('Waktu pemantauan dokumen berhasil diperbarui.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDocument(event) {
    event.preventDefault();
    if (!selectedWorker) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(formElement);
    try {
      await api(`/workers/${selectedWorker.id}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          type: form.get('type'),
          status: documentStatus,
          valid_from: form.get('valid_from') || null,
          valid_until: form.get('valid_until') || null,
          target_completion_date: form.get('target_completion_date') || null,
        }),
      });
      formElement.reset();
      setDocumentStatus('pending');
      await reloadData();
      setNotice('Dokumen berhasil dicatat.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function archiveWorker(workerId) {
    if (user.role !== 'admin' || !window.confirm('Arsipkan pekerja ini? Data dan riwayat terkait tetap disimpan, tautan presensi akan dicabut.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/workers/${encodeURIComponent(workerId)}`, { method: 'DELETE' });
      if (selectedId === workerId) setSelectedId(null);
      await reloadData();
      setNotice('Pekerja diarsipkan. Data terkait tetap tersimpan.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function archiveDocument(workerId, documentId) {
    if (user.role !== 'admin' || !window.confirm('Arsipkan catatan dokumen ini? Catatan tetap tersimpan dan tidak lagi digunakan untuk kelayakan.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/workers/${encodeURIComponent(workerId)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      await Promise.all([refreshWorkers(), refreshDashboard()]);
      setNotice('Catatan dokumen diarsipkan.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function archiveAttendance(workerId) {
    if (user.role !== 'admin' || !window.confirm('Arsipkan log presensi ini? Log tidak lagi tampil dalam rekap operasional.')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/attendance/${encodeURIComponent(workerId)}?date=${encodeURIComponent(attendanceDate)}`, { method: 'DELETE' });
      const [dailyData, monthlyData] = await Promise.all([
        api(`/attendance?date=${encodeURIComponent(attendanceDate)}`),
        api(`/attendance/month?month=${encodeURIComponent(attendanceMonth)}`),
      ]);
      setAttendanceData(dailyData);
      setMonthlyAttendance(monthlyData);
      await refreshDashboard();
      setNotice('Log presensi diarsipkan.');
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status, effectiveDate = null) {
    if (!selectedWorker) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api(`/workers/${selectedWorker.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(status === 'inactive' ? { effective_date: effectiveDate } : {}) }),
      });
      await reloadData();
      setNotice(result.scheduled_inactive_date
        ? `Penonaktifan dijadwalkan pada ${result.scheduled_inactive_date}.`
        : `Status pekerja diperbarui menjadi ${STATUS_LABELS[status]}.`);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
      setWorkers([]);
      setAdminUsers([]);
      setSummary(null);
      setSelectedId(null);
    } catch (requestError) {
      showError(requestError);
    }
  }

  const visibleWorkers = useMemo(
    () => workers.filter((worker) => {
      const matchesStatus = filter === 'all' || worker.status === filter;
      const query = workerSearch.trim().toLocaleLowerCase('id-ID');
      const matchesSearch = !query || [worker.full_name, worker.position, worker.department, worker.email, worker.national_id]
        .some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(query));
      return matchesStatus && matchesSearch;
    }),
    [workers, filter, workerSearch]
  );

  const profileSearchResults = useMemo(() => {
    const query = profileWorkerSearch.trim().toLocaleLowerCase('id-ID');
    return workers.filter((worker) => !query
      || [worker.full_name, worker.position, worker.department]
        .some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(query)));
  }, [workers, profileWorkerSearch]);

  const expiringDocuments = useMemo(() => workers.flatMap((worker) => (
    (worker.documents || [])
      .filter((document) => {
        if (!document.valid_until || !['valid', 'expired'].includes(document.status)) return false;
        if (document.status === 'expired') return true;
        const threshold = documentTypes.find((type) => type.code === document.type)?.warning_threshold_days
          ?? summary?.document_warning_threshold_days
          ?? 30;
        const startDate = summary?.document_warning_start_date || localDateString();
        return document.valid_until <= addDaysToDate(startDate, threshold);
      })
      .map((document) => ({
        ...document,
        warning_threshold_days: documentTypes.find((type) => type.code === document.type)?.warning_threshold_days
          ?? summary?.document_warning_threshold_days
          ?? 30,
        worker_name: worker.full_name,
      }))
  )).sort((left, right) => left.valid_until.localeCompare(right.valid_until)), [workers, documentTypes, summary?.document_warning_start_date, summary?.document_warning_threshold_days]);

  const monthlyWorkerRows = useMemo(() => {
    const grouped = new Map();
    for (const record of monthlyAttendance.records) {
      if (!grouped.has(record.worker_id)) {
        grouped.set(record.worker_id, {
          worker_id: record.worker_id,
          full_name: record.full_name,
          position: record.position,
          days: {},
        });
      }
      if (record.attendance_date) grouped.get(record.worker_id).days[Number(record.attendance_date.slice(-2))] = record;
    }
    return [...grouped.values()];
  }, [monthlyAttendance.records]);

  const filteredMonthlyWorkers = useMemo(() => {
    const query = attendanceSearch.trim().toLocaleLowerCase('id-ID');
    return monthlyWorkerRows.filter((worker) => !query
      || worker.full_name.toLocaleLowerCase('id-ID').includes(query)
      || worker.position.toLocaleLowerCase('id-ID').includes(query));
  }, [monthlyWorkerRows, attendanceSearch]);

  const pendingAttendanceApprovals = useMemo(
    () => monthlyAttendance.records.filter((record) => record.attendance_id && record.approval_status === 'pending'),
    [monthlyAttendance.records]
  );
  const totalMonthlyLogs = monthlyAttendance.records.filter((record) => record.attendance_id).length;
  const monthlyCheckedIns = monthlyAttendance.records.filter((record) => record.check_in_time).length;
  const monthlyPageCount = Math.max(1, Math.ceil(filteredMonthlyWorkers.length / attendancePageSize));
  const visibleMonthlyWorkers = filteredMonthlyWorkers.slice(
    (attendancePage - 1) * attendancePageSize,
    attendancePage * attendancePageSize
  );
  const monthlyDays = Array.from({ length: monthlyAttendance.days_in_month }, (_, index) => index + 1);
  const navigationTabs = NAVIGATION_TABS.filter((tab) => !tab.managerOnly || user?.role !== 'viewer');
  const workerQuotaFull = subscription?.worker_limit != null
    && subscription.active_workers >= subscription.worker_limit;

  function selectMatrixAttendanceDate(day) {
    const date = `${attendanceMonth}-${String(day).padStart(2, '0')}`;
    setAttendanceDate(date);
    window.requestAnimationFrame(() => {
      document.getElementById('attendance-daily-operations')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  if (checkingSession) {
    return <main className="loading-screen">Memuat ruang kerja…</main>;
  }
  if (!user) return <AuthScreen onAuthenticated={setUser} initialError={sessionError} />;

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand-row">
          <a className="brand" href="#top" aria-label="rusakparah.web.id">
            <span className="brand-mark">R</span>
            <span className="brand-copy"><strong>rusakparah.web.id</strong><small>HRD Management</small></span>
          </a>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? 'Perluas menu navigasi' : 'Ringkas menu navigasi'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Perluas menu' : 'Ringkas menu'}
            onClick={(event) => {
              event.preventDefault();
              setSidebarCollapsed((collapsed) => !collapsed);
            }}
          >
            <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
          </button>
        </div>
        <div className="tenant-card">
          <span className="eyebrow">PERUSAHAAN</span>
          <strong className="uppercase-text">{user.company_name}</strong>
        </div>
        <nav className="side-nav" role="tablist" aria-label="Navigasi utama" onKeyDown={handleTabKeyDown}>
          {navigationTabs.map((tab) => (
            <button
              className={`nav-link ${activeTab === tab.id ? 'active' : ''}`}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              key={tab.id}
              title={sidebarCollapsed ? tab.label : undefined}
              aria-label={tab.label}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon" aria-hidden="true">{tab.icon}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">i</span>
          <p>Status kelayakan adalah rekomendasi. Aktivasi dan penonaktifan tetap dilakukan HRD.</p>
        </div>
        <button className="button sidebar-logout" onClick={logout} aria-label="Keluar" title={sidebarCollapsed ? 'Keluar' : undefined}>Keluar</button>
      </aside>

      <main className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} id="top">
        <header className="topbar">
          <div>
            <p className="eyebrow">DASHBOARD HRD</p>
            <h1>Pemantauan siklus pekerja</h1>
            <p className="muted">Kelola status dan persyaratan dokumen dalam satu ruang kerja.</p>
          </div>
          <div className="topbar-actions">
            <span className={`realtime-status ${realtimeConnected ? 'connected' : ''}`} role="status">
              <i /> {realtimeConnected ? 'Live' : 'Menghubungkan'}
            </span>
            {user.role !== 'viewer' && (
              <button
                className="button primary add-worker-button"
                type="button"
                onClick={openWorkerModal}
                disabled={busy || workerQuotaFull}
                title={workerQuotaFull ? 'Kuota pekerja aktif paket Free sudah penuh.' : undefined}
              >
                <span aria-hidden="true">+</span> Tambah Pekerja
              </button>
            )}
            {workerQuotaFull && <span className="worker-quota-topbar-note" role="status">Kuota pekerja paket Free penuh</span>}
            <div className="user-chip">
              <button className="user-profile-button" type="button" onClick={() => setActiveTab('settings')} aria-label="Buka pengaturan profil">
                {user.profile_photo_url
                  ? <img className="avatar profile-avatar" src={user.profile_photo_url} alt="" />
                  : <span className="avatar">{user.full_name?.slice(0, 1).toUpperCase() || user.email?.slice(0, 1).toUpperCase()}</span>}
                <span><strong className="uppercase-text">{user.full_name || user.email}</strong><small>{{ admin: 'Administrator', hr_manager: 'HR Staff', viewer: 'Viewer' }[user.role] || user.role}</small></span>
              </button>
            </div>
          </div>
        </header>

        {error && !workerModalOpen && <div className="notice error" role="alert">{error}<button onClick={() => setError('')}>Tutup</button></div>}
        {notice && <div className="notice success" role="status">{notice}<button onClick={() => setNotice('')}>Tutup</button></div>}
        {workerModalOpen && (
          <WorkerModal
            key={editingWorker?.id || 'new-worker'}
            onClose={closeWorkerModal}
            onSubmit={editingWorker ? handleEditWorker : handleCreateWorker}
            busy={busy}
            error={error}
            departmentOptions={departmentOptions}
            documentTypes={documentTypes}
            documentTypesLoading={documentTypesLoading}
            initialWorker={editingWorker}
          />
        )}

        <section
          className="overview-dashboard"
          id="panel-overview"
          role="tabpanel"
          aria-labelledby="tab-overview"
          hidden={activeTab !== 'overview'}
        >
          <div className="overview-heading">
            <div><p className="eyebrow">RINGKASAN OPERASIONAL</p><h2>Ikhtisar perusahaan</h2></div>
            <span className="overview-live"><i /> Data diperbarui otomatis</span>
          </div>
          <div className="stats-grid">
            <StatCard label="Offering" value={summary?.offered ?? '—'} tone="violet" />
            <StatCard label="Pra-aktif" value={summary?.preactive ?? '—'} tone="blue" />
            <StatCard label="Aktif" value={summary?.active ?? '—'} tone="green" />
            <StatCard label="Nonaktif" value={summary?.inactive ?? '—'} tone="slate" />
            <StatCard label="Dokumen perlu tindak lanjut" value={summary?.expiring_documents ?? '—'} tone="amber" />
            <StatCard label="Klaim presensi pending" value={summary?.pending_attendance_claims ?? '—'} tone="rose" />
          </div>
          {subscription && subscription.worker_limit != null && (
            <section className={`worker-quota-card ${workerQuotaFull ? 'at-limit' : ''}`} aria-label="Penggunaan kuota pekerja">
              <div className="worker-quota-heading">
                <div><p className="eyebrow">PAKET FREE</p><h3>Kuota pekerja aktif</h3></div>
                <strong>{subscription.active_workers}/{subscription.worker_limit} Pekerja</strong>
              </div>
              <progress value={Math.min(subscription.active_workers, subscription.worker_limit)} max={subscription.worker_limit} aria-label={`${subscription.active_workers} dari ${subscription.worker_limit} pekerja aktif`} />
              <p>{workerQuotaFull
                ? 'Kuota penuh. Penambahan pekerja dan aktivasi pekerja dibatasi sampai ada kuota tersedia.'
                : `${subscription.worker_limit - subscription.active_workers} kuota pekerja aktif tersedia.`}</p>
            </section>
          )}
        </section>

        <section
          className="history-page"
          id="panel-history"
          role="tabpanel"
          aria-labelledby="tab-history"
          hidden={activeTab !== 'history'}
        >
          <div className="overview-heading">
            <div><p className="eyebrow">AUDIT TRAIL</p><h2>Riwayat aktivitas</h2></div>
            <span className="overview-live"><i /> Diperbarui otomatis</span>
          </div>
          <section className="panel history-panel" aria-label="Daftar aktivitas pengguna">
            {historyLoading && !activityHistory.length ? (
              <p className="muted history-state">Memuat riwayat aktivitas…</p>
            ) : activityHistory.length ? (
              <ol className="history-list">
                {activityHistory.map((event) => (
                  <li className="history-item" key={event.id}>
                    <span className={`history-action action-${event.action}`}>
                      {{ create: 'Create', update: 'Update', delete: 'Delete', approve: 'Approve', reject: 'Reject' }[event.action] || event.action}
                    </span>
                    <div className="history-event-content">
                      <div className="history-event-heading">
                        <strong>{event.actor_name}</strong>
                        <span className="history-role">{USER_ROLE_LABELS[event.actor_role] || 'Sistem'}</span>
                        <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('id-ID')}</time>
                      </div>
                      <p>{event.description}</p>
                      <small>{event.entity_type.replaceAll('_', ' ')}{event.entity_id ? ` · ${event.entity_id}` : ''}</small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted history-state">Belum ada aktivitas yang tercatat.</p>
            )}
            <p className="history-footnote">Menampilkan hingga 100 aktivitas terbaru pada perusahaan ini. Riwayat hanya dapat dilihat oleh Admin dan HR Staff.</p>
          </section>
        </section>

        <WorkersPanel
          activeTab={activeTab}
          archiveWorker={archiveWorker}
          busy={busy}
          createWorkerWorkbook={createWorkerWorkbook}
          filter={filter}
          handleImportWorkers={handleImportWorkers}
          openEditWorker={openEditWorker}
          selectedId={selectedId}
          setFilter={setFilter}
          setSelectedId={setSelectedId}
          setWorkerSearch={setWorkerSearch}
          showError={showError}
          subscription={subscription}
          user={user}
          visibleWorkers={visibleWorkers}
          workerImportInputRef={workerImportInputRef}
          workerImportResult={workerImportResult}
          workerQuotaFull={workerQuotaFull}
          workerSearch={workerSearch}
          workers={workers}
        />

        <AttendancePanel
          activeTab={activeTab}
          attendanceDate={attendanceDate}
          attendanceData={attendanceData}
          attendanceLinks={attendanceLinks}
          attendanceLoading={attendanceLoading}
          attendanceMonth={attendanceMonth}
          attendancePage={attendancePage}
          attendancePageSize={attendancePageSize}
          attendanceSettings={attendanceSettings}
          attendanceStatusDrafts={attendanceStatusDrafts}
          attendanceSearch={attendanceSearch}
          busy={busy}
          createAttendanceLink={createAttendanceLink}
          copyAttendanceLink={copyAttendanceLink}
          decideAttendanceRequest={decideAttendanceRequest}
          filteredMonthlyWorkers={filteredMonthlyWorkers}
          monthlyAttendanceLoading={monthlyAttendanceLoading}
          monthlyCheckedIns={monthlyCheckedIns}
          monthlyDays={monthlyDays}
          monthlyPageCount={monthlyPageCount}
          monthlyWorkerRows={monthlyWorkerRows}
          pendingAttendanceApprovals={pendingAttendanceApprovals}
          reviewingAttendance={reviewingAttendance}
          saveAttendanceStatus={saveAttendanceStatus}
          selectMatrixAttendanceDate={selectMatrixAttendanceDate}
          setAttendanceDate={setAttendanceDate}
          setAttendanceMonth={setAttendanceMonth}
          setAttendancePage={setAttendancePage}
          setAttendancePageSize={setAttendancePageSize}
          setAttendanceSearch={setAttendanceSearch}
          setReviewingAttendance={setReviewingAttendance}
          totalMonthlyLogs={totalMonthlyLogs}
          user={user}
          visibleMonthlyWorkers={visibleMonthlyWorkers}
          archiveAttendance={archiveAttendance}
          revokeAttendanceLink={revokeAttendanceLink}
        />

        <section
          className="detail-grid"
          id="panel-documents"
          role="tabpanel"
          aria-labelledby="tab-documents"
          hidden={activeTab !== 'documents'}
        >
          <div className="panel detail-panel">
            <div className="profile-worker-picker">
              <label htmlFor="profile-worker-search">Cari dan pilih profil pekerja</label>
              <input
                id="profile-worker-search"
                type="search"
                value={profileWorkerSearch}
                onChange={(event) => setProfileWorkerSearch(event.target.value)}
                placeholder="Nama, posisi, atau departemen"
              />
              <div className="profile-worker-options" aria-label="Daftar hasil pekerja">
                {profileSearchResults.slice(0, 6).map((worker) => (
                  <button
                    className={`profile-worker-option ${selectedId === worker.id ? 'selected' : ''}`}
                    type="button"
                    key={worker.id}
                    onClick={() => setSelectedId(worker.id)}
                  >
                    <strong className="uppercase-text">{worker.full_name}</strong>
                    <small className="uppercase-text">{worker.position} · {worker.department}</small>
                  </button>
                ))}
                {!profileSearchResults.length && <span className="muted">Tidak ada pekerja yang cocok.</span>}
              </div>
            </div>
            <div className="panel-heading">
              <div><p className="eyebrow">PROFIL & KELAYAKAN</p><h2 className="uppercase-text">{selectedWorker?.full_name || 'Pilih pekerja'}</h2></div>
              {selectedWorker && <StatusBadge status={selectedWorker.status} />}
            </div>
            {!selectedWorker ? (
              <p className="muted empty-detail">Pilih pekerja pada daftar untuk melihat dokumen, kelayakan, dan riwayat status.</p>
            ) : (
              <>
                <div className={`eligibility-banner ${selectedWorker.eligibility.eligible ? 'eligible' : 'ineligible'}`}>
                  <strong>{selectedWorker.eligibility.eligible ? 'Persyaratan dokumen terpenuhi' : 'Persyaratan dokumen belum terpenuhi'}</strong>
                  <span>{selectedWorker.eligibility.eligible ? 'HRD dapat mempertimbangkan aktivasi.' : 'Lengkapi dokumen wajib yang masih kurang atau kedaluwarsa.'}</span>
                </div>
                <div className="requirement-list">
                  {selectedWorker.eligibility.checks.map((check) => (
                    <div className="requirement-item" key={check.type}>
                      <span className="uppercase-text">{documentTypeName(check.type, documentTypes)}</span>
                      <span className={`readiness ${check.valid ? 'ready' : 'needs-work'}`}>{check.valid ? 'Valid' : 'Belum valid'}</span>
                    </div>
                  ))}
                </div>
                <div className="document-heading"><h3>Riwayat dokumen</h3><span>{selectedWorker.documents.length} catatan</span></div>
                {selectedWorker.documents.length ? (
                  <div className="document-list">
                      {selectedWorker.documents.map((document) => {
                        const state = documentState(document);
                        return (
                          <article className="document-item" key={document.id}>
                            <span className="document-icon">{documentTypeName(document.type, documentTypes).slice(0, 1).toUpperCase()}</span>
                            <span><strong className="uppercase-text">{documentTypeName(document.type, documentTypes)}</strong><small>
                              {document.status === 'pending'
                                ? `Target selesai ${document.target_completion_date || 'belum ditentukan'}`
                                : document.status === 'rejected'
                                  ? 'Tanggal tidak berlaku'
                                  : `${document.valid_from || 'Tanggal mulai —'} hingga ${document.valid_until || 'tanpa tanggal akhir'}`}
                            </small></span>
                            <span className={`readiness ${state.valid ? 'ready' : 'needs-work'}`}>{state.label}</span>
                            {user.role === 'admin' && <button className="button danger small-action" type="button" disabled={busy} onClick={() => archiveDocument(selectedWorker.id, document.id)}>Arsipkan</button>}
                          </article>
                        );
                      })}
                  </div>
                ) : <p className="muted">Belum ada dokumen dicatat.</p>}
                {user.role === 'admin' && <div className="status-controls">
                  {selectedWorker.status === 'offered' && <button className="button secondary" disabled={busy} onClick={() => changeStatus('preactive')}>Pindahkan ke pra-aktif</button>}
                  {['preactive', 'inactive'].includes(selectedWorker.status) && (
                    <button className="button primary" disabled={busy || !selectedWorker.eligibility.eligible} onClick={() => changeStatus('active')}>
                      {selectedWorker.status === 'inactive' ? 'Aktifkan kembali' : 'Aktifkan pekerja'}
                    </button>
                  )}
                  {['active', 'preactive'].includes(selectedWorker.status) && (
                    <div className="scheduled-inactive-control">
                      <label htmlFor="scheduled-inactive-date">Tanggal efektif nonaktif</label>
                      <input
                        id="scheduled-inactive-date"
                        type="date"
                        min={localDateString()}
                        value={scheduledInactiveDate}
                        onChange={(event) => setScheduledInactiveDate(event.target.value)}
                        required
                      />
                      <button className="button danger" disabled={busy || !scheduledInactiveDate} onClick={() => changeStatus('inactive', scheduledInactiveDate)}>Jadwalkan nonaktif</button>
                    </div>
                  )}
                  <button className="button danger" disabled={busy} onClick={() => archiveWorker(selectedWorker.id)}>Arsipkan pekerja</button>
                </div>}
                {selectedWorker.history?.length > 0 && (
                  <div className="history-line">
                    <h3>Riwayat status</h3>
                    {selectedWorker.history.map((entry) => (
                      <p key={entry.id}>{STATUS_LABELS[entry.previous_status] || 'Baru'} → {STATUS_LABELS[entry.new_status]} <small>oleh {entry.changed_by || 'pengguna'} · {new Date(entry.created_at).toLocaleDateString('id-ID')}</small></p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="right-column">
            {user.role !== 'viewer' ? <section className="panel document-form-panel">
              <div className="panel-heading"><div><p className="eyebrow">KELENGKAPAN</p><h2>Catat dokumen</h2></div></div>
              {!selectedWorker ? <p className="muted">Pilih pekerja terlebih dahulu.</p> : (
                <form className="form-stack" onSubmit={handleCreateDocument}>
                  <label>Jenis dokumen<select className="uppercase-text" name="type" required disabled={!documentTypes.some((type) => type.is_active || selectedWorker.required_document_types.includes(type.code))}>{documentTypes.filter((type) => type.is_active || selectedWorker.required_document_types.includes(type.code)).map((type) => <option value={type.code} key={type.code}>{type.name}{type.is_active ? '' : ' (Nonaktif)'}</option>)}</select></label>
                  <label>Status<select name="status" value={documentStatus} onChange={(event) => setDocumentStatus(event.target.value)}><option value="pending">Menunggu pemeriksaan</option><option value="valid">Valid</option><option value="expired">Kedaluwarsa</option><option value="rejected">Ditolak</option></select></label>
                  {documentStatus === 'pending' && (
                    <label>Target Selesai<input type="date" name="target_completion_date" /></label>
                  )}
                  {['valid', 'expired'].includes(documentStatus) && (
                    <div className="date-fields">
                      <label>Berlaku mulai<input type="date" name="valid_from" /></label>
                      <label>Berlaku hingga<input type="date" name="valid_until" /></label>
                    </div>
                  )}
                  <button className="button primary" disabled={busy || !documentTypes.some((type) => type.is_active || selectedWorker.required_document_types.includes(type.code))}>Simpan dokumen</button>
                  <small>Hasil medis rinci dan catatan bebas tidak disimpan.</small>
                </form>
              )}
            </section> : <section className="panel document-form-panel"><div className="panel-heading"><div><p className="eyebrow">KELENGKAPAN</p><h2>Catat dokumen</h2></div></div><p className="muted">Akses Viewer hanya dapat melihat data dan riwayat dokumen.</p></section>}
            <section className="panel expiry-panel">
              <div className="panel-heading"><div><p className="eyebrow">TINDAK LANJUT DOKUMEN</p><h2>Masa berlaku</h2></div></div>
              {expiringDocuments.length ? (
                <div className="expiry-list">
                  {expiringDocuments.map((document) => (
                    <div className="expiry-item" key={`${document.id}-${document.worker_id}`}>
                      <span className={`expiry-dot ${document.valid_until < (summary?.document_warning_start_date || localDateString()) ? 'expired' : ''}`} />
                      <span><strong className="uppercase-text">{document.worker_name}</strong><small><span className="uppercase-text">{documentTypeName(document.type, documentTypes)}</span> · {document.valid_until < (summary?.document_warning_start_date || localDateString()) ? 'Kedaluwarsa' : `Segera kedaluwarsa · ambang ${document.warning_threshold_days} hari`} · berakhir {new Date(`${document.valid_until}T00:00:00`).toLocaleDateString('id-ID')}</small></span>
                    </div>
                  ))}
                </div>
              ) : <p className="muted">Tidak ada dokumen kedaluwarsa atau yang memasuki ambang peringatannya.</p>}
            </section>
          </div>
        </section>
        <SettingsPanel
          active={activeTab === 'settings'}
          user={user}
          users={adminUsers}
          documentTypes={documentTypes}
          usersLoading={adminUsersLoading}
          onCreateDocumentType={handleCreateDocumentType}
          onUpdateDocumentType={handleUpdateDocumentType}
          documentSettings={documentSettings}
          onSaveDocumentSettings={handleSaveDocumentSettings}
          busy={busy}
          onSaveProfile={handleSaveProfile}
          onUploadProfilePhoto={handleUploadProfilePhoto}
          onChangePassword={handleChangePassword}
          onCreateUser={handleCreateUser}
          onUpdateUser={handleUpdateUser}
          onResetPassword={handleResetPassword}
          attendanceSettings={attendanceSettings}
          subscription={subscription}
          onUpdateAttendanceSecurity={updateAttendanceSecurity}
          attendanceLocations={attendanceLocations}
          onRotateAttendanceSalt={rotateAttendanceSalt}
          onCreateAttendanceLocation={createAttendanceLocation}
          onDeleteAttendanceLocation={deleteAttendanceLocation}
          error={error}
          theme={theme}
          onChangeTheme={setTheme}
        />
        <footer className="footer-note">Informasi MCU yang disimpan hanya berupa status dan masa berlaku dokumen.</footer>
      </main>
    </div>
  );
}

function App() {
  return window.location.pathname === '/presensi' ? <Presensi /> : <WorkspaceApp />;
}

export default App;
