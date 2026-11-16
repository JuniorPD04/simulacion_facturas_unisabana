web: python manage.py migrate --noinput && python manage.py seed && gunicorn backend.wsgi:application --bind 0.0.0.0:$PORT
