"""
==============================================================================
SMART ATTENDANCE SYSTEM
==============================================================================
Student Name : Sahil Pasula
Class        : TYBSC-A-39
Seat Number  : 24TCS076
College      : TY BSc Computer Science College Project
Technology   : Python 3, Flask, SQLite3, HTML5, CSS3, JavaScript
==============================================================================
"""

import os
import sqlite3
from datetime import datetime, date
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, flash, jsonify
)
from werkzeug.utils import secure_filename
from database import get_db_connection, init_db, refresh_notifications

app = Flask(__name__)
app.secret_key = 'smart_attendance_secret_sahil_pasula_24tcs076'

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Inject notification count into all templates for sidebar badge
@app.context_processor
def inject_notifications():
    try:
        conn = get_db_connection()
        count = conn.execute("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0").fetchone()['count']
        conn.close()
        return {'unread_notifications_count': count}
    except Exception:
        return {'unread_notifications_count': 0}

# ------------------------------------------------------------------------------
# 1. AUTHENTICATION (Login / Logout)
# ------------------------------------------------------------------------------
@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()

        if not username or not password:
            flash('Please enter both username and password.', 'danger')
            return render_template('login.html')

        conn = get_db_connection()
        user = conn.execute(
            "SELECT * FROM users WHERE username = ? AND password = ?",
            (username, password)
        ).fetchone()
        conn.close()

        if user:
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['full_name'] = user['full_name']
            session['role'] = user['role']
            flash(f"Welcome back, {user['full_name']}!", 'success')
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid username or password. (Hint: admin / admin123)', 'danger')

    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('You have been logged out successfully.', 'info')
    return redirect(url_for('login'))

# ------------------------------------------------------------------------------
# 2. DASHBOARD
# ------------------------------------------------------------------------------
@app.route('/')
@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    today_str = date.today().strftime('%Y-%m-%d')
    conn = get_db_connection()
    cursor = conn.cursor()

    # Total Students
    total_students = cursor.execute("SELECT COUNT(*) as c FROM students").fetchone()['c']

    # Today's Attendance stats
    today_present = cursor.execute(
        "SELECT COUNT(*) as c FROM attendance WHERE date = ? AND status = 'Present'",
        (today_str,)
    ).fetchone()['c']

    today_absent = cursor.execute(
        "SELECT COUNT(*) as c FROM attendance WHERE date = ? AND status = 'Absent'",
        (today_str,)
    ).fetchone()['c']

    total_marked_today = today_present + today_absent
    if total_marked_today > 0:
        attendance_percentage = round((today_present / total_marked_today) * 100, 1)
    else:
        # If no attendance marked today, show overall average percentage across history
        overall_present = cursor.execute("SELECT COUNT(*) as c FROM attendance WHERE status = 'Present'").fetchone()['c']
        overall_total = cursor.execute("SELECT COUNT(*) as c FROM attendance").fetchone()['c']
        attendance_percentage = round((overall_present / overall_total) * 100, 1) if overall_total > 0 else 0.0

    # Students with Low Attendance (< 75%)
    low_attendance_students = cursor.execute("""
        SELECT s.id, s.name, s.roll_number, s.seat_number, s.class,
               COUNT(a.id) as total_sessions,
               SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_sessions
        FROM students s
        LEFT JOIN attendance a ON s.id = a.student_id
        GROUP BY s.id
        HAVING total_sessions > 0 AND (present_sessions * 100.0 / total_sessions) < 75.0
        ORDER BY (present_sessions * 100.0 / total_sessions) ASC
    """).fetchall()

    # Recent attendance activity
    recent_attendance = cursor.execute("""
        SELECT a.id, a.date, a.time, a.status, s.name, s.roll_number, s.class
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        ORDER BY a.date DESC, a.time DESC
        LIMIT 8
    """).fetchall()

    conn.close()

    return render_template(
        'dashboard.html',
        total_students=total_students,
        present_today=today_present,
        absent_today=today_absent,
        attendance_percentage=attendance_percentage,
        low_attendance_students=low_attendance_students,
        recent_attendance=recent_attendance,
        today_date=today_str
    )

# ------------------------------------------------------------------------------
# 3. STUDENT REGISTRATION
# ------------------------------------------------------------------------------
@app.route('/register', methods=['GET', 'POST'])
def register_student():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        roll_number = request.form.get('roll_number', '').strip()
        seat_number = request.form.get('seat_number', '').strip()
        class_name = request.form.get('class', '').strip()
        email = request.form.get('email', '').strip()
        phone = request.form.get('phone', '').strip()

        if not all([name, roll_number, seat_number, class_name, email, phone]):
            flash('All fields are mandatory. Please fill in all details.', 'danger')
            return render_template('register_student.html')

        # Handle Photo Upload
        photo_filename = 'default_avatar.png'
        if 'photo' in request.files:
            file = request.files['photo']
            if file and file.filename and allowed_file(file.filename):
                sec_name = secure_filename(f"{roll_number}_{file.filename}")
                file.save(os.path.join(app.config['UPLOAD_FOLDER'], sec_name))
                photo_filename = sec_name

        conn = get_db_connection()
        try:
            conn.execute(
                """
                INSERT INTO students (name, roll_number, seat_number, class, email, phone, photo)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (name, roll_number, seat_number, class_name, email, phone, photo_filename)
            )
            conn.commit()
            flash(f"Student '{name}' ({roll_number}) registered successfully in SQLite!", 'success')
            return redirect(url_for('student_records'))
        except sqlite3.IntegrityError as e:
            flash(f"Roll Number or Seat Number already exists! ({str(e)})", 'danger')
        finally:
            conn.close()

    return render_template('register_student.html')

# ------------------------------------------------------------------------------
# 4. MARK ATTENDANCE
# ------------------------------------------------------------------------------
@app.route('/attendance', methods=['GET', 'POST'])
def mark_attendance():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    selected_date = request.args.get('date', date.today().strftime('%Y-%m-%d'))

    if request.method == 'POST':
        selected_date = request.form.get('date', date.today().strftime('%Y-%m-%d'))
        marked_time = datetime.now().strftime('%H:%M:%S')
        marked_by = session.get('full_name', 'Teacher')

        students = conn.execute("SELECT id FROM students").fetchall()
        for student in students:
            s_id = student['id']
            status = request.form.get(f'status_{s_id}', 'Absent')

            # Insert or replace attendance record for this student and date
            conn.execute(
                """
                INSERT INTO attendance (student_id, date, time, status, marked_by)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(student_id, date) DO UPDATE SET
                    time = excluded.time,
                    status = excluded.status,
                    marked_by = excluded.marked_by
                """,
                (s_id, selected_date, marked_time, status, marked_by)
            )

        conn.commit()
        conn.close()

        # Update notifications for attendance below 75%
        refresh_notifications()

        flash(f"Attendance for {selected_date} marked successfully at {marked_time}!", 'success')
        return redirect(url_for('attendance_records', date=selected_date))

    # Fetch students along with existing attendance for the selected date (if any)
    query = """
        SELECT s.id, s.name, s.roll_number, s.seat_number, s.class, s.photo,
               a.status as current_status, a.time as recorded_time
        FROM students s
        LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
        ORDER BY s.roll_number ASC
    """
    students_with_status = conn.execute(query, (selected_date,)).fetchall()
    conn.close()

    return render_template(
        'mark_attendance.html',
        students=students_with_status,
        selected_date=selected_date
    )

# ------------------------------------------------------------------------------
# 5. ATTENDANCE RECORDS
# ------------------------------------------------------------------------------
@app.route('/attendance/records')
def attendance_records():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    filter_date = request.args.get('date', '')
    filter_status = request.args.get('status', '')
    search_query = request.args.get('search', '').strip()

    sql = """
        SELECT a.id, a.date, a.time, a.status, a.marked_by,
               s.name, s.roll_number, s.seat_number, s.class, s.photo
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        WHERE 1=1
    """
    params = []

    if filter_date:
        sql += " AND a.date = ?"
        params.append(filter_date)

    if filter_status in ['Present', 'Absent']:
        sql += " AND a.status = ?"
        params.append(filter_status)

    if search_query:
        sql += " AND (s.name LIKE ? OR s.roll_number LIKE ? OR s.seat_number LIKE ?)"
        term = f"%{search_query}%"
        params.extend([term, term, term])

    sql += " ORDER BY a.date DESC, a.time DESC, s.roll_number ASC"

    records = conn.execute(sql, params).fetchall()

    # Get distinct dates for filtering dropdown
    distinct_dates = conn.execute("SELECT DISTINCT date FROM attendance ORDER BY date DESC").fetchall()
    conn.close()

    return render_template(
        'attendance_records.html',
        records=records,
        distinct_dates=distinct_dates,
        filter_date=filter_date,
        filter_status=filter_status,
        search_query=search_query
    )

# ------------------------------------------------------------------------------
# 6. REPORTS (Daily, Monthly, Student-wise with Auto Percentage Calculation)
# ------------------------------------------------------------------------------
@app.route('/reports')
def reports():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    report_type = request.args.get('type', 'student')  # 'student', 'daily', 'monthly'
    selected_date = request.args.get('date', date.today().strftime('%Y-%m-%d'))
    selected_month = request.args.get('month', date.today().strftime('%Y-%m'))
    selected_student_id = request.args.get('student_id', '')

    all_students = conn.execute("SELECT id, name, roll_number, seat_number, class FROM students ORDER BY roll_number").fetchall()

    student_report = []
    daily_report = []
    monthly_report = []

    if report_type == 'student':
        # Student-wise attendance percentage report
        sql = """
            SELECT s.id, s.name, s.roll_number, s.seat_number, s.class,
                   COUNT(a.id) as total_lectures,
                   SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
                   SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id
        """
        params = []
        if selected_student_id:
            sql += " WHERE s.id = ?"
            params.append(selected_student_id)

        sql += " GROUP BY s.id ORDER BY s.roll_number ASC"
        rows = conn.execute(sql, params).fetchall()

        for r in rows:
            total = r['total_lectures']
            present = r['present_count'] or 0
            absent = r['absent_count'] or 0
            pct = round((present / total) * 100, 2) if total > 0 else 0.0
            student_report.append({
                'id': r['id'],
                'name': r['name'],
                'roll_number': r['roll_number'],
                'seat_number': r['seat_number'],
                'class': r['class'],
                'total_lectures': total,
                'present_count': present,
                'absent_count': absent,
                'percentage': pct,
                'is_shortage': (pct < 75.0 and total > 0)
            })

    elif report_type == 'daily':
        # Daily Attendance Report
        sql = """
            SELECT s.name, s.roll_number, s.seat_number, s.class,
                   a.time, a.status, a.marked_by
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
            ORDER BY s.roll_number ASC
        """
        rows = conn.execute(sql, (selected_date,)).fetchall()
        for r in rows:
            daily_report.append({
                'name': r['name'],
                'roll_number': r['roll_number'],
                'seat_number': r['seat_number'],
                'class': r['class'],
                'time': r['time'] or '-',
                'status': r['status'] or 'Not Marked',
                'marked_by': r['marked_by'] or '-'
            })

    elif report_type == 'monthly':
        # Monthly Attendance Report (by YYYY-MM)
        sql = """
            SELECT s.id, s.name, s.roll_number, s.class,
                   COUNT(a.id) as total_month_lectures,
                   SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
                   SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id AND strftime('%Y-%m', a.date) = ?
            GROUP BY s.id
            ORDER BY s.roll_number ASC
        """
        rows = conn.execute(sql, (selected_month,)).fetchall()
        for r in rows:
            total = r['total_month_lectures']
            present = r['present_count'] or 0
            absent = r['absent_count'] or 0
            pct = round((present / total) * 100, 2) if total > 0 else 0.0
            monthly_report.append({
                'name': r['name'],
                'roll_number': r['roll_number'],
                'class': r['class'],
                'total_month_lectures': total,
                'present_count': present,
                'absent_count': absent,
                'percentage': pct,
                'is_shortage': (pct < 75.0 and total > 0)
            })

    conn.close()

    return render_template(
        'reports.html',
        report_type=report_type,
        selected_date=selected_date,
        selected_month=selected_month,
        selected_student_id=selected_student_id,
        all_students=all_students,
        student_report=student_report,
        daily_report=daily_report,
        monthly_report=monthly_report
    )

# ------------------------------------------------------------------------------
# 7. STUDENT RECORDS (View, Edit, Delete)
# ------------------------------------------------------------------------------
@app.route('/students')
def student_records():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    search = request.args.get('search', '').strip()
    conn = get_db_connection()

    if search:
        term = f"%{search}%"
        students = conn.execute(
            """
            SELECT * FROM students
            WHERE name LIKE ? OR roll_number LIKE ? OR seat_number LIKE ? OR email LIKE ?
            ORDER BY roll_number ASC
            """,
            (term, term, term, term)
        ).fetchall()
    else:
        students = conn.execute("SELECT * FROM students ORDER BY roll_number ASC").fetchall()

    conn.close()
    return render_template('student_records.html', students=students, search=search)

@app.route('/students/view/<int:id>')
def view_student(id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (id,)).fetchone()
    if not student:
        conn.close()
        flash('Student record not found.', 'danger')
        return redirect(url_for('student_records'))

    # Attendance logs for this student
    history = conn.execute(
        "SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC", (id,)
    ).fetchall()

    total_sessions = len(history)
    present_sessions = sum(1 for h in history if h['status'] == 'Present')
    absent_sessions = total_sessions - present_sessions
    percentage = round((present_sessions / total_sessions) * 100, 2) if total_sessions > 0 else 0.0

    conn.close()

    return render_template(
        'student_view.html',
        student=student,
        history=history,
        total_sessions=total_sessions,
        present_sessions=present_sessions,
        absent_sessions=absent_sessions,
        percentage=percentage
    )

@app.route('/students/edit/<int:id>', methods=['GET', 'POST'])
def edit_student(id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (id,)).fetchone()

    if not student:
        conn.close()
        flash('Student record not found.', 'danger')
        return redirect(url_for('student_records'))

    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        roll_number = request.form.get('roll_number', '').strip()
        seat_number = request.form.get('seat_number', '').strip()
        class_name = request.form.get('class', '').strip()
        email = request.form.get('email', '').strip()
        phone = request.form.get('phone', '').strip()

        photo_filename = student['photo']
        if 'photo' in request.files:
            file = request.files['photo']
            if file and file.filename and allowed_file(file.filename):
                sec_name = secure_filename(f"{roll_number}_{file.filename}")
                file.save(os.path.join(app.config['UPLOAD_FOLDER'], sec_name))
                photo_filename = sec_name

        try:
            conn.execute(
                """
                UPDATE students
                SET name = ?, roll_number = ?, seat_number = ?, class = ?, email = ?, phone = ?, photo = ?
                WHERE id = ?
                """,
                (name, roll_number, seat_number, class_name, email, phone, photo_filename, id)
            )
            conn.commit()
            conn.close()
            flash(f"Student '{name}' updated successfully!", 'success')
            return redirect(url_for('student_records'))
        except sqlite3.IntegrityError as e:
            conn.close()
            flash(f"Error: Roll Number or Seat Number already in use by another student.", 'danger')
            return render_template('student_edit.html', student=student)

    conn.close()
    return render_template('student_edit.html', student=student)

@app.route('/students/delete/<int:id>', methods=['POST'])
def delete_student(id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    student = conn.execute("SELECT name FROM students WHERE id = ?", (id,)).fetchone()

    if student:
        conn.execute("DELETE FROM students WHERE id = ?", (id,))
        conn.commit()
        conn.close()
        refresh_notifications()
        flash(f"Student '{student['name']}' and their attendance records were deleted.", 'warning')
    else:
        conn.close()
        flash("Student not found.", 'danger')

    return redirect(url_for('student_records'))

# ------------------------------------------------------------------------------
# 8. NOTIFICATIONS (< 75% ATTENDANCE WARNING)
# ------------------------------------------------------------------------------
@app.route('/notifications')
def notifications():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    refresh_notifications()
    conn = get_db_connection()
    notifications_list = conn.execute("""
        SELECT n.id, n.title, n.message, n.percentage, n.created_at, n.is_read,
               s.id as student_id, s.name as student_name, s.roll_number, s.seat_number,
               s.class, s.email, s.phone, s.photo
        FROM notifications n
        JOIN students s ON n.student_id = s.id
        ORDER BY n.percentage ASC, n.created_at DESC
    """).fetchall()
    conn.close()

    return render_template('notifications.html', notifications=notifications_list)

@app.route('/notifications/mark-read/<int:id>', methods=['POST'])
def mark_notification_read(id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (id,))
    conn.commit()
    conn.close()
    flash("Notification acknowledged.", 'info')
    return redirect(url_for('notifications'))

# ------------------------------------------------------------------------------
# API ENDPOINT FOR QUICK LIVE STATS (AJAX)
# ------------------------------------------------------------------------------
@app.route('/api/stats')
def api_stats():
    conn = get_db_connection()
    total_students = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
    total_present = conn.execute("SELECT COUNT(*) FROM attendance WHERE status = 'Present'").fetchone()[0]
    total_absent = conn.execute("SELECT COUNT(*) FROM attendance WHERE status = 'Absent'").fetchone()[0]
    low_att_count = conn.execute("SELECT COUNT(*) FROM notifications WHERE is_read = 0").fetchone()[0]
    conn.close()

    return jsonify({
        'total_students': total_students,
        'total_present': total_present,
        'total_absent': total_absent,
        'low_attendance_warnings': low_att_count,
        'developer': {
            'student': 'Sahil Pasula',
            'class': 'TYBSC-A-39',
            'seat_no': '24TCS076',
            'project': 'SMART ATTENDANCE SYSTEM'
        }
    })

# ------------------------------------------------------------------------------
# APPLICATION ENTRY POINT
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    # Initialize DB if missing
    if not os.path.exists('smart_attendance.db'):
        from init_db import seed_sample_data
        seed_sample_data()

    print("=================================================================")
    print("SMART ATTENDANCE SYSTEM - FLASK SERVER RUNNING ON LOCALHOST")
    print("Student : Sahil Pasula (TYBSC-A-39 | Seat: 24TCS076)")
    print("URL     : http://127.0.0.1:5000")
    print("=================================================================")
    app.run(host='0.0.0.0', port=5000, debug=True)
