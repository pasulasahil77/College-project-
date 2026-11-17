"""
SMART ATTENDANCE SYSTEM - Database Seeder Script
Student: Sahil Pasula | Class: TYBSC-A-39 | Seat No: 24TCS076
TY BSc Computer Science Project
"""

from datetime import datetime, timedelta
from database import init_db, get_db_connection, refresh_notifications, hash_password


def seed_sample_data():
    init_db()
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Insert Default Users with securely hashed passwords
    users = [
        ('admin', hash_password('admin123'), 'Sahil Pasula (Admin)', 'Admin', None),
        ('teacher', hash_password('teacher123'), 'Prof. R. K. Sharma', 'Teacher', None),
        ('student', hash_password('student123'), 'Sahil Pasula', 'Student', 1),
        ('parent', hash_password('parent123'), 'Mr. M. Verma (Guardian)', 'Parent', 4),
    ]
    for username, password_hash, full_name, role, student_id in users:
        cursor.execute(
            """
            INSERT OR IGNORE INTO users (username, password, full_name, role, student_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (username, password_hash, full_name, role, student_id),
        )

    # 2. Insert Sample Students
    sample_students = [
        ('Sahil Pasula', 'TYBSC-A-39', '24TCS076', 'TYBSC-CS', 'pasulasahil77@gmail.com', '+91 98765 43210', 'Mr. R. Pasula', '+91 98765 43219', 'sahil.png'),
        ('Rohan Sharma', 'TYBSC-A-12', '24TCS012', 'TYBSC-CS', 'rohan.sharma@college.edu', '+91 98201 11223', 'Mr. K. Sharma', '+91 98201 11229', 'avatar_m1.png'),
        ('Priya Nair', 'TYBSC-A-24', '24TCS045', 'TYBSC-CS', 'priya.nair@college.edu', '+91 98202 33445', 'Mrs. S. Nair', '+91 98202 33449', 'avatar_f1.png'),
        ('Amit Verma', 'TYBSC-A-05', '24TCS008', 'TYBSC-CS', 'amit.verma@college.edu', '+91 98203 55667', 'Mr. M. Verma', '+91 98203 55669', 'avatar_m2.png'),
        ('Neha Kulkarni', 'TYBSC-A-18', '24TCS029', 'TYBSC-CS', 'neha.kulkarni@college.edu', '+91 98204 77889', 'Mrs. A. Kulkarni', '+91 98204 77881', 'avatar_f2.png'),
        ('Aditya Deshmukh', 'TYBSC-A-02', '24TCS003', 'TYBSC-CS', 'aditya.d@college.edu', '+91 98205 99001', 'Mr. V. Deshmukh', '+91 98205 99009', 'avatar_m3.png'),
        ('Sneha Patil', 'TYBSC-A-44', '24TCS089', 'TYBSC-CS', 'sneha.patil@college.edu', '+91 98206 12345', 'Mrs. R. Patil', '+91 98206 12349', 'avatar_f3.png'),
        ('Tanmay Joshi', 'TYBSC-A-51', '24TCS102', 'TYBSC-CS', 'tanmay.joshi@college.edu', '+91 98207 67890', 'Mr. D. Joshi', '+91 98207 67899', 'avatar_m4.png'),
    ]

    for name, roll, seat, cls, email, phone, p_name, p_phone, photo in sample_students:
        cursor.execute(
            """
            INSERT OR IGNORE INTO students (name, roll_number, seat_number, class, email, phone, parent_name, parent_phone, photo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, roll, seat, cls, email, phone, p_name, p_phone, photo),
        )

    conn.commit()

    student_rows = cursor.execute("SELECT id, roll_number FROM students").fetchall()
    student_map = {row['roll_number']: row['id'] for row in student_rows}

    base_date = datetime.now()
    attendance_patterns = {
        'TYBSC-A-39': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'],
        'TYBSC-A-12': ['Present', 'Present', 'Absent',  'Present', 'Present', 'Present', 'Present'],
        'TYBSC-A-24': ['Present', 'Present', 'Present', 'Present', 'Absent',  'Present', 'Present'],
        'TYBSC-A-05': ['Absent',  'Absent',  'Present', 'Absent',  'Present', 'Absent',  'Present'],
        'TYBSC-A-18': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Absent'],
        'TYBSC-A-02': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'],
        'TYBSC-A-44': ['Absent',  'Present', 'Absent',  'Present', 'Absent',  'Present', 'Absent'],
        'TYBSC-A-51': ['Present', 'Absent',  'Present', 'Present', 'Present', 'Present', 'Present'],
    }
    subjects = [
        'Advanced Python Programming',
        'Database Management Systems (SQLite)',
        'Linux & Shell Scripting',
        'Computer Networks & Security',
        'Software Engineering & Project Management',
    ]
    times = ['09:15:00', '09:10:00', '09:05:00', '09:20:00', '09:12:00', '09:08:00', '09:15:00']

    for day_idx in range(7):
        att_date = (base_date - timedelta(days=(6 - day_idx))).strftime('%Y-%m-%d')
        rec_time = times[day_idx % len(times)]
        subj = subjects[(6 - day_idx) % len(subjects)]

        for roll_no, statuses in attendance_patterns.items():
            s_id = student_map.get(roll_no)
            if s_id:
                status = statuses[day_idx]
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO attendance (student_id, date, time, status, subject, marked_by, method)
                    VALUES (?, ?, ?, ?, ?, 'Prof. R. K. Sharma', ?)
                    """,
                    (s_id, att_date, rec_time, status, subj, 'Face Recognition' if day_idx % 2 == 0 else 'Manual Roll Call'),
                )

    conn.commit()
    conn.close()
    refresh_notifications()


if __name__ == '__main__':
    seed_sample_data()
    print("Database 'smart_attendance.db' initialized and seeded successfully!")
