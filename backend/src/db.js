const mysql = require('mysql2/promise');

const databaseName = process.env.DB_NAME || 'hrd_management';

if (databaseName.length > 64 || !/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('DB_NAME must be 64 characters or fewer and contain only letters, numbers, and underscores');
}

const connectionOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
};

const pool = mysql.createPool({
  ...connectionOptions,
  database: databaseName,
});

async function initializeDatabase() {
  const connection = await mysql.createConnection(connectionOptions);
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }

  const [versionRows] = await pool.query('SELECT VERSION() AS server_version');
  const generatedColumnStorage = /mariadb/i.test(versionRows[0].server_version) ? 'PERSISTENT' : 'STORED';

  const statements = [
    `CREATE TABLE IF NOT EXISTS tenants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(170) NOT NULL UNIQUE,
      subscription_plan ENUM('free', 'pro', 'enterprise') NOT NULL DEFAULT 'free',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      full_name VARCHAR(150) NULL,
      email VARCHAR(254) NOT NULL,
      email_hash BINARY(32) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'hr_manager', 'viewer') NOT NULL DEFAULT 'admin',
      profile_photo_url VARCHAR(2048) NULL,
      profile_photo_data MEDIUMBLOB NULL,
      profile_photo_mime_type VARCHAR(32) NULL,
      profile_photo_updated_at TIMESTAMP NULL DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      token_version INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email_hash (email_hash),
      CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash BINARY(32) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_password_reset_token_hash (token_hash),
      KEY ix_password_reset_user_created (user_id, created_at),
      KEY ix_password_reset_expiry (expires_at),
      CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      actor_name VARCHAR(150) NOT NULL,
      actor_role VARCHAR(32) NOT NULL,
      action VARCHAR(24) NOT NULL,
      entity_type VARCHAR(48) NOT NULL,
      entity_id VARCHAR(64) NULL,
      description VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY ix_audit_events_tenant_created (tenant_id, created_at, id),
      CONSTRAINT fk_audit_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_audit_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS workers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(254) NULL,
      email_hash BINARY(32) NULL,
      position VARCHAR(150) NOT NULL,
      phone_number VARCHAR(30) NULL,
      national_id CHAR(16) NULL,
      address VARCHAR(500) NULL,
      department VARCHAR(150) NULL,
      placement_client VARCHAR(150) NULL,
      work_location VARCHAR(150) NULL,
      contract_type ENUM('pkwt', 'pkwtt', 'freelance', 'daily_worker') NOT NULL DEFAULT 'pkwt',
      offer_date DATE NULL,
      join_date DATE NULL,
      salary_rate DECIMAL(15, 2) NULL,
      status ENUM('offered', 'preactive', 'active', 'inactive') NOT NULL DEFAULT 'offered',
      required_document_types LONGTEXT NOT NULL,
      deleted_at DATETIME NULL,
      scheduled_inactive_date DATE NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY ix_workers_tenant_status (tenant_id, status),
      UNIQUE KEY uq_workers_id_tenant (id, tenant_id),
      UNIQUE KEY uq_workers_tenant_email_hash (tenant_id, email_hash),
      CONSTRAINT fk_workers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS departments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(150) NOT NULL,
      name_hash BINARY(32) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_departments_tenant_name_hash (tenant_id, name_hash),
      CONSTRAINT fk_departments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS document_types (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(100) NOT NULL,
      name_hash BINARY(32) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_builtin TINYINT(1) NOT NULL DEFAULT 0,
      warning_threshold_days SMALLINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_document_types_tenant_code (tenant_id, code),
      UNIQUE KEY uq_document_types_tenant_name_hash (tenant_id, name_hash),
      CONSTRAINT fk_document_types_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS documents (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      worker_id BIGINT UNSIGNED NOT NULL,
      \`type\` VARCHAR(64) NOT NULL,
      status ENUM('pending', 'valid', 'expired', 'rejected') NOT NULL DEFAULT 'pending',
      valid_from DATE NULL,
      valid_until DATE NULL,
      target_completion_date DATE NULL,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY ix_documents_worker_type (tenant_id, worker_id, \`type\`),
      KEY ix_documents_expiry (tenant_id, valid_until),
      CONSTRAINT fk_documents_worker_tenant FOREIGN KEY (worker_id, tenant_id) REFERENCES workers(id, tenant_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS worker_status_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      worker_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      previous_status ENUM('offered', 'preactive', 'active', 'inactive') NULL,
      new_status ENUM('offered', 'preactive', 'active', 'inactive') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY ix_status_history_worker (tenant_id, worker_id, created_at),
      CONSTRAINT fk_history_worker_tenant FOREIGN KEY (worker_id, tenant_id) REFERENCES workers(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS worker_attendance_links (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      worker_id BIGINT UNSIGNED NOT NULL,
      token_hash BINARY(32) NOT NULL,
      revoked_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attendance_link_token_hash (token_hash),
      UNIQUE KEY uq_attendance_link_worker (tenant_id, worker_id),
      CONSTRAINT fk_attendance_link_worker_tenant FOREIGN KEY (worker_id, tenant_id) REFERENCES workers(id, tenant_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS tenant_attendance_settings (
      tenant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      token_salt BINARY(32) NULL,
      anti_mock_location_enabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_attendance_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS tenant_document_settings (
      tenant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      warning_threshold_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_document_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS tenant_attendance_locations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(100) NOT NULL,
      latitude DECIMAL(10, 7) NOT NULL,
      longitude DECIMAL(10, 7) NOT NULL,
      radius_meters SMALLINT UNSIGNED NOT NULL,
      allowed_activities LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attendance_location_tenant_name (tenant_id, name),
      KEY ix_attendance_location_tenant (tenant_id),
      CONSTRAINT fk_attendance_location_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id BIGINT UNSIGNED NOT NULL,
      worker_id BIGINT UNSIGNED NOT NULL,
      attendance_date DATE NOT NULL,
      check_in_time DATETIME NULL,
      check_out_time DATETIME NULL,
      check_in_latitude DECIMAL(10, 7) NULL,
      check_in_longitude DECIMAL(10, 7) NULL,
      check_out_latitude DECIMAL(10, 7) NULL,
      check_out_longitude DECIMAL(10, 7) NULL,
      location_id BIGINT UNSIGNED NULL,
      attendance_type ENUM('regular', 'off', 'permission', 'leave', 'sick', 'dinas') NOT NULL DEFAULT 'regular',
      approval_status ENUM('not_required', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'not_required',
      approval_note VARCHAR(500) NULL,
      approved_by BIGINT UNSIGNED NULL,
      approval_updated_at DATETIME NULL,
      evidence_data MEDIUMBLOB NULL,
      evidence_mime_type VARCHAR(32) NULL,
      status ENUM('present', 'permission', 'sick', 'absent', 'off', 'leave', 'dinas') NOT NULL DEFAULT 'present',
      deleted_at DATETIME NULL,
      active_attendance_date DATE GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN attendance_date ELSE NULL END) ${generatedColumnStorage},
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attendance_worker_active_date (tenant_id, worker_id, active_attendance_date),
      KEY ix_attendance_tenant_date (tenant_id, attendance_date),
      CONSTRAINT fk_attendance_worker_tenant FOREIGN KEY (worker_id, tenant_id) REFERENCES workers(id, tenant_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }

  const [attendanceSettingColumns] = await pool.execute(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tenant_attendance_settings'`,
    [databaseName]
  );
  const attendanceSettingColumnMap = new Map(attendanceSettingColumns.map((column) => [column.COLUMN_NAME, column.IS_NULLABLE]));
  if (attendanceSettingColumnMap.get('token_salt') === 'NO') {
    await pool.query('ALTER TABLE tenant_attendance_settings MODIFY COLUMN token_salt BINARY(32) NULL');
  }
  if (!attendanceSettingColumnMap.has('anti_mock_location_enabled')) {
    await pool.query(
      'ALTER TABLE tenant_attendance_settings ADD COLUMN anti_mock_location_enabled TINYINT(1) NOT NULL DEFAULT 0'
    );
  }

  const [attendanceColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendance'`,
    [databaseName]
  );
  const existingAttendanceColumns = new Set(attendanceColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));
  const attendanceMigrations = [
    ['check_in_latitude', 'DECIMAL(10, 7) NULL'],
    ['check_in_longitude', 'DECIMAL(10, 7) NULL'],
    ['check_out_latitude', 'DECIMAL(10, 7) NULL'],
    ['check_out_longitude', 'DECIMAL(10, 7) NULL'],
    ['location_id', 'BIGINT UNSIGNED NULL'],
    ['attendance_type', "ENUM('regular', 'off', 'permission', 'leave', 'sick', 'dinas') NOT NULL DEFAULT 'regular'"],
    ['approval_status', "ENUM('not_required', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'not_required'"],
    ['approval_note', 'VARCHAR(500) NULL'],
    ['approved_by', 'BIGINT UNSIGNED NULL'],
    ['approval_updated_at', 'DATETIME NULL'],
    ['evidence_data', 'MEDIUMBLOB NULL'],
    ['evidence_mime_type', 'VARCHAR(32) NULL'],
    ['deleted_at', 'DATETIME NULL'],
  ];
  for (const [columnName, columnDefinition] of attendanceMigrations) {
    if (!existingAttendanceColumns.has(columnName)) {
      await pool.query(`ALTER TABLE attendance ADD COLUMN \`${columnName}\` ${columnDefinition}`);
    }
  }
  if (!existingAttendanceColumns.has('active_attendance_date')) {
    await pool.query(
      `ALTER TABLE attendance ADD COLUMN active_attendance_date DATE
       GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN attendance_date ELSE NULL END) ${generatedColumnStorage}`
    );
  }
  const [attendanceIndexes] = await pool.execute(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendance'`,
    [databaseName]
  );
  const attendanceIndexNames = new Set(attendanceIndexes.map(({ INDEX_NAME }) => INDEX_NAME));
  if (attendanceIndexNames.has('uq_attendance_worker_date')) {
    await pool.query('ALTER TABLE attendance DROP INDEX uq_attendance_worker_date');
  }
  if (!attendanceIndexNames.has('uq_attendance_worker_active_date')) {
    await pool.query('ALTER TABLE attendance ADD UNIQUE KEY uq_attendance_worker_active_date (tenant_id, worker_id, active_attendance_date)');
  }
  await pool.query(
    `ALTER TABLE attendance MODIFY COLUMN status
       ENUM('present', 'permission', 'sick', 'absent', 'off', 'leave', 'dinas') NOT NULL DEFAULT 'present'`
  );

  const [userColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
    [databaseName]
  );
  const existingUserColumns = new Set(userColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));
  const userMigrations = [
    ['full_name', 'VARCHAR(150) NULL'],
    ['profile_photo_url', 'VARCHAR(2048) NULL'],
    ['profile_photo_data', 'MEDIUMBLOB NULL'],
    ['profile_photo_mime_type', 'VARCHAR(32) NULL'],
    ['profile_photo_updated_at', 'TIMESTAMP NULL DEFAULT NULL'],
    ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['token_version', 'INT UNSIGNED NOT NULL DEFAULT 0'],
  ];
  for (const [columnName, columnDefinition] of userMigrations) {
    if (!existingUserColumns.has(columnName)) {
      await pool.query(`ALTER TABLE users ADD COLUMN \`${columnName}\` ${columnDefinition}`);
    }
  }
  await pool.query(
    `UPDATE users SET full_name = SUBSTRING_INDEX(email, '@', 1)
      WHERE full_name IS NULL OR TRIM(full_name) = ''`
  );
  const [tenantColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tenants'`,
    [databaseName]
  );
  if (!tenantColumns.some(({ COLUMN_NAME }) => COLUMN_NAME === 'subscription_plan')) {
    await pool.query(
      "ALTER TABLE tenants ADD COLUMN subscription_plan ENUM('free', 'pro', 'enterprise') NOT NULL DEFAULT 'free'"
    );
  }
  for (const [table, columns] of [
    ['users', ['full_name']],
    ['tenants', ['name']],
  ]) {
    for (const column of columns) {
      await pool.query(
        `UPDATE \`${table}\`
            SET \`${column}\` = LOWER(TRIM(\`${column}\`))
          WHERE \`${column}\` IS NOT NULL
            AND BINARY \`${column}\` <> BINARY LOWER(TRIM(\`${column}\`))`
      );
    }
  }

  const workerColumns = [
    ['phone_number', 'VARCHAR(30) NULL'],
    ['national_id', 'CHAR(16) NULL'],
    ['address', 'VARCHAR(500) NULL'],
    ['department', 'VARCHAR(150) NULL'],
    ['placement_client', 'VARCHAR(150) NULL'],
    ['work_location', 'VARCHAR(150) NULL'],
    ['contract_type', "ENUM('pkwt', 'pkwtt', 'freelance', 'daily_worker') NOT NULL DEFAULT 'pkwt'"],
    ['join_date', 'DATE NULL'],
    ['salary_rate', 'DECIMAL(15, 2) NULL'],
    ['deleted_at', 'DATETIME NULL'],
    ['scheduled_inactive_date', 'DATE NULL'],
  ];

  const [existingColumns] = await pool.execute(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'workers'`,
    [databaseName]
  );
  const existingColumnNames = new Set(existingColumns.map(({ COLUMN_NAME }) => COLUMN_NAME));
  const existingColumnTypes = new Map(existingColumns.map(({ COLUMN_NAME, DATA_TYPE }) => [COLUMN_NAME, DATA_TYPE]));
  for (const [columnName, columnDefinition] of workerColumns) {
    if (!existingColumnNames.has(columnName)) {
      await pool.query(`ALTER TABLE workers ADD COLUMN \`${columnName}\` ${columnDefinition}`);
    }
  }
  for (const column of ['full_name', 'address', 'department', 'position', 'work_location', 'placement_client']) {
    await pool.query(
      `UPDATE workers
          SET \`${column}\` = LOWER(TRIM(\`${column}\`))
        WHERE \`${column}\` IS NOT NULL
          AND BINARY \`${column}\` <> BINARY LOWER(TRIM(\`${column}\`))`
    );
  }

  if (existingColumnTypes.get('placement_client') === 'enum') {
    await pool.query('ALTER TABLE workers MODIFY COLUMN placement_client VARCHAR(150) NULL');
    await pool.query(
      `UPDATE workers
          SET placement_client = CASE placement_client
            WHEN 'client_a' THEN 'klien a'
            WHEN 'client_b' THEN 'klien b'
            WHEN 'pool' THEN 'cadangan / pool'
            ELSE placement_client
          END
        WHERE placement_client IN ('client_a', 'client_b', 'pool')`
    );
  }

  const [documentTypeColumns] = await pool.execute(
    `SELECT DATA_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'type'`,
    [databaseName]
  );
  if (documentTypeColumns[0]?.DATA_TYPE !== 'varchar') {
    await pool.query('ALTER TABLE documents MODIFY COLUMN `type` VARCHAR(64) NOT NULL');
  }
  const [existingDocumentTypeColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_types'`,
    [databaseName]
  );
  if (!existingDocumentTypeColumns.some(({ COLUMN_NAME }) => COLUMN_NAME === 'warning_threshold_days')) {
    await pool.query('ALTER TABLE document_types ADD COLUMN warning_threshold_days SMALLINT UNSIGNED NULL');
  }
  const [existingDocumentColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'documents'`,
    [databaseName]
  );
  if (!existingDocumentColumns.some(({ COLUMN_NAME }) => COLUMN_NAME === 'target_completion_date')) {
    await pool.query('ALTER TABLE documents ADD COLUMN target_completion_date DATE NULL');
  }
  if (!existingDocumentColumns.some(({ COLUMN_NAME }) => COLUMN_NAME === 'deleted_at')) {
    await pool.query('ALTER TABLE documents ADD COLUMN deleted_at DATETIME NULL');
  }
  await pool.query(
    `UPDATE departments
        SET name = LOWER(TRIM(name)),
            name_hash = UNHEX(SHA2(LOWER(TRIM(name)), 256))
      WHERE BINARY name <> BINARY LOWER(TRIM(name))
         OR name_hash <> UNHEX(SHA2(LOWER(TRIM(name)), 256))`
  );
  await pool.query(
    `UPDATE document_types
        SET name = LOWER(TRIM(name)),
            name_hash = UNHEX(SHA2(LOWER(TRIM(name)), 256))
      WHERE BINARY name <> BINARY LOWER(TRIM(name))
         OR name_hash <> UNHEX(SHA2(LOWER(TRIM(name)), 256))`
  );

  const [builtInTypes] = await pool.execute(
    'SELECT id, tenant_id, code FROM document_types WHERE is_builtin = 1'
  );
  for (const type of builtInTypes) {
    const [workerRows] = await pool.execute(
      'SELECT required_document_types FROM workers WHERE tenant_id = ?',
      [type.tenant_id]
    );
    const isRequired = workerRows.some(({ required_document_types }) => {
      const requiredTypes = Array.isArray(required_document_types)
        ? required_document_types
        : JSON.parse(required_document_types);
      return requiredTypes.includes(type.code);
    });
    const [documentRows] = await pool.execute(
      'SELECT id FROM documents WHERE tenant_id = ? AND `type` = ? LIMIT 1',
      [type.tenant_id, type.code]
    );
    if (isRequired || documentRows.length) {
      await pool.execute(
        'UPDATE document_types SET is_active = 0 WHERE id = ?',
        [type.id]
      );
    } else {
      await pool.execute(
        'DELETE FROM document_types WHERE id = ?',
        [type.id]
      );
    }
  }
}

module.exports = { pool, initializeDatabase };
