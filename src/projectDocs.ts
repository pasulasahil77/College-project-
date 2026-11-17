import appPyRaw from '../app.py?raw';
import databasePyRaw from '../database.py?raw';
import schemaSqlRaw from '../schema.sql?raw';
import initDbPyRaw from '../init_db.py?raw';
import vivaMdRaw from '../viva_questions.md?raw';
import requirementsTxtRaw from '../requirements.txt?raw';
import readmeMdRaw from '../README.md?raw';
import templateDashboardRaw from '../templates/dashboard.html?raw';
import templateAttendanceRaw from '../templates/mark_attendance.html?raw';

export const VIVA_QUESTIONS = [
  {
    q: 'What is the main objective of your Smart Attendance System project?',
    a: 'The primary objective is to replace the tedious, error-prone manual paper-based roll call in colleges with an automated computerized system. By using facial recognition at the classroom entrance and SQLite persistence, it saves precious teaching time, prevents proxy attendance, automatically computes percentage compliance, and warns students/parents when attendance drops below the university mandatory 75% threshold.',
    category: 'Objective & Scope',
  },
  {
    q: 'Why did you choose Python Flask instead of Django for this college project?',
    a: "Flask is a lightweight WSGI micro-framework that adheres to the KISS principle. Unlike Django which has heavy boilerplate and strict ORMs, Flask is minimalistic, allows direct integration with standard SQLite3 queries via Python's sqlite3 module, uses Jinja2 templating cleanly, and is fast to start and debug on any computer running Windows or Linux.",
    category: 'Framework Architecture',
  },
  {
    q: 'Why did you select SQLite as the database engine?',
    a: "SQLite is a self-contained, serverless, zero-configuration SQL database engine. The entire database is stored in a single cross-platform disk file (smart_attendance.db). It requires no dedicated database daemon, supports full ACID transactions, and is natively built into Python's standard library.",
    category: 'Database',
  },
  {
    q: 'Explain how facial recognition works in this system.',
    a: 'The recognition pipeline runs in 4 real stages: 1) Face Detection: Captures webcam frames and locates face bounding boxes using TinyFaceDetector / SSD MobileNet v1. 2) Landmark Alignment: Detects 68 facial landmarks for normalized framing. 3) Feature Extraction: A deep convolutional neural network computes a 128-dimensional floating-point face descriptor vector. 4) Face Matching: Computes Euclidean distance between the live 128-d vector and enrolled student vectors; if distance <= threshold (default 0.55) a match is confirmed and duplicate-checked attendance is marked.',
    category: 'Computer Vision / AI',
  },
  {
    q: 'How does the system prevent a student from marking attendance twice for the same lecture?',
    a: 'We enforce a composite unique constraint in SQLite: UNIQUE(student_id, date, subject). Both the face scanner and backend API check whether an attendance entry already exists for that student, date, and lecture subject before committing, preventing duplicate entries while allowing separate subjects on the same day.',
    category: 'Database Integrity',
  },
  {
    q: 'What happens when a student is deleted? How is referential integrity maintained?',
    a: 'In SQLite, foreign key constraints are enabled via PRAGMA foreign_keys = ON; with ON DELETE CASCADE on attendance and notifications. Deleting a student automatically cleans up all associated attendance records and notifications.',
    category: 'Database Integrity',
  },
  {
    q: 'What is the mathematical formula used to calculate attendance percentage?',
    a: 'Attendance Percentage = (Total Present Sessions / Total Sessions Conducted) * 100. In SQL: SELECT (SUM(CASE WHEN status = "Present" THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS pct FROM attendance WHERE student_id = ?.',
    category: 'Math & Logic',
  },
  {
    q: 'How does the notification module alert students having below 75% attendance?',
    a: 'After every attendance submission or settings change, refresh_notifications() evaluates all students against the configurable threshold (default 75%). Alerts are stored in notifications while preserving read/dispatched status across refreshes.',
    category: 'Business Logic',
  },
  {
    q: 'What is WSGI in Python Flask?',
    a: 'WSGI stands for Web Server Gateway Interface (PEP 3333), describing how a Python web server communicates with a web application framework such as Flask.',
    category: 'Python Web Tech',
  },
  {
    q: 'What are the 4 user types defined in the project synopsis?',
    a: 'As defined in Section 6: 1) Administrator (full system & settings control), 2) Teacher/Faculty (daily roll call, live scanner, reports), 3) Student (personal attendance viewing), and 4) Parent/Guardian (ward shortage alerts and compliance monitoring).',
    category: 'System Design',
  },
];

export const CODE_FILES: Record<string, { name: string; content: string }> = {
  app_py: { name: 'app.py', content: appPyRaw },
  database_py: { name: 'database.py', content: databasePyRaw },
  schema_sql: { name: 'schema.sql', content: schemaSqlRaw },
  init_db_py: { name: 'init_db.py', content: initDbPyRaw },
  viva_md: { name: 'viva_questions.md', content: vivaMdRaw },
  template_dashboard: { name: 'templates/dashboard.html', content: templateDashboardRaw },
  template_attendance: { name: 'templates/mark_attendance.html', content: templateAttendanceRaw },
  requirements_txt: { name: 'requirements.txt', content: requirementsTxtRaw },
  readme_md: { name: 'README.md', content: readmeMdRaw },
};

export function renderSynopsisBodyHtml(): string {
  return `
    <div class="synopsis-page-container">
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-file-pdf text-danger"></i>
            <div>
              <h3>Official Project Synopsis (TY BSc Computer Science)</h3>
              <p class="card-subtitle">Uploaded Academic Document &bull; Sahil Pasula (TYBSC-A-39 &bull; Seat: 24TCS076)</p>
            </div>
          </div>
          <div class="header-actions">
            <button class="btn btn-sm btn-outline" onclick="window.print()">
              <i class="fa-solid fa-print"></i> Print Synopsis
            </button>
          </div>
        </div>
      </div>

      <div class="synopsis-paper">
        <div class="synopsis-doc-header">
          <h1>SMART ATTENDANCE SYSTEM</h1>
          <div class="doc-subtitle">PROJECT SYNOPSIS &bull; ACADEMIC REPORT</div>
          <div class="synopsis-author-box">
            <div><strong>Student Name:</strong> Sahil Pasula</div>
            <div><strong>Class &amp; Roll No:</strong> TYBSC-A-39</div>
            <div><strong>Seat Number:</strong> 24TCS076</div>
          </div>
        </div>

        <div class="synopsis-section">
          <h2>1. Introduction</h2>
          <p>
            The Smart Attendance System is a computerized system designed to make taking attendance in a college or workplace faster, easier, and more accurate. In most places, attendance is still taken manually on paper or by calling out names, which wastes time at the start of every lecture and often leads to mistakes or proxy attendance. This project aims to solve that everyday problem by automating the process through software.
          </p>
          <p>
            With this system, a student's presence is recorded automatically when they enter the classroom or look at a camera, and the data is stored safely in a database. Because everything is recorded digitally, teachers and administrators can check who is present, who is absent, and what a student's overall attendance percentage is at any time without having to count registers by hand.
          </p>
        </div>

        <div class="synopsis-section">
          <h2>2. Objective</h2>
          <div class="numbered-points">
            <div class="numbered-point"><span class="point-num">1</span><div>To replace the slow and error-prone manual method of taking attendance on paper.</div></div>
            <div class="numbered-point"><span class="point-num">2</span><div>To save valuable classroom teaching time that is otherwise wasted in roll calls.</div></div>
            <div class="numbered-point"><span class="point-num">3</span><div>To reduce proxy attendance and ensure that only genuinely present students are marked.</div></div>
            <div class="numbered-point"><span class="point-num">4</span><div>To store attendance data securely in a digital database so records are easy to search and manage.</div></div>
            <div class="numbered-point"><span class="point-num">5</span><div>To automatically generate accurate attendance reports and percentages for staff and students.</div></div>
          </div>
        </div>

        <div class="synopsis-section">
          <h2>3. Existing System</h2>
          <p>
            Currently, in most schools and colleges, attendance is taken using a traditional paper register. At the beginning or end of each lecture, the teacher calls out every student's roll number one by one and marks them present or absent by hand. This method takes several minutes out of every class, especially when the batch size is large, and it also disturbs the flow of teaching.
          </p>
          <p>
            Apart from wasting time, the paper-based system comes with several practical issues. Students sometimes answer roll calls for their absent friends, which leads to fake or proxy attendance. On top of that, paper registers can get lost, torn, or damaged over time, and calculating monthly or semester-wise attendance percentages for every single student becomes a tiring and time-consuming task for the staff.
          </p>
        </div>

        <div class="synopsis-section">
          <h2>4. Scope</h2>
          <p>
            The scope of the Smart Attendance System covers its use inside classrooms, laboratories, and departments within a school or college. In its initial version, the system is designed to handle student registration, daily attendance marking, and simple report generation for individual subjects or classes, replacing the regular paper register for teachers and staff.
          </p>
          <p>
            At a later stage, the same system can be scaled up to cover an entire department or even a full campus, with multiple entry points connected to a central database.
          </p>
        </div>

        <div class="synopsis-section">
          <h2>5. Modules</h2>
          <div class="numbered-points">
            <div class="numbered-point"><span class="point-num">1</span><div><strong>Registration Module:</strong> Used to add new students into the system along with their photo, roll number, and class details so that the system can recognize them later.</div></div>
            <div class="numbered-point"><span class="point-num">2</span><div><strong>Attendance Marking Module:</strong> The core module that captures the student's face/identity at the entry point and automatically marks them present in the database with a timestamp.</div></div>
            <div class="numbered-point"><span class="point-num">3</span><div><strong>Database Module:</strong> Responsible for securely storing all student information and daily attendance records so that nothing is lost or duplicated.</div></div>
            <div class="numbered-point"><span class="point-num">4</span><div><strong>Report Generation Module:</strong> Generates daily, monthly, or subject-wise attendance reports and attendance percentage automatically, removing the need for manual calculation.</div></div>
            <div class="numbered-point"><span class="point-num">5</span><div><strong>Admin/Login Module:</strong> Allows authorized staff to log in, view records, edit student details, and manage overall system access securely.</div></div>
            <div class="numbered-point"><span class="point-num">6</span><div><strong>Notification Module (optional):</strong> Can alert parents or students through SMS or email if attendance falls below a certain required percentage (75%).</div></div>
          </div>
        </div>

        <div class="synopsis-section">
          <h2>6. Type of Users</h2>
          <div class="numbered-points">
            <div class="numbered-point"><span class="point-num">1</span><div><strong>Administrator:</strong> Has full control over the system, including adding/removing students, managing teacher accounts, and overseeing the entire attendance database.</div></div>
            <div class="numbered-point"><span class="point-num">2</span><div><strong>Teacher/Faculty:</strong> Uses the system on a daily basis to view live attendance during lectures and to generate reports for their respective classes or subjects.</div></div>
            <div class="numbered-point"><span class="point-num">3</span><div><strong>Student:</strong> Mainly interacts with the system passively, by simply being recognized at the entry point, though some versions may allow students to view their own attendance percentage.</div></div>
            <div class="numbered-point"><span class="point-num">4</span><div><strong>Parent/Guardian (optional user):</strong> May receive periodic updates or alerts regarding their ward's attendance if the notification module is implemented.</div></div>
          </div>
        </div>

        <div class="synopsis-section">
          <h2>7. Future Scope of Improvement</h2>
          <p>
            Possible future improvements include native mobile app access for teachers and parents, training on larger diverse datasets for challenging lighting conditions, ERP integration, and centralized multi-campus cloud replication.
          </p>
        </div>

        <div class="synopsis-section">
          <h2>8. Conclusion</h2>
          <p>
            Overall, the Smart Attendance System is a practical solution to the slow, error-prone process of manual attendance, giving back valuable classroom time, reducing proxy attendance, and providing accurate digital records.
          </p>
        </div>
      </div>
    </div>
  `;
}
