import { useState } from 'react';
import { api } from '../lib/hrd.js';

export function AuthScreen({ onAuthenticated, initialError }) {
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
    <main className="landing-page" id="home">
      <header className="landing-navbar">
        <a className="landing-brand" href="#home" aria-label="rusakparah.web.id, beranda">
          <span className="brand-mark">R</span>
          <span><strong>rusakparah.web.id</strong><small>HRD Management</small></span>
        </a>
        <nav className="landing-nav" aria-label="Navigasi utama">
          <a className="landing-nav-home" href="#home">Home</a>
          <a href="#features">Fitur</a>
          <a className="landing-signin-link" href="#signin">Masuk / Sign In <span aria-hidden="true">↗</span></a>
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
            <a className="landing-primary-action" href="#signin">Mulai dengan masuk <span aria-hidden="true">→</span></a>
            <a className="landing-secondary-action" href="#features">Jelajahi fitur</a>
          </div>
          <div className="landing-trust-note"><span aria-hidden="true">✓</span> Informasi operasional tersusun dalam satu dashboard</div>
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
          <div className="landing-float-card landing-doc-float"><span className="landing-float-icon">▤</span><span><strong>Dokumen terpantau</strong><small>Pengingat lebih teratur</small></span><b>✓</b></div>
          <div className="landing-float-card landing-attendance-float"><span className="landing-float-icon attendance-float-icon">◷</span><span><strong>Presensi terkini</strong><small>Pemantauan terpusat</small></span><b className="attendance-float-check">●</b></div>
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
            <span className="landing-feature-icon feature-cycle">↗</span>
            <h3>Siklus pekerja</h3>
            <p>Pantau progres dari offering dan pra-aktif hingga aktif maupun nonaktif.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-attendance">◷</span>
            <h3>Real-time attendance</h3>
            <p>Ikuti presensi melalui matriks bulanan, operasional harian, dan pusat persetujuan.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-documents">▤</span>
            <h3>Pemantauan dokumen</h3>
            <p>Kelola persyaratan dan masa berlaku dokumen dengan pengingat yang dapat diatur.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-security">⌁</span>
            <h3>Presensi lebih tepercaya</h3>
            <p>Pengaturan Anti-Mock Location membantu menambah pemeriksaan pada portal presensi.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-excel">⇅</span>
            <h3>Impor Excel masal</h3>
            <p>Admin dapat memproses data pekerja dari Excel langsung di browser dan meninjau duplikasi.</p>
          </article>
          <article className="landing-feature-card">
            <span className="landing-feature-icon feature-roles">♙</span>
            <h3>Akses berbasis peran</h3>
            <p>Hak akses Admin, HR Staff, dan Viewer disesuaikan dengan tanggung jawab masing-masing.</p>
          </article>
        </div>
      </section>

      <section className="landing-signin-section" id="signin">
        <div className="landing-signin-copy">
          <p className="landing-kicker">RUSAKPARAH.WEB.ID UNTUK TIM HR ANDA</p>
          <h2>{registering ? 'Siapkan ruang kerja HR Anda.' : 'Selamat datang kembali.'}</h2>
          <p>{registering
            ? 'Daftarkan perusahaan untuk mulai mengelola informasi pekerja dan operasional HR.'
            : 'Masuk untuk melanjutkan pemantauan siklus pekerja, presensi, dan dokumen.'}</p>
          <div className="landing-security-note"><span aria-hidden="true">◆</span> Akses dilindungi dan dibatasi sesuai peran pengguna.</div>
        </div>
        <section className="auth-card landing-auth-card" aria-labelledby="landing-auth-title">
          <div className="brand-mark">HR</div>
          <p className="eyebrow">{registering ? 'MULAI GUNAKAN RUSAKPARAH.WEB.ID' : 'MASUK KE RUSAKPARAH.WEB.ID'}</p>
          <h2 id="landing-auth-title">{registering ? 'Daftarkan perusahaan' : 'Masuk ke akun Anda'}</h2>
          <p className="muted">
            {registering
              ? 'Buat ruang kerja perusahaan untuk mulai mengelola pekerja.'
              : 'Gunakan email dan kata sandi akun Anda untuk masuk.'}
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
          <button className="text-button" type="button" onClick={() => { setRegistering(!registering); setError(''); }}>
            {registering ? 'Sudah memiliki akun? Masuk' : 'Daftarkan perusahaan baru'}
          </button>
        </section>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand" href="#home"><span className="brand-mark">R</span><span><strong>rusakparah.web.id</strong><small>HRD Management</small></span></a>
        <span>Pengelolaan HR yang terhubung dan terarah.</span>
        <a href="#home">Kembali ke atas ↑</a>
      </footer>
    </main>
  );
}
