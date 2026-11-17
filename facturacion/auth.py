"""Autenticación por token Bearer y permisos por rol para las vistas DRF."""
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from . import accounts


class BearerTokenAuthentication(BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if not header:
            return None
        parts = header.split()
        if len(parts) != 2 or parts[0] != self.keyword:
            raise AuthenticationFailed('Encabezado Authorization inválido. Usa "Bearer <token>".')
        session = accounts.lookup_session(parts[1])
        if session is None:
            raise AuthenticationFailed('Sesión inválida o vencida.')
        return (session.usuario, session)

    def authenticate_header(self, request):
        return self.keyword


class ResourcePermission(BasePermission):
    """Único punto de verificación de rol para los recursos genéricos de /api/.

    Si el recurso no es uno de los soportados hoy, deja pasar la solicitud para
    que el controlador responda 404 (igual que antes de existir autenticación);
    no se dispersan chequeos de rol en los controladores."""

    def has_permission(self, request, view):
        # Import diferido: facturacion.services importa facturacion.errors, que
        # importa rest_framework.views; en el nivel de módulo eso crea un ciclo
        # con la carga de DEFAULT_AUTHENTICATION_CLASSES (ver settings.py).
        from .services import RESOURCES
        resource = view.kwargs.get('resource')
        if resource not in RESOURCES:
            return True
        role = getattr(request.user, 'rol', None)
        allowed = accounts.PERMISSIONS.get(resource, {}).get(request.method, frozenset())
        if role not in allowed:
            return False
        fields = accounts.FIELD_RESTRICTIONS.get((resource, role, request.method))
        if fields is not None and isinstance(request.data, dict):
            extra = sorted(set(request.data) - fields)
            if extra:
                self.message = f'No tienes permiso para modificar el campo "{extra[0]}".'
                return False
        return True


class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return getattr(request.user, 'rol', None) == 'administrador'


class RolePermission(BasePermission):
    """Para endpoints que no son un recurso de services.RESOURCES (no tienen
    modelo propio en ese mapa, operan sobre Venta), así que no pasan por
    ResourcePermission; aun así consultan la fila central correspondiente de
    accounts.PERMISSIONS (ya prevista desde la fase de autenticación) en vez
    de fijar el rol en el controlador. Subclases solo fijan `resource`."""
    resource = None

    def has_permission(self, request, view):
        role = getattr(request.user, 'rol', None)
        allowed = accounts.PERMISSIONS.get(self.resource, {}).get(request.method, frozenset())
        return role in allowed


class CorreccionPermission(RolePermission):
    resource = 'correcciones'


class ReembolsoPermission(RolePermission):
    resource = 'reembolsos'


class FaltantePermission(RolePermission):
    resource = 'faltantes'


class ReportePermission(RolePermission):
    resource = 'reportes'
