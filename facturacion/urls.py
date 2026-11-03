from django.urls import path
from .controllers.resources import ResourceListController, ResourceDetailController
from .controllers.diagnostics import HealthController, RequestLogsController, SanitizationDemoController

urlpatterns = [
    path('health/', HealthController.as_view()),
    path('request-logs/', RequestLogsController.as_view()),
    path('demo/sanitizacion/', SanitizationDemoController.as_view()),
    path('<str:resource>/', ResourceListController.as_view()),
    path('<str:resource>/<uuid:pk>/', ResourceDetailController.as_view()),
]
