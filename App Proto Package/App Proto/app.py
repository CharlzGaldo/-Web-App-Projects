# app.py

from flask import Flask, render_template, request, jsonify
from models import db, Jobs, Subjobs, EmployeeJobLog, Employees
from datetime import datetime
from decimal import Decimal, InvalidOperation
from sqlalchemy.orm import joinedload
import config
import traceback
import logging

app = Flask(__name__)
app.config.from_object(config)
db.init_app(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/jobs/search')
def search_jobs():
    q = request.args.get('q', '').strip()
    if not q:
        jobs = Jobs.query.order_by(Jobs.JobName).limit(20).all()
    else:
        search_pattern = f'%{q}%'
        jobs = Jobs.query.filter(
            (Jobs.JobName.ilike(search_pattern)) |
            (db.cast(Jobs.JobID, db.String).ilike(search_pattern))
        ).order_by(Jobs.JobName).limit(20).all()
    return jsonify([{'id': j.JobID, 'name': j.JobName} for j in jobs])

@app.route('/api/jobs/<int:job_id>/subjobs')
def get_subjobs(job_id):
    subjobs = Subjobs.query.filter_by(JobID=job_id).order_by(Subjobs.SubjobName).all()
    return jsonify([{'id': s.SubjobID, 'name': s.SubjobName} for s in subjobs])

@app.route('/api/jobs/<int:job_id>/dates')
def get_job_dates(job_id):
    dates = (
        db.session.query(EmployeeJobLog.WorkDate)
        .filter(EmployeeJobLog.JobID == job_id)
        .distinct()
        .order_by(EmployeeJobLog.WorkDate.desc())
        .all()
    )
    return jsonify([d.WorkDate.strftime('%Y-%m-%d') for d in dates if d.WorkDate])

@app.route('/api/employees')
def get_employees():
    all_employees = Employees.query.order_by(Employees.Name).all()
    
    result = []
    for e in all_employees:
        result.append({
            'id': e.EmployeeID, 
            'name': e.Name,
        })
    
    return jsonify(result)

@app.route('/api/employees/<int:employee_id>')
def get_employee(employee_id):
    employee = Employees.query.get_or_404(employee_id)
    
    return jsonify({
        'id': employee.EmployeeID,
        'name': employee.Name,
    })


@app.route('/api/employees/<int:employee_id>/recent-schedule')
def get_employee_recent_schedule(employee_id):
    """Get most recent schedule entry for an employee to use as template"""
    from sqlalchemy import desc
    
    recent = (
        EmployeeJobLog.query
        .filter_by(EmployeeID=employee_id)
        .order_by(desc(EmployeeJobLog.CreatedAt))
        .first()
    )
    
    if not recent:
        return jsonify(None)
    
    return jsonify({
        'job_id': recent.JobID,
        'subjob_id': recent.SubjobID,
        'subjob_name': recent.subjob.SubjobName if recent.subjob else None,
        'qualified': recent.Qualified,
        'start_time': recent.StartTime.strftime('%H:%M') if recent.StartTime else None,
        'end_time': recent.EndTime.strftime('%H:%M') if recent.EndTime else None,
        'lunch': float(recent.Lunch) if recent.Lunch is not None else 0.5,
        'hours': float(recent.Hours) if recent.Hours is not None else None,
        'ot_hours': float(recent.OTHours) if recent.OTHours is not None else None,
        'description': recent.Description,
        'work_date': recent.WorkDate.strftime('%Y-%m-%d') if recent.WorkDate else None
    })

@app.route('/api/jobs/<int:job_id>/schedules')
def get_schedules(job_id):
    date_str = request.args.get('date', '').strip()
    try:
        work_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    schedules = (
        EmployeeJobLog.query
        .filter_by(JobID=job_id, WorkDate=work_date)
        .options(joinedload(EmployeeJobLog.employee), joinedload(EmployeeJobLog.subjob))
        .order_by(EmployeeJobLog.ScheduleID)
        .all()
    )

    return jsonify({
        'schedules': [
            {
                'schedule_id': str(s.ScheduleID),  # RETURN AS STRING
                'job_id': s.JobID,
                'subjob_id': s.SubjobID,
                'subjob_name': s.subjob.SubjobName if s.subjob else '',
                'employee_id': s.EmployeeID,
                'employee_name': s.employee.Name if s.employee else '',
                'form_id': s.FormID or '',
                'qualified': s.Qualified,
                'start_time': s.StartTime.strftime('%H:%M') if s.StartTime else '',
                'end_time': s.EndTime.strftime('%H:%M') if s.EndTime else '',
                'lunch': float(s.Lunch) if s.Lunch else 0,
                'hours': float(s.Hours) if s.Hours else 0,
                'ot_hours': float(s.OTHours) if s.OTHours else 0,
                'description': s.Description or '',
                'work_date': s.WorkDate.strftime('%Y-%m-%d') if s.WorkDate else '',
            }
            for s in schedules
        ]
    })

@app.route('/api/jobs/<int:job_id>/schedules/range')
def get_schedules_range(job_id):
    start_date_str = request.args.get('start_date', '').strip()
    end_date_str = request.args.get('end_date', '').strip()
    
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    
    if start_date > end_date:
        return jsonify({'error': 'Start date must be before or equal to end date'}), 400

    schedules = (
        EmployeeJobLog.query
        .filter(
            EmployeeJobLog.JobID == job_id,
            EmployeeJobLog.WorkDate >= start_date,
            EmployeeJobLog.WorkDate <= end_date
        )
        .options(joinedload(EmployeeJobLog.employee), joinedload(EmployeeJobLog.subjob))
        .order_by(EmployeeJobLog.WorkDate, EmployeeJobLog.ScheduleID)
        .all()
    )

    return jsonify({
        'schedules': [
            {
                'schedule_id': str(s.ScheduleID),  # RETURN AS STRING
                'job_id': s.JobID,
                'subjob_id': s.SubjobID,
                'subjob_name': s.subjob.SubjobName if s.subjob else '',
                'employee_id': s.EmployeeID,
                'employee_name': s.employee.Name if s.employee else '',
                'form_id': s.FormID or '',
                'qualified': s.Qualified,
                'start_time': s.StartTime.strftime('%H:%M') if s.StartTime else '',
                'end_time': s.EndTime.strftime('%H:%M') if s.EndTime else '',
                'lunch': float(s.Lunch) if s.Lunch else 0,
                'hours': float(s.Hours) if s.Hours else 0,
                'ot_hours': float(s.OTHours) if s.OTHours else 0,
                'description': s.Description or '',
                'work_date': s.WorkDate.strftime('%Y-%m-%d') if s.WorkDate else '',
            }
            for s in schedules
        ],
        'start_date': start_date_str,
        'end_date': end_date_str,
        'count': len(schedules)
    })

def parse_time(val):
    if not val or not isinstance(val, str):
        return None
    val = val.strip()
    if not val:
        return None
    for fmt in ('%H:%M:%S', '%H:%M'):
        try:
            return datetime.strptime(val, fmt).time()
        except ValueError:
            continue
    return None

def safe_decimal(val, default='0'):
    if val is None or val == '':
        return Decimal(default)
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)

def schedule_to_dict(s):
    return {
        'employee_id': s.EmployeeID,
        'subjob_id': s.SubjobID,
        'form_id': s.FormID or '',
        'qualified': s.Qualified,
        'start_time': s.StartTime.strftime('%H:%M') if s.StartTime else '',
        'end_time': s.EndTime.strftime('%H:%M') if s.EndTime else '',
        'lunch': float(s.Lunch) if s.Lunch else 0.0,
        'hours': float(s.Hours) if s.Hours else 0.0,
        'ot_hours': float(s.OTHours) if s.OTHours else 0.0,
        'description': s.Description or '',
        'work_date': s.WorkDate.strftime('%Y-%m-%d') if s.WorkDate else '',
    }

def row_to_comparable_dict(row):
    start_time = parse_time(row.get('start_time'))
    end_time = parse_time(row.get('end_time'))
    
    row_work_date = row.get('work_date', '')
    if row_work_date:
        try:
            parsed_date = datetime.strptime(row_work_date, '%Y-%m-%d').date()
            row_work_date = parsed_date.strftime('%Y-%m-%d')
        except ValueError:
            row_work_date = ''
    
    return {
        'employee_id': int(row['employee_id']) if row.get('employee_id') else None,
        'subjob_id': int(row['subjob_id']) if row.get('subjob_id') and str(row['subjob_id']).strip() else None,
        'form_id': str(row.get('form_id', '')).strip(),
        'qualified': bool(row.get('qualified', False)),
        'start_time': start_time.strftime('%H:%M') if start_time else '',
        'end_time': end_time.strftime('%H:%M') if end_time else '',
        'lunch': float(safe_decimal(row.get('lunch'), '0')),
        'hours': float(safe_decimal(row.get('hours'), '0')),
        'ot_hours': float(safe_decimal(row.get('ot_hours'), '0')),
        'description': str(row.get('description', '')).strip(),
        'work_date': row_work_date,
    }

def has_changes(current_data, new_data):
    for key in current_data:
        if key not in new_data:
            return True
        old_val = current_data[key]
        new_val = new_data[key]
        
        if isinstance(old_val, float) and isinstance(new_val, float):
            if abs(old_val - new_val) > 0.001:
                return True
        elif old_val != new_val:
            return True
    return False

@app.route('/api/jobs/<int:job_id>/schedules/save', methods=['POST'])
def save_schedules(job_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No JSON data provided'}), 400
        
    date_str = data.get('date', '')
    rows = data.get('rows', [])

    if not isinstance(rows, list):
        return jsonify({'error': 'Rows must be an array'}), 400
        
    if not rows:
        return jsonify({'error': 'No rows provided'}), 400

    try:
        work_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

    updated = 0
    created = 0
    unchanged = 0
    errors = []
    processed_ids = set()
    has_modifications = False

    for idx, row in enumerate(rows):
        try:
            if not row.get('employee_id'):
                errors.append(f'Row {idx + 1}: Missing employee_id')
                continue

            # Handle schedule_id as string or int
            sid = row.get('schedule_id')
            is_new = True
            existing_schedule = None
            
            if sid and str(sid).strip():
                try:
                    sid_int = int(sid)  # Convert string to int for DB lookup
                    if sid_int > 0:
                        if sid_int in processed_ids:
                            errors.append(f'Row {idx + 1}: Duplicate schedule_id {sid_int}')
                            continue
                        processed_ids.add(sid_int)
                        
                        existing_schedule = EmployeeJobLog.query.get(sid_int)
                        if not existing_schedule:
                            errors.append(f'Row {idx + 1}: ScheduleID {sid_int} not found')
                            continue
                        if existing_schedule.JobID != job_id:
                            errors.append(f'Row {idx + 1}: ScheduleID {sid_int} belongs to different job')
                            continue
                        is_new = False
                except (ValueError, TypeError):
                    pass

            if is_new:
                s = EmployeeJobLog()
                s.JobID = job_id
                s.WorkDate = work_date
                db.session.add(s)
                created += 1
                has_modifications = True
            else:
                current_data = schedule_to_dict(existing_schedule)
                new_data = row_to_comparable_dict(row)
                
                if not has_changes(current_data, new_data):
                    unchanged += 1
                    continue
                
                s = existing_schedule
                updated += 1
                has_modifications = True

            s.EmployeeID = int(row['employee_id'])
            
            subjob_id = row.get('subjob_id')
            s.SubjobID = int(subjob_id) if subjob_id and str(subjob_id).strip() else None
            
            form_id = row.get('form_id')
            s.FormID = str(form_id).strip() if form_id else None
            
            s.Qualified = bool(row.get('qualified', False))
            s.StartTime = parse_time(row.get('start_time'))
            s.EndTime = parse_time(row.get('end_time'))
            
            s.Lunch = safe_decimal(row.get('lunch'), '0')
            s.Hours = safe_decimal(row.get('hours'), '0')
            s.OTHours = safe_decimal(row.get('ot_hours'), '0')
            
            desc = row.get('description')
            s.Description = str(desc).strip() if desc else None
            
            row_work_date = row.get('work_date')
            if row_work_date:
                try:
                    s.WorkDate = datetime.strptime(row_work_date, '%Y-%m-%d').date()
                except ValueError:
                    pass

        except Exception as e:
            errors.append(f'Row {idx + 1}: {str(e)}')
            logger.error(f"Error processing row {idx + 1}: {traceback.format_exc()}")

    if not has_modifications:
        return jsonify({
            'updated': 0, 
            'created': 0,
            'unchanged': unchanged,
            'errors': errors,
            'success': len(errors) == 0,
            'message': 'No changes detected'
        })

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"Database commit error: {traceback.format_exc()}")
        return jsonify({
            'updated': updated, 
            'created': created,
            'unchanged': unchanged,
            'errors': errors + [f'Database error: {str(e)}'],
            'success': False
        }), 500

    return jsonify({
        'updated': updated, 
        'created': created,
        'unchanged': unchanged,
        'errors': errors,
        'success': len(errors) == 0
    })

@app.route('/api/schedules/<int:schedule_id>', methods=['DELETE'])
def delete_schedule(schedule_id):
    s = EmployeeJobLog.query.get_or_404(schedule_id)
    try:
        db.session.delete(s)
        db.session.commit()
        return jsonify({'deleted': schedule_id, 'success': True})
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting schedule: {traceback.format_exc()}")
        return jsonify({'error': str(e), 'success': False}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, host='0.0.0.0', port=5000)