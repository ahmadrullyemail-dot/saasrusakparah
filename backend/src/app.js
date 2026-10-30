require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const { pool, initializeDatabase } = require('./db');

const app = express();
let realtimeServer;
const PORT = Number(process.env.PORT || 4000);
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(TRUST_PROXY_HOPS) || TRUST_PROXY_HOPS < 0 || TRUST_PROXY_HOPS > 10) {
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
}
app.set('trust proxy', TRUST_PROXY_HOPS);
const COOKIE_NAME = 'hrd_session';
const MAX_PROFILE_PHOTO_BYTES = 900 * 1024;
const MAX_LEAVE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const LEAVE_ATTACHMENT_DIRECTORY = path.resolve(__dirname, '../storage/leave-attachments');
const MAX_DOCUMENT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DOCUMENT_ATTACHMENT_DIRECTORY = path.resolve(__dirname, '../storage/document-attachments');
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 10;
const authRateLimits = new Map();
const WORKER_STATUSES = new Set(['offered', 'preactive', 'active', 'inactive']);
const DOCUMENT_STATUSES = new Set(['pending', 'valid', 'expired', 'rejected']);
const CONTRACT_TYPES = new Set(['pkwt', 'pkwtt', 'freelance', 'daily_worker']);
const ALLOWED_TRANSITIONS = {
  offered: ['preactive', 'inactive'],
  preactive: ['active', 'inactive'],
  active: ['inactive'],
  inactive: ['active'],
};

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 },
});
const attendanceEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 },
});
const leaveAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LEAVE_ATTACHMENT_BYTES, files: 1 },
});
const documentAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_ATTACHMENT_BYTES, files: 1 },
});
const ATTENDANCE_ACTIVITIES = new Set(['check_in', 'check_out', 'off', 'permission', 'leave', 'sick']);
const EMPLOYEE_REQUEST_TYPES = new Set(['off', 'permission', 'leave', 'sick']);
const LEAVE_REQUEST_TYPES = new Set(['izin', 'cuti', 'sakit', 'off']);
const BLOCKING_LEAVE_REQUEST_STATUSES = ['pending', 'approved'];

function profilePhotoUrl(user) {
  if (user.profile_photo_updated_at) return '/api/profile/photo';
  return user.profile_photo_url || null;
}

function profilePhotoMimeType(file) {
  if (!Buffer.isBuffer(file)) return null;
  if (file.length >= 8 && file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function leaveAttachmentMimeType(file) {
  if (!Buffer.isBuffer(file)) return null;
  if (file.length >= 8 && file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function documentAttachmentMimeType(file) {
  if (!Buffer.isBuffer(file)) return null;
  const imageMimeType = leaveAttachmentMimeType(file);
  if (imageMimeType) return imageMimeType;
  if (file.length >= 5 && file.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  return null;
}

function safeLeaveAttachmentName(value) {
  const basename = path.basename(String(value || 'lampiran'))
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 255);
  return basename || 'lampiran';
}

function leaveAttachmentStoragePath(storageKey) {
  if (typeof storageKey !== 'string' || !/^leave-attachments\/[0-9a-f-]{36}\.(jpg|png)$/.test(storageKey)) {
    return null;
  }
  const filePath = path.resolve(__dirname, '../storage', storageKey);
  return filePath.startsWith(`${LEAVE_ATTACHMENT_DIRECTORY}${path.sep}`) ? filePath : null;
}

function documentAttachmentStoragePath(storageKey) {
  if (typeof storageKey !== 'string' || !/^document-attachments\/[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(storageKey)) {
    return null;
  }
  const filePath = path.resolve(__dirname, '../storage', storageKey);
  return filePath.startsWith(`${DOCUMENT_ATTACHMENT_DIRECTORY}${path.sep}`) ? filePath : null;
}

function distanceInMeters(latitude1, longitude1, latitude2, longitude2) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function parseAllowedActivities(value) {
  if (!Array.isArray(value)
    || value.some((activity) => !ATTENDANCE_ACTIVITIES.has(activity))
    || new Set(value).size !== value.length) return null;
  return value;
}

function matchRequiredAttendanceLocation(latitude, longitude, locations, activity) {
  const requiredLocations = locations.filter((location) => {
    const activities = Array.isArray(location.allowed_activities)
      ? location.allowed_activities
      : JSON.parse(location.allowed_activities);
    return activities.includes(activity);
  });
  if (!requiredLocations.length) return { isRequired: false, location: null };
  const location = requiredLocations.find((candidate) => distanceInMeters(
    latitude,
    longitude,
    Number(candidate.latitude),
    Number(candidate.longitude)
  ) <= Number(candidate.radius_meters));
  return { isRequired: true, location: location || null };
}

function validAttendanceLocationInput(input) {
  return typeof input.name === 'string' && input.name.trim().length > 0 && input.name.trim().length <= 100
    && typeof input.latitude === 'number' && Number.isFinite(input.latitude)
    && typeof input.longitude === 'number' && Number.isFinite(input.longitude)
    && validCoordinates(input.latitude, input.longitude)
    && Number.isInteger(input.radius_meters) && input.radius_meters >= 25 && input.radius_meters <= 5000
    && Boolean(parseAllowedActivities(input.allowed_activities));
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random value with at least 32 characters');
  }
  return secret;
}

function createSessionCookie(res, user) {
  const token = jwt.sign(
    { sub: String(user.id), tenantId: String(user.tenant_id), sessionVersion: user.token_version || 0 },
    getJwtSecret(),
    { expiresIn: '8h', issuer: 'hrd-management' }
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function recordAudit(req, { action, entityType, entityId = null, description }, connection = pool) {
  await connection.execute(
    `INSERT INTO audit_events
       (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.auth.tenantId,
      req.auth.userId,
      req.auth.fullName || req.auth.email,
      req.auth.role,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      String(description).slice(0, 1000),
    ]
  );
}

async function getTenantSubscription(connection, tenantId, lock = false) {
  const [tenantRows] = await connection.execute(
    `SELECT subscription_plan FROM tenants WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [tenantId]
  );
  if (!tenantRows.length) throw new Error('Tenant subscription record not found');
  const [workerRows] = await connection.execute(
    `SELECT COUNT(*) AS active_workers
       FROM workers
      WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [tenantId]
  );
  const plan = tenantRows[0].subscription_plan;
  return {
    plan,
    active_workers: Number(workerRows[0].active_workers),
    worker_limit: plan === 'free' ? 20 : null,
  };
}

function workerQuotaExceeded(res, subscription) {
  return res.status(409).json({
    error: `Paket Free dibatasi maksimal ${subscription.worker_limit} pekerja aktif. Kuota saat ini ${subscription.active_workers}/${subscription.worker_limit}.`,
    code: 'WORKER_QUOTA_EXCEEDED',
    plan: subscription.plan,
    active_workers: subscription.active_workers,
    worker_limit: subscription.worker_limit,
  });
}

function exceedsWorkerQuota(subscription) {
  return subscription.worker_limit != null && subscription.active_workers >= subscription.worker_limit;
}

function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, getJwtSecret(), { issuer: 'hrd-management' });
    return pool.execute(
      `SELECT id, tenant_id, full_name, email, role, profile_photo_url,
              profile_photo_updated_at, is_active, token_version
         FROM users WHERE id = ? AND tenant_id = ?`,
      [String(payload.sub), String(payload.tenantId)]
    ).then(([rows]) => {
      const user = rows[0];
      if (!user || !user.is_active || Number(user.token_version) !== Number(payload.sessionVersion)) {
        res.clearCookie(COOKIE_NAME, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });
        return res.status(401).json({ error: 'Session is invalid or account is inactive' });
      }
      req.auth = {
        userId: String(user.id),
        tenantId: String(user.tenant_id),
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        profilePhotoUrl: profilePhotoUrl(user),
        tokenVersion: Number(user.token_version),
      };
      next();
    }).catch(next);
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Session is invalid or expired' });
    }
    next(error);
  }
}

function requireManager(req, res, next) {
  if (!['admin', 'hr_manager'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'Manager permission required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.auth.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator permission required' });
  }
  next();
}

function validPassword(value) {
  return typeof value === 'string'
    && value.length >= 12
    && Buffer.byteLength(value, 'utf8') <= 72;
}

function validProfilePhotoUrl(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validDate(value) {
  return value == null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
}

function validLeaveRequestInput(input) {
  if (!input || typeof input !== 'object') return false;
  const { type, start_date: startDate, end_date: endDate, reason } = input;
  return LEAVE_REQUEST_TYPES.has(type)
    && typeof startDate === 'string' && validDate(startDate)
    && typeof endDate === 'string' && validDate(endDate)
    && startDate <= endDate
    && leaveRequestDates(startDate, endDate) !== null
    && typeof reason === 'string'
    && reason.trim().length >= 5
    && reason.trim().length <= 1000;
}

function validLeaveRequestStatus(value) {
  return value === 'approved' || value === 'rejected';
}

function leaveRequestBlocksDate(status) {
  return BLOCKING_LEAVE_REQUEST_STATUSES.includes(status);
}

function validLeaveRejectionNote(value) {
  return typeof value === 'string' && value.trim().length >= 5 && value.trim().length <= 1000;
}

function leaveAttendanceStatus(type) {
  return { izin: 'permission', cuti: 'leave', sakit: 'sick', off: 'off' }[type] || null;
}

function leaveRequestDates(startDate, endDate) {
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00Z`);
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 366) return null;
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000);
    return date.toISOString().slice(0, 10);
  });
}

function findLeaveAttendanceConflictDate(requestDates, attendanceRows, intendedStatus) {
  const attendanceByDate = new Map(
    attendanceRows.map((row) => [String(row.attendance_date).slice(0, 10), row])
  );
  return requestDates.find((date) => {
    const existing = attendanceByDate.get(date);
    return existing && (
      existing.check_in_time
      || existing.check_out_time
      || existing.approval_status === 'pending'
      || existing.status !== intendedStatus
      || existing.attendance_type !== intendedStatus
    );
  }) || null;
}

function validDocumentWarningThreshold(value) {
  return Number.isInteger(value) && value >= 1 && value <= 365;
}

function attendanceMonthRange(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  if (year < 1000 || (year === 9999 && month === 12)) return null;
  const start = `${value}-01`;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const end = `${nextMonth.toISOString().slice(0, 10)}`;
  return {
    month: value,
    start,
    end,
    days: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

function validWorkerId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) return false;
  return BigInt(value) <= 18446744073709551615n;
}

function implausibleLocationMovement(distanceMeters, elapsedSeconds) {
  return Number.isFinite(distanceMeters) && Number.isFinite(elapsedSeconds)
    && elapsedSeconds > 0 && elapsedSeconds <= 24 * 60 * 60
    && distanceMeters / elapsedSeconds > 300;
}

function validCoordinates(latitude, longitude) {
  return typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function validPhoneNumber(value) {
  return typeof value === 'string' && /^\+?[\d\s().-]{8,30}$/.test(value.trim());
}

function validWorkerNumber(value) {
  return typeof value === 'string'
    && value.trim().length >= 1
    && value.trim().length <= 50
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.trim());
}

function validUuidLockEnabled(value) {
  return typeof value === 'boolean';
}

function shouldRejectPortalUuidMismatch(uuidLockEnabled, activeSessionCount, matchingSession) {
  return Boolean(uuidLockEnabled) && activeSessionCount > 0 && !matchingSession;
}

function normalizeWorkerNumber(value) {
  return value.trim();
}

function validNationalId(value) {
  return value == null || value === '' || (typeof value === 'string' && /^\d{16}$/.test(value));
}

function validDepartment(value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= 150;
}

function normalizeText(value) {
  if (typeof value !== 'string') return value;
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
}

function normalizeDocumentTypeName(value) {
  return normalizeText(value);
}

function validSalaryRate(value) {
  return value == null || value === ''
    || (typeof value === 'string' && /^\d{1,13}(\.\d{1,2})?$/.test(value));
}

function validRequiredDocuments(value) {
  return Array.isArray(value)
    && value.every((type) => typeof type === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(type))
    && new Set(value).size === value.length;
}

function documentTypeCode(name, existingCodes = []) {
  const base = normalizeText(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-/g, '_')
    .slice(0, 64) || 'document';
  const existing = new Set(existingCodes);
  if (!existing.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const numbered = `${base.slice(0, 64 - String(suffix).length - 1)}_${suffix}`;
    if (!existing.has(numbered)) return numbered;
  }
}

function parseRequiredDocuments(value) {
  return Array.isArray(value) ? value : JSON.parse(value);
}

function canTransitionStatus(previousStatus, nextStatus) {
  return ALLOWED_TRANSITIONS[previousStatus]?.includes(nextStatus) || false;
}

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest();
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function takeAuthRateLimit(ipAddress, now = Date.now()) {
  if (authRateLimits.size > 10000) {
    for (const [key, entry] of authRateLimits) {
      if (entry.resetAt <= now) authRateLimits.delete(key);
    }
  }
  const current = authRateLimits.get(ipAddress);
  if (!current || current.resetAt <= now) {
    if (authRateLimits.size >= 10000) {
      for (const [key, entry] of authRateLimits) {
        if (entry.resetAt <= now) authRateLimits.delete(key);
      }
      while (authRateLimits.size >= 10000) {
        authRateLimits.delete(authRateLimits.keys().next().value);
      }
    }
    authRateLimits.set(ipAddress, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= AUTH_RATE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
}

function passwordResetMailer() {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  const frontendUrl = process.env.FRONTEND_URL;
  if (!host || !from || !frontendUrl) return null;
  const parsedFrontendUrl = new URL(frontendUrl);
  if (!['http:', 'https:'].includes(parsedFrontendUrl.protocol) || !parsedFrontendUrl.host) {
    throw new Error('FRONTEND_URL must be an absolute HTTP(S) URL');
  }
  if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  }
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }
  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      ...(process.env.SMTP_USER ? {
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' },
      } : {}),
    }),
    from,
    frontendUrl: parsedFrontendUrl.toString().replace(/\/+$/, ''),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function hashNormalizedText(value) {
  return crypto.createHash('sha256').update(normalizeText(value), 'utf8').digest();
}

function validAttendanceToken(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hashAttendanceToken(token) {
  if (!validAttendanceToken(token)) return null;
  return crypto.createHash('sha256').update(token.toLowerCase(), 'utf8').digest();
}

function findMatchingPortalSession(sessions, clientUuid) {
  const suppliedHash = hashAttendanceToken(clientUuid);
  if (!suppliedHash) return null;
  return sessions.find((session) =>
    Buffer.isBuffer(session.token_hash)
    && session.token_hash.length === suppliedHash.length
    && crypto.timingSafeEqual(session.token_hash, suppliedHash)) || null;
}

function hashCompanyPortalToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return crypto.createHash('sha256').update(token, 'ascii').digest();
}

function companyPortalTokenEncryptionKey() {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    getJwtSecret(),
    Buffer.from('saasrusakparah-company-portal-token'),
    Buffer.from('aes-256-gcm'),
    32
  ));
}

function encryptCompanyPortalToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', companyPortalTokenEncryptionKey(), iv);
  cipher.setAAD(Buffer.from('company-portal-token:v1'));
  const ciphertext = Buffer.concat([cipher.update(token, 'ascii'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decryptCompanyPortalToken(encryptedToken) {
  if (!Buffer.isBuffer(encryptedToken) || encryptedToken.length < 29) {
    throw new Error('Stored company portal token ciphertext is invalid');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    companyPortalTokenEncryptionKey(),
    encryptedToken.subarray(0, 12)
  );
  decipher.setAAD(Buffer.from('company-portal-token:v1'));
  decipher.setAuthTag(encryptedToken.subarray(12, 28));
  const token = Buffer.concat([
    decipher.update(encryptedToken.subarray(28)),
    decipher.final(),
  ]).toString('ascii');
  if (!hashCompanyPortalToken(token)) {
    throw new Error('Decrypted company portal token is invalid');
  }
  return token;
}

async function findWorkerForAttendanceToken(workerId, token, connection = pool, lock = false) {
  if (!validWorkerId(workerId) || !validAttendanceToken(token)) return null;
  const [rows] = await connection.execute(
    `SELECT w.id AS worker_id, w.tenant_id, ps.id AS portal_session_id
       FROM workers w
       JOIN worker_portal_sessions ps ON ps.worker_id = w.id AND ps.tenant_id = w.tenant_id
      WHERE w.id = ? AND ps.token_hash = ? AND ps.revoked_at IS NULL
        AND w.status = 'active' AND w.deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [workerId, hashAttendanceToken(token)]
  );
  const worker = rows[0];
  if (!worker) return null;
  await connection.execute(
    'UPDATE worker_portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
    [worker.portal_session_id]
  );
  return { worker_id: String(worker.worker_id), tenant_id: String(worker.tenant_id) };
}

async function activeDocumentTypes(tenantId, connection = pool) {
  const [rows] = await connection.execute(
    'SELECT code FROM document_types WHERE tenant_id = ? AND is_active = 1',
    [tenantId]
  );
  return new Set(rows.map(({ code }) => code));
}

function redactWorkerForViewer(worker, role) {
  const { profile_photo_updated_at: profilePhotoUpdatedAt, ...workerData } = worker;
  const safeWorkerData = {
    ...workerData,
    has_profile_photo: Boolean(profilePhotoUpdatedAt),
  };
  if (role !== 'viewer') return safeWorkerData;
  const {
    phone_number,
    national_id,
    address,
    salary_rate,
    ...viewerData
  } = safeWorkerData;
  return viewerData;
}

async function getWorker(tenantId, workerId, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id, tenant_id, full_name, email, email_hash, position, worker_number, uuid_lock_enabled, phone_number,
            profile_photo_updated_at, national_id, address, department, placement_client,
            work_location, contract_type, offer_date, join_date, salary_rate, status,
            required_document_types, deleted_at, scheduled_inactive_date, created_at, updated_at
       FROM workers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [workerId, tenantId]
  );
  return rows[0] || null;
}

async function listWorkerDocuments(tenantId, workerId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id, worker_id, \`type\`, status, valid_from, valid_until, target_completion_date,
            renewed_from_document_id, superseded_by_document_id,
            attachment_storage_key IS NOT NULL AS has_attachment,
            attachment_original_name, renewal_note, created_at, updated_at
       FROM documents WHERE tenant_id = ? AND worker_id = ? AND deleted_at IS NULL ORDER BY id DESC`,
    [tenantId, workerId]
  );
  return rows.map((document) => ({
    ...document,
    id: String(document.id),
    worker_id: String(document.worker_id),
    renewed_from_document_id: document.renewed_from_document_id == null ? null : String(document.renewed_from_document_id),
    superseded_by_document_id: document.superseded_by_document_id == null ? null : String(document.superseded_by_document_id),
    has_attachment: Boolean(document.has_attachment),
    valid_from: document.valid_from ? String(document.valid_from).slice(0, 10) : null,
    valid_until: document.valid_until ? String(document.valid_until).slice(0, 10) : null,
    target_completion_date: document.target_completion_date ? String(document.target_completion_date).slice(0, 10) : null,
  }));
}

function redactDocumentForViewer(document, role) {
  if (role !== 'viewer') return document;
  const {
    attachment_original_name,
    renewal_note,
    has_attachment,
    ...viewerDocument
  } = document;
  return viewerDocument;
}

function documentDateFields(status, { valid_from, valid_until, target_completion_date }) {
  if (status === 'pending') {
    const targetDate = target_completion_date || null;
    if (!validDate(targetDate)) return null;
    return {
      valid_from: null,
      valid_until: null,
      target_completion_date: targetDate,
    };
  }
  if (status === 'rejected') {
    return { valid_from: null, valid_until: null, target_completion_date: null };
  }
  const validFrom = valid_from || null;
  const validUntil = valid_until || null;
  if (!validDate(validFrom) || !validDate(validUntil)
    || (validFrom && validUntil && validFrom > validUntil)) {
    return null;
  }
  return {
    valid_from: validFrom,
    valid_until: validUntil,
    target_completion_date: null,
  };
}

function documentRenewalFields(status, input, today) {
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (status === 'pending') {
    if (!validDate(input.target_completion_date) || !input.target_completion_date
      || input.target_completion_date < today || note.length > 500) return null;
    return {
      status,
      valid_from: null,
      valid_until: null,
      target_completion_date: input.target_completion_date,
      note: note || null,
    };
  }
  if (status === 'valid') {
    const validFrom = input.valid_from || null;
    const validUntil = input.valid_until || null;
    if (!validDate(validFrom) || !validDate(validUntil) || !validFrom || !validUntil
      || validFrom > validUntil || validUntil < today || note.length > 500) return null;
    return {
      status,
      valid_from: validFrom,
      valid_until: validUntil,
      target_completion_date: null,
      note: note || null,
    };
  }
  if (status === 'rejected') {
    if (note.length < 5 || note.length > 500) return null;
    return {
      status,
      valid_from: null,
      valid_until: null,
      target_completion_date: null,
      note,
    };
  }
  return null;
}

function evaluateEligibility(worker, documents, today = new Date().toISOString().slice(0, 10)) {
  const required = parseRequiredDocuments(worker.required_document_types);
  const checks = required.map((type) => {
    const requiresExpiry = ['mcu', 'pkwt', 'sim'].includes(type);
    const latest = documents.find((document) => document.type === type && !document.superseded_by_document_id);
    const current = latest
      && latest.status === 'valid'
      && (!requiresExpiry || latest.valid_until)
      && (!latest.valid_from || latest.valid_from <= today)
      && (!latest.valid_until || latest.valid_until >= today)
      ? latest
      : null;
    return { type, valid: Boolean(current), document_id: current?.id || null };
  });
  return {
    eligible: checks.every((check) => check.valid),
    required_documents: required,
    checks,
  };
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/public/portal/verify', asyncRoute(async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (!takeAuthRateLimit(`portal-verify:${req.ip || req.socket.remoteAddress || 'unknown'}`)) {
    return res.status(429).json({ error: 'Verifikasi terlalu sering dicoba. Coba lagi nanti.' });
  }
  const { company_token: companyToken, worker_number: workerNumber, client_uuid: clientUuidInput } = req.body || {};
  if (typeof companyToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(companyToken)
    || typeof workerNumber !== 'string' || !validWorkerNumber(workerNumber)
    || (clientUuidInput != null && typeof clientUuidInput !== 'string')
    || (typeof clientUuidInput === 'string' && clientUuidInput.length > 128)) {
    return res.status(400).json({ error: 'Masukkan nomor pekerja dan UUID perangkat yang valid.' });
  }
  const connection = await pool.getConnection();
  let responseData;
  try {
    await connection.beginTransaction();
    const [workers] = await connection.execute(
      `SELECT w.id AS worker_id, w.tenant_id, w.full_name, w.uuid_lock_enabled
         FROM tenant_attendance_settings settings
         JOIN workers w ON w.tenant_id = settings.tenant_id
        WHERE settings.company_portal_token_hash = ?
          AND LOWER(w.worker_number) = LOWER(?)
          AND w.status = 'active' AND w.deleted_at IS NULL
        LIMIT 2 FOR UPDATE`,
      [hashCompanyPortalToken(companyToken), workerNumber.trim()]
    );
    if (workers.length > 1) {
      await connection.rollback();
      return res.status(409).json({ error: 'Nomor pekerja duplikat pada pekerja aktif. Hubungi Admin atau HR Staff.' });
    }
    const worker = workers[0];
    if (!worker) {
      await connection.rollback();
      return res.status(404).json({ error: 'Nomor pekerja tidak ditemukan atau pekerja tidak aktif.' });
    }

    const [sessions] = await connection.execute(
      `SELECT id, token_hash FROM worker_portal_sessions
        WHERE tenant_id = ? AND worker_id = ? AND revoked_at IS NULL
        ORDER BY id DESC FOR UPDATE`,
      [worker.tenant_id, worker.worker_id]
    );
    const matchingSession = findMatchingPortalSession(sessions, clientUuidInput);

    if (shouldRejectPortalUuidMismatch(worker.uuid_lock_enabled, sessions.length, matchingSession)) {
      await connection.rollback();
      return res.status(409).json({
        error: 'UUID perangkat tidak cocok. Minta Admin atau HR Staff mereset UUID jika perangkat ini perlu didaftarkan ulang.',
        code: 'PORTAL_UUID_MISMATCH',
      });
    }

    if (matchingSession) {
      await connection.execute(
        'UPDATE worker_portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
        [matchingSession.id]
      );
      responseData = {
        worker_id: String(worker.worker_id),
        client_uuid: clientUuidInput.toLowerCase(),
        created: false,
      };
    } else {
      const newClientUuid = crypto.randomUUID();
      if (sessions.length) {
        await connection.execute(
          `UPDATE worker_portal_sessions SET revoked_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ? AND worker_id = ? AND revoked_at IS NULL`,
          [worker.tenant_id, worker.worker_id]
        );
      }
      await connection.execute(
        `INSERT INTO worker_portal_sessions (tenant_id, worker_id, token_hash, last_seen_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [worker.tenant_id, worker.worker_id, hashAttendanceToken(newClientUuid)]
      );
      await connection.execute(
        `INSERT INTO audit_events
           (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
         VALUES (?, NULL, ?, 'worker', 'create', 'worker_portal_session', ?, ?)`,
        [
          worker.tenant_id,
          worker.full_name,
          String(worker.worker_id),
          worker.uuid_lock_enabled
            ? 'UUID perangkat portal diterbitkan melalui verifikasi nomor pekerja.'
            : 'UUID perangkat portal diterbitkan atau diperbarui karena Kunci UUID dinonaktifkan.',
        ]
      );
      responseData = {
        worker_id: String(worker.worker_id),
        client_uuid: newClientUuid,
        created: true,
      };
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: responseData });
}));

app.post('/api/leaves', leaveAttachmentUpload.single('attachment'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { worker_id: workerId, token, type, start_date: startDate, end_date: endDate, reason } = req.body || {};
  if (!validWorkerId(workerId) || !validAttendanceToken(token)) {
    return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  }
  if (!validLeaveRequestInput({ type, start_date: startDate, end_date: endDate, reason })) {
    return res.status(400).json({
      error: 'Provide a valid request type, date range, and reason of 5 to 1000 characters',
    });
  }
  const attachmentMimeType = req.file ? leaveAttachmentMimeType(req.file.buffer) : null;
  if (req.file && !attachmentMimeType) {
    return res.status(400).json({ error: 'Attachment must be a valid JPG or PNG image' });
  }
  const worker = await findWorkerForAttendanceToken(workerId, token);
  if (!worker) return res.status(404).json({ error: 'Attendance link is invalid or inactive' });

  const connection = await pool.getConnection();
  let insertedId;
  let attachmentPath;
  let attachmentWritten = false;
  try {
    await connection.beginTransaction();
    const [workerRows] = await connection.execute(
      `SELECT full_name FROM workers
        WHERE id = ? AND tenant_id = ? AND status = 'active' AND deleted_at IS NULL
        FOR UPDATE`,
      [worker.worker_id, worker.tenant_id]
    );
    if (!workerRows[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
    }
    const [conflicts] = await connection.execute(
      `SELECT id FROM leave_requests
        WHERE tenant_id = ? AND worker_id = ? AND status IN (?, ?)
          AND start_date <= ? AND end_date >= ?
        LIMIT 1 FOR UPDATE`,
      [worker.tenant_id, worker.worker_id, ...BLOCKING_LEAVE_REQUEST_STATUSES, endDate, startDate]
    );
    if (conflicts.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'A pending or approved request already covers part of these dates' });
    }
    let attachmentStorageKey = null;
    let attachmentOriginalName = null;
    if (req.file) {
      const attachmentId = crypto.randomUUID();
      const extension = attachmentMimeType === 'image/png' ? 'png' : 'jpg';
      attachmentStorageKey = `leave-attachments/${attachmentId}.${extension}`;
      attachmentPath = leaveAttachmentStoragePath(attachmentStorageKey);
      if (!attachmentPath) throw new Error('Unable to create a safe leave attachment path');
      await fs.mkdir(LEAVE_ATTACHMENT_DIRECTORY, { recursive: true, mode: 0o700 });
      await fs.writeFile(attachmentPath, req.file.buffer, { flag: 'wx', mode: 0o600 });
      attachmentWritten = true;
      attachmentOriginalName = safeLeaveAttachmentName(req.file.originalname);
    }
    const [result] = await connection.execute(
      `INSERT INTO leave_requests
         (tenant_id, worker_id, \`type\`, start_date, end_date, reason,
          attachment_storage_key, attachment_original_name, attachment_mime_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        worker.tenant_id, worker.worker_id, type, startDate, endDate, reason.trim(),
        attachmentStorageKey, attachmentOriginalName, attachmentMimeType,
      ]
    );
    insertedId = String(result.insertId);
    await connection.execute(
      `INSERT INTO audit_events
         (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
       VALUES (?, NULL, ?, 'worker', 'create', 'leave_request', ?, ?)`,
      [
        worker.tenant_id,
        workerRows[0].full_name,
        insertedId,
        `Pengajuan ${type} untuk ${startDate} sampai ${endDate} dikirim.`,
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (attachmentWritten) await fs.unlink(attachmentPath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') console.error('Unable to remove uncommitted leave attachment', cleanupError);
    });
    throw error;
  } finally {
    connection.release();
  }
  publishTenantEvent(worker.tenant_id, 'leave_requests_updated', { action: 'create' });
  publishTenantEvent(worker.tenant_id, 'dashboard_updated', { action: 'create' });
  publishTenantEvent(worker.tenant_id, 'history_updated', { action: 'create' });
  res.status(201).json({
    data: {
      id: insertedId,
      worker_id: worker.worker_id,
      type,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
      status: 'pending',
      attachment_name: req.file ? safeLeaveAttachmentName(req.file.originalname) : null,
    },
  });
}));

app.get('/api/leaves', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { worker_id: workerId, token } = req.query;
  const monthRange = req.query.month == null ? null : attendanceMonthRange(req.query.month);
  if (req.query.month != null && !monthRange) {
    return res.status(400).json({ error: 'Provide a valid month in YYYY-MM format' });
  }
  const worker = await findWorkerForAttendanceToken(workerId, token);
  if (!worker) return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  const [rows] = await pool.execute(
    `SELECT id, worker_id, \`type\`,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            reason, status, rejection_note, created_at, reviewed_at
       FROM leave_requests
      WHERE tenant_id = ? AND worker_id = ?
        AND (? IS NULL OR (start_date < ? AND end_date >= ?))
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
    [
      worker.tenant_id,
      worker.worker_id,
      monthRange?.end || null,
      monthRange?.end || null,
      monthRange?.start || null,
    ]
  );
  res.json({
    data: rows.map((row) => ({ ...row, id: String(row.id), worker_id: String(row.worker_id) })),
  });
}));

app.get('/api/public/attendance', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { worker_id: workerId, token } = req.query;
  const month = req.query.month == null
    ? new Date().toISOString().slice(0, 7)
    : req.query.month;
  const monthRange = attendanceMonthRange(month);
  if (!monthRange) return res.status(400).json({ error: 'Provide a valid month in YYYY-MM format' });
  if (!validWorkerId(workerId) || !validAttendanceToken(token)) {
    return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  }
  const [rows] = await pool.execute(
    `SELECT w.id AS worker_id, w.tenant_id, w.full_name, w.position, w.phone_number,
            w.profile_photo_updated_at, t.name AS company_name,
            s.anti_mock_location_enabled,
            DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS attendance_date,
            a.id AS attendance_record_id, a.status, a.attendance_type, a.approval_status, a.approval_note,
            a.check_in_time, a.check_out_time, a.location_id,
            a.check_in_latitude, a.check_in_longitude,
            a.check_out_latitude, a.check_out_longitude,
            IF(a.evidence_data IS NULL, 0, 1) AS has_evidence
       FROM workers w
       JOIN tenant_attendance_settings s ON s.tenant_id = w.tenant_id
       JOIN worker_portal_sessions ps ON w.id = ps.worker_id AND w.tenant_id = ps.tenant_id
       JOIN tenants t ON t.id = ps.tenant_id
       LEFT JOIN attendance a ON a.tenant_id = ps.tenant_id AND a.worker_id = ps.worker_id
         AND a.attendance_date = CURDATE() AND a.deleted_at IS NULL
      WHERE w.id = ? AND ps.token_hash = ? AND ps.revoked_at IS NULL
        AND w.status = 'active' AND w.deleted_at IS NULL`,
    [workerId, hashAttendanceToken(token)]
  );
  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  }
  await pool.execute('UPDATE worker_portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?', [hashAttendanceToken(token)]);
  const [locationRows] = await pool.execute(
    `SELECT id, name, latitude, longitude, radius_meters, allowed_activities
       FROM tenant_attendance_locations
      WHERE tenant_id = ? ORDER BY name, id`,
    [row.tenant_id]
  );
  const locations = locationRows.map((location) => ({
    ...location,
    id: String(location.id),
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    radius_meters: Number(location.radius_meters),
    allowed_activities: JSON.parse(location.allowed_activities),
  }));
  const [historyRows] = await pool.execute(
    `SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
            check_in_time, check_out_time, status, attendance_type, approval_status,
            check_in_latitude, check_in_longitude,
            check_out_latitude, check_out_longitude
       FROM attendance
      WHERE tenant_id = ? AND worker_id = ? AND deleted_at IS NULL
        AND attendance_date >= ? AND attendance_date < ?
      ORDER BY attendance_date DESC`,
    [row.tenant_id, row.worker_id, monthRange.start, monthRange.end]
  );
  const { tenant_id, ...attendanceData } = row;
  const profilePhotoUrl = row.profile_photo_updated_at
    ? `/api/public/worker-profile/photo?worker_id=${encodeURIComponent(row.worker_id)}&token=${encodeURIComponent(token)}&v=${encodeURIComponent(row.profile_photo_updated_at)}`
    : null;
  res.json({
    data: {
      ...attendanceData,
      worker_id: String(attendanceData.worker_id),
      attendance_record_id: attendanceData.attendance_record_id == null ? null : String(attendanceData.attendance_record_id),
      has_attendance_record: attendanceData.attendance_record_id != null,
      location_id: attendanceData.location_id == null ? null : String(attendanceData.location_id),
      has_evidence: Boolean(attendanceData.has_evidence),
      anti_mock_location_enabled: Boolean(attendanceData.anti_mock_location_enabled),
      profile_photo_url: profilePhotoUrl,
      locations,
      recent_attendance: historyRows,
      recent_attendance_month: monthRange.month,
    },
  });
}));

app.delete('/api/public/attendance/today', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { worker_id: workerId, token } = req.body || {};
  if (!validWorkerId(workerId) || !validAttendanceToken(token)) {
    return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  }
  const connection = await pool.getConnection();
  let deletedRecord;
  let tenantId;
  try {
    await connection.beginTransaction();
    const [workers] = await connection.execute(
      `SELECT w.id AS worker_id, w.tenant_id, w.full_name, ps.id AS portal_session_id
         FROM workers w
         JOIN worker_portal_sessions ps ON ps.worker_id = w.id AND ps.tenant_id = w.tenant_id
        WHERE w.id = ? AND ps.token_hash = ? AND ps.revoked_at IS NULL
          AND w.status = 'active' AND w.deleted_at IS NULL
        FOR UPDATE`,
      [workerId, hashAttendanceToken(token)]
    );
    const worker = workers[0];
    if (!worker) {
      await connection.rollback();
      return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
    }
    await connection.execute(
      'UPDATE worker_portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
      [worker.portal_session_id]
    );
    tenantId = String(worker.tenant_id);
    const [records] = await connection.execute(
      `SELECT id, attendance_date, status, attendance_type
         FROM attendance
        WHERE tenant_id = ? AND worker_id = ? AND attendance_date = CURDATE() AND deleted_at IS NULL
        FOR UPDATE`,
      [worker.tenant_id, worker.worker_id]
    );
    const record = records[0];
    if (!record) {
      await connection.rollback();
      return res.status(404).json({ error: 'No attendance activity exists for today' });
    }
    deletedRecord = {
      id: String(record.id),
      status: record.status,
      attendance_type: record.attendance_type,
    };
    await connection.execute(
      `DELETE FROM attendance
        WHERE id = ? AND tenant_id = ? AND worker_id = ?
          AND attendance_date = CURDATE() AND deleted_at IS NULL`,
      [record.id, worker.tenant_id, worker.worker_id]
    );
    await connection.execute(
      `INSERT INTO audit_events
         (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
       VALUES (?, NULL, ?, 'worker', 'delete', 'attendance', ?, ?)`,
      [
        worker.tenant_id,
        worker.full_name,
        `${worker.worker_id}:${String(record.attendance_date).slice(0, 10)}`,
        `Pekerja menghapus aktivitas presensi hari ini (${record.attendance_type || record.status}).`,
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  publishTenantEvent(tenantId, 'attendance_updated', { action: 'worker_delete_today' });
  publishTenantEvent(tenantId, 'dashboard_updated', { action: 'worker_delete_today' });
  publishTenantEvent(tenantId, 'approval_updated', { action: 'worker_delete_today' });
  publishTenantEvent(tenantId, 'history_updated', { action: 'worker_delete_today' });
  res.json({ data: { deleted: true, ...deletedRecord } });
}));

app.get('/api/public/worker-profile/photo', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const worker = await findWorkerForAttendanceToken(req.query.worker_id, req.query.token);
  if (!worker) return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  const [rows] = await pool.execute(
    `SELECT profile_photo_data, profile_photo_mime_type
       FROM workers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [worker.worker_id, worker.tenant_id]
  );
  const profile = rows[0];
  if (!profile?.profile_photo_data || !['image/jpeg', 'image/png'].includes(profile.profile_photo_mime_type)) {
    return res.status(404).json({ error: 'Profile photo not found' });
  }
  res.set({
    'Content-Type': profile.profile_photo_mime_type,
    'Content-Length': profile.profile_photo_data.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(profile.profile_photo_data);
}));

app.patch('/api/public/worker-profile', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { worker_id: workerId, token, phone_number: phoneNumber } = req.body || {};
  const worker = await findWorkerForAttendanceToken(workerId, token);
  if (!worker) return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  if (typeof phoneNumber !== 'string'
    || (phoneNumber.trim() !== '' && !validPhoneNumber(phoneNumber))) {
    return res.status(400).json({ error: 'Provide a valid phone number or leave it empty to clear it' });
  }
  const normalizedPhone = phoneNumber.trim().replace(/\s+/g, ' ') || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT full_name FROM workers
        WHERE id = ? AND tenant_id = ? AND status = 'active' AND deleted_at IS NULL
        FOR UPDATE`,
      [worker.worker_id, worker.tenant_id]
    );
    if (!rows[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
    }
    await connection.execute(
      `UPDATE workers SET phone_number = ? WHERE id = ? AND tenant_id = ?`,
      [normalizedPhone, worker.worker_id, worker.tenant_id]
    );
    await connection.execute(
      `INSERT INTO audit_events
         (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
       VALUES (?, NULL, ?, 'worker', 'update', 'worker_profile', ?, 'Nomor telepon diperbarui melalui portal pekerja.')`,
      [worker.tenant_id, rows[0].full_name, worker.worker_id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  publishTenantEvent(worker.tenant_id, 'worker_changed', { action: 'profile_update' });
  publishTenantEvent(worker.tenant_id, 'dashboard_updated', { action: 'profile_update' });
  res.json({ data: { phone_number: normalizedPhone } });
}));

app.post('/api/public/worker-profile/photo', profilePhotoUpload.single('photo'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { worker_id: workerId, token } = req.body || {};
  const worker = await findWorkerForAttendanceToken(workerId, token);
  if (!worker) return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG or PNG profile photo' });
  const mimeType = profilePhotoMimeType(req.file.buffer);
  if (!mimeType) return res.status(400).json({ error: 'Profile photo must be a valid JPG or PNG image' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT full_name FROM workers
        WHERE id = ? AND tenant_id = ? AND status = 'active' AND deleted_at IS NULL
        FOR UPDATE`,
      [worker.worker_id, worker.tenant_id]
    );
    if (!rows[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
    }
    await connection.execute(
      `UPDATE workers
          SET profile_photo_data = ?, profile_photo_mime_type = ?, profile_photo_updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?`,
      [req.file.buffer, mimeType, worker.worker_id, worker.tenant_id]
    );
    await connection.execute(
      `INSERT INTO audit_events
         (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
       VALUES (?, NULL, ?, 'worker', 'update', 'worker_profile', ?, 'Foto profil diperbarui melalui portal pekerja.')`,
      [worker.tenant_id, rows[0].full_name, worker.worker_id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  publishTenantEvent(worker.tenant_id, 'worker_changed', { action: 'profile_photo_update' });
  const profilePhotoUrl = `/api/public/worker-profile/photo?worker_id=${encodeURIComponent(worker.worker_id)}&token=${encodeURIComponent(token)}&v=${Date.now()}`;
  res.json({ data: { profile_photo_url: profilePhotoUrl } });
}));

app.post('/api/public/attendance', attendanceEvidenceUpload.single('evidence'), asyncRoute(async (req, res) => {
  const {
    worker_id: workerId,
    token,
    action,
    latitude,
    longitude,
    is_mocked: isMockedInput,
    location_accuracy: accuracyInput,
    location_speed: speedInput,
    request_type: requestType,
  } = req.body || {};
  const parsedLatitude = typeof latitude === 'number' ? latitude : latitude == null || String(latitude).trim() === '' ? NaN : Number(latitude);
  const parsedLongitude = typeof longitude === 'number' ? longitude : longitude == null || String(longitude).trim() === '' ? NaN : Number(longitude);
  if (!validWorkerId(workerId) || !validAttendanceToken(token)
    || !['check_in', 'check_out', 'request_status'].includes(action)
    || !validCoordinates(parsedLatitude, parsedLongitude)) {
    return res.status(400).json({ error: 'Provide a valid attendance link, action, latitude, and longitude' });
  }
  if (action === 'request_status' && !EMPLOYEE_REQUEST_TYPES.has(requestType)) {
    return res.status(400).json({ error: 'Choose a valid attendance request type' });
  }
  if (action !== 'request_status' && requestType != null && requestType !== 'dinas') {
    return res.status(400).json({ error: 'Only Dinas can be selected as an attendance type for check-in or check-out' });
  }
  const isDinas = action !== 'request_status' && requestType === 'dinas';
  if (action === 'request_status' && req.file) {
    return res.status(400).json({ error: 'Evidence images are only accepted for Dinas attendance' });
  }
  if (isDinas && action === 'check_in') {
    const evidenceType = req.file && profilePhotoMimeType(req.file.buffer);
    if (!evidenceType || req.file.mimetype !== evidenceType) {
      return res.status(400).json({ error: 'A valid JPG or PNG evidence image is required for Dinas' });
    }
  } else if (isDinas && req.file) {
    return res.status(400).json({ error: 'Dinas evidence is only uploaded with Check-In' });
  } else if (req.file) {
    return res.status(400).json({ error: 'Evidence images are only accepted for Dinas attendance' });
  }
  const usesGeofence = !isDinas;
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workers] = await connection.execute(
      `SELECT w.id AS worker_id, w.tenant_id, w.full_name, s.anti_mock_location_enabled,
              ps.id AS portal_session_id
         FROM workers w
         JOIN tenant_attendance_settings s ON s.tenant_id = w.tenant_id
         JOIN worker_portal_sessions ps ON w.id = ps.worker_id AND w.tenant_id = ps.tenant_id
        WHERE w.id = ? AND ps.token_hash = ? AND ps.revoked_at IS NULL
          AND w.status = 'active' AND w.deleted_at IS NULL
        FOR UPDATE`,
      [workerId, hashAttendanceToken(token)]
    );
    const worker = workers[0];
    if (!worker) {
      await connection.rollback();
      return res.status(404).json({ error: 'Attendance link is invalid or inactive' });
    }
    await connection.execute(
      'UPDATE worker_portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
      [worker.portal_session_id]
    );

    if (worker.anti_mock_location_enabled) {
      const parsedIsMocked = isMockedInput === true || isMockedInput === 'true'
        ? true
        : isMockedInput === false || isMockedInput === 'false'
          ? false
          : null;
      const accuracy = accuracyInput == null || String(accuracyInput).trim() === '' ? NaN : Number(accuracyInput);
      const speed = speedInput == null || String(speedInput).trim() === '' ? null : Number(speedInput);
      if (parsedIsMocked === null || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 1000
        || (speed !== null && (!Number.isFinite(speed) || speed < 0))) {
        await connection.rollback();
        return res.status(403).json({
          error: 'Anti-Mock Location is enabled. A valid device location signal is required; enable precise location and try again.',
        });
      }
      if (parsedIsMocked || (speed !== null && speed > 300)) {
        await connection.rollback();
        return res.status(403).json({
          error: 'Attendance was blocked because the device reported a mocked or implausible location.',
        });
      }
      const [previousLocations] = await connection.execute(
        `SELECT latitude, longitude,
                TIMESTAMPDIFF(SECOND, recorded_at, CURRENT_TIMESTAMP) AS elapsed_seconds
           FROM (
             SELECT check_in_latitude AS latitude, check_in_longitude AS longitude, check_in_time AS recorded_at
               FROM attendance
              WHERE tenant_id = ? AND worker_id = ? AND deleted_at IS NULL
                AND check_in_time IS NOT NULL AND check_in_latitude IS NOT NULL AND check_in_longitude IS NOT NULL
             UNION ALL
             SELECT check_out_latitude AS latitude, check_out_longitude AS longitude, check_out_time AS recorded_at
               FROM attendance
              WHERE tenant_id = ? AND worker_id = ? AND deleted_at IS NULL
                AND check_out_time IS NOT NULL AND check_out_latitude IS NOT NULL AND check_out_longitude IS NOT NULL
           ) AS recorded_locations
          WHERE recorded_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)
          ORDER BY recorded_at DESC LIMIT 1`,
        [worker.tenant_id, worker.worker_id, worker.tenant_id, worker.worker_id]
      );
      const previous = previousLocations[0];
      if (previous && implausibleLocationMovement(
        distanceInMeters(Number(previous.latitude), Number(previous.longitude), parsedLatitude, parsedLongitude),
        Number(previous.elapsed_seconds)
      )) {
        await connection.rollback();
        return res.status(403).json({
          error: 'Attendance was blocked because the reported movement is not physically plausible.',
        });
      }
    }

    const [records] = await connection.execute(
      `SELECT id, check_in_time, check_out_time, status, attendance_type, approval_status
         FROM attendance
        WHERE tenant_id = ? AND worker_id = ? AND attendance_date = CURDATE() AND deleted_at IS NULL
        FOR UPDATE`,
      [worker.tenant_id, worker.worker_id]
    );
    const record = records[0];
    let location = null;
    const activity = action === 'request_status' ? requestType : action;
    if (usesGeofence) {
      const [locationRows] = await connection.execute(
        `SELECT id, name, latitude, longitude, radius_meters, allowed_activities
           FROM tenant_attendance_locations
          WHERE tenant_id = ? FOR UPDATE`,
        [worker.tenant_id]
      );
      const match = matchRequiredAttendanceLocation(
        parsedLatitude,
        parsedLongitude,
        locationRows,
        activity
      );
      if (match.isRequired && !match.location) {
        await connection.rollback();
        return res.status(403).json({ error: 'You must be inside an attendance area that requires this activity' });
      }
      location = match.location;
    }

    if (action === 'request_status') {
      if (record && record.approval_status !== 'rejected') {
        await connection.rollback();
        return res.status(409).json({ error: 'An attendance record already exists for today' });
      }
      const status = requestType === 'leave' ? 'leave' : requestType;
      if (record) {
        await connection.execute(
          `UPDATE attendance
              SET status = ?, attendance_type = ?, approval_status = 'pending', approval_note = NULL,
                  approved_by = NULL, approval_updated_at = NULL, location_id = ?,
                  check_in_time = NULL, check_out_time = NULL,
                  check_in_latitude = NULL, check_in_longitude = NULL,
                  check_out_latitude = NULL, check_out_longitude = NULL,
                  evidence_data = NULL, evidence_mime_type = NULL
            WHERE id = ?`,
          [status, requestType, location?.id ?? null, record.id]
        );
      } else {
        await connection.execute(
          `INSERT INTO attendance
             (tenant_id, worker_id, attendance_date, status, attendance_type, approval_status, location_id)
           VALUES (?, ?, CURDATE(), ?, ?, 'pending', ?)`,
          [worker.tenant_id, worker.worker_id, status, requestType, location?.id ?? null]
        );
      }
    } else if (isDinas) {
      if (action === 'check_in') {
        if (record && !(record.attendance_type === 'dinas' && record.approval_status === 'rejected')) {
          await connection.rollback();
          return res.status(409).json({ error: 'An attendance record already exists for today' });
        }
        if (record) {
          await connection.execute(
            `UPDATE attendance
                SET status = 'dinas', attendance_type = 'dinas', approval_status = 'pending',
                    approval_note = NULL, approved_by = NULL, approval_updated_at = NULL,
                    location_id = NULL, check_in_time = CURRENT_TIMESTAMP, check_out_time = NULL,
                    check_in_latitude = ?, check_in_longitude = ?,
                    check_out_latitude = NULL, check_out_longitude = NULL,
                    evidence_data = ?, evidence_mime_type = ?
              WHERE id = ?`,
            [parsedLatitude, parsedLongitude, req.file.buffer, profilePhotoMimeType(req.file.buffer), record.id]
          );
        } else {
          await connection.execute(
            `INSERT INTO attendance (
               tenant_id, worker_id, attendance_date, check_in_time, check_in_latitude, check_in_longitude,
               status, attendance_type, approval_status, evidence_data, evidence_mime_type
             ) VALUES (?, ?, CURDATE(), CURRENT_TIMESTAMP, ?, ?, 'dinas', 'dinas', 'pending', ?, ?)`,
            [worker.tenant_id, worker.worker_id, parsedLatitude, parsedLongitude, req.file.buffer, profilePhotoMimeType(req.file.buffer)]
          );
        }
      } else {
        if (!record || record.attendance_type !== 'dinas' || !record.check_in_time
          || record.check_out_time || record.approval_status === 'rejected') {
          await connection.rollback();
          return res.status(409).json({ error: 'A valid Dinas check-in is required before check-out' });
        }
        await connection.execute(
          `UPDATE attendance
              SET check_out_time = CURRENT_TIMESTAMP, check_out_latitude = ?, check_out_longitude = ?
            WHERE id = ?`,
          [parsedLatitude, parsedLongitude, record.id]
        );
      }
    } else if (action === 'check_in') {
      if (record?.check_in_time) {
        await connection.rollback();
        return res.status(409).json({ error: 'Check-in has already been recorded for today' });
      }
      if (record && record.approval_status === 'pending') {
        await connection.rollback();
        return res.status(409).json({ error: 'Your attendance request is waiting for HR approval' });
      }
      if (record && !['present', 'absent'].includes(record.status)
        && record.approval_status !== 'rejected') {
        await connection.rollback();
        return res.status(409).json({ error: 'Attendance status was already recorded by HR' });
      }
      if (record) {
        await connection.execute(
          `UPDATE attendance
              SET check_in_time = CURRENT_TIMESTAMP, status = 'present', attendance_type = 'regular',
                  approval_status = 'not_required', approval_note = NULL, approved_by = NULL,
                  approval_updated_at = NULL, location_id = ?,
                  check_in_latitude = ?, check_in_longitude = ?,
                  evidence_data = NULL, evidence_mime_type = NULL
            WHERE id = ?`,
          [location?.id ?? null, parsedLatitude, parsedLongitude, record.id]
        );
      } else {
        await connection.execute(
          `INSERT INTO attendance (
             tenant_id, worker_id, attendance_date, check_in_time, check_in_latitude, check_in_longitude,
             status, attendance_type, location_id
           ) VALUES (?, ?, CURDATE(), CURRENT_TIMESTAMP, ?, ?, 'present', 'regular', ?)`,
          [worker.tenant_id, worker.worker_id, parsedLatitude, parsedLongitude, location?.id ?? null]
        );
      }
    } else {
      if (!record?.check_in_time || record.check_out_time || record.attendance_type !== 'regular') {
        await connection.rollback();
        return res.status(409).json({ error: 'Check-in is required and check-out must not already exist' });
      }
      await connection.execute(
        `UPDATE attendance
            SET check_out_time = CURRENT_TIMESTAMP, check_out_latitude = ?, check_out_longitude = ?,
                location_id = ?
          WHERE id = ?`,
        [parsedLatitude, parsedLongitude, location?.id ?? null, record.id]
      );
    }

    const [updatedRows] = await connection.execute(
      `SELECT id AS attendance_record_id,
              DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
              check_in_time, check_out_time, status, attendance_type, approval_status, approval_note,
              location_id, IF(evidence_data IS NULL, 0, 1) AS has_evidence,
              check_in_latitude, check_in_longitude,
              check_out_latitude, check_out_longitude
         FROM attendance WHERE tenant_id = ? AND worker_id = ? AND attendance_date = CURDATE() AND deleted_at IS NULL`,
      [worker.tenant_id, worker.worker_id]
    );
    const auditDescription = action === 'request_status'
      ? `Pengajuan presensi ${requestType} diajukan oleh pekerja "${worker.full_name}".`
      : `Pekerja "${worker.full_name}" melakukan ${action === 'check_in' ? 'Check-In' : 'Check-Out'}${isDinas ? ' Dinas' : ''}.`;
    await connection.execute(
      `INSERT INTO audit_events
         (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
       VALUES (?, NULL, ?, 'worker', ?, ?, ?, ?)`,
      [
        worker.tenant_id,
        worker.full_name,
        action === 'check_out' ? 'update' : 'create',
        action === 'request_status' ? 'attendance_claim' : 'attendance',
        String(worker.worker_id),
        auditDescription,
      ]
    );
    await connection.commit();
    publishTenantEvent(worker.tenant_id, 'attendance_updated', {
      action,
      worker_id: String(worker.worker_id),
    });
    publishTenantEvent(worker.tenant_id, 'dashboard_updated', { action });
    if (action === 'request_status' || isDinas) {
      publishTenantEvent(worker.tenant_id, 'approval_updated', {
        action,
        worker_id: String(worker.worker_id),
      });
    }
    publishTenantEvent(worker.tenant_id, 'history_updated', { action });
    res.json({
      data: {
        ...updatedRows[0],
        attendance_record_id: String(updatedRows[0].attendance_record_id),
        has_attendance_record: true,
        location_id: updatedRows[0].location_id == null ? null : String(updatedRows[0].location_id),
        has_evidence: Boolean(updatedRows[0].has_evidence),
      },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { company_name, full_name, email, password } = req.body || {};
  if (typeof company_name !== 'string' || company_name.trim().length < 2 || company_name.trim().length > 150
    || (full_name != null && (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 150))
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    || !validPassword(password)) {
    return res.status(400).json({
      error: 'Provide a company name, valid full name and email, and a password of 12 to 72 UTF-8 bytes',
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedFullName = normalizeText(full_name || company_name);
  const slug = `${company_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 130)}-${crypto.randomBytes(3).toString('hex')}`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tenantResult] = await connection.execute(
      'INSERT INTO tenants (name, slug) VALUES (?, ?)',
      [normalizeText(company_name), slug]
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const [userResult] = await connection.execute(
      `INSERT INTO users (tenant_id, full_name, email, email_hash, password_hash, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantResult.insertId, normalizedFullName, normalizedEmail, hashEmail(normalizedEmail), passwordHash, 'admin']
    );
    await connection.commit();
    const user = {
      id: userResult.insertId,
      tenant_id: tenantResult.insertId,
      full_name: normalizedFullName,
      email: normalizedEmail,
      role: 'admin',
      token_version: 0,
    };
    createSessionCookie(res, user);
    res.status(201).json({
      data: {
        id: String(user.id),
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        profile_photo_url: null,
        company_name: normalizeText(company_name),
      },
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email is already registered' });
    }
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Provide a valid email and a password no longer than 72 UTF-8 bytes' });
  }
  const [users] = await pool.execute(
    `SELECT u.id, u.tenant_id, u.full_name, u.email, u.password_hash, u.role,
            u.profile_photo_url, u.profile_photo_updated_at, u.is_active, u.token_version,
            t.name AS company_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email_hash = ? AND u.email = ?`,
    [hashEmail(email), email.trim().toLowerCase()]
  );
  let user = null;
  for (const candidate of users) {
    if (candidate.is_active && await bcrypt.compare(password, candidate.password_hash)) {
      user = candidate;
      break;
    }
  }
  if (!user) return res.status(401).json({ error: 'Email or password is incorrect' });
  createSessionCookie(res, user);
  res.json({
    data: {
      id: String(user.id),
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      profile_photo_url: profilePhotoUrl(user),
      company_name: user.company_name,
    },
  });
}));

app.post('/api/auth/forgot-password', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!takeAuthRateLimit(req.ip || req.socket.remoteAddress || 'unknown')) {
    return res.status(429).json({ error: 'Too many password recovery requests. Try again later.' });
  }
  const { email } = req.body || {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Provide a valid email address' });
  }
  let mailer;
  try {
    mailer = passwordResetMailer();
  } catch (error) {
    console.error('Password reset mail configuration error:', error.message);
    return res.status(503).json({ error: 'Password recovery is temporarily unavailable' });
  }
  if (!mailer) {
    return res.status(503).json({ error: 'Password recovery is temporarily unavailable' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const [users] = await pool.execute(
    `SELECT id, full_name FROM users
      WHERE email_hash = ? AND email = ? AND is_active = 1
      LIMIT 1`,
    [hashEmail(normalizedEmail), normalizedEmail]
  );
  const user = users[0];
  await pool.execute(
    'DELETE FROM password_reset_tokens WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL'
  );
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
    await pool.execute(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${PASSWORD_RESET_TOKEN_TTL_MINUTES} MINUTE))`,
      [user.id, hashPasswordResetToken(token)]
    );
    const resetUrl = new URL('/#reset-password', `${mailer.frontendUrl}/`);
    resetUrl.searchParams.set('token', token);
    try {
      const safeName = escapeHtml(user.full_name || 'pengguna');
      await mailer.transporter.sendMail({
        from: mailer.from,
        to: normalizedEmail,
        subject: 'Atur ulang kata sandi Ruang Kerja HRD',
        text: `Halo ${user.full_name || 'pengguna'},\n\nGunakan tautan berikut dalam ${PASSWORD_RESET_TOKEN_TTL_MINUTES} menit untuk mengatur ulang kata sandi:\n${resetUrl.toString()}\n\nJika Anda tidak meminta perubahan ini, abaikan email ini.`,
        html: `<p>Halo ${safeName},</p><p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda.</p><p><a href="${escapeHtml(resetUrl.toString())}">Atur ulang kata sandi</a></p><p>Tautan berlaku selama ${PASSWORD_RESET_TOKEN_TTL_MINUTES} menit dan hanya dapat digunakan sekali. Jika Anda tidak meminta perubahan ini, abaikan email ini.</p>`,
      });
    } catch (error) {
      await pool.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
      console.error('Password reset email delivery failed:', error.code || error.name || 'unknown error');
    }
  }
  res.status(202).json({
    data: { message: 'Jika alamat email terdaftar, instruksi pemulihan akan dikirim.' },
  });
}));

app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!takeAuthRateLimit(req.ip || req.socket.remoteAddress || 'unknown')) {
    return res.status(429).json({ error: 'Too many password reset attempts. Try again later.' });
  }
  const { token, new_password: newPassword } = req.body || {};
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !validPassword(newPassword)) {
    return res.status(400).json({ error: 'Provide a valid reset link and a password of 12 to 72 UTF-8 bytes' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT reset.id, reset.user_id
         FROM password_reset_tokens reset
         JOIN users u ON u.id = reset.user_id
        WHERE reset.token_hash = ? AND reset.used_at IS NULL
          AND reset.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
        LIMIT 1
        FOR UPDATE`,
      [hashPasswordResetToken(token)]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Reset link is invalid or expired. Request a new link.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await connection.execute(
      `UPDATE users SET password_hash = ?, token_version = token_version + 1
        WHERE id = ?`,
      [passwordHash, rows[0].user_id]
    );
    await connection.execute(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
      [rows[0].id]
    );
    await connection.execute(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?',
      [rows[0].user_id, rows[0].id]
    );
    await connection.commit();
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    res.json({ data: { message: 'Password updated. Sign in with your new password.' } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.status(204).end();
});

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.email, u.role, t.name AS company_name FROM users u
       JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.tenant_id = ?`,
    [req.auth.userId, req.auth.tenantId]
  );
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({
    data: {
      id: req.auth.userId,
      full_name: req.auth.fullName,
      email: rows[0].email,
      role: req.auth.role,
      profile_photo_url: req.auth.profilePhotoUrl,
      company_name: rows[0].company_name,
    },
  });
}));

app.use('/api', requireAuth);

function publishTenantEvent(tenantId, event, payload = {}) {
  if (!realtimeServer || !tenantId) return;
  realtimeServer.to(`tenant:${tenantId}`).emit(event, {
    ...payload,
    occurred_at: new Date().toISOString(),
  });
}

app.use('/api', (req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.auth) return;
    const path = req.originalUrl.split('?')[0];
    const payload = { action: req.method.toLowerCase() };
    if (path.startsWith('/api/workers') || path.startsWith('/api/admin/workers')) {
      publishTenantEvent(req.auth.tenantId, 'worker_changed', payload);
      publishTenantEvent(req.auth.tenantId, 'dashboard_updated', payload);
      if (path.includes('/documents')) publishTenantEvent(req.auth.tenantId, 'documents_updated', payload);
      if (path.includes('/portal-session')) {
        publishTenantEvent(req.auth.tenantId, 'attendance_updated', payload);
      }
    } else if (path.startsWith('/api/attendance')) {
      publishTenantEvent(req.auth.tenantId, 'attendance_updated', payload);
      publishTenantEvent(req.auth.tenantId, 'dashboard_updated', payload);
      if (path.includes('/approval')) publishTenantEvent(req.auth.tenantId, 'approval_updated', payload);
    } else if (path.startsWith('/api/leaves')) {
      publishTenantEvent(req.auth.tenantId, 'leave_requests_updated', payload);
      publishTenantEvent(req.auth.tenantId, 'dashboard_updated', payload);
    } else if (path.startsWith('/api/admin/document')) {
      publishTenantEvent(req.auth.tenantId, 'documents_updated', payload);
      publishTenantEvent(req.auth.tenantId, 'dashboard_updated', payload);
      publishTenantEvent(req.auth.tenantId, 'settings_updated', payload);
    } else if (path.startsWith('/api/admin/users')) {
      publishTenantEvent(req.auth.tenantId, 'user_changed', payload);
    } else if (path.startsWith('/api/admin/attendance')) {
      publishTenantEvent(req.auth.tenantId, 'settings_updated', payload);
    }
    publishTenantEvent(req.auth.tenantId, 'history_updated', payload);
  });
  next();
});

app.get('/api/leaves/pending', requireManager, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT lr.id, lr.worker_id, w.full_name, w.position, lr.\`type\`,
            DATE_FORMAT(lr.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(lr.end_date, '%Y-%m-%d') AS end_date,
            lr.reason, lr.status, lr.created_at,
            lr.attachment_original_name IS NOT NULL AS has_attachment,
            lr.attachment_original_name
       FROM leave_requests lr
       JOIN workers w ON w.id = lr.worker_id AND w.tenant_id = lr.tenant_id
      WHERE lr.tenant_id = ? AND lr.status = 'pending' AND w.deleted_at IS NULL
      ORDER BY lr.created_at ASC, lr.id ASC
      LIMIT 100`,
    [req.auth.tenantId]
  );
  res.json({
    data: rows.map((row) => ({ ...row, id: String(row.id), worker_id: String(row.worker_id) })),
  });
}));

app.get('/api/leaves/:id/attachment', requireManager, asyncRoute(async (req, res) => {
  if (!validWorkerId(req.params.id)) return res.status(400).json({ error: 'Invalid leave request ID' });
  const [rows] = await pool.execute(
    `SELECT attachment_storage_key, attachment_original_name, attachment_mime_type
       FROM leave_requests
      WHERE id = ? AND tenant_id = ?`,
    [req.params.id, req.auth.tenantId]
  );
  const attachment = rows[0];
  if (!attachment || !attachment.attachment_storage_key) {
    return res.status(404).json({ error: 'Attachment not found' });
  }
  const filePath = leaveAttachmentStoragePath(attachment.attachment_storage_key);
  if (!filePath) {
    console.error(`Invalid leave attachment storage key for request ${req.params.id}`);
    return res.status(500).json({ error: 'Attachment is unavailable' });
  }
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Attachment not found' });
    throw error;
  }
  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${attachment.attachment_original_name.replace(/["\\\r\n]/g, '_')}"`,
    'Content-Type': attachment.attachment_mime_type,
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(filePath);
}));

app.put('/api/leaves/:id/status', requireManager, asyncRoute(async (req, res) => {
  const requestId = req.params.id;
  const { status, rejection_note: rejectionNote } = req.body || {};
  if (!validWorkerId(requestId) || !validLeaveRequestStatus(status)) {
    return res.status(400).json({ error: 'Provide a valid request ID and status (approved or rejected)' });
  }
  if (status === 'rejected' && !validLeaveRejectionNote(rejectionNote)) {
    return res.status(400).json({ error: 'A rejection note of 5 to 1000 characters is required' });
  }
  const connection = await pool.getConnection();
  let updatedRequest;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT lr.id, lr.worker_id, lr.status, lr.\`type\`, lr.start_date, lr.end_date, w.full_name
         FROM leave_requests lr
         JOIN workers w ON w.id = lr.worker_id AND w.tenant_id = lr.tenant_id
        WHERE lr.id = ? AND lr.tenant_id = ? AND w.deleted_at IS NULL
        FOR UPDATE`,
      [requestId, req.auth.tenantId]
    );
    const request = rows[0];
    if (!request) {
      await connection.rollback();
      return res.status(404).json({ error: 'Leave request not found' });
    }
    if (request.status !== 'pending') {
      await connection.rollback();
      return res.status(409).json({ error: 'Leave request has already been reviewed' });
    }
    if (status === 'approved') {
      const requestDates = leaveRequestDates(request.start_date, request.end_date);
      if (!requestDates) {
        await connection.rollback();
        return res.status(409).json({ error: 'The requested date range is invalid or too long to approve' });
      }
      const placeholders = requestDates.map(() => '?').join(', ');
      const [attendanceRows] = await connection.execute(
        `SELECT attendance_date, check_in_time, check_out_time, status, attendance_type, approval_status
           FROM attendance
          WHERE tenant_id = ? AND worker_id = ? AND deleted_at IS NULL
            AND attendance_date IN (${placeholders})
          FOR UPDATE`,
        [req.auth.tenantId, request.worker_id, ...requestDates]
      );
      const intendedAttendanceStatus = leaveAttendanceStatus(request.type);
      const attendanceByDate = new Map(
        attendanceRows.map((row) => [String(row.attendance_date).slice(0, 10), row])
      );
      const conflictDate = findLeaveAttendanceConflictDate(
        requestDates,
        attendanceRows,
        intendedAttendanceStatus
      );
      if (conflictDate) {
        await connection.rollback();
        return res.status(409).json({
          error: `Approval cannot replace existing attendance records. Resolve the attendance conflict for ${conflictDate} first.`,
          conflict_date: conflictDate,
        });
      }
      for (const attendanceDate of requestDates) {
        if (attendanceByDate.has(attendanceDate)) {
          await connection.execute(
            `UPDATE attendance
                SET status = ?, attendance_type = ?, approval_status = 'approved',
                    approved_by = ?, approval_updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ? AND worker_id = ? AND attendance_date = ? AND deleted_at IS NULL`,
            [intendedAttendanceStatus, intendedAttendanceStatus, req.auth.userId,
              req.auth.tenantId, request.worker_id, attendanceDate]
          );
        } else {
          await connection.execute(
            `INSERT INTO attendance
               (tenant_id, worker_id, attendance_date, status, attendance_type,
                approval_status, approved_by, approval_updated_at)
             VALUES (?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP)`,
            [req.auth.tenantId, request.worker_id, attendanceDate,
              intendedAttendanceStatus, intendedAttendanceStatus, req.auth.userId]
          );
        }
      }
    }
    await connection.execute(
      `UPDATE leave_requests
          SET status = ?, rejection_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
      [status, status === 'rejected' ? rejectionNote.trim() : null, req.auth.userId, requestId, req.auth.tenantId]
    );
    await recordAudit(req, {
      action: status === 'approved' ? 'approve' : 'reject',
      entityType: 'leave_request',
      entityId: requestId,
      description: `Pengajuan ${request.type} milik ${request.full_name} untuk ${String(request.start_date).slice(0, 10)} sampai ${String(request.end_date).slice(0, 10)} ${status === 'approved' ? 'disetujui' : 'ditolak'}.`,
    }, connection);
    await connection.commit();
    updatedRequest = {
      id: String(request.id),
      worker_id: String(request.worker_id),
      status,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (status === 'approved') {
    publishTenantEvent(req.auth.tenantId, 'attendance_updated', { action: 'leave_approved' });
  }
  res.json({ data: updatedRequest });
}));

app.get('/api/history', requireManager, asyncRoute(async (req, res) => {
  const requestedLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
  const [rows] = await pool.execute(
    `SELECT id, user_id, actor_name, actor_role, action, entity_type, entity_id, description, created_at
       FROM audit_events
      WHERE tenant_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [req.auth.tenantId, limit]
  );
  res.json({
    data: rows.map((row) => ({ ...row, id: String(row.id) })),
  });
}));

app.get('/api/admin/attendance-settings', requireAdmin, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT company_portal_token_hash IS NOT NULL AS company_portal_configured,
            anti_mock_location_enabled, updated_at
       FROM tenant_attendance_settings WHERE tenant_id = ?`,
    [req.auth.tenantId]
  );
  res.json({
    data: {
      company_portal_configured: Boolean(rows[0]?.company_portal_configured),
      anti_mock_location_enabled: Boolean(rows[0]?.anti_mock_location_enabled),
      updated_at: rows[0]?.updated_at || null,
    },
  });
}));

app.get('/api/admin/attendance-settings/company-token', requireAdmin, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT company_portal_token_encrypted
       FROM tenant_attendance_settings
      WHERE tenant_id = ? AND company_portal_token_hash IS NOT NULL`,
    [req.auth.tenantId]
  );
  const encryptedToken = rows[0]?.company_portal_token_encrypted;
  res.set('Cache-Control', 'no-store');
  if (!encryptedToken) {
    return res.json({ data: { company_token: null, needs_rotation: Boolean(rows[0]) } });
  }
  res.json({ data: { company_token: decryptCompanyPortalToken(encryptedToken), needs_rotation: false } });
}));

app.patch('/api/admin/attendance-settings', requireAdmin, asyncRoute(async (req, res) => {
  const { anti_mock_location_enabled: enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'anti_mock_location_enabled must be a boolean' });
  }
  await pool.execute(
    `INSERT INTO tenant_attendance_settings (tenant_id, anti_mock_location_enabled)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE anti_mock_location_enabled = VALUES(anti_mock_location_enabled)`,
    [req.auth.tenantId, enabled ? 1 : 0]
  );
  await recordAudit(req, {
    action: 'update',
    entityType: 'attendance_settings',
    description: `Anti-Mock Location ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`,
  });
  const [rows] = await pool.execute(
    `SELECT company_portal_token_hash IS NOT NULL AS company_portal_configured,
            anti_mock_location_enabled, updated_at
       FROM tenant_attendance_settings WHERE tenant_id = ?`,
    [req.auth.tenantId]
  );
  res.json({
    data: {
      company_portal_configured: Boolean(rows[0].company_portal_configured),
      anti_mock_location_enabled: Boolean(rows[0].anti_mock_location_enabled),
      updated_at: rows[0].updated_at,
    },
  });
}));

app.get('/api/admin/attendance-locations', requireAdmin, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, name, latitude, longitude, radius_meters, allowed_activities, created_at
       FROM tenant_attendance_locations
      WHERE tenant_id = ? ORDER BY name, id`,
    [req.auth.tenantId]
  );
  res.json({
    data: rows.map((location) => ({
      ...location,
      id: String(location.id),
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      radius_meters: Number(location.radius_meters),
      allowed_activities: JSON.parse(location.allowed_activities),
    })),
  });
}));

app.post('/api/admin/attendance-locations', requireAdmin, asyncRoute(async (req, res) => {
  const input = req.body || {};
  if (!validAttendanceLocationInput(input)) {
    return res.status(400).json({
      error: 'Provide a location name, valid coordinates, radius from 25 to 5000 meters, and allowed activities',
    });
  }
  const name = normalizeText(input.name);
  const allowedActivities = parseAllowedActivities(input.allowed_activities);
  const [result] = await pool.execute(
    `INSERT INTO tenant_attendance_locations
       (tenant_id, name, latitude, longitude, radius_meters, allowed_activities)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.auth.tenantId,
      name,
      input.latitude,
      input.longitude,
      input.radius_meters,
      JSON.stringify(allowedActivities),
    ]
  );
  await recordAudit(req, {
    action: 'create',
    entityType: 'attendance_location',
    entityId: result.insertId,
    description: `Lokasi geofence "${name}" ditambahkan dengan radius ${input.radius_meters} m.`,
  });
  res.status(201).json({
    data: {
      id: String(result.insertId),
      name,
      latitude: input.latitude,
      longitude: input.longitude,
      radius_meters: input.radius_meters,
      allowed_activities: allowedActivities,
    },
  });
}));

app.delete('/api/admin/attendance-locations/:id', requireAdmin, asyncRoute(async (req, res) => {
  if (!validWorkerId(req.params.id)) return res.status(400).json({ error: 'Provide a valid location ID' });
  const [result] = await pool.execute(
    `DELETE FROM tenant_attendance_locations WHERE id = ? AND tenant_id = ?`,
    [req.params.id, req.auth.tenantId]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Attendance location not found' });
  await recordAudit(req, {
    action: 'delete',
    entityType: 'attendance_location',
    entityId: req.params.id,
    description: 'Lokasi geofence dihapus.',
  });
  res.status(204).end();
}));

app.post('/api/admin/attendance-settings/company-token', requireAdmin, asyncRoute(async (req, res) => {
  const { confirm_rotation } = req.body || {};
  if (confirm_rotation !== true) {
    return res.status(400).json({ error: 'Confirm company portal link generation or rotation explicitly' });
  }
  const companyToken = crypto.randomBytes(32).toString('base64url');
  const connection = await pool.getConnection();
  let updatedAt;
  let antiMockLocationEnabled;
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO tenant_attendance_settings
         (tenant_id, company_portal_token_hash, company_portal_token_encrypted)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         company_portal_token_hash = VALUES(company_portal_token_hash),
         company_portal_token_encrypted = VALUES(company_portal_token_encrypted),
         updated_at = CURRENT_TIMESTAMP`,
      [req.auth.tenantId, hashCompanyPortalToken(companyToken), encryptCompanyPortalToken(companyToken)]
    );
    await connection.execute(
      `UPDATE worker_portal_sessions SET revoked_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND revoked_at IS NULL`,
      [req.auth.tenantId]
    );
    await connection.execute(
      `UPDATE worker_portal_enrollment_codes SET used_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND used_at IS NULL`,
      [req.auth.tenantId]
    );
    const [rows] = await connection.execute(
      'SELECT updated_at, anti_mock_location_enabled FROM tenant_attendance_settings WHERE tenant_id = ?',
      [req.auth.tenantId]
    );
    updatedAt = rows[0].updated_at;
    antiMockLocationEnabled = Boolean(rows[0].anti_mock_location_enabled);
    await recordAudit(req, {
      action: 'update',
      entityType: 'attendance_settings',
      description: 'Tautan portal perusahaan dibuat atau dirotasi; sesi perangkat dicabut dan data enrollment legacy dinonaktifkan.',
    }, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({
    data: {
      company_portal_configured: true,
      anti_mock_location_enabled: antiMockLocationEnabled,
      updated_at: updatedAt,
      company_token: companyToken,
    },
  });
}));

app.get('/api/document-types', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, code, name, is_active, is_builtin, warning_threshold_days, created_at
       FROM document_types WHERE tenant_id = ? ORDER BY created_at, id`,
    [req.auth.tenantId]
  );
  res.json({
    data: rows.map((type) => ({
      ...type,
      id: String(type.id),
      is_active: Boolean(type.is_active),
      is_builtin: Boolean(type.is_builtin),
      warning_threshold_days: type.warning_threshold_days == null ? null : Number(type.warning_threshold_days),
    })),
  });
}));

app.post('/api/admin/document-types', requireAdmin, asyncRoute(async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    return res.status(400).json({ error: 'Document type name must be 1 to 100 characters' });
  }
  const normalizedName = normalizeDocumentTypeName(name);
  const [existingTypes] = await pool.execute(
    'SELECT code FROM document_types WHERE tenant_id = ?',
    [req.auth.tenantId]
  );
  const code = documentTypeCode(normalizedName, existingTypes.map(({ code: existingCode }) => existingCode));
  const [result] = await pool.execute(
    `INSERT INTO document_types (tenant_id, code, name, name_hash)
     VALUES (?, ?, ?, ?)`,
    [req.auth.tenantId, code, normalizedName, hashNormalizedText(normalizedName)]
  );
  await recordAudit(req, {
    action: 'create',
    entityType: 'document_type',
    entityId: code,
    description: `Jenis dokumen "${normalizedName}" ditambahkan.`,
  });
  res.status(201).json({
    data: {
      id: String(result.insertId),
      code,
      name: normalizedName,
      is_active: true,
      is_builtin: false,
      warning_threshold_days: null,
    },
  });
}));

app.patch('/api/admin/document-types/:code', requireAdmin, asyncRoute(async (req, res) => {
  const { name, is_active, warning_threshold_days: warningThresholdDays } = req.body || {};
  const updatesName = Object.hasOwn(req.body || {}, 'name');
  const updatesStatus = Object.hasOwn(req.body || {}, 'is_active');
  const updatesWarningThreshold = Object.hasOwn(req.body || {}, 'warning_threshold_days');
  if ((!updatesName && !updatesStatus && !updatesWarningThreshold)
    || (updatesName && (typeof name !== 'string' || !name.trim() || name.trim().length > 100))
    || (updatesStatus && typeof is_active !== 'boolean')
    || (updatesWarningThreshold && warningThresholdDays !== null && !validDocumentWarningThreshold(warningThresholdDays))) {
    return res.status(400).json({ error: 'Provide a valid document type name, active status, or warning threshold from 1 to 365 days (or null to use company default)' });
  }
  const normalizedName = updatesName ? normalizeDocumentTypeName(name) : null;
  const assignments = [];
  const values = [];
  if (updatesName) {
    assignments.push('name = ?', 'name_hash = ?');
    values.push(normalizedName, hashNormalizedText(normalizedName));
  }
  if (updatesStatus) {
    assignments.push('is_active = ?');
    values.push(is_active ? 1 : 0);
  }
  if (updatesWarningThreshold) {
    assignments.push('warning_threshold_days = ?');
    values.push(warningThresholdDays);
  }
  const [existingType] = await pool.execute(
    'SELECT code FROM document_types WHERE tenant_id = ? AND code = ?',
    [req.auth.tenantId, req.params.code]
  );
  if (!existingType[0]) return res.status(404).json({ error: 'Document type not found' });
  values.push(req.auth.tenantId, req.params.code);
  await pool.execute(
    `UPDATE document_types SET ${assignments.join(', ')} WHERE tenant_id = ? AND code = ?`,
    values
  );
  const changedFields = [
    updatesName ? 'nama' : null,
    updatesStatus ? 'status aktif' : null,
    updatesWarningThreshold ? 'ambang peringatan' : null,
  ].filter(Boolean);
  await recordAudit(req, {
    action: 'update',
    entityType: 'document_type',
    entityId: req.params.code,
    description: `Jenis dokumen diperbarui (${changedFields.join(', ')}).`,
  });
  const [rows] = await pool.execute(
    `SELECT id, code, name, is_active, is_builtin, warning_threshold_days, created_at
       FROM document_types WHERE tenant_id = ? AND code = ?`,
    [req.auth.tenantId, req.params.code]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Document type not found' });
  res.json({
    data: {
      ...rows[0],
      id: String(rows[0].id),
      is_active: Boolean(rows[0].is_active),
      is_builtin: Boolean(rows[0].is_builtin),
      warning_threshold_days: rows[0].warning_threshold_days == null ? null : Number(rows[0].warning_threshold_days),
    },
  });
}));

app.patch('/api/profile', asyncRoute(async (req, res) => {
  const { full_name } = req.body || {};
  if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 150) {
    return res.status(400).json({ error: 'Provide a valid full name' });
  }
  const normalizedName = normalizeText(full_name);
  await pool.execute(
    `UPDATE users SET full_name = ?
      WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [normalizedName, req.auth.userId, req.auth.tenantId]
  );
  await recordAudit(req, {
    action: 'update',
    entityType: 'user_profile',
    entityId: req.auth.userId,
    description: 'Nama profil akun diperbarui.',
  });
  res.json({
    data: {
      id: req.auth.userId,
      full_name: normalizedName,
      email: req.auth.email,
      role: req.auth.role,
      profile_photo_url: req.auth.profilePhotoUrl,
    },
  });
}));

app.get('/api/profile/photo', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT profile_photo_data, profile_photo_mime_type
       FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [req.auth.userId, req.auth.tenantId]
  );
  const photo = rows[0];
  if (!photo?.profile_photo_data || !['image/jpeg', 'image/png'].includes(photo.profile_photo_mime_type)) {
    return res.status(404).json({ error: 'Profile photo not found' });
  }
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': photo.profile_photo_mime_type,
  });
  res.send(photo.profile_photo_data);
}));

app.post('/api/profile/photo', profilePhotoUpload.single('photo'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG or PNG profile photo' });
  const mimeType = profilePhotoMimeType(req.file.buffer);
  if (!mimeType || req.file.mimetype !== mimeType) {
    return res.status(400).json({ error: 'Profile photo must be a valid JPG or PNG image' });
  }
  await pool.execute(
    `UPDATE users
        SET profile_photo_data = ?, profile_photo_mime_type = ?, profile_photo_updated_at = CURRENT_TIMESTAMP,
            profile_photo_url = NULL
      WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [req.file.buffer, mimeType, req.auth.userId, req.auth.tenantId]
  );
  await recordAudit(req, {
    action: 'update',
    entityType: 'user_profile',
    entityId: req.auth.userId,
    description: 'Foto profil akun diperbarui.',
  });
  res.json({
    data: {
      id: req.auth.userId,
      full_name: req.auth.fullName,
      email: req.auth.email,
      role: req.auth.role,
      profile_photo_url: `/api/profile/photo?v=${Date.now()}`,
    },
  });
}));

app.patch('/api/profile/password', asyncRoute(async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};
  if (typeof current_password !== 'string' || !validPassword(new_password)
    || new_password !== confirm_password || current_password === new_password) {
    return res.status(400).json({
      error: 'Provide the current password, matching new password confirmation, and a different password of 12 to 72 UTF-8 bytes',
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT password_hash, token_version FROM users
        WHERE id = ? AND tenant_id = ? AND is_active = 1 FOR UPDATE`,
      [req.auth.userId, req.auth.tenantId]
    );
    if (!rows[0] || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
      await connection.rollback();
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const passwordHash = await bcrypt.hash(new_password, 12);
    const tokenVersion = Number(rows[0].token_version) + 1;
    await connection.execute(
      `UPDATE users SET password_hash = ?, token_version = ?
        WHERE id = ? AND tenant_id = ?`,
      [passwordHash, tokenVersion, req.auth.userId, req.auth.tenantId]
    );
    await recordAudit(req, {
      action: 'update',
      entityType: 'user_security',
      entityId: req.auth.userId,
      description: 'Kata sandi akun diubah; sesi lain dicabut.',
    }, connection);
    await connection.commit();
    createSessionCookie(res, {
      id: req.auth.userId,
      tenant_id: req.auth.tenantId,
      token_version: tokenVersion,
    });
    res.json({ data: { message: 'Password updated. Other sessions have been signed out.' } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/admin/users', requireAdmin, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, full_name, email, role, profile_photo_url, is_active, created_at
       FROM users WHERE tenant_id = ? ORDER BY created_at ASC, id ASC`,
    [req.auth.tenantId]
  );
  res.json({ data: rows.map((user) => ({ ...user, is_active: Boolean(user.is_active) })) });
}));

app.post('/api/admin/users', requireAdmin, asyncRoute(async (req, res) => {
  const { full_name, email, password, role } = req.body || {};
  if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 150
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    || !validPassword(password)
    || !['admin', 'hr_manager', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Provide a valid name, email, initial password, and role' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute(
    `INSERT INTO users (tenant_id, full_name, email, email_hash, password_hash, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.auth.tenantId,
      normalizeText(full_name),
      normalizedEmail,
      hashEmail(normalizedEmail),
      passwordHash,
      role,
    ]
  );
  await recordAudit(req, {
    action: 'create',
    entityType: 'user',
    entityId: result.insertId,
    description: `Akun pengguna "${normalizeText(full_name)}" ditambahkan dengan role ${role}.`,
  });
  res.status(201).json({
    data: {
      id: String(result.insertId),
      full_name: normalizeText(full_name),
      email: normalizedEmail,
      role,
      profile_photo_url: null,
      is_active: true,
    },
  });
}));

app.patch('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const { role, is_active } = req.body || {};
  const updatesRole = Object.hasOwn(req.body || {}, 'role');
  const updatesStatus = Object.hasOwn(req.body || {}, 'is_active');
  if ((!updatesRole && !updatesStatus)
    || (updatesRole && !['admin', 'hr_manager', 'viewer'].includes(role))
    || (updatesStatus && typeof is_active !== 'boolean')) {
    return res.status(400).json({ error: 'Provide a valid role and/or active status' });
  }
  if (String(req.params.id) === req.auth.userId
    && ((updatesRole && role !== 'admin') || (updatesStatus && !is_active))) {
    return res.status(400).json({ error: 'You cannot remove your own administrator access or deactivate your account' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [targets] = await connection.execute(
      `SELECT id, role, is_active FROM users
        WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [req.params.id, req.auth.tenantId]
    );
    const target = targets[0];
    if (!target) {
      await connection.rollback();
      return res.status(404).json({ error: 'User not found' });
    }
    const removesActiveAdmin = target.role === 'admin' && target.is_active
      && ((updatesRole && role !== 'admin') || (updatesStatus && !is_active));
    if (removesActiveAdmin) {
      const [admins] = await connection.execute(
        `SELECT id FROM users
          WHERE tenant_id = ? AND role = 'admin' AND is_active = 1 FOR UPDATE`,
        [req.auth.tenantId]
      );
      if (admins.length <= 1) {
        await connection.rollback();
        return res.status(409).json({ error: 'The last active administrator cannot be demoted or deactivated' });
      }
    }
    const nextRole = updatesRole ? role : target.role;
    const nextActive = updatesStatus ? is_active : Boolean(target.is_active);
    await connection.execute(
      `UPDATE users SET role = ?, is_active = ?, token_version = token_version + 1
        WHERE id = ? AND tenant_id = ?`,
      [nextRole, nextActive ? 1 : 0, req.params.id, req.auth.tenantId]
    );
    await recordAudit(req, {
      action: 'update',
      entityType: 'user',
      entityId: req.params.id,
      description: `Akun pengguna diperbarui: ${updatesRole ? `role ${target.role} menjadi ${nextRole}` : ''}${updatesRole && updatesStatus ? '; ' : ''}${updatesStatus ? `status ${nextActive ? 'aktif' : 'nonaktif'}` : ''}.`,
    }, connection);
    await connection.commit();
    res.json({
      data: {
        id: String(target.id),
        role: nextRole,
        is_active: nextActive,
      },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/admin/users/:id/reset-password', requireAdmin, asyncRoute(async (req, res) => {
  if (String(req.params.id) === req.auth.userId) {
    return res.status(400).json({ error: 'Use the profile security form to change your own password' });
  }
  const { new_password } = req.body || {};
  if (!validPassword(new_password)) {
    return res.status(400).json({ error: 'New password must be 12 to 72 UTF-8 bytes' });
  }
  const passwordHash = await bcrypt.hash(new_password, 12);
  const [result] = await pool.execute(
    `UPDATE users SET password_hash = ?, token_version = token_version + 1
      WHERE id = ? AND tenant_id = ?`,
    [passwordHash, req.params.id, req.auth.tenantId    ]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
  await recordAudit(req, {
    action: 'update',
    entityType: 'user',
    entityId: req.params.id,
    description: 'Kata sandi akun pengguna direset; sesi aktif dicabut.',
  });
  res.json({ data: { message: 'Password reset. The user must sign in again.' } });
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const [counts] = await pool.execute(
    `SELECT status, COUNT(*) AS total FROM workers WHERE tenant_id = ? AND deleted_at IS NULL GROUP BY status`,
    [req.auth.tenantId]
  );
  const summary = {
    offered: 0,
    preactive: 0,
    active: 0,
    inactive: 0,
    expiring_documents: 0,
    pending_attendance_claims: 0,
    pending_leave_requests: 0,
  };
  for (const row of counts) summary[row.status] = Number(row.total);
  const [settingsRows] = await pool.execute(
    `SELECT warning_threshold_days FROM tenant_document_settings WHERE tenant_id = ?`,
    [req.auth.tenantId]
  );
  const warningThresholdDays = Number(settingsRows[0]?.warning_threshold_days ?? 30);
  const [dateRows] = await pool.execute(
    `SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') AS warning_start_date,
            DATE_FORMAT(DATE_ADD(UTC_DATE(), INTERVAL ? DAY), '%Y-%m-%d') AS warning_cutoff_date`,
    [warningThresholdDays]
  );
  const [expiring] = await pool.execute(
    `SELECT COUNT(*) AS total
       FROM documents d
       JOIN workers w ON w.tenant_id = d.tenant_id AND w.id = d.worker_id AND w.deleted_at IS NULL
       LEFT JOIN document_types dt
         ON dt.tenant_id = d.tenant_id AND dt.code = d.type
      WHERE d.tenant_id = ? AND d.deleted_at IS NULL
        AND d.superseded_by_document_id IS NULL
        AND ((d.status = 'valid'
          AND d.valid_until <= DATE_ADD(UTC_DATE(), INTERVAL COALESCE(dt.warning_threshold_days, ?) DAY))
          OR d.status = 'expired')`,
    [req.auth.tenantId, warningThresholdDays]
  );
  summary.expiring_documents = Number(expiring[0].total);
  const [pendingAttendance] = await pool.execute(
    `SELECT COUNT(*) AS total FROM attendance a
       JOIN workers w ON w.tenant_id = a.tenant_id AND w.id = a.worker_id AND w.deleted_at IS NULL
      WHERE a.tenant_id = ? AND a.approval_status = 'pending' AND a.deleted_at IS NULL`,
    [req.auth.tenantId]
  );
  summary.pending_attendance_claims = Number(pendingAttendance[0].total);
  const [pendingLeaveRequests] = await pool.execute(
    `SELECT COUNT(*) AS total FROM leave_requests lr
       JOIN workers w ON w.tenant_id = lr.tenant_id AND w.id = lr.worker_id AND w.deleted_at IS NULL
      WHERE lr.tenant_id = ? AND lr.status = 'pending'`,
    [req.auth.tenantId]
  );
  summary.pending_leave_requests = Number(pendingLeaveRequests[0].total);
  summary.document_warning_threshold_days = warningThresholdDays;
  summary.document_warning_start_date = dateRows[0].warning_start_date;
  summary.document_warning_cutoff_date = dateRows[0].warning_cutoff_date;
  res.json({ data: summary });
}));

app.get('/api/subscription', asyncRoute(async (req, res) => {
  res.json({ data: await getTenantSubscription(pool, req.auth.tenantId) });
}));

app.get('/api/admin/document-settings', requireAdmin, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT warning_threshold_days, updated_at
       FROM tenant_document_settings
      WHERE tenant_id = ?`,
    [req.auth.tenantId]
  );
  res.json({
    data: rows[0]
      ? { warning_threshold_days: Number(rows[0].warning_threshold_days), updated_at: rows[0].updated_at }
      : { warning_threshold_days: 30, updated_at: null },
  });
}));

app.patch('/api/admin/document-settings', requireAdmin, asyncRoute(async (req, res) => {
  const { warning_threshold_days: warningThresholdDays } = req.body || {};
  if (!validDocumentWarningThreshold(warningThresholdDays)) {
    return res.status(400).json({ error: 'Warning threshold must be a whole number between 1 and 365 days' });
  }
  await pool.execute(
    `INSERT INTO tenant_document_settings (tenant_id, warning_threshold_days)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE warning_threshold_days = VALUES(warning_threshold_days)`,
    [req.auth.tenantId, warningThresholdDays]
  );
  await recordAudit(req, {
    action: 'update',
    entityType: 'document_settings',
    description: `Ambang peringatan dokumen perusahaan diatur menjadi ${warningThresholdDays} hari.`,
  });
  const [rows] = await pool.execute(
    `SELECT warning_threshold_days, updated_at
       FROM tenant_document_settings
      WHERE tenant_id = ?`,
    [req.auth.tenantId]
  );
  res.json({ data: { warning_threshold_days: Number(rows[0].warning_threshold_days), updated_at: rows[0].updated_at } });
}));

app.get('/api/attendance', asyncRoute(async (req, res) => {
  const requestedDate = req.query.date || null;
  if (requestedDate && !validDate(requestedDate)) {
    return res.status(400).json({ error: 'Attendance date must use YYYY-MM-DD format' });
  }
  const [dateRows] = await pool.execute(
    `SELECT DATE_FORMAT(COALESCE(?, CURDATE()), '%Y-%m-%d') AS attendance_date,
            EXISTS(SELECT 1 FROM tenant_attendance_settings WHERE tenant_id = ? AND company_portal_token_hash IS NOT NULL) AS company_portal_configured`,
    [requestedDate, req.auth.tenantId]
  );
  const attendanceDate = dateRows[0].attendance_date;
  const [rows] = await pool.execute(
    `SELECT w.id AS worker_id, w.full_name, w.position, w.worker_number, w.uuid_lock_enabled,
            a.id AS attendance_id, a.status, a.attendance_type, a.approval_status, a.approval_note,
            a.check_in_time, a.check_out_time, a.location_id, a.approved_by, a.approval_updated_at,
            a.check_in_latitude, a.check_in_longitude,
            a.check_out_latitude, a.check_out_longitude,
            IF(a.evidence_data IS NULL, 0, 1) AS has_evidence
       FROM workers w
       LEFT JOIN attendance a ON a.tenant_id = w.tenant_id AND a.worker_id = w.id
         AND a.attendance_date = ? AND a.deleted_at IS NULL
      WHERE w.tenant_id = ? AND w.status = 'active' AND w.deleted_at IS NULL
      ORDER BY w.full_name, w.id`,
    [attendanceDate, req.auth.tenantId]
  );
  res.json({
    data: {
      attendance_date: attendanceDate,
      company_portal_configured: Boolean(dateRows[0].company_portal_configured),
      records: rows.map((row) => ({
        ...row,
        worker_id: String(row.worker_id),
        location_id: row.location_id == null ? null : String(row.location_id),
        uuid_lock_enabled: Boolean(row.uuid_lock_enabled),
        has_evidence: Boolean(row.has_evidence),
      })),
    },
  });
}));

app.get('/api/attendance/month', asyncRoute(async (req, res) => {
  const range = attendanceMonthRange(req.query.month);
  if (!range) return res.status(400).json({ error: 'Attendance month must use YYYY-MM format' });
  const [rows] = await pool.execute(
    `SELECT w.id AS worker_id, w.full_name, w.position,
            a.id AS attendance_id,
            DATE_FORMAT(a.attendance_date, '%Y-%m-%d') AS attendance_date,
            a.status, a.attendance_type, a.approval_status, a.approval_note,
            a.check_in_time, a.check_out_time,
            a.check_in_latitude, a.check_in_longitude,
            a.check_out_latitude, a.check_out_longitude,
            IF(a.evidence_data IS NULL, 0, 1) AS has_evidence
       FROM workers w
       LEFT JOIN attendance a ON a.tenant_id = w.tenant_id AND a.worker_id = w.id
         AND a.attendance_date >= ? AND a.attendance_date < ? AND a.deleted_at IS NULL
      WHERE w.tenant_id = ? AND w.status = 'active' AND w.deleted_at IS NULL
      ORDER BY w.full_name, w.id, a.attendance_date`,
    [range.start, range.end, req.auth.tenantId]
  );
  res.json({
    data: {
      month: range.month,
      days_in_month: range.days,
      records: rows.map((row) => ({
        ...row,
        worker_id: String(row.worker_id),
        attendance_id: row.attendance_id == null ? null : String(row.attendance_id),
        has_evidence: Boolean(row.has_evidence),
      })),
    },
  });
}));

app.patch('/api/attendance/:workerId/status', requireAdmin, asyncRoute(async (req, res) => {
  const { attendance_date, status } = req.body || {};
  if (!validDate(attendance_date) || !attendance_date
    || !['permission', 'sick', 'absent', 'off', 'leave'].includes(status)) {
    return res.status(400).json({ error: 'Provide a valid date and status (off, permission, leave, sick, or absent)' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workers] = await connection.execute(
      `SELECT id FROM workers WHERE id = ? AND tenant_id = ? AND status = 'active' AND deleted_at IS NULL FOR UPDATE`,
      [req.params.workerId, req.auth.tenantId]
    );
    if (!workers[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Active worker not found' });
    }
    const [records] = await connection.execute(
      `SELECT id, check_in_time FROM attendance
        WHERE tenant_id = ? AND worker_id = ? AND attendance_date = ? AND deleted_at IS NULL FOR UPDATE`,
      [req.auth.tenantId, req.params.workerId, attendance_date]
    );
    const record = records[0];
    if (record?.check_in_time) {
      await connection.rollback();
      return res.status(409).json({ error: 'Cannot change status after check-in has been recorded' });
    }
    if (record) {
      await connection.execute(
        `UPDATE attendance SET status = ?, check_in_time = NULL, check_out_time = NULL,
                attendance_type = ?, approval_status = 'not_required', approval_note = NULL,
                approved_by = NULL, approval_updated_at = NULL, evidence_data = NULL, evidence_mime_type = NULL,
                check_in_latitude = NULL, check_in_longitude = NULL,
                check_out_latitude = NULL, check_out_longitude = NULL
          WHERE id = ?`,
        [status, status, record.id]
      );
    } else {
      await connection.execute(
        `INSERT INTO attendance (tenant_id, worker_id, attendance_date, status, attendance_type)
         VALUES (?, ?, ?, ?, ?)`,
        [req.auth.tenantId, req.params.workerId, attendance_date, status, status]
      );
    }
    await recordAudit(req, {
      action: 'update',
      entityType: 'attendance',
      entityId: `${req.params.workerId}:${attendance_date}`,
      description: `Status presensi untuk ${attendance_date} diubah menjadi ${status}.`,
    }, connection);
    await connection.commit();
    res.json({ data: { worker_id: String(req.params.workerId), attendance_date, status } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.patch('/api/attendance/:workerId/approval', requireAdmin, asyncRoute(async (req, res) => {
  const { attendance_date: attendanceDate, decision, note = null } = req.body || {};
  if (!validWorkerId(req.params.workerId) || !validDate(attendanceDate) || !attendanceDate
    || !['approve', 'reject'].includes(decision)
    || (note != null && (typeof note !== 'string' || note.trim().length > 500))) {
    return res.status(400).json({ error: 'Provide a valid worker, date, approval decision, and optional note' });
  }
  const [result] = await pool.execute(
    `UPDATE attendance
        SET approval_status = ?, approval_note = ?, approved_by = ?, approval_updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND worker_id = ? AND attendance_date = ?
        AND approval_status = 'pending' AND attendance_type IN ('off', 'permission', 'leave', 'sick', 'dinas')
        AND deleted_at IS NULL`,
    [
      decision === 'approve' ? 'approved' : 'rejected',
      note?.trim() || null,
      req.auth.userId,
      req.auth.tenantId,
      req.params.workerId,
      attendanceDate,
    ]
  );
  if (!result.affectedRows) return res.status(409).json({ error: 'No pending attendance request was found for this worker and date' });
  await recordAudit(req, {
    action: decision === 'approve' ? 'approve' : 'reject',
    entityType: 'attendance_claim',
    entityId: `${req.params.workerId}:${attendanceDate}`,
    description: `Klaim presensi tanggal ${attendanceDate} ${decision === 'approve' ? 'disetujui' : 'ditolak'}.`,
  });
  res.json({
    data: {
      worker_id: String(req.params.workerId),
      attendance_date: attendanceDate,
      approval_status: decision === 'approve' ? 'approved' : 'rejected',
      approval_note: note?.trim() || null,
    },
  });
}));

app.get('/api/attendance/:workerId/evidence', asyncRoute(async (req, res) => {
  const attendanceDate = req.query.date || '';
  if (!validWorkerId(req.params.workerId) || !validDate(attendanceDate)) {
    return res.status(400).json({ error: 'Provide a valid worker ID and attendance date' });
  }
  const [rows] = await pool.execute(
    `SELECT evidence_data, evidence_mime_type FROM attendance
      WHERE tenant_id = ? AND worker_id = ? AND attendance_date = ?
        AND attendance_type = 'dinas' AND evidence_data IS NOT NULL AND deleted_at IS NULL`,
    [req.auth.tenantId, req.params.workerId, attendanceDate]
  );
  const evidence = rows[0];
  if (!evidence || !['image/jpeg', 'image/png'].includes(evidence.evidence_mime_type)) {
    return res.status(404).json({ error: 'Dinas evidence not found' });
  }
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': evidence.evidence_mime_type,
  });
  res.send(evidence.evidence_data);
}));

app.delete('/api/attendance/:workerId', requireAdmin, asyncRoute(async (req, res) => {
  const attendanceDate = req.query.date || '';
  if (!validWorkerId(req.params.workerId) || !validDate(attendanceDate)) {
    return res.status(400).json({ error: 'Provide a valid worker ID and attendance date' });
  }
  const [result] = await pool.execute(
    `UPDATE attendance SET deleted_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND worker_id = ? AND attendance_date = ? AND deleted_at IS NULL`,
    [req.auth.tenantId, req.params.workerId, attendanceDate]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Attendance record not found' });
  await recordAudit(req, {
    action: 'delete',
    entityType: 'attendance',
    entityId: `${req.params.workerId}:${attendanceDate}`,
    description: `Catatan presensi tanggal ${attendanceDate} diarsipkan.`,
  });
  res.status(204).end();
}));

app.get('/api/workers', asyncRoute(async (req, res) => {
  const { status } = req.query;
  if (status && !WORKER_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid worker status' });
  }
  const query = `SELECT id, tenant_id, full_name, email, email_hash, position, worker_number, uuid_lock_enabled, phone_number,
                        profile_photo_updated_at, national_id, address, department, placement_client,
                        work_location, contract_type, offer_date, join_date, salary_rate, status,
                        required_document_types, deleted_at, scheduled_inactive_date, created_at, updated_at
                   FROM workers WHERE tenant_id = ? AND deleted_at IS NULL
                   ${status ? 'AND status = ?' : ''} ORDER BY updated_at DESC, id DESC`;
  const [rows] = await pool.execute(query, status ? [req.auth.tenantId, status] : [req.auth.tenantId]);
  const data = await Promise.all(rows.map(async (worker) => {
    const documents = await listWorkerDocuments(req.auth.tenantId, worker.id);
    return {
      ...redactWorkerForViewer(worker, req.auth.role),
      uuid_lock_enabled: Boolean(worker.uuid_lock_enabled),
      required_document_types: parseRequiredDocuments(worker.required_document_types),
      documents: documents.map((document) => redactDocumentForViewer(document, req.auth.role)),
      eligibility: evaluateEligibility(worker, documents),
    };
  }));
  res.json({ data });
}));

app.put('/api/workers/:id/uuid-lock', requireManager, asyncRoute(async (req, res) => {
  const { enabled } = req.body || {};
  if (!validWorkerId(req.params.id) || !validUuidLockEnabled(enabled)) {
    return res.status(400).json({ error: 'Provide a valid worker ID and boolean UUID lock state' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const worker = await getWorker(req.auth.tenantId, req.params.id, connection, true);
    if (!worker) {
      await connection.rollback();
      return res.status(404).json({ error: 'Worker not found' });
    }
    if (Boolean(worker.uuid_lock_enabled) === enabled) {
      await connection.commit();
      return res.json({
        data: { worker_id: String(worker.id), uuid_lock_enabled: enabled },
      });
    }
    await connection.execute(
      'UPDATE workers SET uuid_lock_enabled = ? WHERE id = ? AND tenant_id = ?',
      [enabled ? 1 : 0, worker.id, req.auth.tenantId]
    );
    await recordAudit(req, {
      action: 'update',
      entityType: 'worker_uuid_lock',
      entityId: worker.id,
      description: `Kunci UUID untuk pekerja "${worker.full_name}" ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.`,
    }, connection);
    await connection.commit();
    res.json({
      data: { worker_id: String(worker.id), uuid_lock_enabled: enabled },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/workers/:id/portal-session/reset', requireManager, asyncRoute(async (req, res) => {
  if (!validWorkerId(req.params.id)) return res.status(400).json({ error: 'Invalid worker ID' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const worker = await getWorker(req.auth.tenantId, req.params.id, connection, true);
    if (!worker || worker.status !== 'active' || !worker.worker_number) {
      await connection.rollback();
      return res.status(404).json({ error: 'Pekerja aktif dengan nomor pekerja diperlukan untuk mereset UUID portal.' });
    }
    await connection.execute(
      `UPDATE worker_portal_sessions SET revoked_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND worker_id = ? AND revoked_at IS NULL`,
      [req.auth.tenantId, worker.id]
    );
    await connection.execute(
      `UPDATE worker_portal_enrollment_codes SET used_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND worker_id = ? AND used_at IS NULL`,
      [req.auth.tenantId, worker.id]
    );
    await recordAudit(req, {
      action: 'update',
      entityType: 'worker_portal_session',
      entityId: worker.id,
      description: `UUID portal pekerja "${worker.full_name}" direset oleh ${req.auth.role}.`,
    }, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ data: { worker_id: String(req.params.id), reset: true } });
}));

app.get('/api/departments', asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT name
       FROM departments
      WHERE tenant_id = ?
      ORDER BY name`,
    [req.auth.tenantId]
  );
  res.json({ data: rows.map(({ name }) => name) });
}));

app.post('/api/workers', requireManager, asyncRoute(async (req, res) => {
  const {
    full_name,
    email,
    phone_number,
    national_id,
    address,
    department,
    position,
    worker_number: workerNumberInput,
    work_location,
    contract_type,
    offer_date,
    join_date,
    salary_rate,
    required_document_types = [],
  } = req.body || {};
  const workerNumber = workerNumberInput == null || workerNumberInput === ''
    ? null
    : validWorkerNumber(workerNumberInput) ? normalizeWorkerNumber(workerNumberInput) : undefined;
  if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 150
    || typeof position !== 'string' || !position.trim() || position.trim().length > 150
    || (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    || !validPhoneNumber(phone_number)
    || !validNationalId(national_id)
    || (address != null && (typeof address !== 'string' || address.length > 500))
    || !validDepartment(department)
    || (work_location != null && (typeof work_location !== 'string' || work_location.length > 150))
    || !CONTRACT_TYPES.has(contract_type)
    || !validDate(offer_date) || !validDate(join_date)
    || (offer_date && join_date && join_date < offer_date)
    || !validSalaryRate(salary_rate)
    || workerNumber === undefined
    || !validRequiredDocuments(required_document_types)) {
    return res.status(400).json({ error: 'Provide valid worker, contact, department, contract, date, rate, and document details' });
  }
  const activeTypes = await activeDocumentTypes(req.auth.tenantId);
  if (required_document_types.some((type) => !activeTypes.has(type))) {
    return res.status(400).json({ error: 'Required document types must be active for this company' });
  }
  const connection = await pool.getConnection();
  let workerId;
  try {
    await connection.beginTransaction();
    const subscription = await getTenantSubscription(connection, req.auth.tenantId, true);
    if (exceedsWorkerQuota(subscription)) {
      await connection.rollback();
      return workerQuotaExceeded(res, subscription);
    }
    if (workerNumber) {
      const [activeNumberRows] = await connection.execute(
        `SELECT id FROM workers
          WHERE tenant_id = ? AND worker_number = ? AND status = 'active' AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [req.auth.tenantId, workerNumber]
      );
      if (activeNumberRows.length) {
        await connection.rollback();
        return res.status(409).json({ error: 'Nomor pekerja sudah digunakan oleh karyawan aktif' });
      }
    }
    const normalizedDepartment = normalizeText(department);
    await connection.execute(
      `INSERT INTO departments (tenant_id, name, name_hash)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [req.auth.tenantId, normalizedDepartment, hashNormalizedText(department)]
    );
    const [result] = await connection.execute(
      `INSERT INTO workers (
         tenant_id, full_name, email, email_hash, worker_number, phone_number, national_id, address,
         department, position, work_location, contract_type, offer_date, join_date,
         salary_rate, status, required_document_types
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?)`,
      [
        req.auth.tenantId,
        normalizeText(full_name),
        email?.trim().toLowerCase() || null,
        email ? hashEmail(email) : null,
        workerNumber,
        phone_number.trim().replace(/\s+/g, ' '),
        national_id || null,
        address ? normalizeText(address) : null,
        normalizedDepartment,
        normalizeText(position),
        work_location ? normalizeText(work_location) : null,
        contract_type,
        offer_date || null,
        join_date || null,
        salary_rate || null,
        JSON.stringify(required_document_types),
      ]
    );
    workerId = result.insertId;
    await connection.execute(
      `INSERT INTO worker_status_history (tenant_id, worker_id, user_id, previous_status, new_status)
       VALUES (?, ?, ?, NULL, 'offered')`,
      [req.auth.tenantId, workerId, req.auth.userId]
    );
    await recordAudit(req, {
      action: 'create',
      entityType: 'worker',
      entityId: workerId,
      description: `Pekerja "${normalizeText(full_name)}" ditambahkan dengan status Offering.`,
    }, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const worker = await getWorker(req.auth.tenantId, workerId);
  res.status(201).json({
    data: {
      ...redactWorkerForViewer(worker, req.auth.role),
      uuid_lock_enabled: Boolean(worker.uuid_lock_enabled),
      required_document_types: parseRequiredDocuments(worker.required_document_types),
      eligibility: evaluateEligibility(worker, []),
    },
  });
}));

app.post('/api/admin/workers/import', requireAdmin, asyncRoute(async (req, res) => {
  const { workers: importRows } = req.body || {};
  if (!Array.isArray(importRows) || importRows.length === 0 || importRows.length > 500) {
    return res.status(400).json({ error: 'Import must contain between 1 and 500 worker rows' });
  }

  const activeTypes = await activeDocumentTypes(req.auth.tenantId);
  const [existingRows] = await pool.execute(
    `SELECT full_name, national_id
       FROM workers
      WHERE tenant_id = ? AND deleted_at IS NULL`,
    [req.auth.tenantId]
  );
  const knownNames = new Set(existingRows.map(({ full_name }) => normalizeText(full_name).toLowerCase()));
  const knownNationalIds = new Set(existingRows.filter(({ national_id }) => national_id).map(({ national_id }) => String(national_id)));
  const created = [];
  const skipped = [];
  const errors = [];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const subscription = await getTenantSubscription(connection, req.auth.tenantId, true);
    if (exceedsWorkerQuota(subscription)) {
      await connection.rollback();
      return workerQuotaExceeded(res, subscription);
    }
    await connection.commit();
    for (const [index, row] of importRows.entries()) {
      const rowNumber = index + 2;
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push({ row: rowNumber, error: 'Invalid row data' });
        continue;
      }
      const {
        full_name, email, worker_number: workerNumberInput, phone_number, national_id, address, department, position, work_location,
        contract_type, offer_date, join_date, salary_rate, required_document_types = [],
      } = row;
      const workerNumber = workerNumberInput == null || workerNumberInput === ''
        ? null
        : validWorkerNumber(String(workerNumberInput)) ? normalizeWorkerNumber(String(workerNumberInput)) : undefined;
      if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 150
        || typeof position !== 'string' || !position.trim() || position.trim().length > 150
        || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        || !validPhoneNumber(phone_number) || !validNationalId(national_id)
        || (address != null && (typeof address !== 'string' || address.length > 500))
        || !validDepartment(department)
        || (work_location != null && (typeof work_location !== 'string' || work_location.length > 150))
        || !CONTRACT_TYPES.has(contract_type)
        || !validDate(offer_date) || !validDate(join_date)
        || (offer_date && join_date && join_date < offer_date)
        || !validSalaryRate(salary_rate) || !validRequiredDocuments(required_document_types)
        || workerNumber === undefined
        || required_document_types.some((type) => !activeTypes.has(type))) {
        errors.push({ row: rowNumber, error: 'Invalid worker fields or inactive required document type' });
        continue;
      }
      const normalizedName = normalizeText(full_name).toLowerCase();
      const normalizedNationalId = national_id || null;
      if (knownNames.has(normalizedName) || (normalizedNationalId && knownNationalIds.has(normalizedNationalId))) {
        skipped.push({ row: rowNumber, reason: 'Duplicate worker name or NIK' });
        continue;
      }
      const emailHash = hashEmail(email);
      const [existingEmail] = await connection.execute(
        'SELECT id FROM workers WHERE tenant_id = ? AND email_hash = ? AND deleted_at IS NULL',
        [req.auth.tenantId, emailHash]
      );
      if (existingEmail.length) {
        skipped.push({ row: rowNumber, reason: 'Duplicate email' });
        continue;
      }
      if (workerNumber) {
        const [activeNumberRows] = await connection.execute(
          `SELECT id FROM workers
            WHERE tenant_id = ? AND worker_number = ? AND status = 'active' AND deleted_at IS NULL
            LIMIT 1`,
          [req.auth.tenantId, workerNumber]
        );
        if (activeNumberRows.length) {
          skipped.push({ row: rowNumber, reason: 'Nomor pekerja sudah digunakan oleh karyawan aktif' });
          continue;
        }
      }

      try {
        await connection.beginTransaction();
        const normalizedDepartment = normalizeText(department);
        await connection.execute(
          `INSERT INTO departments (tenant_id, name, name_hash)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [req.auth.tenantId, normalizedDepartment, hashNormalizedText(department)]
        );
        const [result] = await connection.execute(
          `INSERT INTO workers (
             tenant_id, full_name, email, email_hash, worker_number, phone_number, national_id, address,
             department, position, work_location, contract_type, offer_date, join_date,
             salary_rate, status, required_document_types
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?)`,
          [
            req.auth.tenantId, normalizeText(full_name), email.trim().toLowerCase(), emailHash,
            workerNumber,
            phone_number.trim().replace(/\s+/g, ' '), normalizedNationalId,
            address ? normalizeText(address) : null, normalizedDepartment, normalizeText(position),
            work_location ? normalizeText(work_location) : null, contract_type,
            offer_date || null, join_date || null, salary_rate || null,
            JSON.stringify(required_document_types),
          ]
        );
        await connection.execute(
          `INSERT INTO worker_status_history (tenant_id, worker_id, user_id, previous_status, new_status)
           VALUES (?, ?, ?, NULL, 'offered')`,
          [req.auth.tenantId, result.insertId, req.auth.userId]
        );
        await connection.commit();
        knownNames.add(normalizedName);
        if (normalizedNationalId) knownNationalIds.add(normalizedNationalId);
        created.push({ row: rowNumber, worker_id: String(result.insertId) });
      } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') skipped.push({ row: rowNumber, reason: 'Duplicate worker data' });
        else throw error;
      }
    }
  } finally {
    connection.release();
  }
  if (created.length) {
    await recordAudit(req, {
      action: 'create',
      entityType: 'worker_import',
      description: `Impor pekerja selesai: ${created.length} ditambahkan, ${skipped.length} dilewati, ${errors.length} baris bermasalah.`,
    });
  }
  res.status(201).json({ data: { created, skipped, errors } });
}));

app.get('/api/workers/:id', asyncRoute(async (req, res) => {
  const worker = await getWorker(req.auth.tenantId, req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  const documents = await listWorkerDocuments(req.auth.tenantId, worker.id);
  const [history] = await pool.execute(
    `SELECT h.id, h.previous_status, h.new_status, h.created_at, u.email AS changed_by
       FROM worker_status_history h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.tenant_id = ? AND h.worker_id = ? ORDER BY h.created_at DESC`,
    [req.auth.tenantId, worker.id]
  );
  res.json({
    data: {
      ...redactWorkerForViewer(worker, req.auth.role),
      uuid_lock_enabled: Boolean(worker.uuid_lock_enabled),
      required_document_types: parseRequiredDocuments(worker.required_document_types),
      documents: documents.map((document) => redactDocumentForViewer(document, req.auth.role)),
      history,
      eligibility: evaluateEligibility(worker, documents),
    },
  });
}));

app.patch('/api/workers/:id', requireAdmin, asyncRoute(async (req, res) => {
  const worker = await getWorker(req.auth.tenantId, req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  const fields = {
    worker_number: ['worker_number', validWorkerNumber, normalizeWorkerNumber],
    full_name: ['full_name', (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 150, normalizeText],
    email: ['email', (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()), (value) => value.trim().toLowerCase()],
    phone_number: ['phone_number', validPhoneNumber, (value) => value.trim().replace(/\s+/g, ' ')],
    national_id: ['national_id', validNationalId, (value) => value || null],
    address: ['address', (value) => value == null || (typeof value === 'string' && value.length <= 500), (value) => value ? normalizeText(value) : null],
    department: ['department', validDepartment, normalizeText],
    position: ['position', (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 150, normalizeText],
    work_location: ['work_location', (value) => value == null || (typeof value === 'string' && value.length <= 150), (value) => value ? normalizeText(value) : null],
    contract_type: ['contract_type', (value) => CONTRACT_TYPES.has(value), (value) => value],
    offer_date: ['offer_date', validDate, (value) => value || null],
    join_date: ['join_date', validDate, (value) => value || null],
    salary_rate: ['salary_rate', validSalaryRate, (value) => value || null],
  };
  const body = req.body || {};
  const updates = Object.entries(fields).filter(([key]) =>
    Object.hasOwn(body, key) && !(key === 'worker_number' && (body[key] == null || body[key] === '')));
  const updatesRequiredDocuments = Object.hasOwn(body, 'required_document_types');
  if (!updates.length && !updatesRequiredDocuments) {
    return res.status(400).json({ error: 'Provide valid worker fields to update' });
  }
  if (updates.some(([key, [, validate]]) => !validate(body[key]))
    || (updatesRequiredDocuments && !validRequiredDocuments(body.required_document_types))) {
    return res.status(400).json({ error: 'Provide valid worker fields to update' });
  }
  const requestedWorkerNumber = updates.some(([key]) => key === 'worker_number')
    ? normalizeWorkerNumber(body.worker_number)
    : null;
  if (requestedWorkerNumber) {
    const [activeNumberRows] = await pool.execute(
      `SELECT id FROM workers
        WHERE tenant_id = ? AND worker_number = ? AND status = 'active'
          AND deleted_at IS NULL AND id <> ?
        LIMIT 1`,
      [req.auth.tenantId, requestedWorkerNumber, worker.id]
    );
    if (activeNumberRows.length) {
      return res.status(409).json({ error: 'Nomor pekerja sudah digunakan oleh karyawan aktif' });
    }
  }
  if (updatesRequiredDocuments) {
    const activeTypes = await activeDocumentTypes(req.auth.tenantId);
    const existingRequirements = new Set(parseRequiredDocuments(worker.required_document_types));
    if (body.required_document_types.some((type) => !activeTypes.has(type) && !existingRequirements.has(type))) {
      return res.status(400).json({ error: 'Required document types must be active for this company' });
    }
  }
  if (Object.hasOwn(body, 'email')) {
    const [duplicateEmail] = await pool.execute(
      'SELECT id FROM workers WHERE tenant_id = ? AND email_hash = ? AND id <> ? AND deleted_at IS NULL',
      [req.auth.tenantId, hashEmail(body.email), worker.id]
    );
    if (duplicateEmail.length) return res.status(409).json({ error: 'A worker with this email already exists' });
  }
  const nextOfferDate = Object.hasOwn(body, 'offer_date') ? body.offer_date : worker.offer_date;
  const nextJoinDate = Object.hasOwn(body, 'join_date') ? body.join_date : worker.join_date;
  if (nextOfferDate && nextJoinDate && String(nextJoinDate).slice(0, 10) < String(nextOfferDate).slice(0, 10)) {
    return res.status(400).json({ error: 'Join date cannot be earlier than offer date' });
  }
  if (Object.hasOwn(body, 'department')) {
    const normalizedDepartment = normalizeText(body.department);
    await pool.execute(
      `INSERT INTO departments (tenant_id, name, name_hash)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [req.auth.tenantId, normalizedDepartment, hashNormalizedText(body.department)]
    );
  }
  const assignments = [];
  const values = [];
  for (const [key, [, , normalize]] of updates) {
    if (key === 'email') {
      assignments.push('email = ?', 'email_hash = ?');
      values.push(normalize(body[key]), hashEmail(body[key]));
    } else {
      assignments.push(`\`${key}\` = ?`);
      values.push(normalize(body[key]));
    }
  }
  if (updatesRequiredDocuments) {
    assignments.push('required_document_types = ?');
    values.push(JSON.stringify(body.required_document_types));
  }
  values.push(worker.id, req.auth.tenantId);
  try {
    await pool.execute(
      `UPDATE workers SET ${assignments.join(', ')} WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      values
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' && requestedWorkerNumber) {
      return res.status(409).json({ error: 'Nomor pekerja sudah digunakan oleh karyawan aktif' });
    }
    throw error;
  }
  const changedFields = [
    ...updates.map(([key]) => key),
    ...(updatesRequiredDocuments ? ['required_document_types'] : []),
  ];
  await recordAudit(req, {
    action: 'update',
    entityType: 'worker',
    entityId: worker.id,
    description: `Data pekerja "${worker.full_name}" diperbarui (${changedFields.join(', ')}).`,
  });
  const updated = await getWorker(req.auth.tenantId, worker.id);
  const documents = await listWorkerDocuments(req.auth.tenantId, worker.id);
  res.json({
    data: {
      ...redactWorkerForViewer(updated, req.auth.role),
      required_document_types: parseRequiredDocuments(updated.required_document_types),
      documents,
      eligibility: evaluateEligibility(updated, documents),
    },
  });
}));

app.delete('/api/workers/:id', requireAdmin, asyncRoute(async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE workers SET deleted_at = CURRENT_TIMESTAMP, scheduled_inactive_date = NULL
        WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [req.params.id, req.auth.tenantId]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ error: 'Worker not found' });
    }
    await connection.execute(
      `UPDATE worker_portal_sessions SET revoked_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND worker_id = ? AND revoked_at IS NULL`,
      [req.auth.tenantId, req.params.id]
    );
    await connection.execute(
      `UPDATE worker_portal_enrollment_codes SET used_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND worker_id = ? AND used_at IS NULL`,
      [req.auth.tenantId, req.params.id]
    );
    const [workers] = await connection.execute(
      'SELECT full_name FROM workers WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.auth.tenantId]
    );
    await recordAudit(req, {
      action: 'delete',
      entityType: 'worker',
      entityId: req.params.id,
      description: `Data pekerja "${workers[0]?.full_name || req.params.id}" diarsipkan.`,
    }, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(204).end();
}));

app.get('/api/workers/:id/eligibility', asyncRoute(async (req, res) => {
  const worker = await getWorker(req.auth.tenantId, req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  const documents = await listWorkerDocuments(req.auth.tenantId, worker.id);
  res.json({ data: { worker_id: worker.id, status: worker.status, ...evaluateEligibility(worker, documents) } });
}));

app.post('/api/workers/:id/documents', requireManager, documentAttachmentUpload.single('attachment'), asyncRoute(async (req, res) => {
  const worker = await getWorker(req.auth.tenantId, req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  const { type, status = 'pending' } = req.body || {};
  const dateFields = documentDateFields(status, req.body || {});
  const activeTypes = await activeDocumentTypes(req.auth.tenantId);
  const allowedForExistingWorker = !activeTypes.has(type)
    && parseRequiredDocuments(worker.required_document_types).includes(type);
  if ((!activeTypes.has(type) && !allowedForExistingWorker) || !DOCUMENT_STATUSES.has(status)
    || !dateFields) {
    return res.status(400).json({ error: 'Invalid document type, status, or dates' });
  }
  let attachmentStorageKey = null;
  let attachmentOriginalName = null;
  let attachmentMimeType = null;
  let attachmentPath;
  let attachmentWritten = false;
  if (req.file) {
    attachmentMimeType = documentAttachmentMimeType(req.file.buffer);
    const expectedMimeType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.pdf': 'application/pdf',
    }[path.extname(req.file.originalname).toLowerCase()];
    if (!attachmentMimeType || attachmentMimeType !== expectedMimeType || req.file.mimetype !== attachmentMimeType) {
      return res.status(400).json({ error: 'Lampiran harus berupa JPG, PNG, atau PDF yang valid.' });
    }
    const attachmentId = crypto.randomUUID();
    const extension = attachmentMimeType === 'image/jpeg'
      ? 'jpg'
      : attachmentMimeType === 'image/png' ? 'png' : 'pdf';
    attachmentStorageKey = `document-attachments/${attachmentId}.${extension}`;
    attachmentPath = documentAttachmentStoragePath(attachmentStorageKey);
    if (!attachmentPath) throw new Error('Unable to create a safe document attachment path');
    await fs.mkdir(DOCUMENT_ATTACHMENT_DIRECTORY, { recursive: true, mode: 0o700 });
    await fs.writeFile(attachmentPath, req.file.buffer, { flag: 'wx', mode: 0o600 });
    attachmentWritten = true;
    attachmentOriginalName = safeLeaveAttachmentName(req.file.originalname);
  }
  let result;
  try {
    [result] = await pool.execute(
      `INSERT INTO documents (
         tenant_id, worker_id, \`type\`, status, valid_from, valid_until, target_completion_date,
         attachment_storage_key, attachment_original_name, attachment_mime_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.auth.tenantId,
        worker.id,
        type,
        status,
        dateFields.valid_from,
        dateFields.valid_until,
        dateFields.target_completion_date,
        attachmentStorageKey,
        attachmentOriginalName,
        attachmentMimeType,
      ]
    );
  } catch (error) {
    if (attachmentWritten) {
      try {
        await fs.unlink(attachmentPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('Failed to remove an uncommitted document attachment:', cleanupError);
      }
    }
    throw error;
  }
  const [rows] = await pool.execute(
    `SELECT id, worker_id, \`type\`, status, valid_from, valid_until, target_completion_date,
            attachment_storage_key IS NOT NULL AS has_attachment, attachment_original_name,
            created_at, updated_at
       FROM documents WHERE id = ? AND tenant_id = ?`,
    [result.insertId, req.auth.tenantId]
  );
  const document = rows[0];
  await recordAudit(req, {
  action: 'create',
  entityType: 'document',
  entityId: result.insertId,
  description: `Dokumen ${type} untuk pekerja "${worker.full_name}" dicatat dengan status ${status}.`,
  });
  res.status(201).json({
    data: {
      ...document,
      valid_from: document.valid_from ? String(document.valid_from).slice(0, 10) : null,
      valid_until: document.valid_until ? String(document.valid_until).slice(0, 10) : null,
      target_completion_date: document.target_completion_date ? String(document.target_completion_date).slice(0, 10) : null,
      has_attachment: Boolean(document.has_attachment),
    },
  });
}));

app.post(
  '/api/workers/:id/documents/:documentId/renew',
  requireManager,
  documentAttachmentUpload.single('attachment'),
  asyncRoute(async (req, res) => {
    if (!validWorkerId(req.params.id) || !validWorkerId(req.params.documentId)) {
      return res.status(400).json({ error: 'Invalid worker or document ID' });
    }
    const noteInput = req.body?.note ?? '';
    if (typeof noteInput !== 'string') {
      return res.status(400).json({ error: 'Keterangan dokumen tidak valid.' });
    }

    const connection = await pool.getConnection();
    let attachmentPath;
    let attachmentWritten = false;
    let committed = false;
    let insertedDocumentId;
    try {
      await connection.beginTransaction();
      const [workers] = await connection.execute(
        `SELECT id, full_name FROM workers
          WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
          FOR UPDATE`,
        [req.params.id, req.auth.tenantId]
      );
      const worker = workers[0];
      if (!worker) {
        await connection.rollback();
        return res.status(404).json({ error: 'Worker not found' });
      }
      const [documents] = await connection.execute(
        `SELECT id, \`type\`, status, renewed_from_document_id FROM documents
          WHERE id = ? AND worker_id = ? AND tenant_id = ? AND deleted_at IS NULL
            AND superseded_by_document_id IS NULL
          FOR UPDATE`,
        [req.params.documentId, worker.id, req.auth.tenantId]
      );
      const sourceDocument = documents[0];
      const renewableStatus = sourceDocument && (
        ['valid', 'expired'].includes(sourceDocument.status)
        || (sourceDocument.renewed_from_document_id != null && ['pending', 'rejected'].includes(sourceDocument.status))
      );
      if (!renewableStatus) {
        await connection.rollback();
        return res.status(404).json({ error: 'Dokumen aktif untuk diperpanjang tidak ditemukan.' });
      }
      const [todayRows] = await connection.execute(
        `SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') AS today`
      );
      const renewal = documentRenewalFields(req.body?.status, req.body || {}, todayRows[0].today);
      if (!renewal) {
        await connection.rollback();
        return res.status(400).json({
          error: 'Periksa status pembaruan, tanggal yang diperlukan, dan keterangan penolakan (minimal 5 karakter).',
        });
      }

      let attachmentStorageKey = null;
      let attachmentOriginalName = null;
      let attachmentMimeType = null;
      if (req.file) {
        attachmentMimeType = documentAttachmentMimeType(req.file.buffer);
        const expectedMimeType = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.pdf': 'application/pdf',
        }[path.extname(req.file.originalname).toLowerCase()];
        if (!attachmentMimeType || attachmentMimeType !== expectedMimeType || req.file.mimetype !== attachmentMimeType) {
          await connection.rollback();
          return res.status(400).json({ error: 'Lampiran harus berupa JPG, PNG, atau PDF yang valid.' });
        }
        const attachmentId = crypto.randomUUID();
        const extension = attachmentMimeType === 'image/jpeg'
          ? 'jpg'
          : attachmentMimeType === 'image/png' ? 'png' : 'pdf';
        attachmentStorageKey = `document-attachments/${attachmentId}.${extension}`;
        attachmentPath = documentAttachmentStoragePath(attachmentStorageKey);
        if (!attachmentPath) throw new Error('Unable to create a safe document attachment path');
        await fs.mkdir(DOCUMENT_ATTACHMENT_DIRECTORY, { recursive: true, mode: 0o700 });
        await fs.writeFile(attachmentPath, req.file.buffer, { flag: 'wx', mode: 0o600 });
        attachmentWritten = true;
        attachmentOriginalName = safeLeaveAttachmentName(req.file.originalname);
      }
      const [result] = await connection.execute(
        `INSERT INTO documents (
           tenant_id, worker_id, \`type\`, status, valid_from, valid_until, target_completion_date,
           renewed_from_document_id, attachment_storage_key, attachment_original_name,
           attachment_mime_type, renewal_note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.auth.tenantId,
          worker.id,
          sourceDocument.type,
          renewal.status,
          renewal.valid_from,
          renewal.valid_until,
          renewal.target_completion_date,
          sourceDocument.id,
          attachmentStorageKey,
          attachmentOriginalName,
          attachmentMimeType,
          renewal.note,
        ]
      );
      insertedDocumentId = String(result.insertId);
      await connection.execute(
        `UPDATE documents SET superseded_by_document_id = ?
          WHERE id = ? AND worker_id = ? AND tenant_id = ? AND deleted_at IS NULL
            AND superseded_by_document_id IS NULL`,
        [insertedDocumentId, sourceDocument.id, worker.id, req.auth.tenantId]
      );
      await recordAudit(req, {
        action: 'create',
        entityType: 'document',
        entityId: insertedDocumentId,
        description: `Pembaruan dokumen ${sourceDocument.type} pekerja "${worker.full_name}" dicatat dengan status ${renewal.status}${renewal.valid_until ? ` hingga ${renewal.valid_until}` : ''}.`,
      }, connection);
      await connection.commit();
      committed = true;
    } catch (error) {
      if (!committed) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Failed to roll back document renewal transaction:', rollbackError);
        }
      }
      if (attachmentWritten) {
        try {
          await fs.unlink(attachmentPath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            console.error('Failed to remove an uncommitted document attachment:', cleanupError);
          }
        }
      }
      throw error;
    } finally {
      connection.release();
    }

    const documents = await listWorkerDocuments(req.auth.tenantId, req.params.id);
    const renewedDocument = documents.find((document) => document.id === insertedDocumentId);
    res.status(201).json({ data: renewedDocument });
  })
);

app.get('/api/workers/:id/documents/:documentId/attachment', requireManager, asyncRoute(async (req, res) => {
  if (!validWorkerId(req.params.id) || !validWorkerId(req.params.documentId)) {
    return res.status(400).json({ error: 'Invalid worker or document ID' });
  }
  const [rows] = await pool.execute(
    `SELECT attachment_storage_key, attachment_original_name, attachment_mime_type
       FROM documents
      WHERE id = ? AND worker_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [req.params.documentId, req.params.id, req.auth.tenantId]
  );
  const attachment = rows[0];
  if (!attachment || !attachment.attachment_storage_key) {
    return res.status(404).json({ error: 'Attachment not found' });
  }
  const filePath = documentAttachmentStoragePath(attachment.attachment_storage_key);
  if (!filePath) {
    console.error(`Invalid document attachment storage key for document ${req.params.documentId}`);
    return res.status(500).json({ error: 'Attachment is unavailable' });
  }
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Attachment not found' });
    throw error;
  }
  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${attachment.attachment_original_name.replace(/["\\\r\n]/g, '_')}"`,
    'Content-Type': attachment.attachment_mime_type,
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(filePath);
}));

app.delete('/api/workers/:id/documents/:documentId', requireAdmin, asyncRoute(async (req, res) => {
  const worker = await getWorker(req.auth.tenantId, req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  const [result] = await pool.execute(
    `UPDATE documents SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND worker_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [req.params.documentId, worker.id, req.auth.tenantId]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Document not found' });
  await recordAudit(req, {
    action: 'delete',
    entityType: 'document',
    entityId: req.params.documentId,
    description: `Dokumen pekerja "${worker.full_name}" diarsipkan.`,
  });
  res.status(204).end();
}));

app.patch('/api/workers/:id/status', requireAdmin, asyncRoute(async (req, res) => {
  const { status, effective_date: effectiveDate, worker_number: workerNumberInput } = req.body || {};
  const workerNumber = typeof workerNumberInput === 'string' && validWorkerNumber(workerNumberInput)
    ? normalizeWorkerNumber(workerNumberInput)
    : null;
  if (status === 'active' && !workerNumber) {
    return res.status(400).json({ error: 'Nomor pekerja wajib diisi saat mengaktifkan pekerja' });
  }
  if (workerNumberInput != null && workerNumberInput !== '' && !validWorkerNumber(workerNumberInput)) {
    return res.status(400).json({ error: 'Nomor pekerja harus 1–50 karakter dan hanya berisi huruf, angka, titik, garis bawah, garis miring, atau tanda hubung' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let subscription;
    if (status === 'active') {
      subscription = await getTenantSubscription(connection, req.auth.tenantId, true);
    }
    const worker = await getWorker(req.auth.tenantId, req.params.id, connection, true);
    if (!worker) {
      await connection.rollback();
      return res.status(404).json({ error: 'Worker not found' });
    }
    const [todayRows] = await connection.execute("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
    if (status === 'inactive' && effectiveDate != null && !validDate(effectiveDate)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Effective inactive date must use YYYY-MM-DD format' });
    }
    if (status !== 'inactive' && effectiveDate != null) {
      await connection.rollback();
      return res.status(400).json({ error: 'Effective date is only supported for inactive status' });
    }
    if (!WORKER_STATUSES.has(status) || status === worker.status
      || !canTransitionStatus(worker.status, status)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Status transition is not allowed' });
    }
    if (status === 'active' && exceedsWorkerQuota(subscription)) {
      await connection.rollback();
      return workerQuotaExceeded(res, subscription);
    }
    if (status === 'active') {
      const [activeNumberRows] = await connection.execute(
        `SELECT id FROM workers
          WHERE tenant_id = ? AND worker_number = ? AND status = 'active'
            AND deleted_at IS NULL AND id <> ?
          LIMIT 1 FOR UPDATE`,
        [req.auth.tenantId, workerNumber, worker.id]
      );
      if (activeNumberRows.length) {
        await connection.rollback();
        return res.status(409).json({ error: 'Nomor pekerja sudah digunakan oleh karyawan aktif' });
      }
    }
    if (status === 'inactive' && effectiveDate && effectiveDate > todayRows[0].today) {
      await connection.execute(
        `UPDATE workers SET scheduled_inactive_date = ?
          WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [effectiveDate, worker.id, req.auth.tenantId]
      );
      await recordAudit(req, {
        action: 'update',
        entityType: 'worker_status',
        entityId: worker.id,
        description: `Penonaktifan pekerja "${worker.full_name}" dijadwalkan pada ${effectiveDate}.`,
      }, connection);
      await connection.commit();
      return res.json({ data: { id: String(worker.id), status: worker.status, scheduled_inactive_date: effectiveDate } });
    }
    await connection.execute(
      `UPDATE workers SET status = ?, scheduled_inactive_date = NULL
        ${status === 'active' ? ', worker_number = ?' : ''}
        WHERE id = ? AND tenant_id = ?`,
      status === 'active'
        ? [status, workerNumber, worker.id, req.auth.tenantId]
        : [status, worker.id, req.auth.tenantId]
    );
    if (status === 'inactive') {
      await connection.execute(
        `UPDATE worker_portal_sessions SET revoked_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND worker_id = ? AND revoked_at IS NULL`,
        [req.auth.tenantId, worker.id]
      );
      await connection.execute(
        `UPDATE worker_portal_enrollment_codes SET used_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND worker_id = ? AND used_at IS NULL`,
        [req.auth.tenantId, worker.id]
      );
    }
    await connection.execute(
      `INSERT INTO worker_status_history (tenant_id, worker_id, user_id, previous_status, new_status)
       VALUES (?, ?, ?, ?, ?)`,
      [req.auth.tenantId, worker.id, req.auth.userId, worker.status, status]
    );
    await recordAudit(req, {
      action: 'update',
      entityType: 'worker_status',
      entityId: worker.id,
      description: `Status pekerja "${worker.full_name}" berubah dari ${worker.status} menjadi ${status}.`,
    }, connection);
    await connection.commit();
    res.json({
      data: {
        id: String(worker.id),
        status,
        worker_number: status === 'active' ? workerNumber : worker.worker_number,
      },
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY' && status === 'active') {
      return res.status(409).json({ error: 'Nomor pekerja sudah digunakan oleh karyawan aktif' });
    }
    throw error;
  } finally {
    connection.release();
  }
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMessage = req.originalUrl.includes('/documents/') && req.originalUrl.endsWith('/renew')
        ? 'Document attachment must be 5 MB or smaller'
        : req.originalUrl.startsWith('/api/leaves')
          ? 'Leave attachment must be 5 MB or smaller'
          : 'Profile and attendance images must be 900 KB or smaller';
      return res.status(413).json({ error: maxSizeMessage });
    }
    const uploadMessage = req.originalUrl.includes('/documents/') && req.originalUrl.endsWith('/renew')
      ? 'Upload one JPG, PNG, or PDF document at a time'
      : 'Upload one JPG or PNG image at a time';
    return res.status(400).json({ error: uploadMessage });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'A record with these details already exists' });
  }
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred' });
});

async function applyScheduledInactivations() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [workers] = await connection.execute(
      `SELECT id, tenant_id, status
         FROM workers
        WHERE deleted_at IS NULL AND scheduled_inactive_date <= CURDATE()
          AND status <> 'inactive'
        FOR UPDATE`
    );
    for (const worker of workers) {
      await connection.execute(
        `UPDATE workers SET status = 'inactive', scheduled_inactive_date = NULL
          WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [worker.id, worker.tenant_id]
      );
      await connection.execute(
        `INSERT INTO worker_status_history (tenant_id, worker_id, user_id, previous_status, new_status)
         VALUES (?, ?, NULL, ?, 'inactive')`,
        [worker.tenant_id, worker.id, worker.status]
      );
      await connection.execute(
        `UPDATE worker_portal_sessions SET revoked_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND worker_id = ? AND revoked_at IS NULL`,
        [worker.tenant_id, worker.id]
      );
      await connection.execute(
        `UPDATE worker_portal_enrollment_codes SET used_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND worker_id = ? AND used_at IS NULL`,
        [worker.tenant_id, worker.id]
      );
      await connection.execute(
        `INSERT INTO audit_events
           (tenant_id, user_id, actor_name, actor_role, action, entity_type, entity_id, description)
         VALUES (?, NULL, 'Sistem', 'system', 'update', 'worker_status', ?, ?)`,
        [
          worker.tenant_id,
          String(worker.id),
          `Status pekerja ${worker.id} berubah dari ${worker.status} menjadi inactive sesuai jadwal.`,
        ]
      );
    }
    await connection.commit();
    for (const worker of workers) {
      publishTenantEvent(worker.tenant_id, 'worker_changed', {
        action: 'scheduled_inactivation',
        worker_id: String(worker.id),
      });
      publishTenantEvent(worker.tenant_id, 'dashboard_updated', { action: 'scheduled_inactivation' });
      publishTenantEvent(worker.tenant_id, 'history_updated', { action: 'scheduled_inactivation' });
    }
    return workers.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function startServer() {
  getJwtSecret();
  await initializeDatabase();
  await applyScheduledInactivations();
  const httpServer = http.createServer(app);
  realtimeServer = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
  });
  realtimeServer.use(async (socket, next) => {
    let payload;
    try {
      const cookieHeader = socket.request.headers.cookie || '';
      const sessionCookie = cookieHeader.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE_NAME}=`));
      if (!sessionCookie) return next(new Error('Authentication required'));
      const token = decodeURIComponent(sessionCookie.slice(COOKIE_NAME.length + 1));
      payload = jwt.verify(token, getJwtSecret(), { issuer: 'hrd-management' });
    } catch {
      return next(new Error('Session is invalid or expired'));
    }
    try {
      const [rows] = await pool.execute(
        `SELECT id, tenant_id, is_active, token_version
           FROM users WHERE id = ? AND tenant_id = ?`,
        [String(payload.sub), String(payload.tenantId)]
      );
      const user = rows[0];
      if (!user || !user.is_active || Number(user.token_version) !== Number(payload.sessionVersion)) {
        return next(new Error('Session is invalid or expired'));
      }
      socket.data.userId = String(user.id);
      socket.data.tenantId = String(user.tenant_id);
      socket.data.sessionVersion = Number(user.token_version);
      socket.data.sessionExpiresAt = Number(payload.exp);
      next();
    } catch (error) {
      next(error);
    }
  });
  realtimeServer.on('connection', (socket) => {
    socket.join(`tenant:${socket.data.tenantId}`);
    socket.emit('realtime_ready', { connected: true });
    const sessionCheck = setInterval(() => {
      pool.execute(
        `SELECT is_active, token_version FROM users
          WHERE id = ? AND tenant_id = ?`,
        [socket.data.userId, socket.data.tenantId]
      ).then(([rows]) => {
        const user = rows[0];
        if (!user || !user.is_active
          || Number(user.token_version) !== socket.data.sessionVersion
          || Date.now() >= socket.data.sessionExpiresAt * 1000) {
          socket.disconnect(true);
        }
      }).catch((error) => {
        console.error('WebSocket session validation failed:', error);
        socket.disconnect(true);
      });
    }, 60 * 1000);
    sessionCheck.unref();
    socket.on('disconnect', () => clearInterval(sessionCheck));
  });
  const scheduledInactivationTimer = setInterval(() => {
    applyScheduledInactivations().catch((error) => console.error('Scheduled worker inactivation failed:', error));
  }, 60 * 1000);
  scheduledInactivationTimer.unref();
  httpServer.listen(PORT, () => console.log(`HRD API listening with real-time events on http://localhost:${PORT}`));
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start HRD API:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
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
  documentAttachmentMimeType,
  documentAttachmentStoragePath,
  validDocumentWarningThreshold,
  attendanceMonthRange,
  validRequiredDocuments,
  documentTypeCode,
  documentDateFields,
  documentRenewalFields,
  parseRequiredDocuments,
  canTransitionStatus,
  hashEmail,
  hashPasswordResetToken,
  takeAuthRateLimit,
  validPhoneNumber,
  validNationalId,
  validDepartment,
  normalizeText,
  normalizeDocumentTypeName,
  hashNormalizedText,
  validSalaryRate,
  validPassword,
  validProfilePhotoUrl,
  profilePhotoMimeType,
  MAX_PROFILE_PHOTO_BYTES,
  validAttendanceToken,
  hashAttendanceToken,
  encryptCompanyPortalToken,
  decryptCompanyPortalToken,
  findMatchingPortalSession,
  validWorkerId,
  validWorkerNumber,
  validUuidLockEnabled,
  shouldRejectPortalUuidMismatch,
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
  applyScheduledInactivations,
  initializeDatabase,
  pool,
};
