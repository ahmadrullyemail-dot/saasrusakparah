import { useEffect, useRef } from 'react';
import { CONTRACT_TYPES } from '../config.js';
import { Icon } from './Icon.jsx';

export function WorkerModal({ onClose, onSubmit, busy, error, departmentOptions, documentTypes, documentTypesLoading, initialWorker = null }) {
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
            <Icon name="x" />
          </button>
        </header>
        <form className="worker-form" onSubmit={onSubmit}>
          <div className="modal-fields">
            <section className="worker-form-section" aria-labelledby="personal-section-title">
              <h3 className="form-section-title" id="personal-section-title">Informasi personal</h3>
              <div className="worker-data-grid">
                <label className="modal-field"><span>Nama lengkap <span className="required-mark">*</span></span><input className="modal-control uppercase-text" ref={nameInputRef} name="full_name" required maxLength="150" autoComplete="name" defaultValue={initialWorker?.full_name || ''} /></label>
                <label className="modal-field">Nomor pekerja
                  <input
                    className="modal-control"
                    name="worker_number"
                    maxLength="50"
                    pattern="[A-Za-z0-9][A-Za-z0-9._/-]*"
                    placeholder={initialWorker?.status === 'active' ? 'Wajib untuk pekerja aktif' : 'Diisi sebelum aktivasi'}
                    defaultValue={initialWorker?.worker_number || ''}
                    required={initialWorker?.status === 'active'}
                    aria-describedby="worker-number-help"
                  />
                  <small id="worker-number-help" className="rate-hint">
                    Nomor disimpan pada profil dan tetap melekat saat status pekerja menjadi nonaktif.
                  </small>
                </label>
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
