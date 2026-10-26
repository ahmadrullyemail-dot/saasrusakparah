import { useEffect, useState } from 'react';
import { api } from '../lib/hrd.js';
import { Icon } from './Icon.jsx';

export function AuthScreen({ onAuthenticated, initialError }) {
  const [registering, setRegistering] = useState(false);
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [recoveryMode, setRecoveryMode] = useState(() => (
    new URLSearchParams(window.location.search).has('token') ? 'reset' : 'login'
  ));
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resetToken) window.history.replaceState(null, '', `${window.location.pathname}#reset-password`);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (recoveryMode === 'forgot') {
        const result = await api('/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: form.get('email') }),
        });
        setRecoveryNotice(result.message);
        return;
      }
      if (recoveryMode === 'reset') {
        const password = form.get('password');
        if (password !== form.get('confirm_password')) throw new Error('Konfirmasi kata sandi tidak sama.');
        const result = await api('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({
            token: resetToken,
            new_password: password,
          }),
        });
        window.history.replaceState(null, '', `${window.location.pathname}#signin`);
        setResetToken('');
        setRecoveryMode('login');
        setRecoveryNotice(result.message);
        return;
      }
      const payload = { email: form.get('email'), password: form.get('password') };
      if (registering) {
        payload.full_name = form.get('full_name');
        payload.company_name = form.get('company_name');
      }
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
    <main className="landing-page" id="home">
      <header className="landing-navbar">
        <a className="landing-brand" href="#home" aria-label="rusakparah.web.id, beranda">
          <span className="brand-mark">R</span>
          <span><strong>rusakparah.web.id</strong><small>HRD Management</small></span>
        </a>
        <nav className="landing-nav" aria-label="Navigasi utama">
          <a className="landing-nav-home" href="#home">Home</a>
          <a href="#features">Fitur</a>
          <a href="#changelog">Changelog</a>
          <a className="landing-signin-link" href="#signin">Masuk / Sign In <Icon name="arrowUpRight" size={16} /></a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-kicker"><span /> PLATFORM OPERASIONAL HR TERPADU</p>
          <h1>Kelola timesheet pekerja, <span>lebih terarah.</span></h1>
          <p className="landing-lede">
            Satu ruang kerja untuk memantau siklus pekerja, presensi harian, dan dokumen penting—agar tim HR dapat fokus pada hal yang paling berarti.
          </p>
          <div className="landing-hero-actions">
            <a className="landing-primary-action" href="#signin">Mulai dengan masuk <Icon name="arrowRight" size={17} /></a>
            <a className="landing-secondary-action" href="#features">Jelajahi fitur</a>
          </div>
          <div className="landing-trust-note"><Icon name="checkCircle" size={17} /> Informasi operasional tersusun dalam satu dashboard</div>
        </div>

        <div className="landing-visual" aria-label="Ilustrasi dashboard manajemen pekerja">
          <div className="landing-visual-orbit orbit-one" />
          <div className="landing-visual-orbit orbit-two" />
          <div className="landing-dashboard-card">
            <div className="landing-dashboard-top">
              <div><span className="landing-mini-mark">R</span><span><strong>Ringkasan</strong><small>rusakparah.web.id</small></span></div>
              <span className="landing-live"><i /> PREVIEW</span>
            </div>
            <p className="landing-dashboard-caption">Status pekerja</p>
            <div className="landing-status-grid">
              <div><span className="status-dot offered-dot" /><span>Offering</span><strong>12</strong></div>
              <div><span className="status-dot active-dot" /><span>Aktif</span><strong>148</strong></div>
              <div><span className="status-dot preactive-dot" /><span>Pra-aktif</span><strong>08</strong></div>
              <div><span className="status-dot inactive-dot" /><span>Nonaktif</span><strong>06</strong></div>
            </div>
            <div className="landing-dashboard-bottom">
              <div className="landing-chart" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
              <div className="landing-chart-label"><span>Contoh tampilan</span><strong>Ringkasan HR</strong></div>
            </div>
          </div>
          <div className="landing-float-card landing-doc-float"><span className="landing-float-icon"><Icon name="fileClock" /></span><span><strong>Dokumen terpantau</strong><small>Pengingat lebih teratur</small></span><b><Icon name="check" size={16} /></b></div>
          <div className="landing-float-card landing-attendance-float"><span className="landing-float-icon attendance-float-icon"><Icon name="calendarClock" /></span><span><strong>Presensi terkini</strong><small>Pemantauan terpusat</small></span><b className="attendance-float-check"><Icon name="checkCircle" size={16} /></b></div>
        </div>
      </section>

      <section className="landing-features" id="features">
        <div className="landing-section-heading">
          <p className="landing-kicker">DIBUAT UNTUK KERJA HR SEHARI-HARI</p>
          <h2>Operasional lebih rapi, dari satu tempat.</h2>
          <p>Alur penting tim HR terhubung agar informasi mudah dipantau dan ditindaklanjuti.</p>
        </div>
        <div className="landing-feature-grid">
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-cycle"><Icon name="refresh" size={21} /></span>
            <h3>Siklus pekerja</h3>
            <p>Pantau progres dari offering dan pra-aktif hingga aktif maupun nonaktif.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-attendance"><Icon name="calendarClock" size={21} /></span>
            <h3>Real-time attendance</h3>
            <p>Ikuti presensi melalui matriks bulanan, operasional harian, dan pusat persetujuan.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-documents"><Icon name="fileClock" size={21} /></span>
            <h3>Pemantauan dokumen</h3>
            <p>Kelola persyaratan dan masa berlaku dokumen dengan pengingat yang dapat diatur.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-security"><Icon name="shield" size={21} /></span>
            <h3>Presensi lebih tepercaya</h3>
            <p>Pengaturan Anti-Mock Location membantu menambah pemeriksaan pada portal presensi.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-excel"><Icon name="upload" size={21} /></span>
            <h3>Impor Excel masal</h3>
            <p>Admin dapat memproses data pekerja dari Excel langsung di browser dan meninjau duplikasi.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-roles"><Icon name="users" size={21} /></span>
            <h3>Akses berbasis peran</h3>
            <p>Hak akses Admin, HR Staff, dan Viewer disesuaikan dengan tanggung jawab masing-masing.</p>
          </article>
        </div>
      </section>

      <section className="landing-changelog" id="changelog">
        <div className="landing-section-heading">
          <p className="landing-kicker">RIWAYAT PEMBARUAN</p>
          <h2>Terus berkembang untuk kerja HR.</h2>
          <p>Catatan fitur yang sudah tersedia di Ruang Kerja HRD.</p>
        </div>
        <div className="changelog-list">
          <article className="changelog-release">
            <div className="changelog-release-meta"><span className="changelog-version">PEMBARUAN UI</span><time dateTime="2026-10-26">26 Oktober 2026</time></div>
            <h3>Pengalaman kerja lebih jelas dan konsisten</h3>
            <ul>
              <li>Tipografi, kartu, kontrol formulir, dan ikon Lucide diseragamkan.</li>
              <li>Portal Presensi mendapat layout responsif dan status Check-In/Check-Out yang lebih mudah dipindai.</li>
              <li>Perbaikan ukuran peta geofence saat tab Pengaturan Presensi dibuka.</li>
            </ul>
          </article>
          <article className="changelog-release">
            <div className="changelog-release-meta"><span className="changelog-version">PEMBARUAN OPERASIONAL</span><span>Fitur tersedia</span></div>
            <h3>Pemantauan yang terhubung</h3>
            <ul>
              <li>Paket Free membatasi 20 pekerja aktif.</li>
              <li>Ringkasan menampilkan tindak lanjut masa berlaku dokumen dan klaim presensi pending.</li>
              <li>Geofence, pengajuan presensi, bukti Dinas, dan pusat persetujuan HR.</li>
              <li>Pembaruan data dashboard dan presensi melalui sinkronisasi real-time.</li>
            </ul>
          </article>
          <article className="changelog-release">
            <div className="changelog-release-meta"><span className="changelog-version">VERSI 1.0.0</span><span>Fondasi produk</span></div>
            <h3>Siklus pekerja dan dokumen HR</h3>
            <ul>
              <li>Kelola tahapan offering, pra-aktif, aktif, dan nonaktif.</li>
              <li>Katalog persyaratan dokumen, evaluasi kelayakan, dan riwayat aktivitas.</li>
              <li>Autentikasi perusahaan, peran pengguna, serta impor dan ekspor pekerja.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="landing-signin-section" id="signin">
        <div className="landing-signin-copy">
          <p className="landing-kicker">RUSAKPARAH.WEB.ID UNTUK TIM HR ANDA</p>
          <h2>{registering ? 'Siapkan ruang kerja HR Anda.' : recoveryMode === 'forgot' || recoveryMode === 'reset' ? 'Pulihkan akses akun Anda.' : 'Selamat datang kembali.'}</h2>
          <p>{registering
            ? 'Daftarkan perusahaan untuk mulai mengelola informasi pekerja dan operasional HR.'
            : recoveryMode === 'forgot' || recoveryMode === 'reset'
              ? 'Ikuti langkah pemulihan untuk kembali masuk ke ruang kerja HR.'
              : 'Masuk untuk melanjutkan pemantauan siklus pekerja, presensi, dan dokumen.'}</p>
          <div className="landing-security-note"><Icon name="shield" size={16} /> Akses dilindungi dan dibatasi sesuai peran pengguna.</div>
        </div>
        <section className="auth-card landing-auth-card" id={recoveryMode === 'reset' ? 'reset-password' : undefined} aria-labelledby="landing-auth-title">
          <div className="brand-mark">HR</div>
          <p className="eyebrow">{registering ? 'MULAI GUNAKAN RUSAKPARAH.WEB.ID' : recoveryMode === 'forgot' ? 'PEMULIHAN AKUN' : recoveryMode === 'reset' ? 'TAUTAN PEMULIHAN' : 'MASUK KE RUSAKPARAH.WEB.ID'}</p>
          <h2 id="landing-auth-title">{registering ? 'Daftarkan perusahaan' : recoveryMode === 'forgot' ? 'Lupa kata sandi?' : recoveryMode === 'reset' ? 'Atur kata sandi baru' : 'Masuk ke akun Anda'}</h2>
          <p className="muted">
            {registering
              ? 'Buat ruang kerja perusahaan untuk mulai mengelola pekerja.'
              : recoveryMode === 'forgot'
                ? 'Masukkan email akun. Jika terdaftar, kami akan mengirim tautan pemulihan yang berlaku selama 30 menit.'
                : recoveryMode === 'reset'
                  ? 'Gunakan kata sandi baru minimal 12 karakter.'
                  : 'Gunakan email dan kata sandi akun Anda untuk masuk.'}
          </p>
          <form className="form-stack" onSubmit={handleSubmit}>
            {registering && recoveryMode === 'login' && (
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
            {(recoveryMode === 'login' || recoveryMode === 'forgot') && (
              <label>Email<input name="email" type="email" required autoComplete="email" /></label>
            )}
            {(recoveryMode === 'login' || recoveryMode === 'reset') && (
              <>
                <label>Kata sandi<input name="password" type="password" required minLength={registering || recoveryMode === 'reset' ? 12 : 1} maxLength="72" autoComplete={registering || recoveryMode === 'reset' ? 'new-password' : 'current-password'} />{(registering || recoveryMode === 'reset') && <small>Minimal 12 karakter; maksimal 72 byte UTF-8.</small>}</label>
                {recoveryMode === 'reset' && <label>Konfirmasi kata sandi<input name="confirm_password" type="password" required minLength="12" maxLength="72" autoComplete="new-password" /></label>}
              </>
            )}
            {error && <p className="notice error" role="alert">{error}</p>}
            {initialError && <p className="notice error" role="alert">{initialError}</p>}
            {recoveryNotice && <p className="notice success" role="status">{recoveryNotice}</p>}
            <button className="button primary full-width" disabled={busy}>
              {busy ? 'Memproses…' : registering ? 'Buat akun perusahaan' : recoveryMode === 'forgot' ? 'Kirim tautan pemulihan' : recoveryMode === 'reset' ? 'Simpan kata sandi baru' : 'Masuk'}
            </button>
          </form>
          {recoveryMode === 'login' && !registering && <button className="text-button recovery-link" type="button" onClick={() => { setRecoveryMode('forgot'); setError(''); setRecoveryNotice(''); }}>Lupa kata sandi?</button>}
          {recoveryMode === 'login' && <button className="text-button" type="button" onClick={() => { setRegistering(!registering); setError(''); setRecoveryNotice(''); }}>
            {registering ? 'Sudah memiliki akun? Masuk' : 'Daftarkan perusahaan baru'}
          </button>}
          {recoveryMode !== 'login' && <button className="text-button" type="button" onClick={() => { setRecoveryMode('login'); setRegistering(false); setResetToken(''); setError(''); setRecoveryNotice(''); window.history.replaceState(null, '', `${window.location.pathname}#signin`); }}>Kembali ke halaman masuk</button>}
        </section>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand" href="#home"><span className="brand-mark">R</span><span><strong>rusakparah.web.id</strong><small>HRD Management</small></span></a>
        <span>Pengelolaan HR yang terhubung dan terarah.</span>
        <a href="#changelog">Changelog</a>
      </footer>
    </main>
  );
}
