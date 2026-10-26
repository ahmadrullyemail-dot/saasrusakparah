import { useEffect, useRef, useState } from 'react';
import { APP_THEMES, ATTENDANCE_ACTIVITY_OPTIONS, USER_ROLE_LABELS } from '../config.js';
import { formatCoordinate } from '../lib/hrd.js';
import { AttendanceLocationsMap } from './AttendanceLocationsMap.jsx';

export function DocumentWarningThresholdEditor({ type, defaultDays, busy, onSave }) {
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

export function SettingsPanel({
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
  subscription,
  onRotateAttendanceSalt,
  onUpdateAttendanceSecurity,
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
        {user.role === 'admin' && <button type="button" className={`settings-tab ${section === 'subscription' ? 'active' : ''}`} aria-pressed={section === 'subscription'} onClick={() => setSection('subscription')}>Paket Langganan</button>}
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

      {section === 'subscription' && user.role === 'admin' && (
        <section className="panel settings-card subscription-settings-card" aria-label="Paket langganan">
          <div className="panel-heading">
            <div><p className="eyebrow">LANGGANAN</p><h2>Paket perusahaan</h2></div>
            <span className="subscription-current-badge">Paket {subscription?.plan === 'free' ? 'Free' : subscription?.plan || 'Free'}</span>
          </div>
          <p className="muted">Paket dan kuota berlaku untuk perusahaan ini. Pekerja aktif adalah pekerja yang tidak diarsipkan dan berstatus Aktif.</p>
          <div className="subscription-plan-grid">
            <article className="subscription-plan-card current">
              <span className="subscription-plan-state">PAKET SAAT INI</span>
              <h3>Free</h3>
              <p>Untuk memulai pengelolaan operasional HR.</p>
              <strong className="subscription-quota">{subscription?.active_workers ?? '—'}<span>/{subscription?.worker_limit ?? 20} pekerja aktif</span></strong>
              <span className="subscription-plan-footnote">Kuota aktif diperbarui dari data pekerja perusahaan.</span>
            </article>
            <article className="subscription-plan-card unavailable">
              <span className="subscription-plan-state">SEGERA HADIR</span>
              <h3>Pro</h3>
              <p>Fitur paket Pro sedang dalam pengembangan.</p>
              <button className="button secondary" type="button" disabled>Belum Tersedia</button>
            </article>
            <article className="subscription-plan-card unavailable">
              <span className="subscription-plan-state">SEGERA HADIR</span>
              <h3>Enterprise</h3>
              <p>Fitur paket Enterprise sedang dalam pengembangan.</p>
              <button className="button secondary" type="button" disabled>Belum Tersedia</button>
            </article>
          </div>
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
            <div className="attendance-security-setting">
              <div>
                <strong>Anti-Mock Location</strong>
                <p className="muted">Memblokir sinyal mock yang dilaporkan browser, akurasi GPS yang tidak memadai, dan perpindahan yang tidak masuk akal.</p>
              </div>
              <label className="switch-control" aria-label="Anti-Mock Location">
                <input
                  type="checkbox"
                  role="switch"
                  checked={Boolean(attendanceSettings.anti_mock_location_enabled)}
                  disabled={busy}
                  onChange={(event) => onUpdateAttendanceSecurity(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true"><span /></span>
                <span>{attendanceSettings.anti_mock_location_enabled ? 'Aktif' : 'Nonaktif'}</span>
              </label>
            </div>
            <p className="attendance-salt-warning">
              Pembatasan: halaman web tidak dapat membuktikan bahwa GPS berasal dari perangkat asli. Deteksi ini bersifat best-effort dan sinyal yang dikirim browser dapat dimanipulasi; perlindungan kuat memerlukan aplikasi native dengan device attestation.
            </p>
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
