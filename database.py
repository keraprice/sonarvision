"""
Database models and initialization for user authentication
"""
import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = 'sonarvision.db'

def init_database():
    """Initialize the database with user tables"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_superuser INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            last_login TEXT,
            metadata TEXT
        )
    ''')
    
    # Create sessions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_token TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    # Create user_data table for storing user-specific data
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            data_key TEXT NOT NULL,
            data_value TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, data_key)
        )
    ''')

    # Create projects table for storing per-user project details
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, name)
        )
    ''')

    # Create project features table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            UNIQUE(project_id, name)
        )
    ''')

    # Phase submissions table (links a submission to project/feature and phase name)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS phase_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id INTEGER,
            feature_id INTEGER,
            phase TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (feature_id) REFERENCES project_features(id)
        )
    ''')
    
    conn.commit()
    
    # Create default superuser if no users exist
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        create_default_superuser(cursor)
        conn.commit()
    
    conn.close()
    print(f"[+] Database initialized at {DB_PATH}")

def create_default_superuser(cursor):
    """Create a default superuser account"""
    default_username = "admin"
    default_email = "admin@sonarvision.local"
    default_password = "admin123"  # Should be changed on first login
    
    password_hash = hash_password(default_password)
    created_at = datetime.now().isoformat()
    
    cursor.execute('''
        INSERT INTO users (username, email, password_hash, is_superuser, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (default_username, default_email, password_hash, 1, 1, created_at))
    
    print(f"[+] Created default superuser: {default_username} / {default_password}")
    print(f"[!] IMPORTANT: Change the default password after first login!")

def hash_password(password):
    """Hash a password using SHA-256 with salt"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return f"{salt}:{password_hash}"

def verify_password(password, password_hash):
    """Verify a password against a hash"""
    try:
        salt, stored_hash = password_hash.split(':')
        computed_hash = hashlib.sha256((password + salt).encode()).hexdigest()
        return computed_hash == stored_hash
    except ValueError:
        return False

def get_db_connection():
    """Get a database connection"""
    return sqlite3.connect(DB_PATH)

def get_user_by_username(username):
    """Get user by username"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            'id': row[0],
            'username': row[1],
            'email': row[2],
            'password_hash': row[3],
            'is_superuser': bool(row[4]),
            'is_active': bool(row[5]),
            'created_at': row[6],
            'last_login': row[7],
            'metadata': row[8]
        }
    return None

def get_user_by_id(user_id):
    """Get user by ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            'id': row[0],
            'username': row[1],
            'email': row[2],
            'password_hash': row[3],
            'is_superuser': bool(row[4]),
            'is_active': bool(row[5]),
            'created_at': row[6],
            'last_login': row[7],
            'metadata': row[8]
        }
    return None

def get_user_by_email(email):
    """Get user by email"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            'id': row[0],
            'username': row[1],
            'email': row[2],
            'password_hash': row[3],
            'is_superuser': bool(row[4]),
            'is_active': bool(row[5]),
            'created_at': row[6],
            'last_login': row[7],
            'metadata': row[8]
        }
    return None

def create_user(username, email, password, is_superuser=False):
    """Create a new user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if username or email already exists
    if get_user_by_username(username):
        conn.close()
        return None, "Username already exists"
    
    if get_user_by_email(email):
        conn.close()
        return None, "Email already exists"
    
    password_hash = hash_password(password)
    created_at = datetime.now().isoformat()
    
    cursor.execute('''
        INSERT INTO users (username, email, password_hash, is_superuser, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (username, email, password_hash, 1 if is_superuser else 0, 1, created_at))
    
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return get_user_by_id(user_id), None

def update_user_last_login(user_id):
    """Update user's last login timestamp"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE users SET last_login = ? WHERE id = ?
    ''', (datetime.now().isoformat(), user_id))
    conn.commit()
    conn.close()

def get_all_users():
    """Get all users (for superuser management)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, email, is_superuser, is_active, created_at, last_login FROM users')
    rows = cursor.fetchall()
    conn.close()
    
    return [
        {
            'id': row[0],
            'username': row[1],
            'email': row[2],
            'is_superuser': bool(row[3]),
            'is_active': bool(row[4]),
            'created_at': row[5],
            'last_login': row[6]
        }
        for row in rows
    ]

def update_user(user_id, updates):
    """Update user information"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    allowed_fields = ['username', 'email', 'is_superuser', 'is_active']
    update_fields = []
    values = []
    
    for field in allowed_fields:
        if field in updates:
            update_fields.append(f"{field} = ?")
            values.append(updates[field])
    
    if 'password' in updates:
        update_fields.append("password_hash = ?")
        values.append(hash_password(updates['password']))
    
    if not update_fields:
        conn.close()
        return False
    
    values.append(user_id)
    query = f"UPDATE users SET {', '.join(update_fields)} WHERE id = ?"
    cursor.execute(query, values)
    conn.commit()
    conn.close()
    return True

def delete_user(user_id):
    """Delete a user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return True

def create_session(user_id, expires_in_hours=24):
    """Create a session for a user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    session_token = secrets.token_urlsafe(32)
    created_at = datetime.now().isoformat()
    # Use timedelta instead of manual hour math to avoid invalid hour values
    expires_at = (datetime.fromisoformat(created_at) + timedelta(hours=expires_in_hours)).isoformat()
    
    cursor.execute('''
        INSERT INTO sessions (user_id, session_token, created_at, expires_at)
        VALUES (?, ?, ?, ?)
    ''', (user_id, session_token, created_at, expires_at))
    
    conn.commit()
    conn.close()
    
    return session_token

def get_session(session_token):
    """Get session by token"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM sessions WHERE session_token = ? AND expires_at > ?
    ''', (session_token, datetime.now().isoformat()))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            'id': row[0],
            'user_id': row[1],
            'session_token': row[2],
            'created_at': row[3],
            'expires_at': row[4]
        }
    return None

def delete_session(session_token):
    """Delete a session"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM sessions WHERE session_token = ?', (session_token,))
    conn.commit()
    conn.close()

# -------------------- Project helpers --------------------

def get_projects_for_user(user_id):
    """Return all projects for a user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, details, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            'id': row[0],
            'name': row[1],
            'details': row[2],
            'created_at': row[3],
            'updated_at': row[4]
        } for row in rows
    ]

def get_project_by_id(user_id, project_id):
    """Get a specific project for a user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, details, created_at, updated_at FROM projects WHERE user_id = ? AND id = ?', (user_id, project_id))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            'id': row[0],
            'name': row[1],
            'details': row[2],
            'created_at': row[3],
            'updated_at': row[4]
        }
    return None

def create_project(user_id, name, details_json):
    """Create a new project for a user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        'INSERT INTO projects (user_id, name, details, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        (user_id, name, details_json, now, now)
    )
    project_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_project_by_id(user_id, project_id)

def update_project(user_id, project_id, name=None, details_json=None):
    """Update an existing project"""
    conn = get_db_connection()
    cursor = conn.cursor()
    fields = []
    values = []
    if name is not None:
        fields.append('name = ?')
        values.append(name)
    if details_json is not None:
        fields.append('details = ?')
        values.append(details_json)
    if not fields:
        conn.close()
        return False
    values.append(datetime.now().isoformat())
    fields.append('updated_at = ?')
    values.extend([user_id, project_id])
    query = f"UPDATE projects SET {', '.join(fields)} WHERE user_id = ? AND id = ?"
    cursor.execute(query, values)
    conn.commit()
    conn.close()
    return True

def delete_project(user_id, project_id):
    """Delete a project"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM projects WHERE user_id = ? AND id = ?', (user_id, project_id))
    conn.commit()
    conn.close()

# -------------------- Feature helpers --------------------

def get_features_for_project(user_id, project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''SELECT pf.id, pf.name, pf.details, pf.created_at, pf.updated_at
           FROM project_features pf
           JOIN projects p ON pf.project_id = p.id
           WHERE p.user_id = ? AND pf.project_id = ?
           ORDER BY pf.updated_at DESC''',
        (user_id, project_id)
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            'id': row[0],
            'name': row[1],
            'details': row[2],
            'created_at': row[3],
            'updated_at': row[4],
        } for row in rows
    ]

def get_feature_by_id(user_id, project_id, feature_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''SELECT pf.id, pf.name, pf.details, pf.created_at, pf.updated_at
           FROM project_features pf
           JOIN projects p ON pf.project_id = p.id
           WHERE p.user_id = ? AND pf.project_id = ? AND pf.id = ?''',
        (user_id, project_id, feature_id)
    )
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            'id': row[0],
            'name': row[1],
            'details': row[2],
            'created_at': row[3],
            'updated_at': row[4],
        }
    return None

def create_feature(user_id, project_id, name, details_json):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        '''INSERT INTO project_features (project_id, name, details, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?)''',
        (project_id, name, details_json, now, now, project_id, user_id)
    )
    if cursor.rowcount == 0:
        conn.close()
        return None
    feature_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_feature_by_id(user_id, project_id, feature_id)

def update_feature(user_id, project_id, feature_id, name=None, details_json=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    fields = []
    values = []
    if name is not None:
        fields.append('name = ?')
        values.append(name)
    if details_json is not None:
        fields.append('details = ?')
        values.append(details_json)
    if not fields:
        conn.close()
        return False
    values.append(datetime.now().isoformat())
    fields.append('updated_at = ?')
    values.extend([user_id, project_id, feature_id])
    cursor.execute(
        f'''UPDATE project_features SET {', '.join(fields)}
            WHERE id = ? AND project_id = ?
              AND EXISTS (SELECT 1 FROM projects WHERE id = project_id AND user_id = ?)''',
        (*values, )
    )
    conn.commit()
    conn.close()
    return True

def delete_feature(user_id, project_id, feature_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''DELETE FROM project_features
           WHERE id = ? AND project_id = ?
             AND EXISTS (SELECT 1 FROM projects WHERE id = project_id AND user_id = ?)''',
        (feature_id, project_id, user_id)
    )
    conn.commit()
    conn.close()

# -------------------- Phase submission helpers --------------------

def create_phase_submission(user_id, project_id, feature_id, phase, payload_json):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute(
        '''INSERT INTO phase_submissions (user_id, project_id, feature_id, phase, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (user_id, project_id, feature_id, phase, payload_json, now, now)
    )
    submission_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return submission_id

def delete_phase_submission(user_id, submission_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''DELETE FROM phase_submissions
           WHERE id = ? AND user_id = ?''',
        (submission_id, user_id)
    )
    conn.commit()
    conn.close()
    return True

def list_phase_submissions(user_id, project_id=None, feature_id=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = 'SELECT id, user_id, project_id, feature_id, phase, payload, created_at, updated_at FROM phase_submissions WHERE user_id = ?'
    params = [user_id]
    if project_id:
        query += ' AND project_id = ?'
        params.append(project_id)
    if feature_id:
        query += ' AND feature_id = ?'
        params.append(feature_id)
    query += ' ORDER BY created_at DESC'
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            'id': row[0],
            'user_id': row[1],
            'project_id': row[2],
            'feature_id': row[3],
            'phase': row[4],
            'payload': row[5],
            'created_at': row[6],
            'updated_at': row[7]
        } for row in rows
    ]

# Initialize database on import
init_database()
