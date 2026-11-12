"""
SMART ATTENDANCE SYSTEM - Database Helper Module
Student: Sahil Pasula | Class: TYBSC-A-39 | Seat No: 24TCS076
TY BSc Computer Science Project
"""

import sqlite3
import os
from datetime import datetime

DATABASE_NAME = 'smart_attendance.db'

def get_db_connection():
    """Establish and return a connection to the SQLite database with Row mapping."""
    db_path = os.path.join(os.path.dirname(__file__), DATABASE_NAME)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row  # Enables access to columns by name like dict
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    """Initialize database tables using schema.sql."""
    schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
    conn = get_db_connection()
    with open(schema_path, 'r', encoding='utf-8') as f:
        conn.executescript(f.read())
    conn.commit()
    conn.close()

def refresh_notifications():
    """
    Check overall attendance percentage for every student.
    If attendance is below 75% and total lectures >= 1,
    generate or update a warning notification in the notifications table.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # Clear old auto-generated low attendance notifications
    cursor.execute("DELETE FROM notifications WHERE title LIKE '%Attendance Shortage%'")

    students = cursor.execute("SELECT id, name, roll_number, seat_number FROM students").fetchall()

    for student in students:
        s_id = student['id']
        total_days = cursor.execute(
            "SELECT COUNT(*) as count FROM attendance WHERE student_id = ?", (s_id,)
        ).fetchone()['count']

        if total_days > 0:
            present_days = cursor.execute(
                "SELECT COUNT(*) as count FROM attendance WHERE student_id = ? AND status = 'Present'",
                (s_id,)
            ).fetchone()['count']

            percentage = round((present_days / total_days) * 100, 2)

            if percentage < 75.0:
                title = f"Attendance Shortage Warning (<75%)"
                message = (
                    f"Warning: {student['name']} (Roll: {student['roll_number']}) has only "
                    f"{percentage}% attendance ({present_days}/{total_days} sessions attended). "
                    f"Minimum mandatory requirement is 75% for University exam eligibility."
                )
                cursor.execute(
                    """
                    INSERT INTO notifications (student_id, title, message, percentage, is_read)
                    VALUES (?, ?, ?, ?, 0)
                    """,
                    (s_id, title, message, percentage)
                )

    conn.commit()
    conn.close()
