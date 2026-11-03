import ipaddress
import json
import logging
from django.http import JsonResponse
from django.db import DatabaseError
from .models import RequestLog

logger = logging.getLogger('facturacion.requests')


class RequestLoggingMiddleware:
    """Preprocesamiento: persiste cada llamada antes del controlador."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        ip = request.META.get('REMOTE_ADDR')
        try:
            ip = str(ipaddress.ip_address(ip))
        except ValueError:
            ip = None
        logger.info('%s %s ip=%s', request.method, request.path, ip)
        try:
            RequestLog.objects.create(method=request.method, path=request.path[:255], ip=ip)
        except DatabaseError:
            logger.exception('No se pudo registrar la solicitud')
            return JsonResponse({'success': False, 'message': 'Base de datos no disponible.'}, status=503)
        return self.get_response(request)


class SanitizeIdsMiddleware:
    """Postprocesamiento: elimina claves *_id de objetos y listas anidados."""
    def __init__(self, get_response):
        self.get_response = get_response

    @classmethod
    def strip_ids(cls, value):
        if isinstance(value, dict):
            return {k: cls.strip_ids(v) for k, v in value.items() if not k.endswith('_id')}
        if isinstance(value, list):
            return [cls.strip_ids(item) for item in value]
        return value

    def __call__(self, request):
        response = self.get_response(request)
        if not response.streaming and response.get('Content-Type', '').startswith('application/json'):
            try:
                cleaned = self.strip_ids(json.loads(response.content))
                response.content = json.dumps(cleaned, ensure_ascii=False, allow_nan=False).encode('utf-8')
                if 'Content-Length' in response:
                    response['Content-Length'] = len(response.content)
            except (ValueError, TypeError, UnicodeDecodeError):
                pass
        return response
