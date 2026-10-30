import { StatusBadge } from './StatCard.jsx';
import { Icon } from './Icon.jsx';

export function WorkersPanel({ activeTab, archiveWorker, busy, createWorkerWorkbook, filter, handleImportWorkers, openEditWorker, selectedId, setFilter, setSelectedId, setWorkerSearch, showError, subscription, user, visibleWorkers, workerImportInputRef, workerImportResult, workerQuotaFull, workerSearch, workers }) {
  const hasActions = user.role === 'admin';
  return (
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
              <div className="worker-search-field">
                <label className="visually-hidden" htmlFor="worker-search">Cari pekerja</label>
                <span className="worker-search-control">
                  <input
                    id="worker-search"
                    type="search"
                    value={workerSearch}
                    onChange={(event) => setWorkerSearch(event.target.value)}
                    placeholder="Cari nama, NIK, posisi, departemen..."
                    aria-label="Cari pekerja"
                  />
                  {workerSearch && <button type="button" onClick={() => setWorkerSearch('')} aria-label="Hapus pencarian"><Icon name="x" size={16} /></button>}
                </span>
              </div>
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
                  <button className="button secondary" type="button" disabled={busy} onClick={() => createWorkerWorkbook([]).catch(showError)}><Icon name="download" size={16} /> Unduh template Excel</button>
                  <button className="button secondary" type="button" disabled={busy || workerQuotaFull} onClick={() => workerImportInputRef.current?.click()}>
                    <Icon name="upload" size={16} /> {busy ? 'Memproses…' : 'Impor Excel'}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy || !workers.length}
                    onClick={() => createWorkerWorkbook(workers.map((worker) => ({
                      full_name: worker.full_name,
                      email: worker.email,
                      worker_number: worker.worker_number || '',
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
                    <Icon name="download" size={16} /> Ekspor Excel
                  </button>
                </div>
              )}
            </div>
            {subscription?.worker_limit != null && (
              <p className={`worker-quota-inline ${workerQuotaFull ? 'at-limit' : ''}`} role="status">
                Paket Free · {subscription.active_workers}/{subscription.worker_limit} pekerja aktif
                {workerQuotaFull ? ' — kuota penuh; penambahan/aktivasi dibatasi.' : ` — ${subscription.worker_limit - subscription.active_workers} kuota tersedia.`}
              </p>
            )}
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
                <button key={value} className={`filter-chip ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {label}<span>{value === 'all' ? workers.length : workers.filter((worker) => worker.status === value).length}</span>
                </button>
              ))}
              <span className="worker-result-count" role="status">{visibleWorkers.length} ditampilkan</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nama pekerja</th><th>Nomor pekerja</th><th>Posisi</th><th>Status</th><th>Kelayakan</th>{hasActions && <th>Aksi</th>}</tr></thead>
                <tbody>
                  {visibleWorkers.map((worker) => (
                    <tr key={worker.id} className={selectedId === worker.id ? 'selected-row' : ''}>
                      <td><button className="worker-link uppercase-text" onClick={() => setSelectedId(worker.id)}>{worker.full_name}<small className="normal-case">{worker.email || 'Email belum dicatat'}</small></button></td>
                      <td>{worker.worker_number || <span className="muted">Belum ditetapkan</span>}</td>
                      <td className="uppercase-text">{worker.position}</td>
                      <td><StatusBadge status={worker.status} />{worker.scheduled_inactive_date && <small className="scheduled-inactive-note">Nonaktif mulai {worker.scheduled_inactive_date.slice(0, 10)}</small>}</td>
                      <td><span className={`readiness ${worker.eligibility?.eligible ? 'ready' : 'needs-work'}`}>{worker.eligibility?.eligible ? 'Memenuhi syarat' : 'Perlu dokumen'}</span></td>
                      {hasActions && (
                        <td>
                          <div className="user-actions">
                            {user.role === 'admin' && (
                              <>
                                <button className="button secondary small-action" type="button" disabled={busy} onClick={() => openEditWorker(worker)}><Icon name="pencil" size={15} /> Edit</button>
                                <button className="button danger small-action" type="button" disabled={busy} onClick={() => archiveWorker(worker.id)}><Icon name="archive" size={15} /> Arsipkan</button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!visibleWorkers.length && (
                    <tr><td colSpan={hasActions ? 6 : 5} className="empty-cell">
                      {workers.length ? 'Tidak ada pekerja yang cocok dengan filter pencarian.' : 'Belum ada data pekerja. Gunakan tombol Tambah Pekerja untuk memulai.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </section>
  );
}
