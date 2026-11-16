import os
import secrets
import urllib.parse
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

# DEBUG es False por defecto: un despliegue que olvide fijar la variable queda
# seguro. El flujo local sigue igual porque .env.example ya trae DJANGO_DEBUG=true.
DEBUG = os.getenv('DJANGO_DEBUG', 'false').lower() == 'true'

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY')
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured(
            'DJANGO_SECRET_KEY es obligatoria cuando DJANGO_DEBUG no es true (despliegue). '
            'Define la variable de entorno antes de iniciar el servidor.'
        )
    SECRET_KEY = secrets.token_urlsafe(48)  # Solo desarrollo: efimera entre reinicios.

ALLOWED_HOSTS = os.getenv('DJANGO_ALLOWED_HOSTS', '127.0.0.1,localhost,testserver').split(',')

INSTALLED_APPS = ['corsheaders', 'rest_framework', 'facturacion']
MIDDLEWARE = [
    'facturacion.middleware.RequestLoggingMiddleware',
    'facturacion.middleware.SanitizeIdsMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
]
ROOT_URLCONF = 'backend.urls'
WSGI_APPLICATION = 'backend.wsgi.application'


def _database_config():
    """DATABASE_URL (Render/Railway/Fly, etc.) si existe; si no, las variables
    DB_* actuales, para que "py run.py" en local no cambie de comportamiento."""
    options = {'connect_timeout': 5}
    sslmode = os.getenv('DB_SSLMODE')
    if sslmode:
        options['sslmode'] = sslmode
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME', 'papel_y_luna'),
            'USER': os.getenv('DB_USER', 'postgres'),
            'PASSWORD': os.getenv('DB_PASSWORD', ''),
            'HOST': os.getenv('DB_HOST', '127.0.0.1'),
            'PORT': os.getenv('DB_PORT', '5432'),
            'OPTIONS': options,
        }
    parsed = urllib.parse.urlparse(database_url)
    query = dict(urllib.parse.parse_qsl(parsed.query))
    if query.get('sslmode'):
        options['sslmode'] = query['sslmode']
    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': parsed.path.lstrip('/'),
        'USER': urllib.parse.unquote(parsed.username or ''),
        'PASSWORD': urllib.parse.unquote(parsed.password or ''),
        'HOST': parsed.hostname,
        'PORT': str(parsed.port or '5432'),
        'OPTIONS': options,
    }


DATABASES = {'default': _database_config()}

# Autenticacion por token en Authorization: no hay cookies de sesion ni de
# CSRF (CsrfViewMiddleware ni siquiera esta en MIDDLEWARE), asi que CORS solo
# necesita permitir el origen; no hace falta CORS_ALLOW_CREDENTIALS ni
# CSRF_TRUSTED_ORIGINS. 'Authorization' ya esta en los headers por defecto de
# django-cors-headers.
CORS_ALLOWED_ORIGINS = [o.strip() for o in os.getenv('CORS_ALLOWED_ORIGINS', '').split(',') if o.strip()]

# Detras de un proxy TLS (Render, Railway, Fly): permite que request.is_secure()
# reporte https aunque gunicorn reciba la conexion interna en http.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['facturacion.auth.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'EXCEPTION_HANDLER': 'facturacion.errors.exception_handler',
    'UNAUTHENTICATED_USER': None,
}
LANGUAGE_CODE = 'es'
TIME_ZONE = 'America/Bogota'
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LOGGING = {'version': 1, 'disable_existing_loggers': False,
           'handlers': {'console': {'class': 'logging.StreamHandler'}},
           'loggers': {'facturacion.requests': {'handlers': ['console'], 'level': 'INFO'}}}
