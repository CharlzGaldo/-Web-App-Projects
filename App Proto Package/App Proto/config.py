SQLALCHEMY_DATABASE_URI = (
    "mssql+pyodbc://@CHARLZ\\SQLEXPRESS/FlaskAppDB"
    "?driver=ODBC+Driver+17+for+SQL+Server"
    "&trusted_connection=yes"
    "&TrustServerCertificate=yes"
)
SQLALCHEMY_TRACK_MODIFICATIONS = False