-- ==============================================================================
-- SMART ATTENDANCE SYSTEM - DATABASE SCHEMA (SQLite)
-- Project: TY BSc Computer Science College Project
-- Student: Sahil Pasula | Class: TYBSC-A-39 | Seat No: 24TCS076
-- ==============================================================================

-- 1. Users Table (for Authentication)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'Teacher',
    student_id INTEGER DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Students Table
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    roll_number TEXT UNIQUE NOT NULL,
    seat_number TEXT UNIQUE NOT NULL,
    class TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    parent_name TEXT DEFAULT '',
    parent_phone TEXT DEFAULT '',
    photo TEXT DEFAULT 'default_avatar.png',
    face_descriptor TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
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
);

-- 4. Notifications Table (Warning when attendance is below configurable threshold)
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    percentage REAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0,
    dispatched_at TIMESTAMP DEFAULT NULL,
    dispatch_channel TEXT DEFAULT '',
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- 5. System Settings Table (Configurable Thresholds & Recognition Params)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast query performance in reports and dashboard
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_subject ON attendance(subject);
CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_number);
