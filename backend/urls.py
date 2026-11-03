from django.urls import include, path, re_path
from django.views.static import serve
from django.conf import settings

urlpatterns = [
    path('api/', include('facturacion.urls')),
    path('', serve, {'path': 'index.html', 'document_root': settings.BASE_DIR}),
    # Lista explícita: nunca exponer .env, código backend o archivos SQL.
    *[re_path(r'^' + folder + r'/(?P<path>.+)$', serve,
              {'document_root': settings.BASE_DIR / folder}) for folder in ('js', 'css', 'assets')],
]
