from django.urls import path
from .controllers.auth import LoginController, LogoutController, MeController
from .controllers.resources import ResourceListController, ResourceDetailController
from .controllers.diagnostics import HealthController, RequestLogsController, SanitizationDemoController
from .controllers.ventas import CorregirVentaController, ReembolsarVentaController
from .controllers.reportes import (ReporteVentasController, ReporteProductosMasVendidosController,
                                   ReporteComprasController, ReporteFaltantesController)
from .controllers.faltantes import FaltanteListController, FaltanteResumenController, FaltanteResolverController

urlpatterns = [
    path('health/', HealthController.as_view()),
    path('request-logs/', RequestLogsController.as_view()),
    path('demo/sanitizacion/', SanitizationDemoController.as_view()),
    path('auth/login/', LoginController.as_view()),
    path('auth/logout/', LogoutController.as_view()),
    path('auth/me/', MeController.as_view()),
    path('ventas/<uuid:pk>/corregir/', CorregirVentaController.as_view()),
    path('ventas/<uuid:pk>/reembolsos/', ReembolsarVentaController.as_view()),
    path('faltantes/', FaltanteListController.as_view()),
    path('faltantes/resumen/', FaltanteResumenController.as_view()),
    path('faltantes/<uuid:pk>/resolver/', FaltanteResolverController.as_view()),
    path('reportes/ventas/', ReporteVentasController.as_view()),
    path('reportes/productos-mas-vendidos/', ReporteProductosMasVendidosController.as_view()),
    path('reportes/compras/', ReporteComprasController.as_view()),
    path('reportes/faltantes/', ReporteFaltantesController.as_view()),
    path('<str:resource>/', ResourceListController.as_view()),
    path('<str:resource>/<uuid:pk>/', ResourceDetailController.as_view()),
]
