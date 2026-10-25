import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import Presensi from './Presensi.jsx';

const CONTRACT_TYPES = [
  ['pkwt', 'PKWT'],
  ['pkwtt', 'PKWTT'],
  ['freelance', 'Freelance'],
  ['daily_worker', 'Daily Worker'],
];

const STATUS_LABELS = {
  offered: 'Offering',
  preactive: 'Pra-aktif',
  active: 'Aktif',
  inactive: 'Nonaktif',
};

const NAVIGATION_TABS = [
  { id: 'overview', label: 'Ringkasan', icon: '⌂' },
  { id: 'workers', label: 'Data pekerja', icon: '♙' },
  { id: 'documents', label: 'Dokumen & masa berlaku', icon: '▤' },
  { id: 'attendance', label: 'Presensi', icon: '◷' },
  { id: 'settings', label: 'Pengaturan', icon: '⚙' },
];

const APP_THEMES = [
  { id: 'standard', label: 'Default / Standard', description: 'Tampilan standar Ruang Kerja HRD.' },
  { id: 'dark', label: 'Dark Mode', description: 'Tampilan gelap untuk kondisi cahaya rendah.' },
  { id: 'clean', label: 'Compact / Light Clean', description: 'Tampilan terang dengan jarak dan panel lebih ringkas.' },
];

const USER_ROLE_LABELS = {
  admin: 'Admin',
  hr_manager: 'HR Staff',
  viewer: 'Viewer',
};

const MAX_PROFILE_PHOTO_BYTES = 900 * 1024;
const MAX_PROFILE_PHOTO_SOURCE_BYTES = 12 * 1024 * 1024;
const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY;

function documentTypeName(code, documentTypes) {
  return documentTypes.find((type) => type.code === code)?.name || code;
}

function addDaysToDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function excelDateString(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const localDate = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (localDate) return `${localDate[3]}-${localDate[2].padStart(2, '0')}-${localDate[1].padStart(2, '0')}`;
  return text;
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const randomValues = new Uint8Array(16);
  window.crypto.getRandomValues(randomValues);
  return `${Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('')}Aa7!`;
}

async function compressProfilePhoto(file) {
  if (file.size <= MAX_PROFILE_PHOTO_BYTES) return file;
  if (file.size > MAX_PROFILE_PHOTO_SOURCE_BYTES) {
    throw new Error('Ukuran gambar sumber maksimal 12 MB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Browser ini tidak mendukung pemrosesan foto. Gunakan gambar maksimal 900 KB.');
  }

  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 40000000) {
      throw new Error('Resolusi foto terlalu besar. Pilih gambar dengan resolusi lebih rendah.');
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Foto tidak dapat diproses oleh browser.');

    let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.45, 0.9 - attempt * 0.07);
      const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!compressed) throw new Error('Foto tidak dapat dikompresi oleh browser.');
      if (compressed.size <= MAX_PROFILE_PHOTO_BYTES) {
        return new File([compressed], 'profile-photo.jpg', {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
      scale *= 0.82;
    }
    throw new Error('Foto tetap terlalu besar setelah dikompresi. Pilih gambar lain.');
  } finally {
    image.close();
  }
}

function documentState(document) {
  if (document.status !== 'valid') {
    return {
      label: document.status === 'pending' ? 'Menunggu' : document.status === 'expired' ? 'Kedaluwarsa' : 'Ditolak',
      valid: false,
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (['mcu', 'pkwt', 'sim'].includes(document.type) && !document.valid_until) {
    return { label: 'Tanggal akhir diperlukan', valid: false };
  }
  if (document.valid_from && document.valid_from > today) return { label: 'Belum berlaku', valid: false };
  if (document.valid_until && document.valid_until < today) return { label: 'Kedaluwarsa', valid: false };
  return { label: 'Valid', valid: true };
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Permintaan gagal.');
    error.status = response.status;
    throw error;
  }
  return result.data;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function attendanceStatusLabel(status) {
  return {
    present: 'Hadir',
    permission: 'Izin',
    sick: 'Sakit',
    absent: 'Tidak hadir',
    off: 'Off',
    leave: 'Cuti',
    dinas: 'Dinas',
  }[status] || 'Belum presensi';
}

function monthlyAttendanceCode(record) {
  if (!record?.attendance_id) return '';
  if (record.approval_status === 'pending') return 'P';
  if (record.status === 'permission' || record.status === 'leave' || record.status === 'off') return 'I';
  if (record.status === 'sick') return 'S';
  if (record.status === 'late') return 'T';
  if (record.check_in_time) return record.check_out_time ? 'H' : 'X';
  if (record.status === 'absent') return 'X';
  return '';
}

function attendanceMonthLabel(month) {
  if (!month) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function attendanceMonthSummary(days) {
  return Object.values(days).reduce((summary, record) => {
    const code = monthlyAttendanceCode(record);
    if (code) summary[code] += 1;
    return summary;
  }, { H: 0, T: 0, I: 0, S: 0, X: 0, P: 0 });
}

const ATTENDANCE_ACTIVITY_OPTIONS = [
  ['check_in', 'Check-In'],
  ['check_out', 'Check-Out'],
  ['off', 'Off'],
  ['permission', 'Izin'],
  ['leave', 'Cuti'],
  ['sick', 'Sakit'],
];

function MapClickPicker({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng);
    },
  });
  return null;
}

function AttendanceLocationsMap({ locations, draft, onSelect }) {
  const defaultPosition = locations.length
    ? [locations[0].latitude, locations[0].longitude]
    : [-6.2088, 106.8456];
  const center = draft.latitude && draft.longitude
    ? [Number(draft.latitude), Number(draft.longitude)]
    : defaultPosition;
  const draftRadius = Number(draft.radius_meters);
  const hasDraftRadius = Number.isFinite(draftRadius) && draftRadius > 0;
  return (
    <MapContainer className="attendance-location-map" center={center} zoom={13} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY || '')}`}
        subdomains="abcd"
        maxZoom={20}
      />
      <MapClickPicker onSelect={onSelect} />
      {locations.map((location) => (
        <Circle
          key={location.id}
          center={[location.latitude, location.longitude]}
          radius={location.radius_meters}
          pathOptions={{ color: '#4e62df', fillColor: '#5368df', fillOpacity: 0.12 }}
        />
      ))}
      {center.every(Number.isFinite) && hasDraftRadius && (
        <Circle
          center={center}
          radius={draftRadius}
          pathOptions={{ color: '#e25b63', fillColor: '#e25b63', fillOpacity: 0.1, dashArray: '6 6' }}
        />
      )}
      {center.every(Number.isFinite) && (
        <CircleMarker center={center} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#e25b63', fillOpacity: 1 }} />
      )}
    </MapContainer>
  );
}

function formatAttendanceTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatCoordinate(value) {
  return value == null ? null : Number(value).toFixed(6);
}

function AuthScreen({ onAuthenticated, initialError }) {
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get('email'),
      password: form.get('password'),
    };
    if (registering) {
      payload.full_name = form.get('full_name');
      payload.company_name = form.get('company_name');
    }
    try {
      const user = await api(`/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onAuthenticated(user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">HR</div>
        <p className="eyebrow">MANAJEMEN HRD</p>
        <h1>{registering ? 'Daftarkan perusahaan' : 'Selamat datang kembali'}</h1>
        <p className="muted">
          {registering
            ? 'Buat ruang kerja perusahaan untuk mulai mengelola pekerja.'
            : 'Masuk untuk memantau siklus kerja dan dokumen pekerja.'}
        </p>
        <form className="form-stack" onSubmit={handleSubmit}>
          {registering && (
            <>
              <label>
                Nama lengkap
                <input className="uppercase-text" name="full_name" required minLength="2" maxLength="150" autoComplete="name" />
              </label>
              <label>
                Nama perusahaan
                <input className="uppercase-text" name="company_name" required minLength="2" maxLength="150" autoComplete="organization" />
              </label>
            </>
          )}
          <label>
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Kata sandi
            <input name="password" type="password" required minLength={registering ? 12 : 1} maxLength="72" autoComplete={registering ? 'new-password' : 'current-password'} />
            {registering && <small>12 karakter atau lebih; maksimal 72 byte UTF-8.</small>}
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          {initialError && <p className="notice error" role="alert">{initialError}</p>}
          <button className="button primary full-width" disabled={busy}>
            {busy ? 'Memproses…' : registering ? 'Buat akun perusahaan' : 'Masuk'}
          </button>
        </form>
        <button className="text-button" onClick={() => { setRegistering(!registering); setError(''); }}>
          {registering ? 'Sudah memiliki akun? Masuk' : 'Daftarkan perusahaan baru'}
        </button>
      </section>
    </main>
  );
}

function WorkerModal({ onClose, onSubmit, busy, error, departmentOptions, documentTypes, documentTypesLoading, initialWorker = null }) {
  const nameInputRef = useRef(null);

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameInputRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocusedElement instanceof HTMLElement) previouslyFocusedElement.focus();
    };
  }, []);

  function handleKeyDown(event) {
    if (event.key === 'Escape' && !busy) {
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusableElements = event.currentTarget.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="worker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worker-modal-title"
        onKeyDown={handleKeyDown}
      >
        <header className="modal-heading">
          <div>
            <p className="eyebrow">SETELAH OFFERING</p>
            <h2 id="worker-modal-title">{initialWorker ? 'Edit data pekerja' : 'Tambah pekerja'}</h2>
            <p className="muted">{initialWorker ? 'Perbarui data personal dan penempatan pekerja.' : 'Catat data awal pekerja dan dokumen wajib untuk posisinya.'}</p>
          </div>
          <button className="modal-close" type="button" aria-label="Tutup modal" onClick={onClose} disabled={busy}>
            ×
          </button>
        </header>
        <form className="worker-form" onSubmit={onSubmit}>
          <div className="modal-fields">
            <section className="worker-form-section" aria-labelledby="personal-section-title">
              <h3 className="form-section-title" id="personal-section-title">Informasi personal</h3>
              <div className="worker-data-grid">
                <label className="modal-field"><span>Nama lengkap <span className="required-mark">*</span></span><input className="modal-control uppercase-text" ref={nameInputRef} name="full_name" required maxLength="150" autoComplete="name" defaultValue={initialWorker?.full_name || ''} /></label>
                <label className="modal-field"><span>Email <span className="required-mark">*</span></span><input className="modal-control" name="email" type="email" required maxLength="254" autoComplete="email" defaultValue={initialWorker?.email || ''} /></label>
                <label className="modal-field"><span>WhatsApp / telepon <span className="required-mark">*</span></span><input className="modal-control" name="phone_number" type="tel" required maxLength="30" pattern="\+?[\d\s().-]{8,30}" autoComplete="tel" placeholder="+62 812 3456 7890" defaultValue={initialWorker?.phone_number || ''} /></label>
                <label className="modal-field">NIK KTP<input className="modal-control" name="national_id" inputMode="numeric" pattern="\d{16}" maxLength="16" placeholder="16 digit" defaultValue={initialWorker?.national_id || ''} /></label>
                <label className="modal-field field-span">Alamat domisili<textarea className="modal-control uppercase-text" name="address" maxLength="500" rows="3" autoComplete="street-address" defaultValue={initialWorker?.address || ''} /></label>
              </div>
            </section>

            <section className="worker-form-section" aria-labelledby="placement-section-title">
              <h3 className="form-section-title" id="placement-section-title">Penempatan</h3>
              <div className="worker-data-grid">
                <label className="modal-field">Departemen / Divisi
                  <input className="modal-control uppercase-text" name="department" list="department-options" required maxLength="150" autoComplete="organization-title" placeholder="Pilih atau ketik departemen" defaultValue={initialWorker?.department || ''} />
                  <datalist id="department-options">
                    {departmentOptions.map((department) => <option value={department} key={department} />)}
                  </datalist>
                </label>
                <label className="modal-field"><span>Posisi / job role <span className="required-mark">*</span></span><input className="modal-control uppercase-text" name="position" required maxLength="150" defaultValue={initialWorker?.position || ''} /></label>
                <label className="modal-field">Lokasi penempatan / area kerja<input className="modal-control uppercase-text" name="work_location" maxLength="150" placeholder="Contoh: Jakarta Selatan" defaultValue={initialWorker?.work_location || ''} /></label>
                <label className="modal-field">Jenis kontrak
                  <select className="modal-control" name="contract_type" defaultValue={initialWorker?.contract_type || 'pkwt'} required>
                    {CONTRACT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className="worker-form-section" aria-labelledby="contract-section-title">
              <h3 className="form-section-title" id="contract-section-title">Data kontrak</h3>
              <div className="worker-data-grid">
                <label className="modal-field field-span">Gaji / rate yang ditawarkan
                  <span className="currency-input"><span>Rp</span><input className="modal-control" name="salary_rate" type="number" min="0" max="9999999999999.99" step="0.01" inputMode="decimal" placeholder="0" defaultValue={initialWorker?.salary_rate || ''} /></span>
                  <small className="rate-hint">Rate dapat dikosongkan bila belum disepakati.</small>
                </label>
                <label className="modal-field">Tanggal offering<input className="modal-control" name="offer_date" type="date" defaultValue={initialWorker?.offer_date?.slice(0, 10) || ''} /></label>
                <label className="modal-field">Tanggal mulai bergabung<input className="modal-control" name="join_date" type="date" defaultValue={initialWorker?.join_date?.slice(0, 10) || ''} /></label>
              </div>
            </section>

            <section className="document-section">
              <div className="document-card-heading">
                <h3>Dokumen wajib & compliance</h3>
                <p>Pilih dokumen sesuai kebutuhan posisi.</p>
              </div>
              <fieldset>
                <legend className="visually-hidden">Dokumen wajib untuk posisi ini</legend>
                {documentTypesLoading && <small>Memuat jenis dokumen…</small>}
                {!documentTypesLoading && !documentTypes.some((type) => type.is_active) && <small>Belum ada jenis dokumen aktif. Admin dapat menambahkannya melalui Pengaturan Dokumen. Pekerja dapat dibuat tanpa persyaratan dokumen.</small>}
                {documentTypes.filter((type) => type.is_active || initialWorker?.required_document_types?.includes(type.code)).map((type) => (
                  <label className="check-row" key={type.code}>
                    <input type="checkbox" name="required_document_types" value={type.code} defaultChecked={initialWorker?.required_document_types?.includes(type.code) || false} />
                    <span className="uppercase-text">{type.name}{type.is_active ? '' : ' (Nonaktif)'}</span>
                  </label>
                ))}
                {!documentTypesLoading && documentTypes.some((type) => type.is_active) && <small>Pilih hanya jenis dokumen yang menjadi persyaratan posisi ini. Tidak ada pilihan bawaan.</small>}
              </fieldset>
            </section>
          </div>
          {error && <p className="notice error modal-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Batal</button>
            <button className="button primary" type="submit" disabled={busy || documentTypesLoading}>
              {busy ? 'Menyimpan…' : initialWorker ? 'Simpan perubahan' : 'Tambah ke daftar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DocumentWarningThresholdEditor({ type, defaultDays, busy, onSave }) {
  const [days, setDays] = useState(type.warning_threshold_days == null ? '' : String(type.warning_threshold_days));

  useEffect(() => {
    setDays(type.warning_threshold_days == null ? '' : String(type.warning_threshold_days));
  }, [type.warning_threshold_days]);

  async function save(event) {
    event.preventDefault();
    await onSave(days === '' ? null : Number(days));
  }

  async function reset() {
    const saved = await onSave(null);
    if (saved) setDays('');
  }

  return (
    <form className="document-threshold-editor" onSubmit={save}>
      <label className="visually-hidden" htmlFor={`threshold-${type.code}`}>Ambang peringatan {type.name} dalam hari</label>
      <input
        id={`threshold-${type.code}`}
        type="number"
        min="1"
        max="365"
        step="1"
        value={days}
        placeholder={`${defaultDays} default`}
        onChange={(event) => setDays(event.target.value)}
        aria-label={`Ambang peringatan ${type.name} dalam hari; kosong berarti default perusahaan`}
      />
      <span>{days === '' ? `Default · ${defaultDays} hari` : 'hari'}</span>
      <button className="button secondary small-action" type="submit" disabled={busy || (days !== '' && (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365))}>Simpan</button>
      {type.warning_threshold_days != null && <button className="button secondary small-action" type="button" disabled={busy} onClick={reset}>Reset</button>}
    </form>
  );
}

function SettingsPanel({
  active,
  user,
  users,
  documentTypes,
  usersLoading,
  onCreateDocumentType,
  onUpdateDocumentType,
  documentSettings,
  onSaveDocumentSettings,
  busy,
  onSaveProfile,
  onUploadProfilePhoto,
  onChangePassword,
  onCreateUser,
  onUpdateUser,
  onResetPassword,
  attendanceSettings,
  attendanceLocations,
  onRotateAttendanceSalt,
  onCreateAttendanceLocation,
  onDeleteAttendanceLocation,
  error,
  theme,
  onChangeTheme,
}) {
  const [section, setSection] = useState('profile');
  const [attendanceSaltConfirmStep, setAttendanceSaltConfirmStep] = useState(0);
  const [attendanceSaltConfirmation, setAttendanceSaltConfirmation] = useState('');
  const attendanceSaltConfirmationRef = useRef(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetUserId, setResetUserId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newDocumentTypeName, setNewDocumentTypeName] = useState('');
  const [editingDocumentType, setEditingDocumentType] = useState(null);
  const [editedDocumentTypeName, setEditedDocumentTypeName] = useState('');
  const [warningThresholdDays, setWarningThresholdDays] = useState(String(documentSettings.warning_threshold_days));
  const profilePhotoInputRef = useRef(null);
  const [attendanceLocationDraft, setAttendanceLocationDraft] = useState({
    name: '',
    latitude: '-6.2088',
    longitude: '106.8456',
    radius_meters: '150',
    allowed_activities: ['check_in', 'check_out'],
  });

  useEffect(() => {
    if (attendanceSaltConfirmStep === 2) attendanceSaltConfirmationRef.current?.focus();
  }, [attendanceSaltConfirmStep]);

  useEffect(() => {
    setWarningThresholdDays(String(documentSettings.warning_threshold_days));
  }, [documentSettings.warning_threshold_days]);

  function handleCreateUser(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    onCreateUser({
      full_name: form.get('full_name'),
      email: form.get('email'),
      password: form.get('password'),
      role: form.get('role'),
    }).then((saved) => {
      if (!saved) return;
      formElement.reset();
      setNewPassword('');
      setShowNewPassword(false);
    });
  }

  function closeAttendanceSaltConfirmation() {
    if (busy) return;
    setAttendanceSaltConfirmStep(0);
    setAttendanceSaltConfirmation('');
  }

  async function confirmAttendanceSaltChange() {
    if (attendanceSettings.salt_configured && attendanceSaltConfirmStep === 1) {
      setAttendanceSaltConfirmStep(2);
      return;
    }
    if (attendanceSettings.salt_configured && attendanceSaltConfirmation !== 'ROTASI SALT') return;
    const saved = await onRotateAttendanceSalt();
    if (saved) {
      setAttendanceSaltConfirmStep(0);
      setAttendanceSaltConfirmation('');
    }
  }

  return (
    <section className="settings-page" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden={!active}>
      <div className="settings-intro">
        <p className="eyebrow">AKUN & AKSES</p>
        <h2>Pengaturan</h2>
        <p className="muted">Kelola informasi akun dan keamanan ruang kerja <span className="uppercase-text">{user.company_name}</span>.</p>
      </div>
      <nav className="settings-tabs" aria-label="Bagian pengaturan">
        <button type="button" className={`settings-tab ${section === 'profile' ? 'active' : ''}`} aria-pressed={section === 'profile'} onClick={() => setSection('profile')}>Profil Saya</button>
        <button type="button" className={`settings-tab ${section === 'security' ? 'active' : ''}`} aria-pressed={section === 'security'} onClick={() => setSection('security')}>Keamanan</button>
        {user.role === 'admin' && <button type="button" className={`settings-tab ${section === 'users' ? 'active' : ''}`} aria-pressed={section === 'users'} onClick={() => setSection('users')}>Manajemen User</button>}
        {user.role === 'admin' && <button type="button" className={`settings-tab ${section === 'documents' ? 'active' : ''}`} aria-pressed={section === 'documents'} onClick={() => setSection('documents')}>Pengaturan Dokumen</button>}
        {user.role === 'admin' && <button type="button" className={`settings-tab ${section === 'attendance' ? 'active' : ''}`} aria-pressed={section === 'attendance'} onClick={() => setSection('attendance')}>Pengaturan Presensi</button>}
      </nav>

      {section === 'profile' && (
        <>
        <section className="panel settings-card" aria-label="Profil Saya">
          <div className="panel-heading">
            <div><p className="eyebrow">PROFIL SAYA</p><h2>Informasi akun</h2></div>
          </div>
          <div className="profile-summary">
            <button
              className="profile-photo-button"
              type="button"
              onClick={() => profilePhotoInputRef.current?.click()}
              disabled={busy}
              aria-label="Unggah atau ganti foto profil"
            >
              {user.profile_photo_url
                ? <img className="profile-photo" src={user.profile_photo_url} alt="" />
                : <span className="profile-photo profile-placeholder">{user.full_name?.slice(0, 1).toUpperCase() || '?'}</span>}
              <span className="profile-photo-edit" aria-hidden="true">Ubah</span>
            </button>
            <input
              ref={profilePhotoInputRef}
              className="profile-photo-input"
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              aria-label="Pilih foto profil JPG atau PNG"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) onUploadProfilePhoto(file);
              }}
            />
            <span><strong className="uppercase-text">{user.full_name}</strong><small>{user.email} · {USER_ROLE_LABELS[user.role] || user.role}</small></span>
            <small className="profile-photo-hint">JPG/PNG · ukuran dioptimalkan otomatis</small>
          </div>
          <form className="settings-form" key={`${user.full_name}-${user.profile_photo_url || ''}`} onSubmit={onSaveProfile}>
            <label>Nama lengkap<input className="uppercase-text" name="full_name" required maxLength="150" defaultValue={user.full_name} /></label>
            <label>Email<input value={user.email} readOnly /></label>
            <label>Role / jabatan<input value={USER_ROLE_LABELS[user.role] || user.role} readOnly /></label>
            <div className="settings-actions settings-span"><button className="button primary" disabled={busy}>Simpan profil</button></div>
          </form>
        </section>
        <section className="panel settings-card theme-settings" aria-label="Tema tampilan">
          <div className="panel-heading">
            <div><p className="eyebrow">PREFERENSI TAMPILAN</p><h2>Tema aplikasi</h2></div>
          </div>
          <p className="muted">Pilihan tema disimpan di peramban ini dan langsung diterapkan.</p>
          <div className="theme-options" role="radiogroup" aria-label="Pilih tema aplikasi">
            {APP_THEMES.map((option) => (
              <label className={`theme-option ${theme === option.id ? 'selected' : ''}`} key={option.id}>
                <input type="radio" name="app-theme" value={option.id} checked={theme === option.id} onChange={() => onChangeTheme(option.id)} />
                <span className={`theme-preview ${option.id}`} aria-hidden="true"><i /><i /><i /></span>
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </label>
            ))}
          </div>
        </section>
        </>
      )}

      {section === 'security' && (
        <section className="panel settings-card security-card" aria-label="Keamanan akun">
          <div className="panel-heading">
            <div><p className="eyebrow">KEAMANAN</p><h2>Ubah password</h2></div>
          </div>
          <p className="muted">Masukkan password saat ini untuk mengonfirmasi perubahan. Sesi di perangkat lain akan dicabut.</p>
          <form className="settings-form security-form" onSubmit={onChangePassword}>
            <label>Password lama<input name="current_password" type="password" required autoComplete="current-password" /></label>
            <label>Password baru<input name="new_password" type="password" required minLength="12" maxLength="72" autoComplete="new-password" /><small>Minimal 12 karakter dan maksimal 72 byte UTF-8.</small></label>
            <label>Konfirmasi password baru<input name="confirm_password" type="password" required minLength="12" maxLength="72" autoComplete="new-password" /></label>
            <div className="settings-actions"><button className="button primary" disabled={busy}>Perbarui password</button></div>
          </form>
        </section>
      )}

      {section === 'attendance' && user.role === 'admin' && (
        <>
          <section className="panel settings-card attendance-settings-card" aria-label="Pengaturan presensi perusahaan">
            <div className="panel-heading">
              <div><p className="eyebrow">KUNCI TAUTAN PRESENSI</p><h2>Salt rahasia perusahaan</h2></div>
              <span className={`user-state ${attendanceSettings.salt_configured ? 'active' : 'inactive'}`}>
                {attendanceSettings.salt_configured ? 'Sudah diatur' : 'Belum diatur'}
              </span>
            </div>
            <p className="muted">Salt dibuat secara acak dan disimpan hanya di backend. Nilainya tidak ditampilkan atau dikirim ke browser. Link presensi statis dibuat dari ID pekerja, salt ini, dan kunci aplikasi.</p>
            {attendanceSettings.updated_at && <p className="settings-footnote">Terakhir dirotasi: {new Date(attendanceSettings.updated_at).toLocaleString('id-ID')}</p>}
            <div className="attendance-salt-warning">
              Rotasi salt akan langsung membatalkan semua link presensi yang sudah dibagikan. Setelah rotasi, buat dan bagikan ulang tautan pekerja.
            </div>
            <button
              className={`button ${attendanceSettings.salt_configured ? 'danger' : 'primary'}`}
              type="button"
              disabled={busy}
              onClick={() => {
                setAttendanceSaltConfirmation('');
                setAttendanceSaltConfirmStep(1);
              }}
            >
              {attendanceSettings.salt_configured ? 'Rotasi salt perusahaan' : 'Generate salt perusahaan'}
            </button>
          </section>

          <section className="panel settings-card attendance-location-settings" aria-label="Lokasi dan aturan geofence">
            <div className="panel-heading">
              <div><p className="eyebrow">AREA KERJA</p><h2>Lokasi & aturan geofence</h2></div>
              <span className="count-pill">{attendanceLocations.length} lokasi</span>
            </div>
            <p className="muted">Klik peta untuk memilih koordinat. Aktivitas yang dicentang wajib dilakukan di dalam radius area ini. Aktivitas yang tidak dicentang dapat dilakukan dari luar area.</p>
            <div className="attendance-location-grid">
              <AttendanceLocationsMap
                locations={attendanceLocations}
                draft={attendanceLocationDraft}
                onSelect={({ lat, lng }) => setAttendanceLocationDraft((current) => ({
                  ...current,
                  latitude: lat.toFixed(7),
                  longitude: lng.toFixed(7),
                }))}
              />
              <form
                className="attendance-location-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const formElement = event.currentTarget;
                  const form = new FormData(formElement);
                  const saved = await onCreateAttendanceLocation({
                    name: form.get('name'),
                    latitude: Number(form.get('latitude')),
                    longitude: Number(form.get('longitude')),
                    radius_meters: Number(form.get('radius_meters')),
                    allowed_activities: attendanceLocationDraft.allowed_activities,
                  });
                  if (saved) {
                    setAttendanceLocationDraft((current) => ({ ...current, name: '' }));
                    formElement.reset();
                  }
                }}
              >
                <label>Nama lokasi<input name="name" required maxLength="100" value={attendanceLocationDraft.name} onChange={(event) => setAttendanceLocationDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Kantor pusat" /></label>
                <div className="attendance-coordinate-fields">
                  <label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required value={attendanceLocationDraft.latitude} onChange={(event) => setAttendanceLocationDraft((current) => ({ ...current, latitude: event.target.value }))} /></label>
                  <label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required value={attendanceLocationDraft.longitude} onChange={(event) => setAttendanceLocationDraft((current) => ({ ...current, longitude: event.target.value }))} /></label>
                </div>
                <label>Radius toleransi (meter)<input name="radius_meters" type="number" min="25" max="5000" required value={attendanceLocationDraft.radius_meters} onChange={(event) => setAttendanceLocationDraft((current) => ({ ...current, radius_meters: event.target.value }))} /></label>
                <fieldset className="attendance-activity-options">
                  <legend>Aktivitas yang diwajibkan di area ini</legend>
                  {ATTENDANCE_ACTIVITY_OPTIONS.map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        checked={attendanceLocationDraft.allowed_activities.includes(value)}
                        onChange={(event) => setAttendanceLocationDraft((current) => ({
                          ...current,
                          allowed_activities: event.target.checked
                            ? [...current.allowed_activities, value]
                            : current.allowed_activities.filter((activity) => activity !== value),
                        }))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
                <button className="button primary" type="submit" disabled={busy}>Simpan lokasi</button>
              </form>
            </div>
            <div className="attendance-location-list">
              {attendanceLocations.map((location) => (
                <article className="attendance-location-item" key={location.id}>
                  <span className="attendance-location-marker" aria-hidden="true" />
                  <div>
                    <strong className="uppercase-text">{location.name}</strong>
                    <small>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)} · radius {location.radius_meters} m</small>
                    <small>{location.allowed_activities.length
                      ? `Wajib di area ini: ${location.allowed_activities.map((activity) => ATTENDANCE_ACTIVITY_OPTIONS.find(([key]) => key === activity)?.[1] || activity).join(' · ')}`
                      : 'Tidak ada aktivitas yang wajib berada di area ini; aktivitas dapat dilakukan dari luar area.'}</small>
                  </div>
                  <button className="button danger" type="button" disabled={busy} onClick={() => onDeleteAttendanceLocation(location.id)}>Hapus</button>
                </article>
              ))}
              {!attendanceLocations.length && <p className="attendance-empty-locations">Belum ada lokasi geofence. Tambahkan titik pertama dengan klik peta atau koordinat.</p>}
            </div>
            <p className="settings-footnote">Dinas tidak dibatasi geofence. Foto bukti wajib saat Check-In dan pengajuan menunggu persetujuan HR. Koordinat GPS browser bukan bukti anti-spoofing.</p>
          </section>
        </>
      )}
      {attendanceSaltConfirmStep > 0 && (
        <div
          className="modal-backdrop confirmation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAttendanceSaltConfirmation();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeAttendanceSaltConfirmation();
          }}
        >
          <section
            className="confirmation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-salt-confirm-title"
            aria-describedby="attendance-salt-confirm-description"
          >
            <div className="confirmation-modal-heading">
              <span className="confirmation-warning-icon" aria-hidden="true">!</span>
              <div>
                <p className="eyebrow">{attendanceSaltConfirmStep === 2 ? 'KONFIRMASI KEDUA' : 'KONFIRMASI PENGATURAN'}</p>
                <h2 id="attendance-salt-confirm-title">
                  {attendanceSaltConfirmStep === 2 ? 'Pastikan rotasi salt' : attendanceSettings.salt_configured ? 'Rotasi salt perusahaan?' : 'Generate salt perusahaan?'}
                </h2>
              </div>
            </div>
            <p className="confirmation-modal-description" id="attendance-salt-confirm-description">
              {attendanceSaltConfirmStep === 2
                ? 'Rotasi membatalkan semua link presensi yang sudah dibagikan. Untuk melanjutkan, ketik ROTASI SALT persis seperti tertulis.'
                : attendanceSettings.salt_configured
                  ? 'Tindakan ini langsung membatalkan seluruh tautan presensi pekerja. Anda perlu membuat dan membagikan link baru setelahnya.'
                  : 'Salt rahasia akan dibuat untuk perusahaan dan digunakan saat menerbitkan link presensi statis.'}
            </p>
            {attendanceSaltConfirmStep === 2 && (
              <label className="confirmation-input-label" htmlFor="attendance-salt-confirmation">
                Ketik <strong>ROTASI SALT</strong> untuk mengonfirmasi
                <input
                  id="attendance-salt-confirmation"
                  ref={attendanceSaltConfirmationRef}
                  autoComplete="off"
                  value={attendanceSaltConfirmation}
                  onChange={(event) => setAttendanceSaltConfirmation(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && attendanceSaltConfirmation === 'ROTASI SALT') {
                      event.preventDefault();
                      confirmAttendanceSaltChange();
                    }
                  }}
                />
              </label>
            )}
            {error && <p className="confirmation-modal-error" role="alert">{error}</p>}
            <div className="confirmation-modal-actions">
              <button className="button secondary" type="button" disabled={busy} onClick={closeAttendanceSaltConfirmation}>Batal</button>
              <button
                className={`button ${attendanceSettings.salt_configured ? 'danger' : 'primary'}`}
                type="button"
                disabled={busy || (attendanceSaltConfirmStep === 2 && attendanceSaltConfirmation !== 'ROTASI SALT')}
                onClick={confirmAttendanceSaltChange}
              >
                {busy
                  ? 'Memproses...'
                  : attendanceSaltConfirmStep === 2
                    ? 'Konfirmasi rotasi'
                    : attendanceSettings.salt_configured ? 'Lanjutkan' : 'Generate salt'}
              </button>
            </div>
          </section>
        </div>
      )}

      {section === 'users' && user.role === 'admin' && (
        <div className="user-management" aria-label="Manajemen User">
          <section className="panel settings-card">
            <div className="panel-heading">
              <div><p className="eyebrow">AKSES RUANG KERJA</p><h2>Tambah akun user</h2></div>
            </div>
            <p className="muted">Akun baru hanya dapat mengakses perusahaan ini. Email harus unik di seluruh sistem.</p>
            <form className="settings-form user-create-form" onSubmit={handleCreateUser}>
              <label>Nama lengkap<input className="uppercase-text" name="full_name" required maxLength="150" autoComplete="name" /></label>
              <label>Email<input name="email" type="email" required maxLength="254" autoComplete="email" /></label>
              <label>Password awal
                <span className="password-generate">
                  <input name="password" type={showNewPassword ? 'text' : 'password'} required minLength="12" maxLength="72" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                  <button className="button secondary" type="button" onClick={() => setShowNewPassword((shown) => !shown)} aria-pressed={showNewPassword}>{showNewPassword ? 'Sembunyikan' : 'Tampilkan'}</button>
                  <button className="button secondary" type="button" onClick={() => setNewPassword(generateTemporaryPassword())}>Generate</button>
                </span>
                <small>Sampaikan password awal dengan aman kepada user.</small>
              </label>
              <label>Role / hak akses<select name="role" defaultValue="hr_manager"><option value="admin">Admin</option><option value="hr_manager">HR Staff</option><option value="viewer">Viewer</option></select></label>
              <div className="settings-actions settings-span"><button className="button primary" disabled={busy}>Buat akun</button></div>
            </form>
          </section>

          <section className="panel settings-card">
            <div className="panel-heading">
              <div><p className="eyebrow">USER PERUSAHAAN</p><h2>Daftar akun</h2></div>
              <span className="count-pill">{users.length} akun</span>
            </div>
            {usersLoading ? <p className="muted">Memuat daftar user…</p> : (
              <div className="table-wrap user-table-wrap">
                <table className="user-table">
                  <thead><tr><th>Nama / email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {users.map((account) => (
                      <tr key={account.id}>
                        <td><strong className="uppercase-text">{account.full_name}</strong><small>{account.email}{account.id === user.id ? ' · Anda' : ''}</small></td>
                        <td>
                          <select aria-label={`Role ${account.full_name}`} value={account.role} disabled={busy || account.id === user.id} onChange={(event) => onUpdateUser(account.id, { role: event.target.value })}>
                            <option value="admin">Admin</option><option value="hr_manager">HR Staff</option><option value="viewer">Viewer</option>
                          </select>
                        </td>
                        <td><span className={`user-state ${account.is_active ? 'active' : 'inactive'}`}>{account.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                        <td>
                          <div className="user-actions">
                            <button type="button" className="button secondary small-action" disabled={busy || account.id === user.id} onClick={() => { setResetUserId(resetUserId === account.id ? null : account.id); setResetPassword(''); setShowResetPassword(false); }}>
                              Reset password
                            </button>
                            <button type="button" className="button secondary small-action" disabled={busy || account.id === user.id} onClick={() => onUpdateUser(account.id, { is_active: !account.is_active })}>
                              {account.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                          </div>
                          {resetUserId === account.id && (
                            <form className="reset-password-form" onSubmit={(event) => {
                              event.preventDefault();
                              onResetPassword(account.id, resetPassword).then((saved) => {
                                if (!saved) return;
                                setResetUserId(null);
                                setResetPassword('');
                                setShowResetPassword(false);
                              });
                            }}>
                              <input aria-label="Password baru user" type={showResetPassword ? 'text' : 'password'} required minLength="12" maxLength="72" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Password baru" />
                              <button className="button secondary small-action" type="button" onClick={() => setShowResetPassword((shown) => !shown)} aria-pressed={showResetPassword}>{showResetPassword ? 'Sembunyikan' : 'Tampilkan'}</button>
                              <button className="button secondary small-action" type="button" onClick={() => setResetPassword(generateTemporaryPassword())}>Generate</button>
                              <button className="button primary small-action" disabled={busy}>Simpan</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!users.length && <tr><td colSpan="4" className="empty-cell">Belum ada akun user.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <p className="settings-footnote">Database perusahaan mengikuti tenant login saat ini; user tidak dapat berpindah atau mengakses tenant lain dari halaman ini.</p>
          </section>
        </div>
      )}

      {section === 'documents' && user.role === 'admin' && (
        <div className="document-type-management">
          <section className="panel settings-card document-monitoring-settings" aria-label="Pengaturan waktu pemantauan dokumen">
            <div className="panel-heading">
              <div><p className="eyebrow">MASA BERLAKU DOKUMEN</p><h2>Default waktu peringatan</h2></div>
              <span className="count-pill">{documentSettings.warning_threshold_days} hari</span>
            </div>
            <p className="muted">Nilai ini digunakan oleh semua jenis dokumen kecuali jenis yang memiliki aturan khusus. Dokumen kedaluwarsa tetap muncul untuk ditindaklanjuti.</p>
            <form className="document-monitoring-form" onSubmit={(event) => {
              event.preventDefault();
              onSaveDocumentSettings(Number(warningThresholdDays));
            }}>
              <label htmlFor="document-warning-threshold">Peringatan default (hari sebelum kedaluwarsa)</label>
              <div className="document-monitoring-input">
                <input id="document-warning-threshold" type="number" min="1" max="365" step="1" required value={warningThresholdDays} onChange={(event) => setWarningThresholdDays(event.target.value)} />
                <span>hari</span>
              </div>
              <small>Masukkan bilangan bulat 1–365. Jenis dokumen dapat memakai nilai berbeda atau mengikuti default ini.</small>
              {documentSettings.updated_at && <small>Terakhir diperbarui: {new Date(documentSettings.updated_at).toLocaleString('id-ID')}</small>}
              <div className="settings-actions"><button className="button primary" type="submit" disabled={busy || !/^\d+$/.test(warningThresholdDays) || Number(warningThresholdDays) < 1 || Number(warningThresholdDays) > 365}>Simpan default</button></div>
            </form>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading">
              <div><p className="eyebrow">KATALOG PERSYARATAN</p><h2>Tambah jenis dokumen</h2></div>
            </div>
            <p className="muted">Jenis dokumen berlaku untuk perusahaan ini. Jenis nonaktif tidak muncul pada pekerja baru, tetapi tetap dapat dilengkapi untuk pekerja yang sudah memiliki persyaratan tersebut.</p>
            <form className="document-type-create" onSubmit={(event) => {
              event.preventDefault();
              onCreateDocumentType(newDocumentTypeName).then((saved) => {
                if (saved) setNewDocumentTypeName('');
              });
            }}>
              <label htmlFor="new-document-type">Nama dokumen</label>
              <input className="uppercase-text" id="new-document-type" value={newDocumentTypeName} onChange={(event) => setNewDocumentTypeName(event.target.value)} required maxLength="100" placeholder="Contoh: Sertifikat K3" />
              <button className="button primary" disabled={busy}>Tambah Dokumen</button>
            </form>
          </section>

          <section className="panel settings-card">
            <div className="panel-heading">
              <div><p className="eyebrow">JENIS DOKUMEN</p><h2>Dokumen persyaratan</h2></div>
              <span className="count-pill">{documentTypes.filter((type) => type.is_active).length} aktif</span>
            </div>
            <div className="table-wrap user-table-wrap">
              <table className="document-type-table">
                <thead><tr><th>Nama dokumen</th><th>Kode sistem</th><th>Peringatan</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                  {documentTypes.map((type) => (
                    <tr key={type.code}>
                      <td>
                        {editingDocumentType === type.code ? (
                          <form className="document-type-edit" onSubmit={(event) => {
                            event.preventDefault();
                            onUpdateDocumentType(type.code, { name: editedDocumentTypeName }).then((saved) => {
                              if (saved) setEditingDocumentType(null);
                            });
                          }}>
                            <input className="uppercase-text" aria-label={`Nama jenis dokumen ${type.name}`} value={editedDocumentTypeName} onChange={(event) => setEditedDocumentTypeName(event.target.value)} required maxLength="100" />
                            <button className="button primary small-action" disabled={busy}>Simpan</button>
                            <button className="button secondary small-action" type="button" disabled={busy} onClick={() => setEditingDocumentType(null)}>Batal</button>
                          </form>
                        ) : <strong className="uppercase-text">{type.name}{type.is_builtin ? <small> Dokumen bawaan</small> : null}</strong>}
                      </td>
                      <td><code>{type.code}</code></td>
                      <td><DocumentWarningThresholdEditor type={type} defaultDays={documentSettings.warning_threshold_days} busy={busy} onSave={(days) => onUpdateDocumentType(type.code, { warning_threshold_days: days })} /></td>
                      <td><span className={`user-state ${type.is_active ? 'active' : 'inactive'}`}>{type.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                      <td>
                        <div className="user-actions">
                          {editingDocumentType !== type.code && <button className="button secondary small-action" type="button" disabled={busy} onClick={() => { setEditingDocumentType(type.code); setEditedDocumentTypeName(type.name); }}>Edit nama</button>}
                          <button className="button secondary small-action" type="button" disabled={busy} onClick={() => onUpdateDocumentType(type.code, { is_active: !type.is_active })}>{type.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!documentTypes.length && <tr><td colSpan="5" className="empty-cell">Belum ada jenis dokumen terdaftar.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="settings-footnote">Ambang per jenis harus berupa bilangan bulat 1–365 hari. Kosongkan dan pilih reset untuk mengikuti default perusahaan. Dokumen nonaktif tidak tersedia pada formulir pekerja baru, tetapi catatan historis tetap tersimpan.</p>
          </section>
        </div>
      )}
    </section>
  );
}

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
  const [attendanceSettings, setAttendanceSettings] = useState({ salt_configured: false, updated_at: null });
  const [attendanceLocations, setAttendanceLocations] = useState([]);
  const [documentSettings, setDocumentSettings] = useState({ warning_threshold_days: 30, updated_at: null });
  const [summary, setSummary] = useState(null);
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
    refreshDepartments().catch(showError);
    refreshDocumentTypes()
      .catch(showError)
      .finally(() => setDocumentTypesLoading(false));
  }, [user]);

  useEffect(() => {
    window.localStorage.setItem('hrd-app-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!user || activeTab !== 'overview') return undefined;
    const refreshMetrics = () => refreshDashboard().catch(showError);
    const intervalId = window.setInterval(refreshMetrics, 15000);
    return () => window.clearInterval(intervalId);
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
      showError(requestError);
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
    const navigationTabs = NAVIGATION_TABS;
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
    await Promise.all([refreshDashboard(), refreshWorkers(), refreshDepartments()]);
  }

  function openWorkerModal() {
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
          <a className="brand" href="#top" aria-label="Ruang Kerja HRD">
            <span className="brand-mark">HR</span>
            <span className="brand-copy"><strong>Ruang Kerja</strong><small>HRD Management</small></span>
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
          {NAVIGATION_TABS.map((tab) => (
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
            {user.role !== 'viewer' && (
              <button className="button primary add-worker-button" type="button" onClick={openWorkerModal}>
                <span aria-hidden="true">+</span> Tambah Pekerja
              </button>
            )}
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
        </section>

        <section
          className="workspace-grid worker-workspace"
          id="panel-workers"
          role="tabpanel"
          aria-labelledby="tab-workers"
          hidden={activeTab !== 'workers'}
        >
          <div className="panel worker-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">DAFTAR PEKERJA</p><h2>Data pekerja</h2></div>
              <span className="count-pill">{workers.length} pekerja</span>
            </div>
            <div className="worker-list-tools">
              <label className="worker-search-field">
                <span className="visually-hidden">Cari pekerja</span>
                <input
                  type="search"
                  value={workerSearch}
                  onChange={(event) => setWorkerSearch(event.target.value)}
                  placeholder="Cari nama, NIK, posisi, departemen..."
                  aria-label="Cari pekerja"
                />
              </label>
              {user.role === 'admin' && (
                <div className="worker-import-tools">
                  <input
                    ref={workerImportInputRef}
                    className="visually-hidden"
                    type="file"
                    accept=".xlsx"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) handleImportWorkers(file);
                    }}
                  />
                  <button className="button secondary" type="button" disabled={busy} onClick={() => createWorkerWorkbook([]).catch(showError)}>Unduh template Excel</button>
                  <button className="button secondary" type="button" disabled={busy} onClick={() => workerImportInputRef.current?.click()}>
                    {busy ? 'Memproses…' : 'Impor Excel'}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy || !workers.length}
                    onClick={() => createWorkerWorkbook(workers.map((worker) => ({
                      full_name: worker.full_name,
                      email: worker.email,
                      phone_number: worker.phone_number,
                      national_id: worker.national_id,
                      address: worker.address,
                      department: worker.department,
                      position: worker.position,
                      work_location: worker.work_location,
                      contract_type: worker.contract_type,
                      offer_date: worker.offer_date?.slice(0, 10) || '',
                      join_date: worker.join_date?.slice(0, 10) || '',
                      salary_rate: worker.salary_rate,
                      required_document_types: (worker.required_document_types || []).join(','),
                    }))).catch(showError)}
                  >
                    Ekspor Excel
                  </button>
                </div>
              )}
            </div>
            {user.role === 'admin' && <p className="settings-footnote">File impor dibaca hanya di browser. Impor mendukung maksimal 500 baris; nama/NIK duplikat dilewati. Isi dokumen wajib sebagai kode dipisahkan koma.</p>}
            {workerImportResult && (
              <div className="worker-import-report" role="status">
                <strong>Hasil impor:</strong> {workerImportResult.created.length} ditambahkan · {workerImportResult.skipped.length} dilewati · {workerImportResult.errors.length} baris bermasalah.
                {(workerImportResult.skipped.length > 0 || workerImportResult.errors.length > 0) && (
                  <details>
                    <summary>Lihat detail baris</summary>
                    <ul>
                      {workerImportResult.skipped.map((item) => <li key={`skip-${item.row}`}>Baris {item.row}: {item.reason}</li>)}
                      {workerImportResult.errors.map((item) => <li key={`error-${item.row}`}>Baris {item.row}: {item.error}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
            <div className="filter-row" aria-label="Filter status pekerja">
              {[
                ['all', 'Semua'],
                ['offered', 'Offering'],
                ['preactive', 'Pra-aktif'],
                ['active', 'Aktif'],
                ['inactive', 'Nonaktif'],
              ].map(([value, label]) => (
                <button key={value} className={`filter-chip ${filter === value ? 'selected' : ''}`} onClick={() => setFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nama pekerja</th><th>Posisi</th><th>Status</th><th>Kelayakan</th>{user.role === 'admin' && <th>Aksi</th>}</tr></thead>
                <tbody>
                  {visibleWorkers.map((worker) => (
                    <tr key={worker.id} className={selectedId === worker.id ? 'selected-row' : ''}>
                      <td><button className="worker-link uppercase-text" onClick={() => setSelectedId(worker.id)}>{worker.full_name}<small className="normal-case">{worker.email || 'Email belum dicatat'}</small></button></td>
                      <td className="uppercase-text">{worker.position}</td>
                      <td><StatusBadge status={worker.status} />{worker.scheduled_inactive_date && <small className="scheduled-inactive-note">Nonaktif mulai {worker.scheduled_inactive_date.slice(0, 10)}</small>}</td>
                      <td><span className={`readiness ${worker.eligibility?.eligible ? 'ready' : 'needs-work'}`}>{worker.eligibility?.eligible ? 'Memenuhi syarat' : 'Perlu dokumen'}</span></td>
                      {user.role === 'admin' && (
                        <td>
                          <div className="user-actions">
                            <button className="button secondary small-action" type="button" disabled={busy} onClick={() => openEditWorker(worker)}>Edit</button>
                            <button className="button danger small-action" type="button" disabled={busy} onClick={() => archiveWorker(worker.id)}>Delete</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!visibleWorkers.length && (
                    <tr><td colSpan={user.role === 'admin' ? 5 : 4} className="empty-cell">
                      {workers.length ? 'Tidak ada pekerja yang cocok dengan filter pencarian.' : 'Belum ada data pekerja. Gunakan tombol Tambah Pekerja untuk memulai.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </section>

        <section
          className="panel attendance-panel"
          id="panel-attendance"
          role="tabpanel"
          aria-labelledby="tab-attendance"
          hidden={activeTab !== 'attendance'}
        >
          <div className="panel-heading attendance-month-heading">
            <div><p className="eyebrow">RINGKASAN & REKAP</p><h2>Presensi bulanan</h2></div>
            <label className="attendance-date-field">Bulan
              <input
                type="month"
                value={attendanceMonth}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setAttendanceMonth(event.target.value);
                  setAttendancePage(1);
                  setAttendanceDate(`${event.target.value}-01`);
                }}
              />
            </label>
          </div>
          <div className="attendance-metric-grid">
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon active-workers">P</span>
              <div><small>Pegawai aktif</small><strong>{monthlyAttendanceLoading ? '—' : monthlyWorkerRows.length}</strong><span>Terdaftar pada perusahaan</span></div>
            </article>
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon checkin-workers">H</span>
              <div><small>Tercatat masuk</small><strong>{monthlyAttendanceLoading ? '—' : monthlyCheckedIns}</strong><span>{attendanceMonthLabel(attendanceMonth)}</span></div>
            </article>
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon total-logs">Σ</span>
              <div><small>Total log presensi</small><strong>{monthlyAttendanceLoading ? '—' : totalMonthlyLogs}</strong><span>{attendanceMonthLabel(attendanceMonth)}</span></div>
            </article>
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon pending-claims">!</span>
              <div><small>Klaim pending</small><strong>{monthlyAttendanceLoading ? '—' : pendingAttendanceApprovals.length}</strong><span>Menunggu tinjauan HR</span></div>
            </article>
          </div>

          <section className="attendance-approval-center" aria-labelledby="attendance-approval-heading">
            <div className="attendance-subsection-heading">
              <div><p className="eyebrow">TINJAUAN HR</p><h3 id="attendance-approval-heading">Pusat Persetujuan</h3></div>
              <span className={`count-pill ${pendingAttendanceApprovals.length ? 'pending-count' : ''}`}>
                {monthlyAttendanceLoading ? 'Memuat…' : `${pendingAttendanceApprovals.length} pending`}
              </span>
            </div>
            {monthlyAttendanceLoading ? <p className="muted">Memuat klaim presensi…</p> : pendingAttendanceApprovals.length ? (
              <div className="attendance-approval-list">
                {pendingAttendanceApprovals.map((record) => (
                  <article className="attendance-approval-card" key={`${record.worker_id}-${record.attendance_date}`}>
                    <div className="attendance-approval-worker">
                      <span className="attendance-approval-avatar">{record.full_name.trim().slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong className="uppercase-text">{record.full_name}</strong>
                        <span className="uppercase-text">{record.position}</span>
                      </div>
                    </div>
                    <div className="attendance-approval-details">
                      <span className="attendance-type-badge">{attendanceStatusLabel(record.status)}</span>
                      <span>{record.attendance_date}</span>
                      <span>Masuk {formatAttendanceTime(record.check_in_time)}</span>
                    </div>
                    {user.role === 'admin'
                      ? <button className="button secondary" type="button" onClick={() => setReviewingAttendance(record)}>Tinjau Bukti &amp; Validasi</button>
                      : <span className="attendance-readonly-note">Menunggu tindakan Admin</span>}
                  </article>
                ))}
              </div>
            ) : <p className="attendance-approval-empty">Tidak ada klaim presensi yang menunggu persetujuan pada {attendanceMonthLabel(attendanceMonth)}.</p>}
          </section>

          <section className="attendance-monthly-matrix" aria-labelledby="attendance-matrix-heading">
            <div className="attendance-subsection-heading attendance-matrix-heading">
              <div><p className="eyebrow">KEHADIRAN PEGAWAI</p><h3 id="attendance-matrix-heading">Matriks Presensi · {attendanceMonthLabel(attendanceMonth)}</h3></div>
              <label className="attendance-search-field">Cari karyawan
                <input
                  type="search"
                  value={attendanceSearch}
                  onChange={(event) => {
                    setAttendanceSearch(event.target.value);
                    setAttendancePage(1);
                  }}
                  placeholder="Nama atau posisi"
                />
              </label>
            </div>
            <div className="attendance-matrix-legend" aria-label="Legenda status matriks">
              {[['H', 'Hadir'], ['T', 'Terlambat'], ['I', 'Izin/Cuti'], ['S', 'Sakit'], ['X', 'Inkomplit'], ['P', 'Pending']].map(([code, label]) => (
                <span key={code}><b className={`attendance-day-code attendance-code-${code.toLowerCase()}`}>{code}</b>{label}</span>
              ))}
            </div>
            <div className="attendance-matrix-scroll">
              <table className="attendance-matrix-table">
                <thead>
                  <tr>
                    <th className="attendance-matrix-worker-column">Karyawan</th>
                    {monthlyDays.map((day) => (
                      <th
                        key={day}
                        className={attendanceDate === `${attendanceMonth}-${String(day).padStart(2, '0')}` ? 'selected-attendance-day' : ''}
                        title={new Date(`${attendanceMonth}-${String(day).padStart(2, '0')}T12:00:00`).toLocaleDateString('id-ID', { weekday: 'long' })}
                      >{day}</th>
                    ))}
                    <th className="attendance-matrix-summary-column">Rekap</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyAttendanceLoading ? (
                    <tr><td className="attendance-matrix-empty" colSpan={monthlyDays.length + 2}>Memuat matriks presensi…</td></tr>
                  ) : visibleMonthlyWorkers.map((worker) => {
                    const summaryForWorker = attendanceMonthSummary(worker.days);
                    return (
                      <tr key={worker.worker_id}>
                        <th scope="row" className="attendance-matrix-worker-column">
                          <span className="attendance-matrix-worker-name uppercase-text">{worker.full_name}</span>
                          <span className="attendance-matrix-worker-position uppercase-text">{worker.position}</span>
                          <span className="attendance-matrix-worker-badge">ID · {worker.worker_id}</span>
                        </th>
                        {monthlyDays.map((day) => {
                          const record = worker.days[day];
                          const code = monthlyAttendanceCode(record);
                          const selectedDate = `${attendanceMonth}-${String(day).padStart(2, '0')}`;
                          return (
                            <td
                              key={day}
                              className={`attendance-matrix-day-cell ${attendanceDate === selectedDate ? 'selected-attendance-day' : ''}`}
                              title={record ? `${attendanceStatusLabel(record.status)}${record.check_in_time ? ` · ${formatAttendanceTime(record.check_in_time)}` : ''}` : 'Belum ada log'}
                            >
                              <button
                                className="attendance-matrix-day-button"
                                type="button"
                                aria-label={`Tampilkan operasional ${worker.full_name}, ${selectedDate}${code ? `, status ${code}` : ', belum ada log'}`}
                                aria-pressed={attendanceDate === selectedDate}
                                onClick={() => selectMatrixAttendanceDate(day)}
                              >
                                {code ? <span className={`attendance-day-code attendance-code-${code.toLowerCase()}`}>{code}</span> : <span className="attendance-day-empty">·</span>}
                              </button>
                            </td>
                          );
                        })}
                        <td className="attendance-matrix-summary-column">
                          <div className="attendance-month-summary">
                            {Object.entries(summaryForWorker).filter(([, count]) => count > 0).map(([code, count]) => (
                              <span key={code} title={`${count} ${code}`}>
                                <b className={`attendance-day-code attendance-code-${code.toLowerCase()}`}>{code}</b>{count}
                              </span>
                            ))}
                            {!Object.values(summaryForWorker).some(Boolean) && '—'}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!monthlyAttendanceLoading && !visibleMonthlyWorkers.length && (
                    <tr><td className="attendance-matrix-empty" colSpan={monthlyDays.length + 2}>
                      {filteredMonthlyWorkers.length < monthlyWorkerRows.length ? 'Tidak ada karyawan yang sesuai pencarian.' : 'Belum ada pegawai aktif.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="attendance-matrix-controls">
              <label>Baris per halaman
                <select value={attendancePageSize} onChange={(event) => {
                  setAttendancePageSize(Number(event.target.value));
                  setAttendancePage(1);
                }}>
                  {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <span>{filteredMonthlyWorkers.length ? `${(attendancePage - 1) * attendancePageSize + 1}–${Math.min(attendancePage * attendancePageSize, filteredMonthlyWorkers.length)} dari ${filteredMonthlyWorkers.length} karyawan` : '0 karyawan'}</span>
              <div>
                <button className="button secondary" type="button" disabled={attendancePage <= 1} onClick={() => setAttendancePage((page) => Math.max(1, page - 1))}>Sebelumnya</button>
                <span>Halaman {Math.min(attendancePage, monthlyPageCount)} / {monthlyPageCount}</span>
                <button className="button secondary" type="button" disabled={attendancePage >= monthlyPageCount} onClick={() => setAttendancePage((page) => Math.min(monthlyPageCount, page + 1))}>Berikutnya</button>
              </div>
            </div>
          </section>

          <div className="panel-heading attendance-heading" id="attendance-daily-operations">
            <div><p className="eyebrow">OPERASIONAL HARIAN</p><h2>Presensi · {attendanceDate}</h2></div>
            <label className="attendance-date-field attendance-date-secondary">Atau pilih tanggal
              <input
                type="date"
                value={attendanceDate}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setAttendanceDate(event.target.value);
                  setAttendanceMonth(event.target.value.slice(0, 7));
                }}
              />
            </label>
          </div>
          <p className="muted attendance-link-note">Tautan statis adalah kredensial pribadi pekerja. Tombol Tampilkan link tidak mengubahnya; hanya rotasi salt perusahaan yang membatalkan semua link.</p>
          <p className="muted attendance-link-note">Koordinat berasal dari browser perangkat dan tidak membuktikan lokasi secara anti-spoofing.</p>
          {!attendanceSettings.salt_configured && <p className="attendance-salt-warning">Pengaturan salt belum dibuat. Minta Admin perusahaan mengaktifkannya melalui Pengaturan → Pengaturan Presensi.</p>}
          {attendanceLoading ? <p className="muted">Memuat rekap presensi...</p> : (
            <div className="table-wrap">
              <table className="attendance-table">
                <thead><tr><th>Nama pekerja</th><th>Posisi</th><th>Status</th><th>Check-in</th><th>Lokasi check-in</th><th>Check-out</th><th>Lokasi check-out</th><th>Status HR</th><th>Tautan</th><th>Aksi</th></tr></thead>
                <tbody>
                  {attendanceData.records.map((record) => (
                    <tr key={record.worker_id}>
                      <td className="uppercase-text">{record.full_name}</td>
                      <td className="uppercase-text">{record.position}</td>
                      <td>
                        <span className={`readiness ${record.status === 'present' || record.approval_status === 'approved' ? 'ready' : 'needs-work'}`}>
                          {record.approval_status === 'pending' ? 'Menunggu persetujuan' : attendanceStatusLabel(record.status)}
                        </span>
                        {record.approval_status === 'rejected' && <small className="attendance-approval-note">Ditolak · pekerja dapat mengajukan ulang</small>}
                      </td>
                      <td>{formatAttendanceTime(record.check_in_time)}</td>
                      <td>{record.check_in_latitude != null && record.check_in_longitude != null ? (
                        <a className="attendance-location-link" href={`https://www.google.com/maps?q=${record.check_in_latitude},${record.check_in_longitude}`} target="_blank" rel="noreferrer">
                          {formatCoordinate(record.check_in_latitude)}, {formatCoordinate(record.check_in_longitude)}
                        </a>
                      ) : '—'}</td>
                      <td>{formatAttendanceTime(record.check_out_time)}</td>
                      <td>{record.check_out_latitude != null && record.check_out_longitude != null ? (
                        <a className="attendance-location-link" href={`https://www.google.com/maps?q=${record.check_out_latitude},${record.check_out_longitude}`} target="_blank" rel="noreferrer">
                          {formatCoordinate(record.check_out_latitude)}, {formatCoordinate(record.check_out_longitude)}
                        </a>
                      ) : '—'}</td>
                      <td>
                        {record.approval_status === 'pending' && user.role === 'admin' ? (
                          <div className="attendance-review-control">
                            {record.has_evidence && (
                              <a
                                className="button secondary"
                                href={`/api/attendance/${encodeURIComponent(record.worker_id)}/evidence?date=${encodeURIComponent(attendanceDate)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Lihat bukti
                              </a>
                            )}
                            <button className="button primary" type="button" onClick={() => decideAttendanceRequest(record.worker_id, 'approve')}>Setujui</button>
                            <button className="button danger" type="button" onClick={() => decideAttendanceRequest(record.worker_id, 'reject')}>Tolak</button>
                          </div>
                        ) : record.approval_status === 'approved' || record.approval_status === 'rejected' ? (
                          <span className={`readiness ${record.approval_status === 'approved' ? 'ready' : 'needs-work'}`}>
                            {record.approval_status === 'approved' ? 'Disetujui' : 'Ditolak'}
                          </span>
                        ) : user.role === 'admin' && !record.check_in_time ? (
                          <div className="attendance-status-control">
                            <select
                              aria-label={`Status presensi ${record.full_name}`}
                              value={attendanceStatusDrafts[record.worker_id] ?? (record.status === 'present' ? '' : record.status || '')}
                              onChange={(event) => setAttendanceStatusDrafts((current) => ({
                                ...current,
                                [record.worker_id]: event.target.value,
                              }))}
                            >
                              <option value="">Pilih status</option>
                              <option value="permission">Izin</option>
                              <option value="leave">Cuti</option>
                              <option value="off">Off</option>
                              <option value="sick">Sakit</option>
                              <option value="absent">Tidak hadir</option>
                            </select>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={!attendanceStatusDrafts[record.worker_id]}
                              onClick={() => saveAttendanceStatus(record.worker_id)}
                            >
                              Simpan
                            </button>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="attendance-link-cell">
                        {user.role !== 'viewer' && attendanceSettings.salt_configured && (
                          <>
                            <button className="button secondary" type="button" onClick={() => createAttendanceLink(record.worker_id)}>
                              {attendanceLinks[record.worker_id] || record.has_attendance_link ? 'Tampilkan link' : 'Buat tautan'}
                            </button>
                            {attendanceLinks[record.worker_id] && (
                              <div className="attendance-link-box">
                                <input aria-label={`Tautan presensi ${record.full_name}`} readOnly value={attendanceLinks[record.worker_id]} />
                                <button className="button secondary" type="button" onClick={() => copyAttendanceLink(attendanceLinks[record.worker_id])}>Salin</button>
                                {user.role === 'admin' && <button className="button danger" type="button" onClick={() => revokeAttendanceLink(record.worker_id)}>Cabut</button>}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td>{user.role === 'admin' && record.attendance_id && <button className="button danger small-action" type="button" disabled={busy} onClick={() => archiveAttendance(record.worker_id)}>Arsipkan</button>}</td>
                    </tr>
                  ))}
                  {!attendanceData.records.length && (
                    <tr><td colSpan="10" className="empty-cell">Tidak ada pekerja aktif untuk tanggal ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {reviewingAttendance && user.role === 'admin' && (
            <div
              className="modal-backdrop attendance-review-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) setReviewingAttendance(null);
              }}
            >
              <section
                className="attendance-review-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="attendance-review-title"
              >
                <header className="modal-heading">
                  <div>
                    <p className="eyebrow">PUSAT PERSETUJUAN · {reviewingAttendance.attendance_date}</p>
                    <h2 id="attendance-review-title">Tinjau klaim presensi</h2>
                    <p className="muted uppercase-text">{reviewingAttendance.full_name} · {reviewingAttendance.position}</p>
                  </div>
                  <button className="modal-close" type="button" aria-label="Tutup tinjauan" disabled={busy} onClick={() => setReviewingAttendance(null)}>×</button>
                </header>
                <div className="attendance-review-summary">
                  <span className="attendance-type-badge">{attendanceStatusLabel(reviewingAttendance.status)}</span>
                  <span>Check-in {formatAttendanceTime(reviewingAttendance.check_in_time)}</span>
                  <span>Check-out {formatAttendanceTime(reviewingAttendance.check_out_time)}</span>
                </div>
                {reviewingAttendance.has_evidence ? (
                  <img
                    className="attendance-review-evidence"
                    src={`/api/attendance/${encodeURIComponent(reviewingAttendance.worker_id)}/evidence?date=${encodeURIComponent(reviewingAttendance.attendance_date)}`}
                    alt={`Bukti presensi ${reviewingAttendance.full_name}`}
                  />
                ) : (
                  <p className="attendance-review-no-evidence">Pengajuan ini tidak memiliki lampiran bukti foto.</p>
                )}
                {reviewingAttendance.approval_note && <p className="muted">Catatan: {reviewingAttendance.approval_note}</p>}
                <div className="modal-actions">
                  <button className="button secondary" type="button" disabled={busy} onClick={() => setReviewingAttendance(null)}>Tutup</button>
                  <button
                    className="button danger"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (await decideAttendanceRequest(reviewingAttendance.worker_id, 'reject', reviewingAttendance.attendance_date)) setReviewingAttendance(null);
                    }}
                  >Tolak</button>
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (await decideAttendanceRequest(reviewingAttendance.worker_id, 'approve', reviewingAttendance.attendance_date)) setReviewingAttendance(null);
                    }}
                  >Setujui</button>
                </div>
              </section>
            </div>
          )}
        </section>

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

function StatCard({ label, value, tone }) {
  return <article className={`stat-card tone-${tone}`}><span className={`stat-marker ${tone}`} /><span className="stat-label">{label}</span><strong>{value}</strong></article>;
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status}`}>{STATUS_LABELS[status] || status}</span>;
}

function App() {
  return window.location.pathname === '/presensi' ? <Presensi /> : <WorkspaceApp />;
}

export default App;
