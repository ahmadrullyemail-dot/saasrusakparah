import { useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon.jsx';

const NAV_ITEMS = [
  { id: 'request', label: 'Pengajuan', icon: 'request' },
  { id: 'history', label: 'Riwayat', icon: 'history' },
  { id: 'timer', label: 'Timer', icon: 'timer', primary: true },
  { id: 'auto', label: 'Auto', icon: 'auto' },
  { id: 'account', label: 'Akun', icon: 'account' },
];

function formatTime(value) {
  if (!value) return '—';
  const databaseTime = String(value).match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/);
  if (databaseTime) return databaseTime[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }).format(date);
}

function formatDate(value) {
  if (!value) return 'Tanggal tidak tersedia';
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

function statusText(status, hasCheckIn) {
  if (status === 'permission') return 'Izin';
  if (status === 'leave') return 'Cuti';
  if (status === 'off') return 'Off';
  if (status === 'sick') return 'Sakit';
  if (status === 'absent') return 'Tidak hadir';
  if (status === 'dinas') return 'Dinas';
  if (hasCheckIn) return 'Hadir';
  return 'Belum ada presensi';
}

function distanceInMeters(latitude1, longitude1, latitude2, longitude2) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLatitude = radians(latitude2 - latitude1);
  const deltaLongitude = radians(longitude2 - longitude1);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2))
    * Math.sin(deltaLongitude / 2) ** 2;
  return 12742000 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function getAttendanceAction(attendance, activity) {
  const checkingOut = Boolean(attendance.check_in_time)
    && attendance.approval_status !== 'rejected';
  const selectedActivity = checkingOut ? (attendance.attendance_type || 'regular') : activity;
  const action = checkingOut
    ? 'check_out'
    : ['regular', 'dinas'].includes(selectedActivity) ? 'check_in' : 'request_status';
  return { action, selectedActivity };
}

function inspectAttendanceLocation(location, attendance, action, selectedActivity) {
  if (attendance.anti_mock_location_enabled) {
    if (location.isMocked) {
      return { allowed: false, status: 'Lokasi terdeteksi sebagai mock' };
    }
    if (!Number.isFinite(location.accuracy) || location.accuracy <= 0 || location.accuracy > 1000) {
      return { allowed: false, status: 'Akurasi lokasi di atas 1.000 meter' };
    }
    if (location.speed != null && (!Number.isFinite(location.speed) || location.speed < 0 || location.speed > 300)) {
      return { allowed: false, status: 'Sinyal kecepatan tidak valid' };
    }
  }

  if (selectedActivity === 'dinas') {
    return { allowed: true, status: 'Dinas · tidak memerlukan geofence' };
  }

  const requiredActivity = action === 'request_status' ? selectedActivity : action;
  const requiredLocations = (attendance.locations || []).filter((candidate) =>
    candidate.allowed_activities.includes(requiredActivity));
  if (!requiredLocations.length) {
    return { allowed: true, status: 'Tidak ada geofence wajib untuk aktivitas ini' };
  }

  const matchingLocation = requiredLocations.find((candidate) => distanceInMeters(
    location.latitude,
    location.longitude,
    candidate.latitude,
    candidate.longitude
  ) <= candidate.radius_meters);
  return matchingLocation
    ? { allowed: true, status: `Dalam radius · ${matchingLocation.name}` }
    : {
      allowed: false,
      status: `Di luar area wajib · ${requiredLocations.map((candidate) => candidate.name).join(', ')}`,
    };
}

async function compressEvidenceImage(file) {
  if (file.size <= 900 * 1024) return file;
  if (file.size > 12 * 1024 * 1024) throw new Error('Ukuran foto bukti maksimal 12 MB.');
  if (typeof createImageBitmap !== 'function') throw new Error('Browser ini tidak mendukung kompresi foto bukti.');
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 40000000) throw new Error('Resolusi foto bukti terlalu besar.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Foto bukti tidak dapat diproses.');
    let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', Math.max(0.45, 0.9 - attempt * 0.07)));
      if (!blob) throw new Error('Foto bukti tidak dapat dikompresi.');
      if (blob.size <= 900 * 1024) return new File([blob], 'dinas-evidence.jpg', { type: 'image/jpeg' });
      scale *= 0.82;
    }
    throw new Error('Foto bukti terlalu besar setelah dikompresi.');
  } finally {
    image.close();
  }
}

function requestLocation() {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('Browser ini tidak mendukung akses lokasi.'));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
        isMocked: position.isMocked === true
          || position.mocked === true
          || position.coords.isMocked === true
          || position.coords.mocked === true,
      }),
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Izinkan akses lokasi di browser untuk mencatat presensi.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Lokasi perangkat tidak tersedia. Periksa pengaturan lokasi lalu coba lagi.'
            : 'Pengambilan lokasi melewati batas waktu. Coba lagi.';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function publicAttendanceRequest(path, options) {
  const response = await fetch(`/api/public/attendance${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options?.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Permintaan presensi gagal.');
  return result.data;
}

async function publicLeaveRequest(path, options = {}) {
  const response = await fetch(`/api/leaves${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Pengajuan tidak dapat diproses.');
  return result.data;
}

function leaveTypeLabel(type) {
  return { izin: 'Izin', cuti: 'Cuti', sakit: 'Sakit', off: 'Off' }[type] || type;
}

function leaveStatusLabel(status) {
  return { pending: 'Pending', approved: 'Disetujui', rejected: 'Ditolak' }[status] || status;
}

function formatLeaveDate(value) {
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

function NavigationIcon({ name }) {
  const icons = { request: 'fileCheck', history: 'history', timer: 'clock', auto: 'refresh', account: 'user' };
  return <Icon name={icons[name]} />;
}

function ActionButton({ action, busy, busyLabel = 'Mengirim...', disabled, onClick }) {
  const label = action.startsWith('Ajukan ')
    ? action
    : action === 'check_in' ? 'Clock In' : 'Clock Out';
  return (
    <button
      className={`button primary attendance-action ${action === 'check_in' ? 'attendance-action-clock-in' : action === 'check_out' ? 'attendance-action-clock-out' : 'attendance-action-request'}`}
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
    >
      <span className="attendance-action-icon">
        {busy ? <span className="attendance-spinner" aria-hidden="true" /> : <NavigationIcon name="timer" />}
      </span>
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}

function TimerPanel({
  attendance,
  action,
  busy,
  onAction,
  currentTime,
  error,
  notice,
  locationWarning,
  activity,
  onActivityChange,
  evidenceFile,
  onEvidenceChange,
  confirmation,
  locationChecking,
  onConfirm,
  onCancel,
  onRetryLocation,
}) {
  const hasCheckIn = Boolean(attendance.check_in_time);
  const hasCheckOut = Boolean(attendance.check_out_time);
  const isDinas = action === 'check_out'
    ? attendance.attendance_type === 'dinas'
    : activity === 'dinas';
  const availableActivities = [
    ['regular', 'Presensi reguler'],
    ['dinas', 'Dinas (menunggu persetujuan HR)'],
    ['off', 'Pengajuan Off'],
    ['permission', 'Pengajuan Izin'],
    ['leave', 'Pengajuan Cuti'],
    ['sick', 'Pengajuan Sakit'],
  ];
  const currentAction = action === 'check_out'
    ? 'check_out'
    : ['regular', 'dinas'].includes(activity) ? 'check_in' : 'request_status';
  const allowedLocationActivity = currentAction === 'request_status' ? activity : currentAction;
  const requiredLocations = (attendance.locations || []).filter((location) =>
    location.allowed_activities.includes(allowedLocationActivity));

  return (
    <>
      <section className="attendance-clock-card">
        <div className="attendance-clock-label"><span className="attendance-live-dot" /> WAKTU SEKARANG · WIB</div>
        <strong className="attendance-clock">{currentTime.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'Asia/Jakarta',
        })}</strong>
        <span className="attendance-clock-date">{currentTime.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Asia/Jakarta',
        })}</span>
      </section>

      <section className="attendance-log-card" aria-labelledby="attendance-log-title">
        <div className="attendance-section-heading">
          <div>
            <p className="eyebrow">AKTIVITAS HARI INI</p>
            <h2 id="attendance-log-title">Log presensi</h2>
          </div>
          {attendance.approval_status === 'pending' && (
            <div className="attendance-pending-notice" role="status">
              Pengajuan {statusText(attendance.status, hasCheckIn)} sedang menunggu persetujuan HR.
            </div>
          )}
          {attendance.approval_status === 'rejected' && (
            <div className="attendance-rejected-notice" role="status">
              Pengajuan sebelumnya ditolak. Kamu dapat mengirim pengajuan baru untuk hari ini.
            </div>
          )}
          <span className={`attendance-status-pill ${hasCheckIn ? 'checked' : ''} status-${attendance.status || 'pending'}`}>
            <Icon name={hasCheckIn ? 'checkCircle' : 'clock'} size={14} />
            {statusText(attendance.status, hasCheckIn)}
          </span>
        </div>
        {!hasCheckIn && !hasCheckOut ? (
          <div className="attendance-empty-log">
            <span className="attendance-empty-icon"><NavigationIcon name="history" /></span>
            <span>Belum Ada Presensi Hari Ini</span>
            <small>Clock In untuk mencatat kehadiranmu.</small>
          </div>
        ) : (
          <div className="attendance-timeline">
            <div className={`attendance-timeline-item ${hasCheckIn ? 'complete' : ''}`}>
              <span className="attendance-timeline-icon"><Icon name={hasCheckIn ? 'checkCircle' : 'clock'} size={17} /></span>
              <span><strong>Clock In</strong><small>{hasCheckIn ? formatTime(attendance.check_in_time) : 'Belum dilakukan'}</small></span>
              {hasCheckIn && <span className="attendance-timeline-value"><Icon name="check" size={13} /> Tercatat</span>}
            </div>
            <div className={`attendance-timeline-item ${hasCheckOut ? 'complete' : ''}`}>
              <span className="attendance-timeline-icon"><Icon name={hasCheckOut ? 'checkCircle' : 'clock'} size={17} /></span>
              <span><strong>Clock Out</strong><small>{hasCheckOut ? formatTime(attendance.check_out_time) : 'Belum dilakukan'}</small></span>
              {hasCheckOut && <span className="attendance-timeline-value"><Icon name="check" size={13} /> Tercatat</span>}
            </div>
          </div>
        )}
      </section>

      {error && !locationWarning && <div className="attendance-feedback error" role="alert">{error}</div>}
      {notice && <div className="attendance-feedback success" role="status">{notice}</div>}
      {attendance.anti_mock_location_enabled && (
        <div className="attendance-anti-mock-notice">
          Anti-Mock Location aktif. Browser akan menolak sinyal mock yang tersedia, akurasi di atas 1.000 meter, dan kecepatan yang tidak masuk akal. Pemeriksaan web tidak dapat membuktikan keaslian GPS sepenuhnya.
        </div>
      )}
      {locationWarning && <div className="attendance-feedback error" role="alert">{locationWarning}</div>}
      {action ? (
        <section className="attendance-action-card">
          {action !== 'check_out' && (
            <label className="attendance-form-field">Jenis aktivitas
              <select value={activity} onChange={(event) => onActivityChange(event.target.value)}>
                {availableActivities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
          {isDinas ? (
            <>
              <div className="attendance-dinas-note">Dinas dapat dicatat di luar area kantor dan wajib dilengkapi foto bukti saat Clock In.</div>
              {action !== 'check_out' && (
                <label className="attendance-form-field">Foto bukti Dinas (JPG/PNG)
                  <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(event) => onEvidenceChange(event.currentTarget.files?.[0] || null)} />
                </label>
              )}
              {evidenceFile && action !== 'check_out' && <small className="attendance-evidence-name">Bukti dipilih: {evidenceFile.name}</small>}
            </>
          ) : (
            <>
              {requiredLocations.length ? (
                <div className="attendance-pending-notice">
                  Aktivitas ini wajib dilakukan di dalam radius salah satu area: {requiredLocations.map((location) => `${location.name} (${location.radius_meters} m)`).join(', ')}.
                </div>
              ) : (
                <div className="attendance-dinas-note">Aktivitas ini tidak diwajibkan di area tertentu dan dapat dilakukan dari luar area presensi.</div>
              )}
              <p>Koordinat GPS tetap dicatat saat presensi dikirim.</p>
            </>
          )}
          <ActionButton
            action={action === 'request_status'
              ? `Ajukan ${statusText(activity, false)}`
              : action}
            busy={busy || locationChecking}
            busyLabel={locationChecking ? 'Memeriksa lokasi...' : 'Mengirim...'}
            disabled={isDinas ? action !== 'check_out' && !evidenceFile : false}
            onClick={onAction}
          />
          {!attendance.anti_mock_location_enabled && <small>Lokasi GPS browser dapat dipengaruhi pengaturan perangkat dan bukan bukti anti-spoofing.</small>}
        </section>
      ) : (
        <div className="attendance-complete">
          {attendance.approval_status === 'pending'
            ? 'Pengajuan sudah diterima dan menunggu persetujuan HR.'
            : attendance.approval_status === 'rejected'
              ? 'Pengajuan ditolak. Pilih aktivitas untuk mengirim pengajuan ulang.'
              : hasCheckOut ? 'Presensi hari ini sudah lengkap.' : hasCheckIn ? 'Clock In hari ini sudah tercatat.' : 'Status presensi hari ini sudah dicatat.'}
        </div>
      )}
      {confirmation && (
        <div
          className="attendance-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy && !locationChecking) onCancel();
          }}
        >
          <section
            className="attendance-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-confirm-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy && !locationChecking) onCancel();
            }}
          >
            <header className="attendance-confirm-heading">
              <span className={`attendance-confirm-icon ${confirmation.action === 'check_in' ? 'clock-in' : confirmation.action === 'check_out' ? 'clock-out' : ''}`}>
                <NavigationIcon name="timer" />
              </span>
              <div>
                <p className="eyebrow">KONFIRMASI PRESENSI</p>
                <h2 id="attendance-confirm-title">
                  {confirmation.action === 'check_in' ? 'Konfirmasi Clock In'
                    : confirmation.action === 'check_out' ? 'Konfirmasi Clock Out'
                      : `Konfirmasi ${statusText(confirmation.selectedActivity, false)}`}
                </h2>
              </div>
            </header>
            <div className="attendance-confirm-details">
              <div><span>Waktu sistem · WIB</span><strong>{currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' })}</strong></div>
              <div>
                <span>Status lokasi &amp; geofence</span>
                {locationChecking
                  ? <strong className="attendance-confirm-location checking"><span className="attendance-spinner" aria-hidden="true" /> Memeriksa lokasi...</strong>
                  : confirmation.locationCheck
                    ? <strong className={`attendance-confirm-location ${confirmation.locationCheck.allowed ? 'allowed' : 'blocked'}`}>{confirmation.locationCheck.status}</strong>
                    : <strong className="attendance-confirm-location blocked">{confirmation.locationError || 'Lokasi belum tersedia'}</strong>}
              </div>
              {confirmation.selectedActivity === 'dinas' && confirmation.action === 'check_in' && (
                <div><span>Bukti Dinas</span><strong>{evidenceFile ? evidenceFile.name : 'Foto bukti belum dipilih'}</strong></div>
              )}
            </div>
            <p className="attendance-confirm-note">
              {confirmation.selectedActivity === 'dinas'
                ? 'Dinas tidak dibatasi geofence. Lokasi dan bukti yang dipilih akan dikirim untuk ditinjau HR.'
                : 'Pastikan waktu dan status lokasi sudah sesuai. Server tetap memvalidasi aturan presensi sebelum menyimpan data.'}
            </p>
            {confirmation.locationError && !locationChecking && (
              <button className="button secondary attendance-confirm-retry" type="button" onClick={onRetryLocation}>
                Coba periksa lokasi lagi
              </button>
            )}
            <div className="attendance-confirm-actions">
              <button className="button secondary" type="button" disabled={busy || locationChecking} onClick={onCancel} autoFocus>Batal</button>
              <button
                className={`button primary attendance-confirm-submit ${confirmation.action === 'check_in' ? 'clock-in' : confirmation.action === 'check_out' ? 'clock-out' : ''}`}
                type="button"
                disabled={busy || locationChecking || !confirmation.location || !confirmation.locationCheck?.allowed || (confirmation.selectedActivity === 'dinas' && confirmation.action === 'check_in' && !evidenceFile)}
                onClick={onConfirm}
              >
                {busy
                  ? <><span className="attendance-spinner" aria-hidden="true" /> Mengirim...</>
                  : confirmation.action === 'check_in' ? 'Konfirmasi Clock In'
                    : confirmation.action === 'check_out' ? 'Konfirmasi Clock Out'
                      : 'Kirim Pengajuan'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function HistoryPanel({ records }) {
  return (
    <section className="attendance-content-card">
      <div className="attendance-section-heading">
        <div><p className="eyebrow">30 HARI TERAKHIR</p><h2>Riwayat presensi</h2></div>
      </div>
      {records.length ? (
        <div className="attendance-history-list">
          {records.map((record) => (
            <article
              className={`attendance-history-item ${record.record_type === 'leave_request' ? 'attendance-history-request-rejected' : ''}`}
              key={record.record_type === 'leave_request' ? `leave-${record.request_id}` : `attendance-${record.attendance_date}`}
            >
              <div className="attendance-history-date">
                <strong>{new Date(`${record.attendance_date}T12:00:00+07:00`).toLocaleDateString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  timeZone: 'Asia/Jakarta',
                })}</strong>
                <small>{record.record_type === 'leave_request'
                  ? `Pengajuan ${leaveTypeLabel(record.leave_type)} · Ditolak`
                  : record.approval_status === 'pending'
                    ? 'Menunggu persetujuan'
                    : `${statusText(record.status, Boolean(record.check_in_time))}${record.approval_status === 'rejected' ? ' · Ditolak' : ''}`}</small>
              </div>
              {record.record_type === 'leave_request' ? (
                <div className="attendance-history-request-details">
                  <span>
                    Rentang tanggal: {formatLeaveDate(record.attendance_date)} – {formatLeaveDate(record.end_date)}
                  </span>
                  <span>Alasan: {record.reason}</span>
                  {record.rejection_note && <strong>Catatan HR: {record.rejection_note}</strong>}
                </div>
              ) : (
                <div className="attendance-history-times">
                  <span>Clock In <strong>{formatTime(record.check_in_time)}</strong></span>
                  <span>Clock Out <strong>{formatTime(record.check_out_time)}</strong></span>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : <p className="attendance-muted">Belum ada catatan presensi dalam 30 hari terakhir.</p>}
      <p className="attendance-privacy-note">Riwayat yang ditampilkan hanya catatan yang sudah tersimpan.</p>
    </section>
  );
}

export default function Presensi() {
  const [attendance, setAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locationChecking, setLocationChecking] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [locationWarning, setLocationWarning] = useState('');
  const [section, setSection] = useState('timer');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [activity, setActivity] = useState('regular');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [leaveRequestsLoading, setLeaveRequestsLoading] = useState(true);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [leaveNotice, setLeaveNotice] = useState('');
  const [leaveForm, setLeaveForm] = useState({ type: 'izin', start_date: '', end_date: '', reason: '' });
  const [leaveAttachment, setLeaveAttachment] = useState(null);
  const actionLockRef = useRef(false);
  const confirmationSubmitLockRef = useRef(false);
  const leaveSubmitLockRef = useRef(false);
  const [{ token, workerId }] = useState(() => {
    const parameters = new URLSearchParams(window.location.search);
    return {
      token: parameters.get('token') || '',
      workerId: parameters.get('worker_id') || '',
    };
  });

  useEffect(() => {
    const timerId = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    let active = true;
    if (!token || !workerId) {
      setError('Link presensi tidak valid. Gunakan tautan resmi dari HR perusahaan.');
      setLoading(false);
      setLeaveRequestsLoading(false);
      return () => { active = false; };
    }
    const query = `?worker_id=${encodeURIComponent(workerId)}&token=${encodeURIComponent(token)}`;
    const refreshPortalData = () => {
      publicAttendanceRequest(query)
        .then((data) => {
          if (active) setAttendance(data);
        })
        .catch((requestError) => {
          if (active) setError(requestError.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      publicLeaveRequest(query)
        .then((requests) => {
          if (active && !leaveSubmitLockRef.current) setLeaveRequests(requests);
        })
        .catch((requestError) => {
          if (active) setLeaveError(requestError.message);
        })
        .finally(() => {
          if (active) setLeaveRequestsLoading(false);
        });
    };
    refreshPortalData();
    const refreshInterval = window.setInterval(refreshPortalData, 15000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
    };
  }, [section, token, workerId]);

  async function submitLeaveRequest(event) {
    event.preventDefault();
    if (leaveSubmitLockRef.current || leaveSubmitting) return;
    if (!leaveForm.start_date || !leaveForm.end_date || leaveForm.start_date > leaveForm.end_date
      || leaveForm.reason.trim().length < 5) {
      setLeaveError('Isi rentang tanggal yang valid dan alasan minimal 5 karakter.');
      return;
    }
    if (leaveAttachment && (!['image/jpeg', 'image/png'].includes(leaveAttachment.type)
      || leaveAttachment.size > 5 * 1024 * 1024)) {
      setLeaveError('Lampiran harus berupa gambar JPG/PNG dengan ukuran maksimal 5 MB.');
      return;
    }
    leaveSubmitLockRef.current = true;
    setLeaveSubmitting(true);
    setLeaveError('');
    setLeaveNotice('');
    try {
      const formData = new FormData();
      Object.entries({
        worker_id: workerId,
        token,
        ...leaveForm,
        reason: leaveForm.reason.trim(),
      }).forEach(([key, value]) => formData.append(key, value));
      if (leaveAttachment) formData.append('attachment', leaveAttachment);
      await publicLeaveRequest('', {
        method: 'POST',
        body: formData,
      });
      setLeaveForm({ type: 'izin', start_date: '', end_date: '', reason: '' });
      setLeaveAttachment(null);
      setLeaveNotice('Pengajuan berhasil dikirim dan sedang menunggu tinjauan HR.');
      try {
        const requests = await publicLeaveRequest(
          `?worker_id=${encodeURIComponent(workerId)}&token=${encodeURIComponent(token)}`
        );
        setLeaveRequests(requests);
      } catch (historyError) {
        setLeaveError(`Pengajuan berhasil dikirim, tetapi riwayat belum dapat dimuat: ${historyError.message}`);
      }
    } catch (requestError) {
      setLeaveError(requestError.message);
    } finally {
      leaveSubmitLockRef.current = false;
      setLeaveSubmitting(false);
    }
  }

  async function checkConfirmationLocation(actionContext) {
    setLocationChecking(true);
    setConfirmation((current) => current && ({ ...current, location: null, locationCheck: null, locationError: '' }));
    try {
      const location = await requestLocation();
      const locationCheck = inspectAttendanceLocation(
        location,
        attendance,
        actionContext.action,
        actionContext.selectedActivity
      );
      setConfirmation((current) => current && ({
        ...current,
        location,
        locationCheck,
        locationError: '',
      }));
    } catch (locationError) {
      setConfirmation((current) => current && ({
        ...current,
        location: null,
        locationCheck: null,
        locationError: locationError.message,
      }));
    } finally {
      setLocationChecking(false);
    }
  }

  function openActionConfirmation() {
    if (actionLockRef.current || busy || !attendance) return;
    const actionContext = getAttendanceAction(attendance, activity);
    if (actionContext.action === 'check_in'
      && actionContext.selectedActivity === 'dinas'
      && !evidenceFile) {
      setError('Pilih foto bukti Dinas sebelum Clock In.');
      return;
    }
    actionLockRef.current = true;
    setError('');
    setNotice('');
    setLocationWarning('');
    setConfirmation({ ...actionContext, location: null, locationCheck: null, locationError: '' });
    checkConfirmationLocation(actionContext);
  }

  function closeActionConfirmation() {
    if (busy || locationChecking) return;
    actionLockRef.current = false;
    setConfirmation(null);
  }

  async function recordAttendance(actionContext, location) {
    const { action, selectedActivity } = actionContext;
    try {
      if (attendance.anti_mock_location_enabled) {
        if (location.isMocked) {
          const warning = 'Presensi diblokir: perangkat/browser menandai koordinat ini sebagai lokasi mock.';
          setLocationWarning(warning);
          throw new Error(warning);
        }
        if (!Number.isFinite(location.accuracy) || location.accuracy <= 0 || location.accuracy > 1000) {
          const warning = 'Presensi diblokir: akurasi GPS lebih buruk dari 1.000 meter. Aktifkan lokasi presisi dan coba lagi.';
          setLocationWarning(warning);
          throw new Error(warning);
        }
        if (location.speed != null && (!Number.isFinite(location.speed) || location.speed < 0 || location.speed > 300)) {
          const warning = 'Presensi diblokir: kecepatan GPS tidak masuk akal.';
          setLocationWarning(warning);
          throw new Error(warning);
        }
      }
      const locationCheck = inspectAttendanceLocation(location, attendance, action, selectedActivity);
      if (!locationCheck.allowed) {
        throw new Error(locationCheck.status);
      }
      const payload = {
        worker_id: workerId,
        token,
        action,
        latitude: location.latitude,
        longitude: location.longitude,
        is_mocked: location.isMocked,
        location_accuracy: location.accuracy,
        location_speed: location.speed == null ? '' : location.speed,
        ...(selectedActivity === 'dinas' ? { request_type: 'dinas' } : {}),
        ...(action === 'request_status' ? { request_type: selectedActivity } : {}),
      };
      let requestOptions;
      if (selectedActivity === 'dinas' && action === 'check_in') {
        if (!evidenceFile) throw new Error('Pilih foto bukti Dinas sebelum Clock In.');
        const compressedEvidence = await compressEvidenceImage(evidenceFile);
        const formData = new FormData();
        Object.entries(payload).forEach(([key, value]) => formData.append(key, String(value)));
        formData.append('evidence', compressedEvidence);
        requestOptions = { method: 'POST', body: formData };
      } else {
        requestOptions = { method: 'POST', body: JSON.stringify(payload) };
      }
      const result = await publicAttendanceRequest('', {
        ...requestOptions,
      });
      setAttendance((current) => {
        const history = current.recent_attendance || [];
        const recentAttendance = [
          result,
          ...history.filter((record) => record.attendance_date !== result.attendance_date),
        ].slice(0, 30);
        return { ...current, ...result, recent_attendance: recentAttendance };
      });
      if (selectedActivity === 'dinas' && action === 'check_in') {
        setNotice('Pengajuan Dinas dan bukti berhasil dikirim. Menunggu persetujuan HR.');
        setEvidenceFile(null);
        setActivity('dinas');
      } else if (action === 'request_status') {
        setNotice(`Pengajuan ${statusText(selectedActivity, false)} berhasil dikirim dan menunggu persetujuan HR.`);
      } else {
        setNotice(action === 'check_in' ? 'Clock In berhasil dicatat.' : 'Clock Out berhasil dicatat.');
      }
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  }

  async function confirmAttendanceAction() {
    if (confirmationSubmitLockRef.current
      || !confirmation
      || busy
      || locationChecking
      || !confirmation.locationCheck?.allowed
      || !confirmation.location) return;
    confirmationSubmitLockRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setLocationWarning('');
    let closeConfirmation = false;
    try {
      const latestLocation = await requestLocation();
      const latestLocationCheck = inspectAttendanceLocation(
        latestLocation,
        attendance,
        confirmation.action,
        confirmation.selectedActivity
      );
      if (!latestLocationCheck.allowed) {
        setConfirmation((current) => current && ({
          ...current,
          location: latestLocation,
          locationCheck: latestLocationCheck,
          locationError: '',
        }));
        return;
      }
      closeConfirmation = true;
      await recordAttendance(confirmation, latestLocation);
    } catch (locationError) {
      setConfirmation((current) => current && ({
        ...current,
        location: null,
        locationCheck: null,
        locationError: locationError.message,
      }));
    } finally {
      setBusy(false);
      confirmationSubmitLockRef.current = false;
      if (closeConfirmation) {
        actionLockRef.current = false;
        setConfirmation(null);
      }
    }
  }

  const hasManagerRecordedStatus = ['permission', 'sick', 'absent', 'off', 'leave'].includes(attendance?.status)
    && attendance?.approval_status !== 'rejected';
  const action = hasManagerRecordedStatus
    || (attendance?.approval_status === 'pending' && attendance?.attendance_type !== 'dinas')
    || (attendance?.approval_status === 'approved' && attendance?.attendance_type !== 'dinas')
    || (attendance?.check_out_time && attendance?.approval_status !== 'rejected')
    ? null
    : attendance?.check_in_time && attendance?.approval_status !== 'rejected'
      ? 'check_out'
      : activity === 'regular' || activity === 'dinas' ? 'check_in' : 'request_status';
  const companyMark = attendance?.company_name?.trim()?.slice(0, 1)?.toUpperCase() || 'R';

  return (
    <main className="attendance-client-page">
      <div className="attendance-client-shell">
        <div className="attendance-client-sticky">
          <header className="attendance-client-header">
            <div className="attendance-company-brand">
              <span className="attendance-company-logo" aria-hidden="true">{companyMark}</span>
              <span><strong className="uppercase-text">{attendance?.company_name || 'Presensi Perusahaan'}</strong><small>Portal presensi pekerja</small></span>
            </div>
          </header>
          {attendance && !loading && !error && (
            <section className="attendance-worker-greeting">
              <span className="attendance-greeting-avatar" aria-hidden="true">
                {attendance.full_name?.trim()?.slice(0, 1)?.toUpperCase() || 'P'}
              </span>
              <div className="attendance-greeting-copy">
                <p className="eyebrow">PORTAL PEKERJA</p>
                <h1>Halo, <span className="uppercase-text">{attendance.full_name}</span></h1>
                <div className="attendance-worker-role">
                  <span className="attendance-position-chip"><Icon name="briefcase" size={13} />{attendance.position || 'Pekerja'}</span>
                  <span className="attendance-date-chip"><Icon name="calendar" size={13} />{currentTime.toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    timeZone: 'Asia/Jakarta',
                  })}</span>
                </div>
              </div>
            </section>
          )}
        </div>

        {loading ? (
          <section className="attendance-state-card" role="status">Memuat data pekerja...</section>
        ) : error && !attendance ? (
          <section className="attendance-state-card attendance-state-error" role="alert">
            <span className="attendance-state-icon"><Icon name="warning" /></span>
            <h1>Link presensi tidak dapat digunakan</h1>
            <p>{error}</p>
            <small>Pastikan link berasal dari dashboard HR dan memuat ID pekerja serta token yang sah.</small>
          </section>
        ) : (
          <>
            <div className="attendance-client-content">
              {section === 'timer' && (
                <TimerPanel
                  attendance={attendance}
                  action={action}
                  busy={busy}
                  onAction={openActionConfirmation}
                  currentTime={currentTime}
                  error={error}
                  notice={notice}
                  locationWarning={locationWarning}
                  activity={activity}
                  onActivityChange={(value) => {
                    setActivity(value);
                    setEvidenceFile(null);
                  }}
                  evidenceFile={evidenceFile}
                  onEvidenceChange={setEvidenceFile}
                  confirmation={confirmation}
                  locationChecking={locationChecking}
                  onConfirm={confirmAttendanceAction}
                  onCancel={closeActionConfirmation}
                  onRetryLocation={() => checkConfirmationLocation(confirmation)}
                />
              )}
              {section === 'history' && <HistoryPanel records={attendance.recent_attendance || []} />}
              {section === 'request' && (
                <section className="attendance-content-card attendance-leave-panel">
                  <div className="attendance-section-heading">
                    <div><p className="eyebrow">PERMOHONAN PEKERJA</p><h2>Pengajuan Izin, Cuti, Sakit, atau Off</h2></div>
                  </div>
                  <form className="attendance-leave-form" onSubmit={submitLeaveRequest}>
                    <label className="attendance-form-field">Jenis pengajuan
                      <select
                        value={leaveForm.type}
                        onChange={(event) => setLeaveForm((current) => ({ ...current, type: event.target.value }))}
                        disabled={leaveSubmitting}
                        required
                      >
                        <option value="izin">Izin</option>
                        <option value="cuti">Cuti</option>
                        <option value="sakit">Sakit</option>
                        <option value="off">Off</option>
                      </select>
                    </label>
                    <div className="attendance-leave-date-grid">
                      <label className="attendance-form-field">Tanggal mulai
                        <input
                          type="date"
                          value={leaveForm.start_date}
                          onChange={(event) => setLeaveForm((current) => ({ ...current, start_date: event.target.value }))}
                          disabled={leaveSubmitting}
                          required
                        />
                      </label>
                      <label className="attendance-form-field">Tanggal selesai
                        <input
                          type="date"
                          min={leaveForm.start_date || undefined}
                          value={leaveForm.end_date}
                          onChange={(event) => setLeaveForm((current) => ({ ...current, end_date: event.target.value }))}
                          disabled={leaveSubmitting}
                          required
                        />
                      </label>
                    </div>
                    <label className="attendance-form-field">Keterangan / alasan
                      <textarea
                        value={leaveForm.reason}
                        onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Jelaskan keperluan pengajuan (minimal 5 karakter)"
                        maxLength={1000}
                        rows={3}
                        disabled={leaveSubmitting}
                        required
                      />
                      <small>{leaveForm.reason.length}/1000 karakter</small>
                    </label>
                    <label className="attendance-form-field">Lampiran bukti (opsional, JPG/PNG · maksimal 5 MB)
                      <input
                        type="file"
                        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] || null;
                          setLeaveAttachment(file);
                          if (file && !['image/jpeg', 'image/png'].includes(file.type)) {
                            setLeaveError('Lampiran hanya boleh berupa gambar JPG atau PNG.');
                          } else if (file && file.size > 5 * 1024 * 1024) {
                            setLeaveError('Ukuran lampiran maksimal 5 MB.');
                          } else {
                            setLeaveError('');
                          }
                        }}
                        disabled={leaveSubmitting}
                      />
                      <small>{leaveAttachment ? `Dipilih: ${leaveAttachment.name}` : 'Lampirkan foto surat dokter atau bukti izin.'}</small>
                    </label>
                    {leaveError && <p className="attendance-feedback error" role="alert">{leaveError}</p>}
                    {leaveNotice && <p className="attendance-feedback success" role="status">{leaveNotice}</p>}
                    <button className="button primary attendance-leave-submit" type="submit" disabled={leaveSubmitting}>
                      {leaveSubmitting
                        ? <><span className="attendance-spinner" aria-hidden="true" /> Mengirim pengajuan...</>
                        : 'Kirim pengajuan'}
                    </button>
                  </form>

                  <div className="attendance-leave-history">
                    <div className="attendance-section-heading">
                      <div><p className="eyebrow">STATUS PERMOHONAN</p><h3>Riwayat pengajuan</h3></div>
                      <span className="count-pill">{leaveRequests.length} pengajuan</span>
                    </div>
                    {leaveRequestsLoading ? <p className="attendance-muted">Memuat riwayat pengajuan...</p>
                      : leaveRequests.length ? (
                        <div className="attendance-leave-list">
                          {leaveRequests.map((request) => (
                            <article className="attendance-leave-item" key={request.id}>
                              <div className="attendance-leave-item-heading">
                                <strong>{leaveTypeLabel(request.type)}</strong>
                                <span className={`attendance-leave-status status-${request.status}`}>{leaveStatusLabel(request.status)}</span>
                              </div>
                              <span className="attendance-leave-dates">
                                {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}
                              </span>
                              <p>{request.reason}</p>
                              {request.rejection_note && (
                                <div className="attendance-leave-rejection-note">
                                  <strong>Catatan penolakan</strong>
                                  <span>{request.rejection_note}</span>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      ) : <p className="attendance-leave-empty">Belum ada riwayat pengajuan. Kirim formulir di atas untuk memulai.</p>}
                  </div>
                </section>
              )}
              {section === 'auto' && (
                <section className="attendance-content-card attendance-info-panel">
                  <span className="attendance-auto-state"><NavigationIcon name="auto" /> NONAKTIF</span>
                  <p className="eyebrow">PRESENSI OTOMATIS</p>
                  <h2>Kontrol tetap di tanganmu</h2>
                  <p>Clock In dan Clock Out tidak dijalankan otomatis. Tekan tombol Timer agar waktu dan lokasi tercatat saat kamu hadir.</p>
                </section>
              )}
              {section === 'account' && (
                <section className="attendance-content-card attendance-account-card">
                  <span className="attendance-account-avatar">{attendance.full_name.slice(0, 1).toUpperCase()}</span>
                  <p className="eyebrow">AKUN PEKERJA</p>
                  <h2 className="uppercase-text">{attendance.full_name}</h2>
                  <p className="uppercase-text">{attendance.position}</p>
                  <div><span>Perusahaan</span><strong className="uppercase-text">{attendance.company_name}</strong></div>
                  <div><span>ID pekerja</span><strong>{attendance.worker_id}</strong></div>
                </section>
              )}
            </div>

            <nav className="attendance-bottom-nav" aria-label="Navigasi presensi">
              {NAV_ITEMS.map((item) => (
                <button
                  className={`attendance-nav-item ${item.primary ? 'primary-nav-item' : ''} ${section === item.id ? 'selected' : ''}`}
                  type="button"
                  key={item.id}
                  aria-current={section === item.id ? 'page' : undefined}
                  disabled={item.primary && (busy || Boolean(confirmation))}
                  onClick={() => {
                    if (item.primary && section === 'timer' && action) {
                      openActionConfirmation();
                      return;
                    }
                    setSection(item.id);
                    setError('');
                    setNotice('');
                  }}
                >
                  <span className="attendance-nav-icon"><NavigationIcon name={item.icon} /></span>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </>
        )}
        <footer className="attendance-client-footer">Lokasi hanya diminta saat mencatat Clock In atau Clock Out.</footer>
      </div>
    </main>
  );
}
