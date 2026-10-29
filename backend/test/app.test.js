const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateEligibility,
  validDate,
  validLeaveRequestInput,
  validLeaveRequestStatus,
  leaveRequestBlocksDate,
  validLeaveRejectionNote,
  leaveAttendanceStatus,
  leaveRequestDates,
  findLeaveAttendanceConflictDate,
  leaveAttachmentMimeType,
  safeLeaveAttachmentName,
  leaveAttachmentStoragePath,
  validDocumentWarningThreshold,
  attendanceMonthRange,
  validRequiredDocuments,
  documentTypeCode,
  documentDateFields,
  parseRequiredDocuments,
  canTransitionStatus,
  hashEmail,
  hashPasswordResetToken,
  takeAuthRateLimit,
  validPhoneNumber,
  validNationalId,
  validDepartment,
  validSalaryRate,
  normalizeText,
  normalizeDocumentTypeName,
  hashNormalizedText,
  validPassword,
  validProfilePhotoUrl,
  profilePhotoMimeType,
  MAX_PROFILE_PHOTO_BYTES,
  validAttendanceToken,
  hashAttendanceToken,
  validPortalEnrollmentCode,
  hashPortalEnrollmentCode,
  validWorkerId,
  validWorkerNumber,
  normalizeWorkerNumber,
  validCoordinates,
  distanceInMeters,
  implausibleLocationMovement,
  parseAllowedActivities,
  matchRequiredAttendanceLocation,
  validAttendanceLocationInput,
  requireManager,
  requireAdmin,
  exceedsWorkerQuota,
} = require('../src/app');

test('Free worker quota blocks at 20 active workers and leaves other plans uncapped', () => {
  assert.equal(exceedsWorkerQuota({ plan: 'free', active_workers: 19, worker_limit: 20 }), false);
  assert.equal(exceedsWorkerQuota({ plan: 'free', active_workers: 20, worker_limit: 20 }), true);
  assert.equal(exceedsWorkerQuota({ plan: 'free', active_workers: 21, worker_limit: 20 }), true);
  assert.equal(exceedsWorkerQuota({ plan: 'pro', active_workers: 200, worker_limit: null }), false);
});

test('RBAC grants operational create access to Admin and HR Staff only', () => {
  for (const role of ['admin', 'hr_manager']) {
    let nextCalled = false;
    requireManager({ auth: { role } }, { status() { throw new Error('Unexpected denial'); } }, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }
  let deniedStatus;
  requireManager({ auth: { role: 'viewer' } }, { status(code) { deniedStatus = code; return { json() {} }; } }, () => {
    throw new Error('Viewer must not create operational data');
  });
  assert.equal(deniedStatus, 403);
});

test('RBAC reserves destructive and administrative operations for Admin', () => {
  for (const role of ['hr_manager', 'viewer']) {
    let deniedStatus;
    requireAdmin({ auth: { role } }, { status(code) { deniedStatus = code; return { json() {} }; } }, () => {
      throw new Error(`${role} must not perform admin mutations`);
    });
    assert.equal(deniedStatus, 403);
  }
  let nextCalled = false;
  requireAdmin({ auth: { role: 'admin' } }, { status() { throw new Error('Unexpected denial'); } }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('eligibility requires a current valid document for every requirement', () => {
  const worker = { required_document_types: ['mcu', 'pkwt'] };
  const documents = [
    { id: 1, type: 'mcu', status: 'valid', valid_from: '2026-01-01', valid_until: '2026-12-31' },
    { id: 2, type: 'pkwt', status: 'valid', valid_from: '2026-01-01', valid_until: '2026-10-22' },
  ];

  const result = evaluateEligibility(worker, documents, '2026-10-23');

  assert.equal(result.eligible, false);
  assert.deepEqual(result.checks.map(({ valid }) => valid), [true, false]);
});

test('eligibility accepts current documents and stringified MySQL JSON', () => {
  const worker = { required_document_types: '["mcu","sim"]' };
  const documents = [
    { id: 4, type: 'mcu', status: 'valid', valid_from: null, valid_until: '2027-01-01' },
    { id: 5, type: 'sim', status: 'valid', valid_from: '2026-10-23', valid_until: '2027-10-22' },
  ];

  assert.equal(evaluateEligibility(worker, documents, '2026-10-23').eligible, true);
  assert.deepEqual(parseRequiredDocuments(worker.required_document_types), ['mcu', 'sim']);
});

test('eligibility rejects documents that have not started or are expired', () => {
  const worker = { required_document_types: ['certification'] };
  const futureDocument = [{ type: 'certification', status: 'valid', valid_from: '2026-10-24', valid_until: null }];

  assert.equal(evaluateEligibility(worker, futureDocument, '2026-10-23').eligible, false);
});

test('MCU, PKWT, and SIM require an expiry date before they qualify', () => {
  const worker = { required_document_types: ['mcu'] };
  const document = [{ type: 'mcu', status: 'valid', valid_from: '2026-01-01', valid_until: null }];

  assert.equal(evaluateEligibility(worker, document, '2026-10-23').eligible, false);
});

test('custom document types can qualify without expiry dates by default', () => {
  const worker = { required_document_types: ['safety-induction'] };
  const documents = [{ id: 9, type: 'safety-induction', status: 'valid', valid_from: '2026-01-01', valid_until: null }];

  assert.equal(evaluateEligibility(worker, documents, '2026-10-23').eligible, true);
});

test('the latest record for a required document type is authoritative', () => {
  const worker = { required_document_types: ['mcu'] };
  const documents = [
    { id: 2, type: 'mcu', status: 'pending', valid_until: '2027-01-01' },
    { id: 1, type: 'mcu', status: 'valid', valid_until: '2027-01-01' },
  ];

  assert.equal(evaluateEligibility(worker, documents, '2026-10-23').eligible, false);
});

test('date and required-document input validation rejects invalid values', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
  assert.equal(validDate(null), true);
  assert.equal(validRequiredDocuments(['mcu', 'pkwt']), true);
  assert.equal(validRequiredDocuments(['mcu', 'skck', 'payroll']), true);
  assert.equal(validRequiredDocuments(['mcu', 'safety-orientation']), true);
  assert.equal(validRequiredDocuments(['invalid type']), false);
  assert.equal(validRequiredDocuments(['mcu', 'mcu']), false);
  assert.equal(validRequiredDocuments([]), true);
});

test('leave requests require a supported type, real ordered dates, and a concise reason', () => {
  const validRequest = {
    type: 'cuti',
    start_date: '2026-10-29',
    end_date: '2026-10-31',
    reason: 'Keperluan keluarga',
  };
  assert.equal(validLeaveRequestInput(validRequest), true);
  assert.equal(validLeaveRequestInput(null), false);
  assert.equal(validLeaveRequestInput({ ...validRequest, type: 'dinas' }), false);
  assert.equal(validLeaveRequestInput({ ...validRequest, start_date: '2026-02-30' }), false);
  assert.equal(validLeaveRequestInput({ ...validRequest, start_date: '2026-11-01' }), false);
  assert.equal(validLeaveRequestInput({ ...validRequest, reason: 'izin' }), false);
  assert.equal(validLeaveRequestInput({ ...validRequest, reason: 'x'.repeat(1001) }), false);
  assert.equal(validLeaveRequestStatus('approved'), true);
  assert.equal(validLeaveRequestStatus('rejected'), true);
  assert.equal(validLeaveRequestStatus('pending'), false);
  assert.equal(leaveRequestBlocksDate('pending'), true);
  assert.equal(leaveRequestBlocksDate('approved'), true);
  assert.equal(leaveRequestBlocksDate('rejected'), false);
  assert.equal(validLeaveRejectionNote('Alasan cukup'), true);
  assert.equal(validLeaveRejectionNote('abc'), false);
  assert.equal(validLeaveRejectionNote('  '), false);
  assert.equal(validLeaveRejectionNote('x'.repeat(1001)), false);
  assert.deepEqual(leaveRequestDates('2026-10-29', '2026-10-31'), ['2026-10-29', '2026-10-30', '2026-10-31']);
  assert.equal(leaveRequestDates('2026-01-01', '2027-01-02'), null);
  assert.equal(leaveAttendanceStatus('izin'), 'permission');
  assert.equal(leaveAttendanceStatus('cuti'), 'leave');
  assert.equal(leaveAttendanceStatus('sakit'), 'sick');
  assert.equal(leaveAttendanceStatus('off'), 'off');
  const approvalDays = ['2026-10-29', '2026-10-30'];
  assert.equal(findLeaveAttendanceConflictDate(approvalDays, [], 'leave'), null);
  assert.equal(findLeaveAttendanceConflictDate(approvalDays, [
    {
      attendance_date: '2026-10-30',
      status: 'leave',
      attendance_type: 'leave',
      approval_status: 'approved',
      check_in_time: null,
      check_out_time: null,
    },
  ], 'leave'), null);
  assert.equal(findLeaveAttendanceConflictDate(approvalDays, [
    {
      attendance_date: '2026-10-30',
      status: 'present',
      attendance_type: 'regular',
      approval_status: 'not_required',
      check_in_time: '2026-10-30 09:00:00',
      check_out_time: null,
    },
  ], 'leave'), '2026-10-30');
});

test('document dates are normalized by selected status', () => {
  assert.deepEqual(
    documentDateFields('pending', { target_completion_date: '2026-11-15', valid_from: 'invalid', valid_until: 'invalid' }),
    { valid_from: null, valid_until: null, target_completion_date: '2026-11-15' }
  );
  assert.deepEqual(
    documentDateFields('pending', { target_completion_date: '', valid_from: null, valid_until: null }),
    { valid_from: null, valid_until: null, target_completion_date: null }
  );
  assert.equal(documentDateFields('pending', { target_completion_date: '2026-02-30' }), null);
  assert.deepEqual(
    documentDateFields('rejected', { target_completion_date: 'invalid', valid_from: 'invalid', valid_until: 'invalid' }),
    { valid_from: null, valid_until: null, target_completion_date: null }
  );
  assert.deepEqual(
    documentDateFields('valid', { valid_from: '2026-10-01', valid_until: '2027-10-01', target_completion_date: 'invalid' }),
    { valid_from: '2026-10-01', valid_until: '2027-10-01', target_completion_date: null }
  );
  assert.deepEqual(
    documentDateFields('expired', { valid_from: null, valid_until: '2026-01-01', target_completion_date: null }),
    { valid_from: null, valid_until: '2026-01-01', target_completion_date: null }
  );
  assert.equal(documentDateFields('valid', { valid_from: '2027-01-01', valid_until: '2026-01-01' }), null);
});

test('contact and salary validation accepts supported worker details', () => {
  assert.equal(validPhoneNumber('+62 812-3456-7890'), true);
  assert.equal(validPhoneNumber('12'), false);
  assert.equal(validNationalId('3201234567890001'), true);
  assert.equal(validNationalId('123'), false);
  assert.equal(validNationalId(null), true);
  assert.equal(validSalaryRate('12500000.50'), true);
  assert.equal(validSalaryRate('12.345'), false);
  assert.equal(validSalaryRate(''), true);
});

test('department values allow new names while rejecting empty or oversized values', () => {
  assert.equal(validDepartment('HR & People'), true);
  assert.equal(validDepartment('  Operasional   Lapangan  '), true);
  assert.equal(validDepartment('  '), false);
  assert.equal(validDepartment('x'.repeat(151)), false);
});

test('worker text normalization trims, collapses spaces, and stores lowercase', () => {
  assert.equal(normalizeText('  Jakarta   Pusat  '), 'jakarta pusat');
  assert.equal(normalizeText('JAKARTA PUSAT'), 'jakarta pusat');
  assert.equal(normalizeText('  Layanan-Teknis   & OPERASI '), 'layanan-teknis & operasi');
  assert.equal(normalizeText(''), '');
});

test('document type names normalize spacing and casing', () => {
  assert.equal(normalizeDocumentTypeName('  sertifikat   K3  '), 'sertifikat k3');
  assert.equal(normalizeDocumentTypeName('DOKUMEN wajib'), 'dokumen wajib');
});

test('document type codes are stable clean slugs and avoid collisions', () => {
  assert.equal(documentTypeCode('SERTIFIKAT K3'), 'sertifikat_k3');
  assert.equal(documentTypeCode('Kartu Izin / Area'), 'kartu_izin_area');
  assert.equal(documentTypeCode('Sertifikat K3', ['sertifikat_k3']), 'sertifikat_k3_2');
  assert.equal(documentTypeCode('Sertifikat K3', ['sertifikat_k3', 'sertifikat_k3_2']), 'sertifikat_k3_3');
  assert.match(documentTypeCode('Sertifikat Keselamatan dan Kesehatan Kerja'), /^[a-z0-9][a-z0-9_]{0,63}$/);
});

test('normalized department values resolve to the same unique key', () => {
  assert.deepEqual(
    hashNormalizedText('jakarta pusat'),
    hashNormalizedText('  JAKARTA   PUSAT ')
  );
});

test('status transitions follow the worker lifecycle and allow reactivation only from inactive', () => {
  assert.equal(canTransitionStatus('offered', 'preactive'), true);
  assert.equal(canTransitionStatus('offered', 'active'), false);
  assert.equal(canTransitionStatus('preactive', 'inactive'), true);
  assert.equal(canTransitionStatus('active', 'preactive'), false);
  assert.equal(canTransitionStatus('inactive', 'active'), true);
});

test('email hashes are normalized and use a fixed-size binary key', () => {
  const normalized = hashEmail('HR@example.com');

  assert.equal(normalized.length, 32);
  assert.deepEqual(normalized, hashEmail(' hr@EXAMPLE.com '));
  assert.notDeepEqual(normalized, hashEmail('other@example.com'));
});

test('password reset tokens are stored as fixed-size one-way hashes', () => {
  const tokenHash = hashPasswordResetToken('random-reset-token');

  assert.equal(tokenHash.length, 32);
  assert.deepEqual(tokenHash, hashPasswordResetToken('random-reset-token'));
  assert.notDeepEqual(tokenHash, hashPasswordResetToken('different-reset-token'));
});

test('public auth endpoints have a bounded per-address request window', () => {
  const address = `test-${Date.now()}-${Math.random()}`;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(takeAuthRateLimit(address, 1000), true);
  }
  assert.equal(takeAuthRateLimit(address, 1000), false);
  assert.equal(takeAuthRateLimit(address, 1000 + 15 * 60 * 1000), true);
});

test('account passwords follow the minimum length and bcrypt byte limits', () => {
  assert.equal(validPassword('correct-horse-battery'), true);
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword('é'.repeat(36)), true);
  assert.equal(validPassword('é'.repeat(37)), false);
  assert.equal(validPassword(null), false);
});

test('profile photo uploads are recognized only from JPEG and PNG signatures', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

  assert.equal(profilePhotoMimeType(png), 'image/png');
  assert.equal(profilePhotoMimeType(jpeg), 'image/jpeg');
  assert.equal(profilePhotoMimeType(Buffer.from('not an image')), null);
  assert.equal(profilePhotoMimeType(null), null);
});

test('leave attachment uploads are signature-checked and stored under private random keys', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(leaveAttachmentMimeType(png), 'image/png');
  assert.equal(leaveAttachmentMimeType(jpeg), 'image/jpeg');
  assert.equal(leaveAttachmentMimeType(Buffer.from('not an image')), null);
  assert.equal(safeLeaveAttachmentName('../../surat izin!!.png'), 'surat_izin_.png');
  assert.match(leaveAttachmentStoragePath('leave-attachments/123e4567-e89b-12d3-a456-426614174000.jpg'), /storage[\\/]leave-attachments[\\/]123e4567-e89b-12d3-a456-426614174000\.jpg$/);
  assert.equal(leaveAttachmentStoragePath('leave-attachments/../../app.js'), null);
});

test('profile photo storage stays below legacy MariaDB packet limits', () => {
  assert.equal(MAX_PROFILE_PHOTO_BYTES, 900 * 1024);
  assert.ok(MAX_PROFILE_PHOTO_BYTES < 1024 * 1024);
});

test('worker portal sessions use UUIDv4 tokens and enrollment codes are stored as hashes', () => {
  const sessionToken = '123e4567-e89b-42d3-a456-426614174000';
  const code = 'A1B2C3D4E5F60718';
  assert.equal(validAttendanceToken(sessionToken), true);
  assert.equal(validAttendanceToken('123e4567-e89b-12d3-a456-426614174000'), false);
  assert.equal(validAttendanceToken('not-a-token'), false);
  assert.equal(hashAttendanceToken(sessionToken).length, 32);
  assert.equal(hashAttendanceToken('invalid'), null);
  assert.equal(validPortalEnrollmentCode(code), true);
  assert.equal(validPortalEnrollmentCode('a1b2c3d4e5f60718'), false);
  assert.equal(validPortalEnrollmentCode('A1B2C3'), false);
  assert.equal(hashPortalEnrollmentCode(code).length, 32);
  assert.equal(hashPortalEnrollmentCode('invalid'), null);
});

test('attendance validates worker IDs and geolocation coordinates', () => {
  assert.equal(validWorkerId('1'), true);
  assert.equal(validWorkerId('18446744073709551615'), true);
  assert.equal(validWorkerId('0'), false);
  assert.equal(validWorkerId('01'), false);
  assert.equal(validWorkerId('18446744073709551616'), false);
  assert.equal(validWorkerId(['1']), false);
  assert.equal(validCoordinates(-90, 180), true);
  assert.equal(validCoordinates(90.01, 0), false);
  assert.equal(validCoordinates(0, -180.01), false);
  assert.equal(validCoordinates('40.7', -73), false);
  assert.equal(validCoordinates(Number.NaN, 0), false);
});

test('worker numbers accept the documented format and normalize surrounding whitespace', () => {
  for (const value of ['EMP-001', 'staff_02', 'A/2026.1', '9']) {
    assert.equal(validWorkerNumber(value), true);
    assert.equal(normalizeWorkerNumber(value), value);
  }
  assert.equal(validWorkerNumber(' EMP-001 '), true);
  assert.equal(normalizeWorkerNumber(' EMP-001 '), 'EMP-001');
  assert.equal(validWorkerNumber(''), false);
  assert.equal(validWorkerNumber('-EMP-001'), false);
  assert.equal(validWorkerNumber('EMP 001'), false);
  assert.equal(validWorkerNumber('A'.repeat(51)), false);
  assert.equal(validWorkerNumber(1001), false);
});

test('anti-mock movement heuristic rejects physically implausible location jumps', () => {
  assert.equal(implausibleLocationMovement(36000, 60), true);
  assert.equal(implausibleLocationMovement(1000, 60), false);
  assert.equal(implausibleLocationMovement(36000, 0), false);
  assert.equal(implausibleLocationMovement(36000, 25 * 60 * 60), false);
});

test('monthly attendance range validates year-month and handles leap years', () => {
  assert.deepEqual(attendanceMonthRange('2024-02'), {
    month: '2024-02',
    start: '2024-02-01',
    end: '2024-03-01',
    days: 29,
  });

  test('document warning threshold accepts only whole days from 1 through 365', () => {
    assert.equal(validDocumentWarningThreshold(1), true);
    assert.equal(validDocumentWarningThreshold(365), true);
    assert.equal(validDocumentWarningThreshold(0), false);
    assert.equal(validDocumentWarningThreshold(366), false);
    assert.equal(validDocumentWarningThreshold(30.5), false);
    assert.equal(validDocumentWarningThreshold('30'), false);
  });
  assert.equal(attendanceMonthRange('2025-02').days, 28);
  assert.equal(attendanceMonthRange('2026-13'), null);
  assert.equal(attendanceMonthRange('2026-2'), null);
  assert.equal(attendanceMonthRange('2026-02-01'), null);
  assert.equal(attendanceMonthRange('0000-01'), null);
  assert.equal(attendanceMonthRange('9999-12'), null);
});

test('geofence distance and attendance location rules validate allowed activities and radius', () => {
  assert.equal(distanceInMeters(-6.2, 106.8, -6.2, 106.8), 0);
  assert.ok(distanceInMeters(-6.2, 106.8, -6.2, 106.801) > 100);
  assert.deepEqual(parseAllowedActivities(['check_in', 'leave']), ['check_in', 'leave']);
  assert.deepEqual(parseAllowedActivities([]), []);
  assert.equal(parseAllowedActivities(['check_in', 'unknown']), null);
  assert.equal(parseAllowedActivities(['check_in', 'check_in']), null);
  assert.equal(validAttendanceLocationInput({
    name: 'Kantor Pusat',
    latitude: -6.2,
    longitude: 106.8,
    radius_meters: 150,
    allowed_activities: ['check_in', 'check_out', 'permission'],
  }), true);
  assert.equal(validAttendanceLocationInput({
    name: 'Invalid radius',
    latitude: -6.2,
    longitude: 106.8,
    radius_meters: 10,
    allowed_activities: ['check_in'],
  }), false);
  assert.equal(validAttendanceLocationInput({
    name: 'Area tanpa aktivitas wajib',
    latitude: -6.2,
    longitude: 106.8,
    radius_meters: 150,
    allowed_activities: [],
  }), true);
  const locations = [
    {
      latitude: -6.2,
      longitude: 106.8,
      radius_meters: 150,
      allowed_activities: ['check_in'],
    },
  ];
  assert.deepEqual(matchRequiredAttendanceLocation(-6.2, 106.8, locations, 'check_in'), {
    isRequired: true,
    location: locations[0],
  });
  assert.deepEqual(matchRequiredAttendanceLocation(-6.3, 106.8, locations, 'check_in'), {
    isRequired: true,
    location: null,
  });
  assert.deepEqual(matchRequiredAttendanceLocation(-6.3, 106.8, locations, 'check_out'), {
    isRequired: false,
    location: null,
  });
});

test('profile photo URLs allow safe HTTP(S) URLs only', () => {
  assert.equal(validProfilePhotoUrl(null), true);
  assert.equal(validProfilePhotoUrl(''), true);
  assert.equal(validProfilePhotoUrl('https://example.com/avatar.png'), true);
  assert.equal(validProfilePhotoUrl('http://example.com/avatar.png'), true);
  assert.equal(validProfilePhotoUrl('javascript:alert(1)'), false);
  assert.equal(validProfilePhotoUrl('https://user:pass@example.com/avatar.png'), false);
  assert.equal(validProfilePhotoUrl(`https://example.com/${'a'.repeat(2048)}`), false);
});
