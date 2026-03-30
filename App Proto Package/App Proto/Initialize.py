# Initiate.py
from flask import Flask
from models import db, Employees, Jobs, Subjobs, EmployeeJobLog, EmployeeTimeClock, EmployeeQualification

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'your_connection_string_here'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

def create_database():
    with app.app_context():
        # Create all tables from models
        db.create_all()
        print("All tables created successfully!")
        
        # Verify tables exist
        from sqlalchemy import inspect
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()
        print(f"Tables: {tables}")

if __name__ == '__main__':
    create_database()