# SMART ATTENDANCE SYSTEM

**A TY BSc Computer Science College Project**  
- **Student Name:** Sahil Pasula  
- **Class & Roll Number:** TYBSC-A-39  
- **Seat Number:** 24TCS076  
- **Technology Stack:** Python 3, Flask, SQLite3, HTML5, CSS3, JavaScript (No React)

---

## 📋 Project Overview

The **Smart Attendance System** is a responsive web application designed for academic colleges and university departments to automate daily student attendance marking, monitor attendance performance, calculate percentages automatically, and issue critical warning notifications when a student's aggregate attendance drops below the mandatory **75% threshold**.

---

## 🗂️ Folder Structure

```text
smart-attendance-system/
│
├── app.py                     # Main Flask Application & Route Controller
├── database.py                # SQLite connection helpers & notification triggers
├── schema.sql                 # SQL database schema (Users, Students, Attendance, Notifications)
├── init_db.py                 # Database initialization & sample student seeder script
├── smart_attendance.db        # SQLite Database file (generated on init)
├── requirements.txt           # Python dependencies (Flask, Werkzeug)
├── README.md                  # Complete documentation and setup guide
├── viva_questions.md          # 25+ Viva questions & model answers for external examiners
│
├── templates/                 # Jinja2 HTML Templates (Pure HTML5 & JS, No React)
│   ├── base.html              # Base layout with sidebar, navbar, and student info
│   ├── login.html             # Faculty & Admin Login page
│   ├── dashboard.html         # Analytics dashboard with 4 metric cards
│   ├── register_student.html  # Student registration form with photo upload
│   ├── mark_attendance.html   # Daily roll-call attendance sheet (Present/Absent)
│   ├── attendance_records.html# Searchable historical attendance audit trail
│   ├── reports.html           # Daily, Monthly & Student-wise percentage reports
│   ├── student_records.html   # Student directory with View, Edit, Delete (CRUD)
│   ├── student_view.html      # Individual Student ID Card & attendance history
│   ├── student_edit.html      # Edit student details modal/page
│   └── notifications.html     # Attendance Shortage Warning (<75%) & Parent Alert
│
└── static/
    ├── css/
    │   └── style.css          # Clean, modern, responsive CSS styling
    ├── js/
    │   └── main.js            # Vanilla JS (DOM manipulation, CSV export, validation)
    └── uploads/               # Uploaded student profile photos directory
```

---

## 🗄️ Database Design (SQLite)

The system utilizes an SQLite3 database (`smart_attendance.db`) containing 4 relational tables:

1. **`users` Table**:
   - `id` (INTEGER PRIMARY KEY)
   - `username` (TEXT UNIQUE)
   - `password` (TEXT)
   - `full_name` (TEXT)
   - `role` (TEXT)

2. **`students` Table**:
   - `id` (INTEGER PRIMARY KEY)
   - `name` (TEXT)
   - `roll_number` (TEXT UNIQUE)
   - `seat_number` (TEXT UNIQUE)
   - `class` (TEXT)
   - `email` (TEXT)
   - `phone` (TEXT)
   - `photo` (TEXT)

3. **`attendance` Table**:
   - `id` (INTEGER PRIMARY KEY)
   - `student_id` (FOREIGN KEY -> `students.id` ON DELETE CASCADE)
   - `date` (DATE)
   - `time` (TIME)
   - `status` (TEXT CHECK `Present` OR `Absent`)
   - `marked_by` (TEXT)
   - *UNIQUE constraint on `(student_id, date)` to prevent duplicate entries per day*

4. **`notifications` Table**:
   - `id` (INTEGER PRIMARY KEY)
   - `student_id` (FOREIGN KEY -> `students.id`)
   - `title` (TEXT)
   - `message` (TEXT)
   - `percentage` (REAL)
   - `is_read` (INTEGER)

---

## 🚀 How to Run the Project on Localhost

### Prerequisites:
- Python 3.8 or higher installed on your computer.
- Terminal / Command Prompt.

### Step 1: Open Terminal in Project Directory
```bash
cd smart-attendance-system
```

### Step 2: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 3: Initialize Database & Seed Sample Data
```bash
python init_db.py
```
*Output: `Database 'smart_attendance.db' initialized and sample data seeded successfully!`*

### Step 4: Start the Flask Web Server
```bash
python app.py
```

### Step 5: Open in Web Browser
Navigate to:
```text
http://127.0.0.1:5000
```
or
```text
http://localhost:5000
```

---

## 🔑 Default Login Credentials

| Role | Username | Password |
| :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` |
| **Faculty / Teacher** | `teacher` | `teacher123` |

---

## 📊 Sample Student Data Included

The database is pre-populated with realistic BSc CS students:

1. **Sahil Pasula** (Roll: `TYBSC-A-39` | Seat: `24TCS076`) - 100% Attendance
2. **Rohan Sharma** (Roll: `TYBSC-A-12` | Seat: `24TCS012`) - 85.7% Attendance
3. **Priya Nair** (Roll: `TYBSC-A-24` | Seat: `24TCS045`) - 85.7% Attendance
4. **Amit Verma** (Roll: `TYBSC-A-05` | Seat: `24TCS008`) - **42.8% Attendance (Triggered Warning <75%)**
5. **Neha Kulkarni** (Roll: `TYBSC-A-18` | Seat: `24TCS029`) - 85.7% Attendance
6. **Aditya Deshmukh** (Roll: `TYBSC-A-02` | Seat: `24TCS003`) - 100% Attendance
7. **Sneha Patil** (Roll: `TYBSC-A-44` | Seat: `24TCS089`) - **42.8% Attendance (Triggered Warning <75%)**
8. **Tanmay Joshi** (Roll: `TYBSC-A-51` | Seat: `24TCS102`) - 85.7% Attendance

---

## 🎯 Key Modules & Features

1. **Login Page**: Secure authentication with session management.
2. **Dashboard**: Live counter cards (Total Students, Present Today, Absent Today, Attendance Percentage) and low-attendance alert banner.
3. **Student Registration**: Register students with Name, Roll No, Seat No, Class, Email, Phone, and Photo upload.
4. **Mark Attendance**: Interactive roll-call register with date selector, "Mark All Present", "Mark All Absent", and timestamp recording.
5. **Attendance Records**: Searchable audit log with date, time, and student details.
6. **Reports**: Daily report, Monthly summary, and Student-wise attendance percentage with automatic computation.
7. **Student Records**: Full CRUD operations (View Profile ID Card, Edit Info, Delete with Cascade).
8. **Notifications**: Automatic warning generator flagging any student below 75% attendance with SMS/Email parent alert simulation.
