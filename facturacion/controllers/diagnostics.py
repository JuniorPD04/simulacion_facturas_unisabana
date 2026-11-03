from django.db import connection
from rest_framework.response import Response
from rest_framework.views import APIView
from facturacion.models import RequestLog


class HealthController(APIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute('SHOW server_version')
            version = cursor.fetchone()[0]
        return Response({'success': True, 'data': {'status': 'ok', 'database': 'postgresql', 'version': version}})


class RequestLogsController(APIView):
    def get(self, request):
        rows = list(RequestLog.objects.order_by('-id').values()[:100])
        return Response({'success': True, 'data': rows})


class SanitizationDemoController(APIView):
    def get(self, request):
        # La respuesta del controlador contiene *_id; el middleware los elimina.
        return Response({'success': True, 'data': {'id': 'demo', 'cliente_id': 42,
                        'nested': {'nombre': 'Papel y Luna', 'proveedor_id': 7},
                        'items': [{'producto_id': 1, 'cantidad': 2, 'productoId': 'publico'}]}})
