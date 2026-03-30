# models.py

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Employees(db.Model):
    __tablename__ = 'Employees'
    EmployeeID = db.Column(db.Integer, primary_key=True)
    Name = db.Column(db.String(100), nullable=False)
    
    # New columns (formerly in EmployeeInformation)
    MainSubjobID = db.Column(db.Integer, db.ForeignKey('Subjobs.SubjobID'))
    StartTime = db.Column(db.Time)
    EndTime = db.Column(db.Time)
    WorkDays = db.Column(db.String(20))
    PhoneNumber = db.Column(db.String(20))
    
    # Relationships
    schedules = db.relationship('EmployeeJobLog', foreign_keys='EmployeeJobLog.EmployeeID', backref='employee')
    main_subjob = db.relationship('Subjobs', foreign_keys=[MainSubjobID])
    

class EmployeeTimeClock(db.Model):
    __tablename__ = 'EmployeeTimeClock'
    
    TimeClockID = db.Column(db.Integer, primary_key=True)
    EmployeeID = db.Column(db.Integer, db.ForeignKey('Employees.EmployeeID'), nullable=False)
    WorkDate = db.Column(db.Date, nullable=False)
    ClockInTime = db.Column(db.DateTime)
    ClockOutTime = db.Column(db.DateTime)
    
    employee = db.relationship('Employees', backref='time_clocks')

class Jobs(db.Model):
    __tablename__ = 'Jobs'
    JobID = db.Column(db.Integer, primary_key=True)
    JobName = db.Column(db.String(200), nullable=False)
    
    # Relationships
    subjobs = db.relationship('Subjobs', backref='job', lazy=True)
    schedules = db.relationship('EmployeeJobLog', backref='job', lazy=True)

class Subjobs(db.Model):
    __tablename__ = 'Subjobs'
    SubjobID = db.Column(db.Integer, primary_key=True)
    JobID = db.Column(db.Integer, db.ForeignKey('Jobs.JobID'), nullable=False)
    SubjobName = db.Column(db.String(200), nullable=False)
    
    # Relationships
    schedules = db.relationship('EmployeeJobLog', backref='subjob', lazy=True)

class EmployeeJobLog(db.Model):
    __tablename__ = 'EmployeeJobLog'
    ScheduleID = db.Column(db.Integer, primary_key=True)
    JobID = db.Column(db.Integer, db.ForeignKey('Jobs.JobID'), nullable=False)
    SubjobID = db.Column(db.Integer, db.ForeignKey('Subjobs.SubjobID'))
    EmployeeID = db.Column(db.Integer, db.ForeignKey('Employees.EmployeeID'), nullable=False)
    WorkDate = db.Column(db.Date, nullable=False)
    FormID = db.Column(db.String(50))
    Qualified = db.Column(db.Boolean, default=False)
    StartTime = db.Column(db.Time)
    EndTime = db.Column(db.Time)
    Lunch = db.Column(db.Numeric(4,2), default=0)
    Hours = db.Column(db.Numeric(4,2), default=0)
    OTHours = db.Column(db.Numeric(4,2), default=0)
    Description = db.Column(db.String(500))
    CreatedAt = db.Column(db.DateTime, server_default=db.func.now())
    UpdatedAt = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())