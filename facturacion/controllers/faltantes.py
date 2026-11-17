from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from facturacion import services
from facturacion.auth import FaltantePermission
from facturacion.serializers import faltante_json


class FaltanteListController(APIView):
    """GET: listado con filtros (tipo, proveedorId, estado, desde, hasta).
    POST: registra un faltante. Ambos roles (ver accounts.PERMISSIONS)."""
    permission_classes = [IsAuthenticated, FaltantePermission]

    def get(self, request):
        filters = services.faltante_filters(request.query_params)
        return Response({'success': True, 'data': [faltante_json(row) for row in services.list_faltantes(filters)]})

    def post(self, request):
        faltante, created = services.create_faltante(request.data, request.user)
        return Response({'success': True, 'data': faltante_json(faltante)}, status=201 if created else 200)


class FaltanteResumenController(APIView):
    """GET: pendientes agrupados por producto (o nombre normalizado) y proveedor."""
    permission_classes = [IsAuthenticated, FaltantePermission]

    def get(self, request):
        filters = services.faltante_filters(request.query_params, resumen=True)
        return Response({'success': True, 'data': services.resumen_faltantes(filters)})


class FaltanteResolverController(APIView):
    """POST: marca el faltante como resuelto (RF-154)."""
    permission_classes = [IsAuthenticated, FaltantePermission]

    def post(self, request, pk):
        return Response({'success': True, 'data': faltante_json(services.resolve_faltante(pk, request.user))})
