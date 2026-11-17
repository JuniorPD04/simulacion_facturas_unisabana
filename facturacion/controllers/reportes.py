from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from facturacion import services
from facturacion.auth import ReportePermission
from facturacion.validators import ReporteRangoValidator, ReporteTopValidator, ReporteFaltantesValidator


class ReporteController(APIView):
    """Base de los reportes (3.10): solo lectura y solo administrador
    (accounts.PERMISSIONS['reportes']). Los filtros llegan como parametros de
    consulta y se validan; uno invalido responde 400."""
    permission_classes = [IsAuthenticated, ReportePermission]
    validator = None
    build = None

    def get(self, request):
        filters = services.reporte_filters(request.query_params, self.validator)
        return Response({'success': True, 'data': type(self).build(filters)})


class ReporteVentasController(ReporteController):
    validator = ReporteRangoValidator
    build = staticmethod(services.reporte_ventas)


class ReporteProductosMasVendidosController(ReporteController):
    validator = ReporteTopValidator
    build = staticmethod(services.reporte_productos_mas_vendidos)


class ReporteComprasController(ReporteController):
    validator = ReporteRangoValidator
    build = staticmethod(services.reporte_compras)


class ReporteFaltantesController(ReporteController):
    validator = ReporteFaltantesValidator
    build = staticmethod(services.reporte_faltantes_frecuentes)
