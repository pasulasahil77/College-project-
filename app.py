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

import csv
import io
import json
import math
import os
import sqlite3
from datetime import datetime, date
from functools import wraps
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, flash, jsonify, Response
)
from werkzeug.utils import secure_filename
from database import (
    get_db_connection,
    init_db,
    refresh_notifications,
    verify_user_password,
    get_all_settings,
    get_attendance_threshold,
)

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'smart_attendance_secret_sahil_pasula_24tcs076')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.environ.get('VERCEL') or not os.access(BASE_DIR, os.W_OK):
    UPLOAD_FOLDER = '/tmp/smart_attendance_uploads'
else:
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def serialize_student(row):
    """Serialize student row safely WITHOUT exposing raw biometric face_descriptor."""
    d = dict(row)
    has_bio = bool(d.pop('face_descriptor', None))
    d['has_face_encoding'] = has_bio
    return d


# ------------------------------------------------------------------------------
# CORS & Security Headers for /api/* Endpoints
# ------------------------------------------------------------------------------
@app.after_request
def add_cors_headers(response):
    if request.path.startswith('/api/'):
        origin = request.headers.get('Origin', '*')
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    return response


@app.route('/api/<path:subpath>', methods=['OPTIONS'])
def api_preflight(subpath):
    return ('', 204)


def api_login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated


def api_roles_required(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if 'user_id' not in session:
                return jsonify({'error': 'Authentication required'}), 401
            if session.get('role') not in roles:
                return jsonify({'error': 'Insufficient permissions for this action'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator


# Inject notification count into all Jinja templates for sidebar badge
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
        user = verify_user_password(conn, username, password)
        conn.close()

        if user:
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['full_name'] = user['full_name']
            session['role'] = user['role']
            session['student_id'] = user['student_id']
            flash(f"Welcome back, {user['full_name']}!", 'success')
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid username or password.', 'danger')

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
    threshold = get_attendance_threshold(conn)

    total_students = cursor.execute("SELECT COUNT(*) as c FROM students").fetchone()['c']
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
        overall_present = cursor.execute("SELECT COUNT(*) as c FROM attendance WHERE status = 'Present'").fetchone()['c']
        overall_total = cursor.execute("SELECT COUNT(*) as c FROM attendance").fetchone()['c']
        attendance_percentage = round((overall_present / overall_total) * 100, 1) if overall_total > 0 else 0.0

    low_attendance_students = cursor.execute("""
        SELECT s.id, s.name, s.roll_number, s.seat_number, s.class,
               COUNT(a.id) as total_sessions,
               SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_sessions
        FROM students s
        LEFT JOIN attendance a ON s.id = a.student_id
        GROUP BY s.id
        HAVING total_sessions > 0 AND (present_sessions * 100.0 / total_sessions) < ?
        ORDER BY (present_sessions * 100.0 / total_sessions) ASC
    """, (threshold,)).fetchall()

    recent_attendance = cursor.execute("""
        SELECT a.id, a.date, a.time, a.status, a.subject, a.method, s.name, s.roll_number, s.class
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
        today_date=today_str,
        threshold=threshold
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
        parent_name = request.form.get('parent_name', '').strip()
        parent_phone = request.form.get('parent_phone', '').strip()

        if not all([name, roll_number, seat_number, class_name, email, phone]):
            flash('All required fields must be filled.', 'danger')
            return render_template('register_student.html')

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
                INSERT INTO students (name, roll_number, seat_number, class, email, phone, parent_name, parent_phone, photo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name, roll_number, seat_number, class_name, email, phone, parent_name, parent_phone, photo_filename)
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
    selected_subject = request.args.get('subject', 'Advanced Python Programming')

    if request.method == 'POST':
        selected_date = request.form.get('date', date.today().strftime('%Y-%m-%d'))
        selected_subject = request.form.get('subject', 'Advanced Python Programming')
        marked_time = datetime.now().strftime('%H:%M:%S')
        marked_by = session.get('full_name', 'Teacher')

        students = conn.execute("SELECT id FROM students").fetchall()
        for student in students:
            s_id = student['id']
            status = request.form.get(f'status_{s_id}', 'Absent')
            if status not in ('Present', 'Absent'):
                status = 'Absent'

            conn.execute(
                """
                INSERT INTO attendance (student_id, date, time, status, subject, marked_by, method)
                VALUES (?, ?, ?, ?, ?, ?, 'Manual Roll Call')
                ON CONFLICT(student_id, date, subject) DO UPDATE SET
                    time = excluded.time,
                    status = excluded.status,
                    marked_by = excluded.marked_by,
                    method = 'Manual Roll Call'
                """,
                (s_id, selected_date, marked_time, status, selected_subject, marked_by)
            )

        conn.commit()
        conn.close()
        refresh_notifications()

        flash(f"Attendance for {selected_date} ({selected_subject}) saved at {marked_time}!", 'success')
        return redirect(url_for('attendance_records', date=selected_date))

    query = """
        SELECT s.id, s.name, s.roll_number, s.seat_number, s.class, s.photo,
               a.status as current_status, a.time as recorded_time
        FROM students s
        LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ? AND a.subject = ?
        ORDER BY s.roll_number ASC
    """
    students_with_status = conn.execute(query, (selected_date, selected_subject)).fetchall()
    conn.close()

    return render_template(
        'mark_attendance.html',
        students=students_with_status,
        selected_date=selected_date,
        selected_subject=selected_subject
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
        SELECT a.id, a.date, a.time, a.status, a.subject, a.method, a.marked_by,
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
# 6. REPORTS (Daily, Monthly, Student-wise with Class Filter & Dynamic Threshold)
# ------------------------------------------------------------------------------
@app.route('/reports')
def reports():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db_connection()
    threshold = get_attendance_threshold(conn)
    report_type = request.args.get('type', 'student')
    selected_date = request.args.get('date', date.today().strftime('%Y-%m-%d'))
    selected_month = request.args.get('month', date.today().strftime('%Y-%m'))
    selected_student_id = request.args.get('student_id', '')
    selected_class = request.args.get('class', '').strip()

    all_students = conn.execute("SELECT id, name, roll_number, seat_number, class FROM students ORDER BY roll_number").fetchall()
    classes = [r['class'] for r in conn.execute("SELECT DISTINCT class FROM students ORDER BY class").fetchall()]

    student_report = []
    daily_report = []
    monthly_report = []

    if report_type == 'student':
        sql = """
            SELECT s.id, s.name, s.roll_number, s.seat_number, s.class,
                   COUNT(a.id) as total_lectures,
                   SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
                   SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id
            WHERE 1=1
        """
        params = []
        if selected_student_id:
            sql += " AND s.id = ?"
            params.append(selected_student_id)
        if selected_class:
            sql += " AND s.class = ?"
            params.append(selected_class)

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
                'is_shortage': (pct < threshold and total > 0)
            })

    elif report_type == 'daily':
        sql = """
            SELECT s.name, s.roll_number, s.seat_number, s.class,
                   a.time, a.status, a.subject, a.marked_by
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
            WHERE 1=1
        """
        params = [selected_date]
        if selected_class:
            sql += " AND s.class = ?"
            params.append(selected_class)
        sql += " ORDER BY s.roll_number ASC"
        rows = conn.execute(sql, params).fetchall()
        for r in rows:
            daily_report.append({
                'name': r['name'],
                'roll_number': r['roll_number'],
                'seat_number': r['seat_number'],
                'class': r['class'],
                'time': r['time'] or '-',
                'status': r['status'] or 'Not Marked',
                'subject': r['subject'] or '-',
                'marked_by': r['marked_by'] or '-'
            })

    elif report_type == 'monthly':
        sql = """
            SELECT s.id, s.name, s.roll_number, s.class,
                   COUNT(a.id) as total_month_lectures,
                   SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
                   SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id AND strftime('%Y-%m', a.date) = ?
            WHERE 1=1
        """
        params = [selected_month]
        if selected_class:
            sql += " AND s.class = ?"
            params.append(selected_class)
        sql += " GROUP BY s.id ORDER BY s.roll_number ASC"
        rows = conn.execute(sql, params).fetchall()
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
                'is_shortage': (pct < threshold and total > 0)
            })

    conn.close()

    return render_template(
        'reports.html',
        report_type=report_type,
        selected_date=selected_date,
        selected_month=selected_month,
        selected_student_id=selected_student_id,
        selected_class=selected_class,
        classes=classes,
        all_students=all_students,
        student_report=student_report,
        daily_report=daily_report,
        monthly_report=monthly_report,
        threshold=threshold
    )


# ------------------------------------------------------------------------------
# 7. STUDENT RECORDS (View, Edit, Delete)
# ------------------------------------------------------------------------------
@app.route('/students')
def student_records():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    search = request.args.get('search', '').strip()
    cls = request.args.get('class', '').strip()
    conn = get_db_connection()

    sql = "SELECT * FROM students WHERE 1=1"
    params = []
    if search:
        term = f"%{search}%"
        sql += " AND (name LIKE ? OR roll_number LIKE ? OR seat_number LIKE ? OR email LIKE ?)"
        params.extend([term, term, term, term])
    if cls:
        sql += " AND class = ?"
        params.append(cls)
    sql += " ORDER BY roll_number ASC"

    students = conn.execute(sql, params).fetchall()
    conn.close()
    return render_template('student_records.html', students=students, search=search, selected_class=cls)


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

    history = conn.execute(
        "SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC, time DESC", (id,)
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
        parent_name = request.form.get('parent_name', student['parent_name'] or '').strip()
        parent_phone = request.form.get('parent_phone', student['parent_phone'] or '').strip()

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
                SET name = ?, roll_number = ?, seat_number = ?, class = ?, email = ?, phone = ?, parent_name = ?, parent_phone = ?, photo = ?
                WHERE id = ?
                """,
                (name, roll_number, seat_number, class_name, email, phone, parent_name, parent_phone, photo_filename, id)
            )
            conn.commit()
            conn.close()
            flash(f"Student '{name}' updated successfully!", 'success')
            return redirect(url_for('student_records'))
        except sqlite3.IntegrityError:
            conn.close()
            flash("Error: Roll Number or Seat Number already in use by another student.", 'danger')
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
# 8. NOTIFICATIONS (Configurable Attendance Threshold Warning)
# ------------------------------------------------------------------------------
@app.route('/notifications')
def notifications():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    refresh_notifications()
    conn = get_db_connection()
    notifications_list = conn.execute("""
        SELECT n.id, n.title, n.message, n.percentage, n.created_at, n.is_read, n.dispatched_at, n.dispatch_channel,
               s.id as student_id, s.name as student_name, s.roll_number, s.seat_number,
               s.class, s.email, s.phone, s.parent_name, s.parent_phone, s.photo
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
# 9. REST JSON API ENDPOINTS (Frontend Integration + Vercel Serverless)
# ------------------------------------------------------------------------------
@app.route('/api/health')
def api_health():
    try:
        conn = get_db_connection()
        student_count = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        att_count = conn.execute("SELECT COUNT(*) FROM attendance").fetchone()[0]
        conn.close()
        return jsonify({
            'status': 'ok',
            'backend': 'Python Flask + SQLite3',
            'students': student_count,
            'attendance_records': att_count,
            'vercel': bool(os.environ.get('VERCEL')),
        })
    except Exception as exc:
        return jsonify({'status': 'error', 'message': str(exc)}), 500


@app.route('/api/stats')
def api_stats():
    conn = get_db_connection()
    today_str = date.today().strftime('%Y-%m-%d')
    total_students = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
    today_present = conn.execute(
        "SELECT COUNT(*) FROM attendance WHERE date = ? AND status = 'Present'", (today_str,)
    ).fetchone()[0]
    today_absent = conn.execute(
        "SELECT COUNT(*) FROM attendance WHERE date = ? AND status = 'Absent'", (today_str,)
    ).fetchone()[0]
    total_present = conn.execute("SELECT COUNT(*) FROM attendance WHERE status = 'Present'").fetchone()[0]
    total_absent = conn.execute("SELECT COUNT(*) FROM attendance WHERE status = 'Absent'").fetchone()[0]
    low_att_count = conn.execute("SELECT COUNT(*) FROM notifications WHERE is_read = 0").fetchone()[0]
    conn.close()

    return jsonify({
        'total_students': total_students,
        'today_present': today_present,
        'today_absent': today_absent,
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


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', '')).strip()

    if not username or not password:
        return jsonify({'error': 'Username and password are required.'}), 400

    conn = get_db_connection()
    user = verify_user_password(conn, username, password)
    conn.close()

    if not user:
        return jsonify({'error': 'Invalid username or password.'}), 401

    session['user_id'] = user['id']
    session['username'] = user['username']
    session['full_name'] = user['full_name']
    session['role'] = user['role']
    session['student_id'] = user['student_id']

    return jsonify({
        'user': {
            'id': user['id'],
            'username': user['username'],
            'name': user['full_name'],
            'role': user['role'],
            'student_id': user['student_id'],
        }
    })


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/me', methods=['GET'])
def api_auth_me():
    if 'user_id' not in session:
        return jsonify({'authenticated': False, 'user': None}), 401
    return jsonify({
        'authenticated': True,
        'user': {
            'id': session.get('user_id'),
            'username': session.get('username'),
            'name': session.get('full_name'),
            'role': session.get('role'),
            'student_id': session.get('student_id'),
        }
    })


@app.route('/api/students', methods=['GET', 'POST'])
@api_login_required
def api_students():
    conn = get_db_connection()

    if request.method == 'GET':
        search = request.args.get('search', '').strip()
        cls = request.args.get('class', '').strip()
        sql = "SELECT * FROM students WHERE 1=1"
        params = []
        if search:
            term = f"%{search}%"
            sql += " AND (name LIKE ? OR roll_number LIKE ? OR seat_number LIKE ? OR email LIKE ?)"
            params.extend([term, term, term, term])
        if cls:
            sql += " AND class = ?"
            params.append(cls)
        sql += " ORDER BY roll_number ASC"
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return jsonify({'students': [serialize_student(r) for r in rows]})

    # POST: Create student (Admin or Teacher)
    if session.get('role') not in ('Admin', 'Administrator', 'Teacher', 'Teacher/Faculty'):
        conn.close()
        return jsonify({'error': 'Permission denied'}), 403

    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    roll_number = str(data.get('roll_number', '')).strip()
    seat_number = str(data.get('seat_number', '')).strip()
    class_name = str(data.get('class', '')).strip()
    email = str(data.get('email', '')).strip()
    phone = str(data.get('phone', '')).strip()
    parent_name = str(data.get('parent_name', '')).strip()
    parent_phone = str(data.get('parent_phone', '')).strip()
    photo = str(data.get('photo', 'default_avatar.png')).strip() or 'default_avatar.png'
    descriptor = data.get('face_descriptor')
    descriptor_json = json.dumps(descriptor) if isinstance(descriptor, list) and len(descriptor) == 128 else None

    if not all([name, roll_number, seat_number, class_name, email, phone]):
        conn.close()
        return jsonify({'error': 'All required fields (name, roll_number, seat_number, class, email, phone) must be provided.'}), 400

    try:
        cur = conn.execute(
            """
            INSERT INTO students (name, roll_number, seat_number, class, email, phone, parent_name, parent_phone, photo, face_descriptor)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, roll_number, seat_number, class_name, email, phone, parent_name, parent_phone, photo, descriptor_json)
        )
        conn.commit()
        created = conn.execute("SELECT * FROM students WHERE id = ?", (cur.lastrowid,)).fetchone()
        conn.close()
        refresh_notifications()
        return jsonify({'student': serialize_student(created)}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Roll Number or Seat Number already exists.'}), 409


@app.route('/api/students/<int:student_id>', methods=['PUT', 'PATCH', 'DELETE'])
@api_login_required
def api_student_detail(student_id):
    if session.get('role') not in ('Admin', 'Administrator', 'Teacher', 'Teacher/Faculty'):
        return jsonify({'error': 'Permission denied'}), 403

    conn = get_db_connection()
    existing = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({'error': 'Student not found'}), 404

    if request.method == 'DELETE':
        if session.get('role') not in ('Admin', 'Administrator'):
            conn.close()
            return jsonify({'error': 'Only Administrator can delete student records'}), 403
        conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        conn.commit()
        conn.close()
        refresh_notifications()
        return jsonify({'deleted': True, 'id': student_id})

    data = request.get_json(silent=True) or {}
    name = str(data.get('name', existing['name'])).strip()
    roll_number = str(data.get('roll_number', existing['roll_number'])).strip()
    seat_number = str(data.get('seat_number', existing['seat_number'])).strip()
    class_name = str(data.get('class', existing['class'])).strip()
    email = str(data.get('email', existing['email'])).strip()
    phone = str(data.get('phone', existing['phone'])).strip()
    parent_name = str(data.get('parent_name', existing['parent_name'] or '')).strip()
    parent_phone = str(data.get('parent_phone', existing['parent_phone'] or '')).strip()
    photo = str(data.get('photo', existing['photo'])).strip() or existing['photo']

    descriptor = data.get('face_descriptor')
    if isinstance(descriptor, list) and len(descriptor) == 128:
        descriptor_json = json.dumps(descriptor)
    else:
        descriptor_json = existing['face_descriptor']

    try:
        conn.execute(
            """
            UPDATE students
            SET name = ?, roll_number = ?, seat_number = ?, class = ?, email = ?, phone = ?,
                parent_name = ?, parent_phone = ?, photo = ?, face_descriptor = ?
            WHERE id = ?
            """,
            (name, roll_number, seat_number, class_name, email, phone, parent_name, parent_phone, photo, descriptor_json, student_id)
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
        conn.close()
        return jsonify({'student': serialize_student(updated)})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Roll Number or Seat Number already belongs to another student.'}), 409


@app.route('/api/attendance', methods=['GET'])
@api_login_required
def api_attendance_list():
    conn = get_db_connection()
    filter_date = request.args.get('date', '').strip()
    filter_status = request.args.get('status', '').strip()
    filter_subject = request.args.get('subject', '').strip()
    filter_class = request.args.get('class', '').strip()
    student_id = request.args.get('student_id', '').strip()

    sql = """
        SELECT a.id, a.student_id, a.date, a.time, a.status, a.subject, a.method, a.marked_by,
               s.name as student_name, s.roll_number, s.seat_number, s.class
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        WHERE 1=1
    """
    params = []
    if filter_date:
        sql += " AND a.date = ?"
        params.append(filter_date)
    if filter_status in ('Present', 'Absent'):
        sql += " AND a.status = ?"
        params.append(filter_status)
    if filter_subject:
        sql += " AND a.subject = ?"
        params.append(filter_subject)
    if filter_class:
        sql += " AND s.class = ?"
        params.append(filter_class)
    if student_id:
        sql += " AND a.student_id = ?"
        params.append(student_id)

    sql += " ORDER BY a.date DESC, a.time DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return jsonify({'records': [dict(r) for r in rows]})


@app.route('/api/attendance/mark', methods=['POST'])
@api_login_required
def api_attendance_mark():
    if session.get('role') not in ('Admin', 'Administrator', 'Teacher', 'Teacher/Faculty'):
        return jsonify({'error': 'Permission denied'}), 403

    data = request.get_json(silent=True) or {}
    student_id = data.get('student_id')
    att_date = str(data.get('date') or date.today().strftime('%Y-%m-%d')).strip()
    att_time = str(data.get('time') or datetime.now().strftime('%H:%M:%S')).strip()
    status = str(data.get('status', 'Present')).strip()
    subject = str(data.get('subject') or 'Advanced Python Programming').strip()
    method = str(data.get('method') or 'Manual Roll Call').strip()
    marked_by = str(data.get('marked_by') or session.get('full_name', 'Teacher')).strip()
    reject_duplicate = bool(data.get('reject_duplicate', False))

    if not student_id or status not in ('Present', 'Absent'):
        return jsonify({'error': 'Valid student_id and status (Present/Absent) are required.'}), 400

    conn = get_db_connection()
    student = conn.execute("SELECT id, name, roll_number FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        conn.close()
        return jsonify({'error': 'Student not found'}), 404

    existing = conn.execute(
        "SELECT id, time, status FROM attendance WHERE student_id = ? AND date = ? AND subject = ?",
        (student_id, att_date, subject)
    ).fetchone()

    if existing and reject_duplicate:
        conn.close()
        return jsonify({
            'duplicate': True,
            'error': f"Duplicate attendance prevented: {student['name']} already marked {existing['status']} at {existing['time']} for {subject}.",
            'existing': dict(existing)
        }), 409

    conn.execute(
        """
        INSERT INTO attendance (student_id, date, time, status, subject, marked_by, method)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, date, subject) DO UPDATE SET
            time = excluded.time,
            status = excluded.status,
            marked_by = excluded.marked_by,
            method = excluded.method
        """,
        (student_id, att_date, att_time, status, subject, marked_by, method)
    )
    conn.commit()
    conn.close()
    refresh_notifications()
    return jsonify({'ok': True, 'duplicate': False, 'updated': bool(existing)})


@app.route('/api/attendance/batch', methods=['POST'])
@api_login_required
def api_attendance_batch():
    if session.get('role') not in ('Admin', 'Administrator', 'Teacher', 'Teacher/Faculty'):
        return jsonify({'error': 'Permission denied'}), 403

    data = request.get_json(silent=True) or {}
    att_date = str(data.get('date') or date.today().strftime('%Y-%m-%d')).strip()
    subject = str(data.get('subject') or 'Advanced Python Programming').strip()
    records = data.get('records', [])
    marked_by = str(data.get('marked_by') or session.get('full_name', 'Teacher')).strip()
    att_time = datetime.now().strftime('%H:%M:%S')

    if not isinstance(records, list) or not records:
        return jsonify({'error': 'Attendance records array is required.'}), 400

    conn = get_db_connection()
    saved_count = 0
    for rec in records:
        s_id = rec.get('student_id')
        status = rec.get('status')
        if s_id and status in ('Present', 'Absent'):
            conn.execute(
                """
                INSERT INTO attendance (student_id, date, time, status, subject, marked_by, method)
                VALUES (?, ?, ?, ?, ?, ?, 'Manual Roll Call')
                ON CONFLICT(student_id, date, subject) DO UPDATE SET
                    time = excluded.time,
                    status = excluded.status,
                    marked_by = excluded.marked_by,
                    method = 'Manual Roll Call'
                """,
                (s_id, att_date, att_time, status, subject, marked_by)
            )
            saved_count += 1

    conn.commit()
    conn.close()
    refresh_notifications()
    return jsonify({'ok': True, 'saved_count': saved_count, 'date': att_date, 'subject': subject})


@app.route('/api/face/verify', methods=['POST'])
@api_login_required
def api_face_verify():
    """
    Server-side 128-d Euclidean distance face matching against enrolled student encodings.
    Raw biometric descriptors are never returned to the client.
    """
    data = request.get_json(silent=True) or {}
    probe = data.get('descriptor')
    subject = str(data.get('subject') or 'Advanced Python Programming').strip()
    auto_mark = bool(data.get('auto_mark', True))

    if not isinstance(probe, list) or len(probe) != 128:
        return jsonify({'error': 'Valid 128-d face descriptor is required.'}), 400

    conn = get_db_connection()
    settings = get_all_settings(conn)
    max_dist = float(settings.get('face_distance_threshold', '0.55'))

    rows = conn.execute(
        "SELECT id, name, roll_number, seat_number, class, photo, face_descriptor FROM students WHERE face_descriptor IS NOT NULL"
    ).fetchall()

    best_student = None
    best_dist = float('inf')

    for row in rows:
        try:
            enrolled = json.loads(row['face_descriptor'])
            if not isinstance(enrolled, list) or len(enrolled) != 128:
                continue
            dist = math.sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(probe, enrolled)))
            if dist < best_dist:
                best_dist = dist
                best_student = row
        except Exception:
            continue

    if not best_student or best_dist > max_dist:
        conn.close()
        return jsonify({
            'matched': False,
            'reason': 'unknown_face' if rows else 'no_enrolled_faces',
            'distance': round(best_dist, 4) if best_dist != float('inf') else None,
            'threshold': max_dist,
        }), 200

    confidence = round(max(0.0, min(99.9, (1.0 - best_dist) * 100.0)), 1)
    today_str = date.today().strftime('%Y-%m-%d')
    now_time = datetime.now().strftime('%H:%M:%S')

    existing = conn.execute(
        "SELECT id, time, status FROM attendance WHERE student_id = ? AND date = ? AND subject = ?",
        (best_student['id'], today_str, subject)
    ).fetchone()

    duplicate = bool(existing)
    if auto_mark and not duplicate:
        conn.execute(
            """
            INSERT INTO attendance (student_id, date, time, status, subject, marked_by, method)
            VALUES (?, ?, ?, 'Present', ?, 'Entry Point Face Recognition', 'Face Recognition')
            """,
            (best_student['id'], today_str, now_time, subject)
        )
        conn.commit()
        conn.close()
        refresh_notifications()
    else:
        conn.close()

    return jsonify({
        'matched': True,
        'duplicate': duplicate,
        'distance': round(best_dist, 4),
        'confidence': confidence,
        'student': {
            'id': best_student['id'],
            'name': best_student['name'],
            'roll_number': best_student['roll_number'],
            'seat_number': best_student['seat_number'],
            'class': best_student['class'],
            'photo': best_student['photo'],
        }
    })


@app.route('/api/reports/summary', methods=['GET'])
@api_login_required
def api_reports_summary():
    conn = get_db_connection()
    threshold = get_attendance_threshold(conn)
    filter_class = request.args.get('class', '').strip()
    filter_month = request.args.get('month', '').strip()

    sql = """
        SELECT s.id, s.name, s.roll_number, s.seat_number, s.class,
               COUNT(a.id) as total_lectures,
               SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
               SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
        FROM students s
        LEFT JOIN attendance a ON s.id = a.student_id
    """
    params = []
    if filter_month:
        sql += " AND strftime('%Y-%m', a.date) = ?"
        params.append(filter_month)
    sql += " WHERE 1=1"
    if filter_class:
        sql += " AND s.class = ?"
        params.append(filter_class)
    sql += " GROUP BY s.id ORDER BY s.roll_number ASC"

    rows = conn.execute(sql, params).fetchall()
    conn.close()

    summary = []
    for r in rows:
        total = r['total_lectures']
        present = r['present_count'] or 0
        absent = r['absent_count'] or 0
        pct = round((present / total) * 100, 1) if total > 0 else 0.0
        summary.append({
            'id': r['id'],
            'name': r['name'],
            'roll_number': r['roll_number'],
            'seat_number': r['seat_number'],
            'class': r['class'],
            'total_lectures': total,
            'present_count': present,
            'absent_count': absent,
            'percentage': pct,
            'is_shortage': (pct < threshold and total > 0),
        })

    return jsonify({'threshold': threshold, 'summary': summary})


@app.route('/api/reports/export/csv', methods=['GET'])
@api_login_required
def api_export_csv():
    conn = get_db_connection()
    filter_class = request.args.get('class', '').strip()
    sql = """
        SELECT a.id, s.name, s.roll_number, s.seat_number, s.class, a.date, a.time, a.subject, a.method, a.status, a.marked_by
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        WHERE 1=1
    """
    params = []
    if filter_class:
        sql += " AND s.class = ?"
        params.append(filter_class)
    sql += " ORDER BY a.date DESC, a.time DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Student Name', 'Roll Number', 'Seat Number', 'Class', 'Date', 'Time', 'Subject', 'Method', 'Status', 'Marked By'])
    for r in rows:
        writer.writerow([r['id'], r['name'], r['roll_number'], r['seat_number'], r['class'], r['date'], r['time'], r['subject'], r['method'], r['status'], r['marked_by']])

    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename=attendance_audit_{date.today().isoformat()}.csv'}
    )


@app.route('/api/notifications', methods=['GET'])
@api_login_required
def api_notifications():
    refresh_notifications()
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT n.*, s.name as student_name, s.roll_number, s.seat_number, s.class, s.email, s.phone, s.parent_name, s.parent_phone
        FROM notifications n
        JOIN students s ON n.student_id = s.id
        ORDER BY n.percentage ASC
    """).fetchall()
    conn.close()
    return jsonify({'notifications': [dict(r) for r in rows]})


@app.route('/api/notifications/<int:notif_id>/read', methods=['POST'])
@api_login_required
def api_notification_read(notif_id):
    conn = get_db_connection()
    conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notif_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': notif_id, 'is_read': 1})


@app.route('/api/notifications/<int:notif_id>/dispatch', methods=['POST'])
@api_login_required
def api_notification_dispatch(notif_id):
    data = request.get_json(silent=True) or {}
    channel = str(data.get('channel') or 'Email/Internal Alert Log').strip()
    now_ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db_connection()
    conn.execute(
        "UPDATE notifications SET dispatched_at = ?, dispatch_channel = ?, is_read = 1 WHERE id = ?",
        (now_ts, channel, notif_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': notif_id, 'dispatched_at': now_ts, 'dispatch_channel': channel})


@app.route('/api/settings', methods=['GET', 'PUT'])
@api_login_required
def api_settings():
    conn = get_db_connection()
    if request.method == 'GET':
        settings = get_all_settings(conn)
        conn.close()
        return jsonify({'settings': settings})

    if session.get('role') not in ('Admin', 'Administrator'):
        conn.close()
        return jsonify({'error': 'Only Administrator can update system settings.'}), 403

    data = request.get_json(silent=True) or {}
    allowed_keys = {
        'attendance_threshold',
        'face_distance_threshold',
        'min_detection_confidence',
        'institution_name',
        'academic_year',
        'default_subject',
    }
    for k, v in data.items():
        if k in allowed_keys:
            conn.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
                """,
                (k, str(v).strip())
            )
    conn.commit()
    settings = get_all_settings(conn)
    conn.close()
    refresh_notifications()
    return jsonify({'ok': True, 'settings': settings})


# ------------------------------------------------------------------------------
# APPLICATION ENTRY POINT
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    db_file = os.path.join(BASE_DIR, 'smart_attendance.db')
    if not os.path.exists(db_file) or os.path.getsize(db_file) == 0:
        from init_db import seed_sample_data
        seed_sample_data()
    else:
        init_db()

    print("=================================================================")
    print("SMART ATTENDANCE SYSTEM - FLASK SERVER RUNNING ON LOCALHOST")
    print("Student : Sahil Pasula (TYBSC-A-39 | Seat: 24TCS076)")
    print("URL     : http://127.0.0.1:5000")
    print("=================================================================")
    app.run(host='0.0.0.0', port=5000, debug=True)
