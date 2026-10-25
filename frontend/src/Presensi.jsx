import { useEffect, useState } from 'react';

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
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
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

function NavigationIcon({ name }) {
  const paths = {
    request: <><path d="M7 3.75h7l4.25 4.5v12A1.75 1.75 0 0 1 16.5 22h-9A1.75 1.75 0 0 1 5.75 20.25v-14A2.5 2.5 0 0 1 8.25 3.75" /><path d="M14 4v5h4.5M9 13h6M9 16.5h6" /></>,
    history: <><path d="M4.5 8A8 8 0 1 1 3.75 13" /><path d="M3.75 5v4h4M12 7.5v5l3 1.75" /></>,
    timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5M9 2.75h6M12 2.75v2.5" /></>,
    auto: <><path d="m12 3 1.55 5.45L19 10l-5.45 1.55L12 17l-1.55-5.45L5 10l5.45-1.55L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    account: <><circle cx="12" cy="8" r="3.25" /><path d="M5.25 20a6.75 6.75 0 0 1 13.5 0" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ActionButton({ action, busy, disabled, onClick }) {
  return (
    <button className="button primary attendance-action" type="button" disabled={busy || disabled} onClick={onClick}>
      <span className="attendance-action-icon"><NavigationIcon name="timer" /></span>
      <span>{busy ? 'Memproses presensi...' : action.startsWith('Ajukan ') ? action : action === 'check_in' ? 'Check-In / Hadir' : 'Check-Out'}</span>
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
  activity,
  onActivityChange,
  evidenceFile,
  onEvidenceChange,
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
            {statusText(attendance.status, hasCheckIn)}
          </span>
        </div>
        {!hasCheckIn && !hasCheckOut ? (
          <div className="attendance-empty-log">
            <span className="attendance-empty-icon"><NavigationIcon name="history" /></span>
            <span>Belum Ada Presensi Hari Ini</span>
            <small>Check-in untuk mencatat kehadiranmu.</small>
          </div>
        ) : (
          <div className="attendance-timeline">
            <div className={`attendance-timeline-item ${hasCheckIn ? 'complete' : ''}`}>
              <span className="attendance-timeline-marker" />
              <span><strong>Check-In</strong><small>{hasCheckIn ? formatTime(attendance.check_in_time) : 'Belum dilakukan'}</small></span>
              {hasCheckIn && <span className="attendance-timeline-value">Tercatat</span>}
            </div>
            <div className={`attendance-timeline-item ${hasCheckOut ? 'complete' : ''}`}>
              <span className="attendance-timeline-marker" />
              <span><strong>Check-Out</strong><small>{hasCheckOut ? formatTime(attendance.check_out_time) : 'Belum dilakukan'}</small></span>
              {hasCheckOut && <span className="attendance-timeline-value">Tercatat</span>}
            </div>
          </div>
        )}
      </section>

      {error && <div className="attendance-feedback error" role="alert">{error}</div>}
      {notice && <div className="attendance-feedback success" role="status">{notice}</div>}
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
              <div className="attendance-dinas-note">Dinas dapat dicatat di luar area kantor dan wajib dilengkapi foto bukti saat Check-In.</div>
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
            busy={busy}
            disabled={isDinas ? action !== 'check_out' && !evidenceFile : false}
            onClick={onAction}
          />
          <small>Lokasi GPS browser dapat dipengaruhi pengaturan perangkat dan bukan bukti anti-spoofing.</small>
        </section>
      ) : (
        <div className="attendance-complete">
          {attendance.approval_status === 'pending'
            ? 'Pengajuan sudah diterima dan menunggu persetujuan HR.'
            : attendance.approval_status === 'rejected'
              ? 'Pengajuan ditolak. Pilih aktivitas untuk mengirim pengajuan ulang.'
              : hasCheckOut ? 'Presensi hari ini sudah lengkap.' : hasCheckIn ? 'Check-in hari ini sudah tercatat.' : 'Status presensi hari ini sudah dicatat.'}
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
            <article className="attendance-history-item" key={record.attendance_date}>
              <div className="attendance-history-date">
                <strong>{new Date(`${record.attendance_date}T12:00:00+07:00`).toLocaleDateString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  timeZone: 'Asia/Jakarta',
                })}</strong>
                <small>{record.approval_status === 'pending'
                  ? 'Menunggu persetujuan'
                  : `${statusText(record.status, Boolean(record.check_in_time))}${record.approval_status === 'rejected' ? ' · Ditolak' : ''}`}</small>
              </div>
              <div className="attendance-history-times">
                <span>Masuk <strong>{formatTime(record.check_in_time)}</strong></span>
                <span>Pulang <strong>{formatTime(record.check_out_time)}</strong></span>
              </div>
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('timer');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [activity, setActivity] = useState('regular');
  const [evidenceFile, setEvidenceFile] = useState(null);
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
    if (!token || !workerId) {
      setError('Link presensi tidak valid. Gunakan tautan resmi dari HR perusahaan.');
      setLoading(false);
      return;
    }
    publicAttendanceRequest(`?worker_id=${encodeURIComponent(workerId)}&token=${encodeURIComponent(token)}`)
      .then(setAttendance)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [token, workerId]);

  async function recordAttendance() {
    const checkingOut = Boolean(attendance.check_in_time)
      && attendance.approval_status !== 'rejected';
    const selectedActivity = checkingOut ? (attendance.attendance_type || 'regular') : activity;
    const action = checkingOut
      ? 'check_out'
      : ['regular', 'dinas'].includes(selectedActivity) ? 'check_in' : 'request_status';
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const location = await requestLocation();
      const requiredActivity = action === 'request_status' ? selectedActivity : action;
      const requiredLocations = selectedActivity === 'dinas'
        ? []
        : (attendance.locations || []).filter((candidate) => candidate.allowed_activities.includes(requiredActivity));
      const matchingLocation = requiredLocations.find((candidate) => distanceInMeters(
        location.latitude,
        location.longitude,
        candidate.latitude,
        candidate.longitude
      ) <= candidate.radius_meters);
      if (requiredLocations.length && !matchingLocation) {
        throw new Error(`Aktivitas ini wajib dilakukan di dalam radius: ${requiredLocations.map((candidate) => `${candidate.name} (${candidate.radius_meters} m)`).join(', ')}.`);
      }
      const payload = {
        worker_id: workerId,
        token,
        action,
        latitude: location.latitude,
        longitude: location.longitude,
        ...(selectedActivity === 'dinas' ? { request_type: 'dinas' } : {}),
        ...(action === 'request_status' ? { request_type: selectedActivity } : {}),
      };
      let requestOptions;
      if (selectedActivity === 'dinas' && action === 'check_in') {
        if (!evidenceFile) throw new Error('Pilih foto bukti Dinas sebelum Check-In.');
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
        setNotice(action === 'check_in' ? 'Check-in berhasil dicatat.' : 'Check-out berhasil dicatat.');
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
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
              <div className="attendance-greeting-copy">
                <h1>Halo, <span className="uppercase-text">{attendance.full_name}</span></h1>
              </div>
            </section>
          )}
        </div>

        {loading ? (
          <section className="attendance-state-card" role="status">Memuat data pekerja...</section>
        ) : error && !attendance ? (
          <section className="attendance-state-card attendance-state-error" role="alert">
            <span className="attendance-state-icon">!</span>
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
                  onAction={recordAttendance}
                  currentTime={currentTime}
                  error={error}
                  notice={notice}
                  activity={activity}
                  onActivityChange={(value) => {
                    setActivity(value);
                    setEvidenceFile(null);
                  }}
                  evidenceFile={evidenceFile}
                  onEvidenceChange={setEvidenceFile}
                />
              )}
              {section === 'history' && <HistoryPanel records={attendance.recent_attendance || []} />}
              {section === 'request' && (
                <section className="attendance-content-card attendance-info-panel">
                  <span className="attendance-info-icon"><NavigationIcon name="request" /></span>
                  <p className="eyebrow">PENGAJUAN</p>
                  <h2>Hubungi tim HR</h2>
                  <p>Pengajuan izin atau cuti belum tersedia di halaman ini. Silakan sampaikan permohonan kepada tim HR perusahaan.</p>
                </section>
              )}
              {section === 'auto' && (
                <section className="attendance-content-card attendance-info-panel">
                  <span className="attendance-auto-state"><NavigationIcon name="auto" /> NONAKTIF</span>
                  <p className="eyebrow">PRESENSI OTOMATIS</p>
                  <h2>Kontrol tetap di tanganmu</h2>
                  <p>Check-in dan check-out tidak dijalankan otomatis. Tekan tombol Timer agar waktu dan lokasi tercatat saat kamu hadir.</p>
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
                  disabled={item.primary && busy}
                  onClick={() => {
                    if (item.primary && section === 'timer' && action) {
                      recordAttendance();
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
        <footer className="attendance-client-footer">Lokasi hanya diminta saat mencatat check-in atau check-out.</footer>
      </div>
    </main>
  );
}
