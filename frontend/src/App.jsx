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
import { Icon } from './components/Icon.jsx';

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
  const [companyPortalLink, setCompanyPortalLink] = useState('');
  const [companyPortalLinkNeedsRotation, setCompanyPortalLinkNeedsRotation] = useState(false);
  const [attendanceStatusDrafts, setAttendanceStatusDrafts] = useState({});
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [monthlyAttendanceLoading, setMonthlyAttendanceLoading] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendancePageSize, setAttendancePageSize] = useState(25);
  const [attendancePage, setAttendancePage] = useState(1);
  const [reviewingAttendance, setReviewingAttendance] = useState(null);
  const [attendanceSettings, setAttendanceSettings] = useState({
    company_portal_configured: false,
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
  const [pendingLeaveRequests, setPendingLeaveRequests] = useState([]);
  const [pendingLeaveRequestsLoading, setPendingLeaveRequestsLoading] = useState(false);
  const [leaveRejectionRequest, setLeaveRejectionRequest] = useState(null);
  const [leaveRejectionNote, setLeaveRejectionNote] = useState('');
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
  const [activationWorker, setActivationWorker] = useState(null);
  const [activationWorkerNumber, setActivationWorkerNumber] = useState('');
  const [activationError, setActivationError] = useState('');
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
    if (!user || !['admin', 'hr_manager'].includes(user.role)) {
      setPendingLeaveRequests([]);
      return;
    }
    refreshPendingLeaveRequests().catch(showError);
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const socket = io({
      withCredentials: true,
      ...(import.meta.env.DEV ? {} : { transports: ['polling'] }),
    });
    let mounted = true;
    let reconnectTimer;
    const scheduleSync = (eventName) => {
      if (realtimeRefreshTimerRef.current) window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = window.setTimeout(async () => {
        try {
          const refreshTasks = [refreshDashboard(), refreshWorkers(), refreshSubscription()];
          if (['admin', 'hr_manager'].includes(user.role)) {
            refreshTasks.push(refreshPendingLeaveRequests());
          }
          const current = realtimeContextRef.current;
          if (['documents_updated', 'settings_updated'].includes(eventName)) {
            refreshTasks.push(refreshDocumentTypes());
          }
          if (current.activeTab === 'attendance') {
            refreshTasks.push(
              api(`/attendance?date=${encodeURIComponent(current.attendanceDate)}`).then((data) => {
                setAttendanceData(data);
                setAttendanceSettings((settings) => ({
                  ...settings,
                  company_portal_configured: data.company_portal_configured,
                }));
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
      'leave_requests_updated',
      'documents_updated',
      'dashboard_updated',
      'settings_updated',
      'user_changed',
      'history_updated',
    ];
    socket.on('connect', setConnected);
    socket.on('disconnect', setDisconnected);
    socket.on('connect_error', setDisconnected);
    eventNames.forEach((eventName) => socket.on(eventName, () => scheduleSync(eventName)));
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
        setAttendanceSettings((current) => ({
          ...current,
          company_portal_configured: data.company_portal_configured,
        }));
      })
      .catch(showError)
      .finally(() => setAttendanceLoading(false));
  }, [activeTab, attendanceDate, user]);

  useEffect(() => {
    if (!user || user.role !== 'admin' || activeTab !== 'attendance') return;
    if (!attendanceSettings.company_portal_configured) {
      setCompanyPortalLink('');
      setCompanyPortalLinkNeedsRotation(false);
      return;
    }

    let cancelled = false;
    setCompanyPortalLink('');
    setCompanyPortalLinkNeedsRotation(false);
    api('/admin/attendance-settings/company-token')
      .then(({ company_token: companyToken, needs_rotation: needsRotation }) => {
        if (cancelled) return;
        if (companyToken) {
          setCompanyPortalLink(`${window.location.origin}/portal?company_token=${encodeURIComponent(companyToken)}`);
        }
        setCompanyPortalLinkNeedsRotation(Boolean(needsRotation));
      })
      .catch((requestError) => {
        if (!cancelled) showError(requestError);
      });
    return () => { cancelled = true; };
  }, [activeTab, attendanceSettings.company_portal_configured, user]);

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
    const query = profileWorkerSearch.trim().toLocaleLowerCase('id-ID');
    const selectedWorkerMatchesSearch = query.length >= 3 && workers.some((worker) => {
      if (String(worker.id) !== String(selectedId)) return false;
      if (query.startsWith('id ')) return String(worker.id) === query.slice(3).trim();
      return [worker.full_name, worker.position, worker.department]
        .some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(query));
    });
    if (activeTab !== 'documents' || !selectedId || !user || !selectedWorkerMatchesSearch) {
      setSelectedWorker(null);
      return;
    }
    api(`/workers/${selectedId}`)
      .then(setSelectedWorker)
      .catch(showError);
  }, [activeTab, profileWorkerSearch, selectedId, user, workers]);

  async function refreshDashboard() {
    setSummary(await api('/dashboard'));
  }

  async function refreshPendingLeaveRequests() {
    setPendingLeaveRequestsLoading(true);
    try {
      setPendingLeaveRequests(await api('/leaves/pending'));
    } finally {
      setPendingLeaveRequestsLoading(false);
    }
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

  async function resetWorkerPortalSession(workerId) {
    if (!window.confirm('Reset UUID portal pekerja ini? UUID aktif akan dicabut dan perangkat akan menerima UUID baru saat pekerja masuk berikutnya.')) {
      return false;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api(
        `/workers/${workerId}/portal-session/reset`,
        { method: 'POST' }
      );
      setNotice('UUID portal berhasil direset. UUID baru akan dibuat saat pekerja memverifikasi nomor pekerjanya.');
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function rotateCompanyPortalToken() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const settings = await api('/admin/attendance-settings/company-token', {
        method: 'POST',
        body: JSON.stringify({ confirm_rotation: true }),
      });
      const { company_token: companyToken, ...updatedSettings } = settings;
      const companyPortalLink = `${window.location.origin}/portal?company_token=${encodeURIComponent(companyToken)}`;
      setAttendanceSettings((current) => ({ ...current, ...updatedSettings }));
      setCompanyPortalLink(companyPortalLink);
      setCompanyPortalLinkNeedsRotation(false);
      setNotice('Tautan portal perusahaan berhasil dibuat. Bagikan tautan tersebut kepada pekerja untuk verifikasi nomor pekerja.');
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

  function openLeaveRejection(request) {
    setError('');
    setLeaveRejectionNote('');
    setLeaveRejectionRequest(request);
  }

  async function decideLeaveRequest(requestId, status, rejectionNote = '') {
    if (status === 'rejected' && rejectionNote.trim().length < 5) {
      setError('Catatan penolakan wajib diisi minimal 5 karakter.');
      return false;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api(`/leaves/${encodeURIComponent(requestId)}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          ...(status === 'rejected' ? { rejection_note: rejectionNote.trim() } : {}),
        }),
      });
      const refreshTasks = [refreshPendingLeaveRequests(), refreshDashboard()];
      if (status === 'approved') {
        refreshTasks.push(
          api(`/attendance?date=${encodeURIComponent(attendanceDate)}`).then(setAttendanceData),
          api(`/attendance/month?month=${encodeURIComponent(attendanceMonth)}`).then(setMonthlyAttendance)
        );
      }
      await Promise.all(refreshTasks);
      setNotice(status === 'approved' ? 'Pengajuan berhasil disetujui.' : 'Pengajuan berhasil ditolak.');
      if (status === 'rejected') setLeaveRejectionRequest(null);
      return true;
    } catch (requestError) {
      showError(requestError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard(link) {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Teks berhasil disalin.');
      setError('');
    } catch {
      setError('Teks tidak dapat disalin otomatis. Pilih dan salin teks yang ditampilkan.');
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
    const form = new FormData(formElement);
    const requiredDocumentTypes = form.getAll('required_document_types');
    const workerNumber = String(form.get('worker_number') || '').trim();
    if (workerNumber && workers.some((worker) => worker.status === 'active'
      && String(worker.worker_number || '').toLocaleLowerCase('id-ID') === workerNumber.toLocaleLowerCase('id-ID'))) {
      showError(new Error('Nomor pekerja sudah digunakan oleh karyawan aktif'));
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const worker = await api('/workers', {
        method: 'POST',
        body: JSON.stringify({
          full_name: form.get('full_name'),
          email: form.get('email'),
          phone_number: form.get('phone_number'),
          worker_number: workerNumber || null,
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
    const workerNumber = String(form.get('worker_number') || '').trim();
    if (workerNumber && workers.some((worker) => String(worker.id) !== String(editingWorker.id)
      && worker.status === 'active'
      && String(worker.worker_number || '').toLocaleLowerCase('id-ID') === workerNumber.toLocaleLowerCase('id-ID'))) {
      showError(new Error('Nomor pekerja sudah digunakan oleh karyawan aktif'));
      return;
    }
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
          worker_number: workerNumber || null,
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
      'full_name', 'email', 'worker_number', 'phone_number', 'national_id', 'address', 'department',
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
        worker_number: ['worker_number', 'nomor_pekerja', 'employee_id', 'nomor_karyawan'],
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
          worker_number: text('worker_number'),
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
    if (user.role !== 'admin' || !window.confirm('Arsipkan pekerja ini? Data dan riwayat terkait tetap disimpan, sesi portal perangkat akan dicabut.')) return;
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

  function openActivationDialog(worker) {
    setActivationWorker(worker);
    setActivationWorkerNumber(worker.worker_number || '');
    setActivationError('');
  }

  async function changeStatus(status, effectiveDate = null, workerNumber = null) {
    if (!selectedWorker) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api(`/workers/${selectedWorker.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          ...(status === 'inactive' ? { effective_date: effectiveDate } : {}),
          ...(status === 'active' ? { worker_number: workerNumber } : {}),
        }),
      });
      await reloadData();
      setNotice(result.scheduled_inactive_date
        ? `Penonaktifan dijadwalkan pada ${result.scheduled_inactive_date}.`
        : `Status pekerja diperbarui menjadi ${STATUS_LABELS[status]}.`);
      return true;
    } catch (requestError) {
      showError(requestError);
      if (status === 'active') setActivationError(requestError.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitWorkerActivation(event) {
    event.preventDefault();
    const workerNumber = activationWorkerNumber.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/.test(workerNumber)) {
      setActivationError('Nomor pekerja wajib diisi (1–50 karakter: huruf, angka, titik, garis bawah, garis miring, atau tanda hubung).');
      return;
    }
    if (workers.some((worker) => String(worker.id) !== String(activationWorker?.id)
      && worker.status === 'active'
      && String(worker.worker_number || '').toLocaleLowerCase('id-ID') === workerNumber.toLocaleLowerCase('id-ID'))) {
      setActivationError('Nomor pekerja sudah digunakan oleh karyawan aktif');
      return;
    }
    const activated = await changeStatus('active', null, workerNumber);
    if (activated) {
      setActivationWorker(null);
      setActivationWorkerNumber('');
      setActivationError('');
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

  const profileSearchTerm = profileWorkerSearch.trim();
  const profileSearchReady = profileSearchTerm.length >= 3;
  const profileSearchResults = useMemo(() => {
    const query = profileSearchTerm.toLocaleLowerCase('id-ID');
    if (query.length < 3) return [];
    return workers.filter((worker) => query.startsWith('id ')
      ? String(worker.id) === query.slice(3).trim()
      : [worker.full_name, worker.position, worker.department]
        .some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(query)));
  }, [workers, profileWorkerSearch]);
  const selectedProfileWorker = profileSearchReady
    && String(selectedWorker?.id) === String(selectedId)
    && profileSearchResults.some((worker) => String(worker.id) === String(selectedId))
    ? selectedWorker
    : null;

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
        worker_id: worker.id,
        warning_threshold_days: documentTypes.find((type) => type.code === document.type)?.warning_threshold_days
          ?? summary?.document_warning_threshold_days
          ?? 30,
        worker_name: worker.full_name,
      }))
  )).sort((left, right) => left.valid_until.localeCompare(right.valid_until)), [workers, documentTypes, summary?.document_warning_start_date, summary?.document_warning_threshold_days]);

  function openDocumentFollowUp(document) {
      const worker = workers.find((candidate) => String(candidate.id) === String(document.worker_id));
      if (!worker) return;
      setProfileWorkerSearch(`ID ${worker.id}`);
      setSelectedId(worker.id);
      setActiveTab('documents');
  }

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
  const pendingApprovalCount = Number(summary?.pending_attendance_claims || 0)
    + Number(summary?.pending_leave_requests || 0);
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

  function openWorkerStatus(status) {
    setFilter(status);
    setWorkerSearch('');
    setActiveTab('workers');
  }

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
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'chevronLeft'} />
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
              <span className="nav-icon"><Icon name={tab.icon} /></span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon"><Icon name="info" size={16} /></span>
          <p>Status kelayakan adalah rekomendasi. Aktivasi dan penonaktifan tetap dilakukan HRD.</p>
        </div>
        <button className="button sidebar-logout" onClick={logout} aria-label="Keluar" title={sidebarCollapsed ? 'Keluar' : undefined}><Icon name="logout" size={17} /> Keluar</button>
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
                <Icon name="plus" size={17} /> Tambah Pekerja
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

        {error && !workerModalOpen && <div className="notice error" role="alert">{error}<button onClick={() => setError('')}><Icon name="x" size={15} />Tutup</button></div>}
        {notice && <div className="notice success" role="status">{notice}<button onClick={() => setNotice('')}><Icon name="x" size={15} />Tutup</button></div>}
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
        {activationWorker && (
          <div
            className="worker-activation-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) setActivationWorker(null);
            }}
          >
            <form
              className="worker-activation-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="worker-activation-title"
              onSubmit={submitWorkerActivation}
            >
              <p className="eyebrow">AKTIVASI PEKERJA</p>
              <h2 id="worker-activation-title">Tetapkan nomor pekerja</h2>
              <p className="muted">
                {activationWorker.full_name} akan diaktifkan. Nomor pekerja tetap melekat pada profilnya saat statusnya berubah menjadi nonaktif.
              </p>
              <label className="worker-activation-field">
                Nomor pekerja <span className="required-mark">*</span>
                <input
                  autoFocus
                  className="modal-control"
                  value={activationWorkerNumber}
                  onChange={(event) => {
                    setActivationWorkerNumber(event.target.value);
                    setActivationError('');
                  }}
                  maxLength={50}
                  pattern="[A-Za-z0-9][A-Za-z0-9._/-]*"
                  required
                  disabled={busy}
                  placeholder="Contoh: EMP-001"
                />
              </label>
              {activationError && <p className="notice error modal-error" role="alert">{activationError}</p>}
              <div className="modal-actions">
                <button className="button secondary" type="button" disabled={busy} onClick={() => setActivationWorker(null)}>Batal</button>
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? 'Mengaktifkan…' : 'Simpan & aktifkan'}
                </button>
              </div>
            </form>
          </div>
        )}
        {leaveRejectionRequest && (
          <div className="leave-review-backdrop">
            <form
              className="leave-review-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="leave-review-title"
              onSubmit={async (event) => {
                event.preventDefault();
                await decideLeaveRequest(leaveRejectionRequest.id, 'rejected', leaveRejectionNote);
              }}
            >
              <div>
                <p className="eyebrow">CATATAN WAJIB</p>
                <h2 id="leave-review-title">Tolak pengajuan</h2>
                <p className="muted">
                  Pengajuan {leaveRejectionRequest.full_name} · {leaveRejectionRequest.start_date} – {leaveRejectionRequest.end_date}
                </p>
              </div>
              <label className="leave-review-note">
                Alasan penolakan
                <textarea
                  autoFocus
                  value={leaveRejectionNote}
                  onChange={(event) => setLeaveRejectionNote(event.target.value)}
                  minLength={5}
                  maxLength={1000}
                  rows={4}
                  required
                  disabled={busy}
                  placeholder="Jelaskan alasan pengajuan ditolak (minimal 5 karakter)"
                />
                <small>{leaveRejectionNote.trim().length}/1000 karakter</small>
              </label>
              {error && <p className="attendance-feedback error" role="alert">{error}</p>}
              <div className="leave-review-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setLeaveRejectionRequest(null);
                    setError('');
                  }}
                >
                  Batal
                </button>
                <button className="button danger" type="submit" disabled={busy || leaveRejectionNote.trim().length < 5}>
                  {busy ? 'Menyimpan…' : 'Tolak pengajuan'}
                </button>
              </div>
            </form>
          </div>
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
            <StatCard label="Offering" value={summary?.offered ?? '—'} tone="violet" icon="file" onClick={() => openWorkerStatus('offered')} />
            <StatCard label="Pra-aktif" value={summary?.preactive ?? '—'} tone="blue" icon="clock" onClick={() => openWorkerStatus('preactive')} />
            <StatCard label="Aktif" value={summary?.active ?? '—'} tone="green" icon="users" onClick={() => openWorkerStatus('active')} />
            <StatCard label="Nonaktif" value={summary?.inactive ?? '—'} tone="slate" icon="archive" onClick={() => openWorkerStatus('inactive')} />
            <StatCard label="Dokumen perlu tindak lanjut" value={summary?.expiring_documents ?? '—'} tone="amber" icon="fileClock" onClick={() => setActiveTab('documents')} />
            <StatCard label="Klaim presensi pending" value={summary?.pending_attendance_claims ?? '—'} tone="rose" icon="calendarClock" onClick={() => setActiveTab('attendance')} />
          </div>
          <section className="dashboard-document-card" aria-labelledby="dashboard-documents-heading">
            <div className="dashboard-document-heading">
              <div>
                <p className="eyebrow">TINDAK LANJUT DOKUMEN</p>
                <h3 id="dashboard-documents-heading">Masa berlaku</h3>
                <p className="muted">Dokumen kedaluwarsa atau memasuki ambang peringatan perusahaan.</p>
              </div>
              <div className="dashboard-document-heading-actions">
                <span className={`count-pill ${expiringDocuments.length ? 'pending-count' : ''}`}>
                  {expiringDocuments.length} perlu ditinjau
                </span>
                <button className="button secondary" type="button" onClick={() => setActiveTab('documents')}>
                  Lihat semua
                </button>
              </div>
            </div>
            {expiringDocuments.length ? (
              <ul className="dashboard-document-list">
                {expiringDocuments.slice(0, 5).map((document) => {
                  const warningStartDate = summary?.document_warning_start_date || localDateString();
                  const expired = document.status === 'expired' || document.valid_until < warningStartDate;
                  return (
                    <li key={`${document.worker_id}-${document.id}`}>
                      <button
                        className="dashboard-document-item"
                        type="button"
                        onClick={() => openDocumentFollowUp(document)}
                        aria-label={`Buka dokumen ${document.type} milik ${document.worker_name}`}
                      >
                        <span className={`dashboard-document-indicator ${expired ? 'expired' : ''}`} aria-hidden="true" />
                        <span className="dashboard-document-main">
                          <strong className="uppercase-text">{document.worker_name}</strong>
                          <small>
                            <span className="uppercase-text">{documentTypeName(document.type, documentTypes)}</span>
                            {' · '}
                            <span className={expired ? 'dashboard-document-expired' : 'dashboard-document-upcoming'}>
                              {expired ? 'Kedaluwarsa' : `Segera kedaluwarsa · ambang ${document.warning_threshold_days} hari`}
                            </span>
                          </small>
                        </span>
                        <span className="dashboard-document-date">
                          <small>Berakhir</small>
                          <time dateTime={document.valid_until}>{new Date(`${document.valid_until}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</time>
                        </span>
                        <span className="dashboard-document-open"><Icon name="arrowRight" size={16} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="dashboard-document-empty">
                <Icon name="checkCircle" />
                <p>Tidak ada dokumen yang kedaluwarsa atau memasuki ambang peringatan saat ini.</p>
              </div>
            )}
            {expiringDocuments.length > 5 && (
              <p className="dashboard-document-footnote">
                Menampilkan 5 dari {expiringDocuments.length} dokumen yang perlu ditinjau.
              </p>
            )}
          </section>
          <section className="dashboard-approval-card" aria-labelledby="dashboard-approval-heading">
            <div className="dashboard-approval-icon"><Icon name="checkCircle" /></div>
            <div className="dashboard-approval-copy">
              <p className="eyebrow">TINJAUAN HR</p>
              <h3 id="dashboard-approval-heading">Pusat Persetujuan</h3>
              <p className="muted">
                {pendingApprovalCount
                  ? `${summary?.pending_attendance_claims || 0} klaim presensi dan ${summary?.pending_leave_requests || 0} pengajuan pekerja menunggu tinjauan.`
                  : 'Tidak ada klaim presensi atau pengajuan pekerja yang menunggu tinjauan.'}
              </p>
            </div>
            <div className={`dashboard-approval-count ${pendingApprovalCount ? 'has-pending' : ''}`}>
              <strong>{summary ? pendingApprovalCount : '—'}</strong>
              <span>pending</span>
            </div>
            <button className="button secondary dashboard-approval-action" type="button" onClick={() => setActiveTab('attendance')}>
              {pendingApprovalCount ? 'Buka tinjauan HR' : 'Buka presensi'}
              <span aria-hidden="true">→</span>
            </button>
            {['admin', 'hr_manager'].includes(user.role) && (
              <div className="dashboard-leave-requests">
                <div className="dashboard-leave-heading">
                  <strong>Pengajuan izin, cuti, sakit, dan off</strong>
                  <span>{pendingLeaveRequestsLoading ? 'Memuat…' : `${pendingLeaveRequests.length} pending`}</span>
                </div>
                {pendingLeaveRequestsLoading ? <p className="muted">Memuat antrean pengajuan…</p>
                  : pendingLeaveRequests.length ? pendingLeaveRequests.slice(0, 4).map((request) => (
                    <article className="dashboard-leave-item" key={request.id}>
                      <div className="dashboard-leave-item-copy">
                        <strong className="uppercase-text">{request.full_name}</strong>
                        <span>{({ izin: 'Izin', cuti: 'Cuti', sakit: 'Sakit', off: 'Off' })[request.type]} · {request.start_date} – {request.end_date}</span>
                        <small>{request.reason}</small>
                        {request.has_attachment && (
                          <a
                            className="leave-attachment-link"
                            href={`/api/leaves/${encodeURIComponent(request.id)}/attachment`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Lihat lampiran: {request.attachment_original_name}
                          </a>
                        )}
                      </div>
                      <div className="dashboard-leave-actions">
                        <button className="button primary" type="button" disabled={busy} onClick={() => decideLeaveRequest(request.id, 'approved')}>Setujui</button>
                        <button className="button danger" type="button" disabled={busy} onClick={() => openLeaveRejection(request)}>Tolak</button>
                      </div>
                    </article>
                  )) : <p className="dashboard-leave-empty">Tidak ada pengajuan pekerja yang menunggu keputusan.</p>}
                {pendingLeaveRequests.length > 4 && (
                  <button className="dashboard-leave-more" type="button" onClick={() => setActiveTab('attendance')}>
                    Lihat {pendingLeaveRequests.length - 4} pengajuan lainnya
                  </button>
                )}
              </div>
            )}
          </section>
          {/*<section className="dashboard-actions" aria-label="Aksi cepat">
            <div>
              <p className="eyebrow">LANGKAH CEPAT</p>
              <h3>Tindak lanjuti operasional</h3>
              <p className="muted">Buka pekerjaan yang membutuhkan perhatian tim HR.</p>
            </div>
            <div className="dashboard-action-buttons">
              {user.role !== 'viewer' && (
                <button className="button primary" type="button" disabled={busy || workerQuotaFull} onClick={openWorkerModal}>
                  <span aria-hidden="true">+</span> Tambah pekerja
                </button>
              )}
              <button className="button secondary" type="button" onClick={() => setActiveTab('documents')}>
                Tinjau dokumen <span className="action-count">{summary?.expiring_documents ?? '—'}</span>
              </button>
              <button className="button secondary" type="button" onClick={() => setActiveTab('attendance')}>
                Buka presensi <span className="action-count">{summary?.pending_attendance_claims ?? '—'}</span>
              </button>
            </div>
          </section>*/}
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
          resetWorkerPortalSession={resetWorkerPortalSession}
          workers={workers}
        />

        <AttendancePanel
          activeTab={activeTab}
          attendanceDate={attendanceDate}
          attendanceData={attendanceData}
          attendanceLoading={attendanceLoading}
          attendanceMonth={attendanceMonth}
          attendancePage={attendancePage}
          attendancePageSize={attendancePageSize}
          attendanceSettings={attendanceSettings}
          companyPortalLink={companyPortalLink}
          companyPortalLinkNeedsRotation={companyPortalLinkNeedsRotation}
          attendanceStatusDrafts={attendanceStatusDrafts}
          attendanceSearch={attendanceSearch}
          busy={busy}
          copyToClipboard={copyToClipboard}
          decideAttendanceRequest={decideAttendanceRequest}
          decideLeaveRequest={decideLeaveRequest}
          openLeaveRejection={openLeaveRejection}
          filteredMonthlyWorkers={filteredMonthlyWorkers}
          monthlyAttendanceLoading={monthlyAttendanceLoading}
          monthlyCheckedIns={monthlyCheckedIns}
          monthlyDays={monthlyDays}
          monthlyPageCount={monthlyPageCount}
          monthlyWorkerRows={monthlyWorkerRows}
          pendingAttendanceApprovals={pendingAttendanceApprovals}
          pendingLeaveRequests={pendingLeaveRequests}
          pendingLeaveRequestsLoading={pendingLeaveRequestsLoading}
          reviewingAttendance={reviewingAttendance}
          saveAttendanceStatus={saveAttendanceStatus}
          resetWorkerPortalSession={resetWorkerPortalSession}
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
              <label htmlFor="profile-worker-search">Cari pekerja untuk melihat dokumen</label>
              <div className="profile-search-control">
                <span className="profile-search-icon"><Icon name="search" size={17} /></span>
                <input
                  id="profile-worker-search"
                  type="search"
                  value={profileWorkerSearch}
                  onChange={(event) => setProfileWorkerSearch(event.target.value)}
                  placeholder="Nama, posisi, departemen, atau ID pekerja (min. 3)"
                  aria-describedby="profile-worker-search-help"
                />
                {profileWorkerSearch && (
                  <button type="button" onClick={() => setProfileWorkerSearch('')} aria-label="Hapus pencarian pekerja">
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
              <p className={`profile-search-help ${profileSearchReady ? 'search-ready' : ''}`} id="profile-worker-search-help" role="status">
                {profileSearchReady
                  ? `Menampilkan ${Math.min(profileSearchResults.length, 6)} dari ${workers.length} pekerja · ${profileSearchResults.length} cocok`
                  : `Masukkan minimal 3 karakter untuk mencari pekerja${profileSearchTerm ? ` · ${Math.max(0, 3 - profileSearchTerm.length)} karakter lagi` : ''}.`}
              </p>
              <div className="profile-worker-options" aria-label="Daftar hasil pekerja">
                {profileSearchReady && profileSearchResults.slice(0, 6).map((worker) => (
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
                {profileSearchReady && !profileSearchResults.length && <span className="muted">Tidak ada pekerja yang cocok dengan pencarian ini.</span>}
              </div>
            </div>
            <div className="panel-heading">
              <div><p className="eyebrow">PROFIL & KELAYAKAN</p><h2 className="uppercase-text">{selectedProfileWorker?.full_name || 'Pilih pekerja'}</h2></div>
              {selectedProfileWorker && <StatusBadge status={selectedProfileWorker.status} />}
            </div>
            {!selectedProfileWorker ? (
              <p className="muted empty-detail">{profileSearchReady
                ? 'Pilih pekerja dari hasil pencarian untuk melihat dokumen, kelayakan, dan riwayat status.'
                : 'Hasil profil dan dokumen akan ditampilkan setelah pencarian mencapai minimal 3 karakter.'}</p>
            ) : (
              <>
                <div className={`eligibility-banner ${selectedProfileWorker.eligibility.eligible ? 'eligible' : 'ineligible'}`}>
                  <strong>{selectedProfileWorker.eligibility.eligible ? 'Persyaratan dokumen terpenuhi' : 'Persyaratan dokumen belum terpenuhi'}</strong>
                  <span>{selectedProfileWorker.eligibility.eligible ? 'HRD dapat mempertimbangkan aktivasi.' : 'Lengkapi dokumen wajib yang masih kurang atau kedaluwarsa.'}</span>
                </div>
                <div className="worker-number-profile">
                  <span>Nomor pekerja</span>
                  <strong>{selectedProfileWorker.worker_number || 'Belum ditetapkan'}</strong>
                </div>
                <div className="requirement-list">
                  {selectedProfileWorker.eligibility.checks.map((check) => (
                    <div className="requirement-item" key={check.type}>
                      <span className="uppercase-text">{documentTypeName(check.type, documentTypes)}</span>
                      <span className={`readiness ${check.valid ? 'ready' : 'needs-work'}`}>{check.valid ? 'Valid' : 'Belum valid'}</span>
                    </div>
                  ))}
                </div>
                <div className="document-heading"><h3>Riwayat dokumen</h3><span>{selectedProfileWorker.documents.length} catatan</span></div>
                {selectedProfileWorker.documents.length ? (
                  <div className="document-list">
                      {selectedProfileWorker.documents.map((document) => {
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
                            {user.role === 'admin' && <button className="button danger small-action" type="button" disabled={busy} onClick={() => archiveDocument(selectedProfileWorker.id, document.id)}>Arsipkan</button>}
                          </article>
                        );
                      })}
                  </div>
                ) : <p className="muted">Belum ada dokumen dicatat.</p>}
                {user.role === 'admin' && <div className="status-controls">
                  {selectedProfileWorker.status === 'offered' && <button className="button secondary" disabled={busy} onClick={() => changeStatus('preactive')}>Pindahkan ke pra-aktif</button>}
                  {['preactive', 'inactive'].includes(selectedProfileWorker.status) && (
                    <button className="button primary" disabled={busy || !selectedProfileWorker.eligibility.eligible} onClick={() => openActivationDialog(selectedProfileWorker)}>
                      {selectedProfileWorker.status === 'inactive' ? 'Aktifkan kembali' : 'Aktifkan pekerja'}
                    </button>
                  )}
                  {['active', 'preactive'].includes(selectedProfileWorker.status) && (
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
                  <button className="button danger" disabled={busy} onClick={() => archiveWorker(selectedProfileWorker.id)}>Arsipkan pekerja</button>
                </div>}
                {selectedProfileWorker.history?.length > 0 && (
                  <div className="history-line">
                    <h3>Riwayat status</h3>
                    {selectedProfileWorker.history.map((entry) => (
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
              {!selectedProfileWorker ? <p className="muted">Cari dan pilih pekerja setelah memasukkan minimal 3 karakter.</p> : (
                <form className="form-stack" onSubmit={handleCreateDocument}>
                  <label>Jenis dokumen<select className="uppercase-text" name="type" required disabled={!documentTypes.some((type) => type.is_active || selectedProfileWorker.required_document_types.includes(type.code))}>{documentTypes.filter((type) => type.is_active || selectedProfileWorker.required_document_types.includes(type.code)).map((type) => <option value={type.code} key={type.code}>{type.name}{type.is_active ? '' : ' (Nonaktif)'}</option>)}</select></label>
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
                  <button className="button primary" disabled={busy || !documentTypes.some((type) => type.is_active || selectedProfileWorker.required_document_types.includes(type.code))}>Simpan dokumen</button>
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
          onRotateAttendanceSalt={rotateCompanyPortalToken}
          companyPortalLink={companyPortalLink}
          onCopyCompanyPortalLink={copyToClipboard}
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
  return ['/portal', '/presensi'].includes(window.location.pathname) ? <Presensi /> : <WorkspaceApp />;
}

export default App;
