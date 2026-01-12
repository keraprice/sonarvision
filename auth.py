"""
Authentication API endpoints
"""
from flask import Blueprint, request, jsonify
from database import (
    get_user_by_username, get_user_by_email, create_user, verify_password,
    create_session, get_session, delete_session, update_user_last_login,
    get_all_users, update_user, delete_user, get_user_by_id,
    get_projects_for_user, get_project_by_id, create_project, update_project, delete_project,
    get_features_for_project, get_feature_by_id, create_feature, update_feature, delete_feature,
    create_phase_submission, list_phase_submissions, delete_phase_submission
)
from functools import wraps
from datetime import datetime
import json

auth_bp = Blueprint('auth', __name__)

def get_current_user():
    """Get current user from session token"""
    session_token = request.headers.get('Authorization')
    if not session_token:
        return None
    
    # Remove 'Bearer ' prefix if present
    if session_token.startswith('Bearer '):
        session_token = session_token[7:]
    
    session = get_session(session_token)
    if not session:
        return None
    
    user = get_user_by_id(session['user_id'])
    if not user or not user['is_active']:
        return None
    
    return user

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def require_superuser(f):
    """Decorator to require superuser"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        if not user['is_superuser']:
            return jsonify({'error': 'Superuser access required'}), 403
        return f(*args, **kwargs)
    return decorated_function

@auth_bp.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Validation
        if not username or len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        
        if not email or '@' not in email:
            return jsonify({'error': 'Valid email is required'}), 400
        
        if not password or len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        # Create user
        user, error = create_user(username, email, password, is_superuser=False)
        if error:
            return jsonify({'error': error}), 400
        
        # Create session
        session_token = create_session(user['id'])
        update_user_last_login(user['id'])
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_superuser': user['is_superuser']
            },
            'session_token': session_token
        }), 201
        
    except Exception as e:
        return jsonify({'error': f'Registration failed: {str(e)}'}), 500

@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    """Login user"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        if not username or not password:
            return jsonify({'error': 'Username and password are required'}), 400
        
        # Get user by username or email
        user = get_user_by_username(username)
        if not user:
            user = get_user_by_email(username)
        
        if not user:
            return jsonify({'error': 'Invalid username or password'}), 401
        
        if not user['is_active']:
            return jsonify({'error': 'Account is disabled'}), 403
        
        # Verify password
        if not verify_password(password, user['password_hash']):
            return jsonify({'error': 'Invalid username or password'}), 401
        
        # Create session
        session_token = create_session(user['id'])
        update_user_last_login(user['id'])
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_superuser': user['is_superuser']
            },
            'session_token': session_token
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Login failed: {str(e)}'}), 500

@auth_bp.route('/api/auth/logout', methods=['POST'])
@require_auth
def logout():
    """Logout user"""
    try:
        session_token = request.headers.get('Authorization', '')
        if session_token.startswith('Bearer '):
            session_token = session_token[7:]
        
        delete_session(session_token)
        return jsonify({'success': True, 'message': 'Logged out successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': f'Logout failed: {str(e)}'}), 500

@auth_bp.route('/api/auth/me', methods=['GET'])
@require_auth
def get_current_user_info():
    """Get current user information"""
    try:
        user = get_current_user()
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_superuser': user['is_superuser'],
                'created_at': user['created_at'],
                'last_login': user['last_login']
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to get user info: {str(e)}'}), 500

@auth_bp.route('/api/auth/users', methods=['GET'])
@require_superuser
def list_users():
    """List all users (superuser only)"""
    try:
        users = get_all_users()
        return jsonify({
            'success': True,
            'users': users
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to list users: {str(e)}'}), 500

@auth_bp.route('/api/auth/users/<int:user_id>', methods=['GET'])
@require_superuser
def get_user(user_id):
    """Get user by ID (superuser only)"""
    try:
        user = get_user_by_id(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_superuser': user['is_superuser'],
                'is_active': user['is_active'],
                'created_at': user['created_at'],
                'last_login': user['last_login']
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to get user: {str(e)}'}), 500

@auth_bp.route('/api/auth/users/<int:user_id>', methods=['PUT'])
@require_superuser
def update_user_info(user_id):
    """Update user information (superuser only)"""
    try:
        data = request.get_json()
        
        # Prevent self-demotion
        current_user = get_current_user()
        if current_user['id'] == user_id and 'is_superuser' in data and not data['is_superuser']:
            return jsonify({'error': 'Cannot remove your own superuser status'}), 400
        
        updates = {}
        if 'username' in data:
            updates['username'] = data['username'].strip()
        if 'email' in data:
            updates['email'] = data['email'].strip()
        if 'password' in data:
            if len(data['password']) < 6:
                return jsonify({'error': 'Password must be at least 6 characters'}), 400
            updates['password'] = data['password']
        if 'is_superuser' in data:
            updates['is_superuser'] = bool(data['is_superuser'])
        if 'is_active' in data:
            updates['is_active'] = bool(data['is_active'])
        
        if not updates:
            return jsonify({'error': 'No valid fields to update'}), 400
        
        success = update_user(user_id, updates)
        if not success:
            return jsonify({'error': 'Failed to update user'}), 500
        
        user = get_user_by_id(user_id)
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_superuser': user['is_superuser'],
                'is_active': user['is_active']
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to update user: {str(e)}'}), 500

@auth_bp.route('/api/auth/users/<int:user_id>', methods=['DELETE'])
@require_superuser
def delete_user_account(user_id):
    """Delete a user account (superuser only)"""
    try:
        current_user = get_current_user()
        if current_user['id'] == user_id:
            return jsonify({'error': 'Cannot delete your own account'}), 400
        
        user = get_user_by_id(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        delete_user(user_id)
        return jsonify({'success': True, 'message': 'User deleted successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': f'Failed to delete user: {str(e)}'}), 500


# -------------------- Project management --------------------

@auth_bp.route('/api/auth/projects', methods=['GET'])
@require_auth
def list_projects():
    """List projects for current user"""
    try:
        user = get_current_user()
        projects = get_projects_for_user(user['id'])
        return jsonify({'success': True, 'projects': projects}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to list projects: {str(e)}'}), 500


@auth_bp.route('/api/auth/projects', methods=['POST'])
@require_auth
def create_project_route():
    """Create a new project for the current user"""
    try:
        user = get_current_user()
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        details = data.get('details') or {}

        if not name:
            return jsonify({'error': 'Project name is required'}), 400

        project = create_project(user['id'], name, json.dumps(details))
        return jsonify({'success': True, 'project': project}), 201
    except Exception as e:
        return jsonify({'error': f'Failed to create project: {str(e)}'}), 500


@auth_bp.route('/api/auth/projects/<int:project_id>', methods=['PUT'])
@require_auth
def update_project_route(project_id):
    """Update an existing project for the current user"""
    try:
        user = get_current_user()
        data = request.get_json() or {}
        name = data.get('name')
        details = data.get('details')

        # Ensure project exists and belongs to user
        project = get_project_by_id(user['id'], project_id)
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        update_project(
            user['id'],
            project_id,
            name=name.strip() if isinstance(name, str) else None,
            details_json=json.dumps(details) if details is not None else None,
        )

        updated = get_project_by_id(user['id'], project_id)
        return jsonify({'success': True, 'project': updated}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to update project: {str(e)}'}), 500


@auth_bp.route('/api/auth/projects/<int:project_id>', methods=['DELETE'])
@require_auth
def delete_project_route(project_id):
    """Delete a project for the current user"""
    try:
        user = get_current_user()
        project = get_project_by_id(user['id'], project_id)
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        delete_project(user['id'], project_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to delete project: {str(e)}'}), 500

# -------------------- Feature management --------------------

@auth_bp.route('/api/auth/projects/<int:project_id>/features', methods=['GET'])
@require_auth
def list_features(project_id):
    try:
        user = get_current_user()
        if not get_project_by_id(user['id'], project_id):
            return jsonify({'error': 'Project not found'}), 404
        features = get_features_for_project(user['id'], project_id)
        return jsonify({'success': True, 'features': features}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to list features: {str(e)}'}), 500


@auth_bp.route('/api/auth/projects/<int:project_id>/features', methods=['POST'])
@require_auth
def create_feature_route(project_id):
    try:
        user = get_current_user()
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        details = data.get('details') or {}

        if not name:
            return jsonify({'error': 'Feature name is required'}), 400

        if not get_project_by_id(user['id'], project_id):
            return jsonify({'error': 'Project not found'}), 404

        feature = create_feature(user['id'], project_id, name, json.dumps(details))
        if not feature:
            return jsonify({'error': 'Failed to create feature'}), 400
        return jsonify({'success': True, 'feature': feature}), 201
    except Exception as e:
        return jsonify({'error': f'Failed to create feature: {str(e)}'}), 500


@auth_bp.route('/api/auth/projects/<int:project_id>/features/<int:feature_id>', methods=['PUT'])
@require_auth
def update_feature_route(project_id, feature_id):
    try:
        user = get_current_user()
        data = request.get_json() or {}
        name = data.get('name')
        details = data.get('details')

        if not get_feature_by_id(user['id'], project_id, feature_id):
            return jsonify({'error': 'Feature not found'}), 404

        update_feature(
            user['id'],
            project_id,
            feature_id,
            name=name.strip() if isinstance(name, str) else None,
            details_json=json.dumps(details) if details is not None else None,
        )

        updated = get_feature_by_id(user['id'], project_id, feature_id)
        return jsonify({'success': True, 'feature': updated}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to update feature: {str(e)}'}), 500


@auth_bp.route('/api/auth/projects/<int:project_id>/features/<int:feature_id>', methods=['DELETE'])
@require_auth
def delete_feature_route(project_id, feature_id):
    try:
        user = get_current_user()
        if not get_feature_by_id(user['id'], project_id, feature_id):
            return jsonify({'error': 'Feature not found'}), 404
        delete_feature(user['id'], project_id, feature_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to delete feature: {str(e)}'}), 500

# -------------------- Phase submissions (list only for now) --------------------

@auth_bp.route('/api/auth/submissions', methods=['GET'])
@require_auth
def list_submissions():
    """List submissions for current user, optional filtering by project/feature"""
    try:
        user = get_current_user()
        project_id = request.args.get('project_id')
        feature_id = request.args.get('feature_id')
        submissions = list_phase_submissions(
            user['id'],
            project_id=project_id if project_id else None,
            feature_id=feature_id if feature_id else None
        )
        return jsonify({'success': True, 'submissions': submissions}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to list submissions: {str(e)}'}), 500

@auth_bp.route('/api/auth/submissions', methods=['POST'])
@require_auth
def create_submission():
    """Create a phase submission record"""
    try:
        user = get_current_user()
        data = request.get_json() or {}
        phase = data.get('phase', '').strip()
        payload = data.get('payload') or {}
        project_id = data.get('projectId')
        feature_id = data.get('featureId')
        if not phase:
          return jsonify({'error': 'Phase is required'}), 400
        submission_id = create_phase_submission(
            user['id'],
            project_id if project_id else None,
            feature_id if feature_id else None,
            phase,
            json.dumps(payload)
        )
        return jsonify({'success': True, 'id': submission_id}), 201
    except Exception as e:
        return jsonify({'error': f'Failed to save submission: {str(e)}'}), 500

@auth_bp.route('/api/auth/submissions/<int:submission_id>', methods=['DELETE'])
@require_auth
def delete_submission(submission_id):
    try:
        user = get_current_user()
        delete_phase_submission(user['id'], submission_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': f'Failed to delete submission: {str(e)}'}), 500

@auth_bp.route('/api/auth/users/create', methods=['POST'])
@require_superuser
def create_user_by_admin():
    """Create a new user (superuser only)"""
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        is_superuser = data.get('is_superuser', False)
        is_active = data.get('is_active', True)
        
        # Validation
        if not username or len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        
        if not email or '@' not in email:
            return jsonify({'error': 'Valid email is required'}), 400
        
        if not password or len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        # Create user
        user, error = create_user(username, email, password, is_superuser=is_superuser)
        if error:
            return jsonify({'error': error}), 400
        
        # Update active status if needed
        if not is_active:
            update_user(user['id'], {'is_active': False})
            user = get_user_by_id(user['id'])
        
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'is_superuser': user['is_superuser'],
                'is_active': user['is_active']
            }
        }), 201
        
    except Exception as e:
        return jsonify({'error': f'User creation failed: {str(e)}'}), 500
