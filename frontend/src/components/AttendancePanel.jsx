import { attendanceMonthLabel, attendanceMonthSummary, attendanceStatusLabel, formatAttendanceTime, formatCoordinate, monthlyAttendanceCode } from '../lib/hrd.js';
import { Icon } from './Icon.jsx';

export function AttendancePanel({ activeTab, attendanceDate, attendanceData, attendanceLoading, attendanceMonth, attendancePage, attendancePageSize, attendanceSettings, companyPortalLink, attendanceStatusDrafts, attendanceSearch, busy, copyToClipboard, decideAttendanceRequest, decideLeaveRequest, openLeaveRejection, filteredMonthlyWorkers, monthlyAttendanceLoading, monthlyCheckedIns, monthlyDays, monthlyPageCount, monthlyWorkerRows, pendingAttendanceApprovals, pendingLeaveRequests, pendingLeaveRequestsLoading, reviewingAttendance, saveAttendanceStatus, resetWorkerPortalSession, selectMatrixAttendanceDate, setAttendanceDate, setAttendanceMonth, setAttendancePage, setAttendancePageSize, setAttendanceSearch, setReviewingAttendance, totalMonthlyLogs, user, visibleMonthlyWorkers, archiveAttendance }) {
  return (
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
              <span className="attendance-metric-icon active-workers"><Icon name="users" /></span>
              <div><small>Pegawai aktif</small><strong>{monthlyAttendanceLoading ? '—' : monthlyWorkerRows.length}</strong><span>Terdaftar pada perusahaan</span></div>
            </article>
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon checkin-workers"><Icon name="checkCircle" /></span>
              <div><small>Tercatat masuk</small><strong>{monthlyAttendanceLoading ? '—' : monthlyCheckedIns}</strong><span>{attendanceMonthLabel(attendanceMonth)}</span></div>
            </article>
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon total-logs"><Icon name="history" /></span>
              <div><small>Total log presensi</small><strong>{monthlyAttendanceLoading ? '—' : totalMonthlyLogs}</strong><span>{attendanceMonthLabel(attendanceMonth)}</span></div>
            </article>
            <article className="attendance-metric-card">
              <span className="attendance-metric-icon pending-claims"><Icon name="clock" /></span>
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
            {['admin', 'hr_manager'].includes(user.role) && (
              <div className="attendance-leave-approval">
                <div className="attendance-subsection-heading">
                  <div><p className="eyebrow">PERMOHONAN RENTANG TANGGAL</p><h4>Pengajuan izin, cuti, sakit, dan off</h4></div>
                  <span className={`count-pill ${pendingLeaveRequests.length ? 'pending-count' : ''}`}>
                    {pendingLeaveRequestsLoading ? 'Memuat…' : `${pendingLeaveRequests.length} pending`}
                  </span>
                </div>
                {pendingLeaveRequestsLoading ? <p className="muted">Memuat antrean pengajuan…</p>
                  : pendingLeaveRequests.length ? (
                    <div className="attendance-approval-list">
                      {pendingLeaveRequests.map((request) => (
                        <article className="attendance-approval-card leave-approval-card" key={request.id}>
                          <div className="attendance-approval-worker">
                            <span className="attendance-approval-avatar">{request.full_name.trim().slice(0, 1).toUpperCase()}</span>
                            <div>
                              <strong className="uppercase-text">{request.full_name}</strong>
                              <span className="uppercase-text">{request.position}</span>
                            </div>
                          </div>
                          <div className="attendance-approval-details">
                            <span className="attendance-type-badge">{({ izin: 'Izin', cuti: 'Cuti', sakit: 'Sakit', off: 'Off' })[request.type]}</span>
                            <span>{request.start_date} – {request.end_date}</span>
                            <span className="leave-approval-reason">{request.reason}</span>
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
                          <div className="leave-approval-actions">
                            <button className="button primary" type="button" disabled={busy} onClick={() => decideLeaveRequest(request.id, 'approved')}>Setujui</button>
                            <button className="button danger" type="button" disabled={busy} onClick={() => openLeaveRejection(request)}>Tolak</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="attendance-approval-empty">Tidak ada pengajuan pekerja yang menunggu keputusan.</p>}
              </div>
            )}
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

          {/*<div className="panel-heading attendance-heading" id="attendance-daily-operations">
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
          </div>*/}
          <p className="muted attendance-link-note">Semua pekerja menggunakan satu tautan portal perusahaan. UUID perangkat diterbitkan saat verifikasi nomor pekerja; Admin dan HR Staff dapat mereset UUID melalui daftar pekerja.</p>
          {user.role === 'admin' && companyPortalLink && (
            <div className="attendance-link-box company-portal-link-box">
              <label className="visually-hidden" htmlFor="attendance-company-portal-link">Tautan portal perusahaan</label>
              <input id="attendance-company-portal-link" readOnly value={companyPortalLink} />
              <button className="button secondary" type="button" onClick={() => copyToClipboard(companyPortalLink)}>Salin tautan</button>
            </div>
          )}
          <p className="muted attendance-link-note">Koordinat berasal dari browser perangkat dan tidak membuktikan lokasi secara anti-spoofing.</p>
          {!attendanceSettings.company_portal_configured && <p className="attendance-salt-warning">Tautan portal perusahaan belum dibuat. Admin dapat membuatnya melalui Pengaturan → Pengaturan Presensi.</p>}
          {attendanceLoading ? <p className="muted">Memuat rekap presensi...</p> : (
            <div className="table-wrap">
              <table className="attendance-table">
                <thead><tr><th>Nama pekerja</th><th>Posisi</th><th>Status</th><th>Check-in</th><th>Lokasi check-in</th><th>Check-out</th><th>Lokasi check-out</th><th>Status HR</th><th>Aktivasi portal</th><th>Aksi</th></tr></thead>
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
                            <button className="button primary" type="button" onClick={() => decideAttendanceRequest(record.worker_id, 'approve')}><Icon name="check" size={16} />Setujui</button>
                            <button className="button danger" type="button" onClick={() => decideAttendanceRequest(record.worker_id, 'reject')}><Icon name="x" size={16} />Tolak</button>
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
                        {(user.role === 'admin' || user.role === 'hr_manager')
                          && attendanceSettings.company_portal_configured
                          && (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => resetWorkerPortalSession(record.worker_id)}
                            >
                              <Icon name="refresh" size={15} /> Reset UUID
                            </button>
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
                  <button className="modal-close" type="button" aria-label="Tutup tinjauan" disabled={busy} onClick={() => setReviewingAttendance(null)}><Icon name="x" /></button>
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
                  ><Icon name="x" size={16} />Tolak</button>
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (await decideAttendanceRequest(reviewingAttendance.worker_id, 'approve', reviewingAttendance.attendance_date)) setReviewingAttendance(null);
                    }}
                  ><Icon name="check" size={16} />Setujui</button>
                </div>
              </section>
            </div>
          )}
        </section>
  );
}
