"""
SMART ATTENDANCE SYSTEM - Database Helper Module
Student: Sahil Pasula | Class: TYBSC-A-39 | Seat No: 24TCS076
TY BSc Computer Science Project
"""

import hashlib
import hmac
import os
import secrets
import shutil
import sqlite3

DATABASE_NAME = 'smart_attendance.db'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULT_SETTINGS = {
    'attendance_threshold': '75',
    'face_distance_threshold': '0.55',
    'min_detection_confidence': '0.55',
    'institution_name': 'Department of Computer Science',
    'academic_year': '2026-2027',
    'default_subject': 'Advanced Python Programming',
}


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 120000)
    return f"pbkdf2_sha256${salt}${dk.hex()}"


def check_password(stored_hash: str, password: str) -> bool:
    try:
        scheme, salt, digest_hex = stored_hash.split('$', 2)
        if scheme != 'pbkdf2_sha256':
            return False
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 120000)
        return hmac.compare_digest(dk.hex(), digest_hex)
    except Exception:
        return False


def get_db_path() -> str:
    """
    Resolve writable SQLite path.
    On Vercel serverless runtime (/var/task is read-only), copy bundled DB into /tmp
    so reads and writes work cleanly during invocation without losing seed data.
    """
    local_path = os.path.join(BASE_DIR, DATABASE_NAME)
    if os.environ.get('VERCEL') or not os.access(BASE_DIR, os.W_OK):
        tmp_path = os.path.join('/tmp', DATABASE_NAME)
        if not os.path.exists(tmp_path):
            if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
                shutil.copy2(local_path, tmp_path)
        return tmp_path
    return local_path


def get_db_connection():
    """Establish and return a connection to the SQLite database with Row mapping."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema_migrations(conn)
    return conn


def _table_columns(conn, table_name: str) -> set:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {r['name'] for r in rows}


def ensure_schema_migrations(conn):
    """Non-destructively migrate existing smart_attendance.db tables to current schema."""
    tables = {
        r['name']
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    if not {'users', 'students', 'attendance', 'notifications'}.issubset(tables):
        schema_path = os.path.join(BASE_DIR, 'schema.sql')
        if os.path.exists(schema_path):
            with open(schema_path, 'r', encoding='utf-8') as f:
                conn.executescript(f.read())
            conn.commit()
            tables = {
                r['name']
                for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }

    # Users table migration
    user_cols = _table_columns(conn, 'users')
    if 'student_id' not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN student_id INTEGER DEFAULT NULL")

    # Students table migration
    student_cols = _table_columns(conn, 'students')
    if 'parent_name' not in student_cols:
        conn.execute("ALTER TABLE students ADD COLUMN parent_name TEXT DEFAULT ''")
    if 'parent_phone' not in student_cols:
        conn.execute("ALTER TABLE students ADD COLUMN parent_phone TEXT DEFAULT ''")
    if 'face_descriptor' not in student_cols:
        conn.execute("ALTER TABLE students ADD COLUMN face_descriptor TEXT DEFAULT NULL")

    # Notifications table migration
    notif_cols = _table_columns(conn, 'notifications')
    if 'dispatched_at' not in notif_cols:
        conn.execute("ALTER TABLE notifications ADD COLUMN dispatched_at TIMESTAMP DEFAULT NULL")
    if 'dispatch_channel' not in notif_cols:
        conn.execute("ALTER TABLE notifications ADD COLUMN dispatch_channel TEXT DEFAULT ''")

    # Settings table
    if 'settings' not in tables:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

    for k, v in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))

    # Attendance table migration (support per-subject attendance without losing existing rows)
    att_cols = _table_columns(conn, 'attendance')
    if 'subject' not in att_cols or 'method' not in att_cols:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS attendance_migrated (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                date DATE NOT NULL,
                time TIME NOT NULL,
                status TEXT CHECK(status IN ('Present', 'Absent')) NOT NULL,
                subject TEXT DEFAULT 'Advanced Python Programming',
                marked_by TEXT DEFAULT 'Admin',
                method TEXT DEFAULT 'Manual Roll Call',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
                UNIQUE(student_id, date, subject)
            )
        """)
        existing_rows = conn.execute("SELECT * FROM attendance").fetchall()
        for row in existing_rows:
            rdict = dict(row)
            conn.execute(
                """
                INSERT OR IGNORE INTO attendance_migrated
                (id, student_id, date, time, status, subject, marked_by, method, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rdict['id'],
                    rdict['student_id'],
                    rdict['date'],
                    rdict['time'],
                    rdict['status'],
                    rdict.get('subject') or 'Advanced Python Programming',
                    rdict.get('marked_by') or 'Admin',
                    rdict.get('method') or 'Manual Roll Call',
                    rdict.get('created_at'),
                ),
            )
        conn.execute("DROP TABLE attendance")
        conn.execute("ALTER TABLE attendance_migrated RENAME TO attendance")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance(subject)")
        conn.execute("PRAGMA foreign_keys = ON")

    conn.commit()


def init_db():
    """Initialize database tables using schema.sql and apply safe migrations."""
    schema_path = os.path.join(BASE_DIR, 'schema.sql')
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    with open(schema_path, 'r', encoding='utf-8') as f:
        conn.executescript(f.read())
    ensure_schema_migrations(conn)
    conn.commit()
    conn.close()


def verify_user_password(conn, username: str, password: str):
    """
    Validate user password safely.
    Supports hashed passwords (pbkdf2_sha256) and transparently upgrades
    legacy plaintext DB rows on successful verification.
    """
    user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user:
        return None

    stored = user['password'] or ''
    is_valid = False
    if stored.startswith('pbkdf2_sha256$'):
        is_valid = check_password(stored, password)
    else:
        is_valid = hmac.compare_digest(stored, password)
        if is_valid:
            new_hash = hash_password(password)
            conn.execute("UPDATE users SET password = ? WHERE id = ?", (new_hash, user['id']))
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user['id'],)).fetchone()

    return user if is_valid else None


def get_all_settings(conn=None) -> dict:
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    result = dict(DEFAULT_SETTINGS)
    for r in rows:
        result[r['key']] = r['value']

    if close_after:
        conn.close()
    return result


def get_attendance_threshold(conn=None) -> float:
    settings = get_all_settings(conn)
    try:
        val = float(settings.get('attendance_threshold', '75'))
        return max(1.0, min(100.0, val))
    except (TypeError, ValueError):
        return 75.0


def refresh_notifications(threshold: float = None):
    """
    Compute attendance percentage for every student against configurable threshold.
    Preserves existing is_read, dispatched_at, and dispatch_channel flags per student.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    if threshold is None:
        threshold = get_attendance_threshold(conn)

    # Preserve existing read/dispatch state keyed by student_id
    existing_state = {}
    for row in cursor.execute(
        "SELECT student_id, is_read, dispatched_at, dispatch_channel FROM notifications"
    ).fetchall():
        existing_state[row['student_id']] = {
            'is_read': row['is_read'],
            'dispatched_at': row['dispatched_at'],
            'dispatch_channel': row['dispatch_channel'],
        }

    cursor.execute("DELETE FROM notifications WHERE title LIKE '%Attendance Shortage%'")

    students = cursor.execute(
        "SELECT id, name, roll_number, seat_number FROM students"
    ).fetchall()

    for student in students:
        s_id = student['id']
        total_days = cursor.execute(
            "SELECT COUNT(*) as count FROM attendance WHERE student_id = ?", (s_id,)
        ).fetchone()['count']

        if total_days > 0:
            present_days = cursor.execute(
                "SELECT COUNT(*) as count FROM attendance WHERE student_id = ? AND status = 'Present'",
                (s_id,),
            ).fetchone()['count']

            percentage = round((present_days / total_days) * 100, 2)

            if percentage < threshold:
                prev = existing_state.get(s_id, {})
                title = f"Attendance Shortage Warning (<{int(threshold)}%)"
                message = (
                    f"Warning: {student['name']} (Roll: {student['roll_number']}) has only "
                    f"{percentage}% attendance ({present_days}/{total_days} sessions attended). "
                    f"Minimum mandatory requirement is {threshold:g}% for University exam eligibility."
                )
                cursor.execute(
                    """
                    INSERT INTO notifications (
                        student_id, title, message, percentage, is_read, dispatched_at, dispatch_channel
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        s_id,
                        title,
                        message,
                        percentage,
                        prev.get('is_read', 0),
                        prev.get('dispatched_at'),
                        prev.get('dispatch_channel', ''),
                    ),
                )

    conn.commit()
    conn.close()
