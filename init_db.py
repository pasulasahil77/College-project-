"""
SMART ATTENDANCE SYSTEM - Database Seeder Script
Student: Sahil Pasula | Class: TYBSC-A-39 | Seat No: 24TCS076
TY BSc Computer Science Project

Run this script once to create the SQLite database and load sample student & attendance data:
    python init_db.py
"""

from database import init_db, get_db_connection, refresh_notifications
from datetime import datetime, timedelta
import hashlib


def seed_sample_data():
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Insert Default Users
    # Plaintext and hashed storage compatible for simple viva demo
    users = [
        ('admin', 'admin123', 'Administrator', 'Admin'),
        ('teacher', 'teacher123', 'Prof. R. K. Sharma', 'Teacher')
    ]
    for username, password, full_name, role in users:
        cursor.execute(
            """
            INSERT OR IGNORE INTO users (username, password, full_name, role)
            VALUES (?, ?, ?, ?)
            """,
            (username, password, full_name, role)
        )

    # 2. Insert Sample Students
    sample_students = [
        ('Sahil Pasula', 'TYBSC-A-39', '24TCS076', 'TYBSC-CS', 'pasulasahil77@gmail.com', '+91 98765 43210', 'sahil.png'),
        ('Rohan Sharma', 'TYBSC-A-12', '24TCS012', 'TYBSC-CS', 'rohan.sharma@college.edu', '+91 98201 11223', 'avatar_m1.png'),
        ('Priya Nair', 'TYBSC-A-24', '24TCS045', 'TYBSC-CS', 'priya.nair@college.edu', '+91 98202 33445', 'avatar_f1.png'),
        ('Amit Verma', 'TYBSC-A-05', '24TCS008', 'TYBSC-CS', 'amit.verma@college.edu', '+91 98203 55667', 'avatar_m2.png'),
        ('Neha Kulkarni', 'TYBSC-A-18', '24TCS029', 'TYBSC-CS', 'neha.kulkarni@college.edu', '+91 98204 77889', 'avatar_f2.png'),
        ('Aditya Deshmukh', 'TYBSC-A-02', '24TCS003', 'TYBSC-CS', 'aditya.d@college.edu', '+91 98205 99001', 'avatar_m3.png'),
        ('Sneha Patil', 'TYBSC-A-44', '24TCS089', 'TYBSC-CS', 'sneha.patil@college.edu', '+91 98206 12345', 'avatar_f3.png'),
        ('Tanmay Joshi', 'TYBSC-A-51', '24TCS102', 'TYBSC-CS', 'tanmay.joshi@college.edu', '+91 98207 67890', 'avatar_m4.png'),
    ]

    for name, roll, seat, cls, email, phone, photo in sample_students:
        cursor.execute(
            """
            INSERT OR IGNORE INTO students (name, roll_number, seat_number, class, email, phone, photo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (name, roll, seat, cls, email, phone, photo)
        )

    conn.commit()

    # Retrieve all student IDs
    student_rows = cursor.execute("SELECT id, roll_number FROM students").fetchall()
    student_map = {row['roll_number']: row['id'] for row in student_rows}

    # 3. Seed Attendance Records across past 7 working days
    base_date = datetime.now()
    attendance_patterns = {
        'TYBSC-A-39': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'], # 100%
        'TYBSC-A-12': ['Present', 'Present', 'Absent',  'Present', 'Present', 'Present', 'Present'], # 85.7%
        'TYBSC-A-24': ['Present', 'Present', 'Present', 'Present', 'Absent',  'Present', 'Present'], # 85.7%
        'TYBSC-A-05': ['Absent',  'Absent',  'Present', 'Absent',  'Present', 'Absent',  'Present'], # 42.8% (<75% Alert!)
        'TYBSC-A-18': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Absent'],  # 85.7%
        'TYBSC-A-02': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'], # 100%
        'TYBSC-A-44': ['Absent',  'Present', 'Absent',  'Present', 'Absent',  'Present', 'Absent'],  # 42.8% (<75% Alert!)
        'TYBSC-A-51': ['Present', 'Absent',  'Present', 'Present', 'Present', 'Present', 'Present'], # 85.7%
    }

    times = ['09:15:00', '09:10:00', '09:05:00', '09:20:00', '09:12:00', '09:08:00', '09:15:00']

    for day_idx in range(7):
        att_date = (base_date - timedelta(days=(6 - day_idx))).strftime('%Y-%m-%d')
        rec_time = times[day_idx % len(times)]

        for roll_no, statuses in attendance_patterns.items():
            s_id = student_map.get(roll_no)
            if s_id:
                status = statuses[day_idx]
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO attendance (student_id, date, time, status, marked_by)
                    VALUES (?, ?, ?, ?, 'Prof. R. K. Sharma')
                    """,
                    (s_id, att_date, rec_time, status)
                )

    conn.commit()
    conn.close()

    # 4. Generate low attendance warning notifications (<75%)
    refresh_notifications()
    print("Database 'smart_attendance.db' initialized and sample data seeded successfully!")
    print("Default Login: Username: admin | Password: admin123")

if __name__ == '__main__':
    seed_sample_data()
