# TY BSc Computer Science - Viva Preparation Guide
## Project: SMART ATTENDANCE SYSTEM
**Student:** Sahil Pasula | **Class:** TYBSC-A-39 | **Seat No:** 24TCS076

---

### Q1: What is the main objective of your project?
**Answer:** The objective of the "Smart Attendance System" is to replace conventional manual paper-based attendance registers in colleges with an automated, computerized web application that records daily attendance, automatically calculates attendance percentage, and generates alerts for students having attendance below 75%.

---

### Q2: Why did you choose Python Flask for this project?
**Answer:** Flask is a lightweight WSGI micro-web framework for Python. It is simple to understand, modular, has no boilerplate code, and integrates smoothly with Jinja2 templating and SQLite databases, making it ideal for a TY BSc Computer Science project.

---

### Q3: Why did you choose SQLite?
**Answer:** SQLite is a serverless, self-contained, zero-configuration SQL database engine. The entire database is stored in a single cross-platform file (`smart_attendance.db`), making it fast, reliable, portable, and easy to run on localhost.

---

### Q4: Explain the database schema and relationships.
**Answer:** 
The database contains 4 tables:
1. `users`: Stores login credentials for teachers and administrators.
2. `students`: Stores student personal details (Roll No, Seat No, Class, Email, Phone, Photo).
3. `attendance`: Stores daily attendance logs. It has a Foreign Key `student_id` referencing `students(id)` with `ON DELETE CASCADE`, and a `UNIQUE(student_id, date)` constraint to prevent duplicate attendance marks on the same day.
4. `notifications`: Stores warning alerts for students with attendance under 75%.

---

### Q5: How is the attendance percentage calculated?
**Answer:** 
The attendance percentage is calculated using the formula:
$$\text{Attendance Percentage} = \left(\frac{\text{Total Present Sessions}}{\text{Total Sessions Held}}\right) \times 100$$
In SQL:
```sql
SELECT (COUNT(CASE WHEN status = 'Present' THEN 1 END) * 100.0 / COUNT(*)) AS percentage
FROM attendance WHERE student_id = ?;
```

---

### Q6: How does the system handle the 75% attendance rule?
**Answer:** 
The function `refresh_notifications()` executes a query after every attendance submission. If any student's aggregate attendance is less than 75.0%, an alert is created in the `notifications` table, displaying a warning on the dashboard and notifications page.

---

### Q7: What prevents marking attendance twice for the same student on the same date?
**Answer:** 
We defined a composite UNIQUE constraint: `UNIQUE(student_id, date)` in the `attendance` table. In Flask, we use SQLite's `INSERT ... ON CONFLICT(student_id, date) DO UPDATE SET` so that re-submitting simply updates the existing record with the new timestamp.

---

### Q8: What happens when a student is deleted?
**Answer:** 
Because we enabled `PRAGMA foreign_keys = ON;` and defined `ON DELETE CASCADE` on `student_id`, deleting a student automatically deletes all of their attendance history and notifications, maintaining referential integrity.

---

### Q9: What HTTP methods are used in this application?
**Answer:**
- `GET`: Used to retrieve pages and query data (e.g., viewing dashboard, reports, attendance records, search queries).
- `POST`: Used to submit data securely to the server (e.g., user login, student registration, marking attendance, updating records, deleting records).

---

### Q10: How do you handle file uploads for student photos?
**Answer:**
We use `enctype="multipart/form-data"` on the registration form and Flask's `request.files['photo']`. We sanitize the filename using `secure_filename()` from `werkzeug.utils` and save the file into the `static/uploads/` directory, while storing the filename in SQLite.
