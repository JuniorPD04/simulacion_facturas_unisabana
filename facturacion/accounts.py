"""Autenticación por sesión, y el único mapa de permisos recurso+método -> roles.

No se usa django.contrib.auth: solo sus hashers (ver models.Usuario), que no
requieren esa app instalada. Las fases siguientes (reportes) solo deben
agregar/ajustar filas en PERMISSIONS; no crear nuevas comprobaciones de rol
dispersas en los controladores.
"""
import os
import secrets
from datetime import timedelta
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from .models import Sesion, Usuario

SESSION_TTL_HOURS = int(os.getenv('SESSION_TTL_HOURS', '12'))

ADMIN = frozenset({'administrador'})
CAJERO = frozenset({'cajero'})
ROLES = ADMIN | CAJERO

# recurso -> método HTTP -> roles permitidos.
# 'reportes' todavia no tiene modelo ni controlador (fase siguiente); queda
# lista para cuando se agregue, sin tocar este mapa de nuevo.
PERMISSIONS = {
    'categorias': {'GET': ROLES, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ADMIN, 'DELETE': ADMIN},
    'clientes': {'GET': ROLES, 'POST': ROLES, 'PUT': ROLES, 'PATCH': ROLES, 'DELETE': ROLES},
    # El cajero solo necesita leer proveedores para elegirlos/filtrarlos al
    # registrar un faltante (3.7); no crea, edita ni elimina, y el modulo de
    # Proveedores sigue sin aparecer en su menu (ver js/store.js y el README).
    'proveedores': {'GET': ROLES, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ADMIN, 'DELETE': ADMIN},
    'productos': {'GET': ROLES, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ROLES, 'DELETE': ADMIN},
    'ventas': {'GET': ROLES, 'POST': ROLES, 'PUT': ROLES, 'PATCH': ROLES, 'DELETE': ROLES},
    'compras': {'GET': ADMIN, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ADMIN, 'DELETE': ADMIN},
    'descuentos': {'GET': ROLES, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ADMIN, 'DELETE': ADMIN},
    'correcciones': {'GET': ADMIN, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ADMIN, 'DELETE': ADMIN},
    'reembolsos': {'GET': ADMIN, 'POST': ADMIN, 'PUT': ADMIN, 'PATCH': ADMIN, 'DELETE': ADMIN},
    'reportes': {'GET': ADMIN},
    'faltantes': {'GET': ROLES, 'POST': ROLES, 'PUT': ROLES, 'PATCH': ROLES, 'DELETE': ROLES},
}

# (recurso, rol, método) -> únicos campos de body permitidos, para roles con
# acceso ya concedido en PERMISSIONS pero restringido a un subconjunto de
# campos. 'id' siempre se permite: identifica el registro, no lo modifica.
# El cajero solo tiene el formulario rápido de "edición en caliente" desde la
# venta (nombre, categoría, precio, costo); el stock SOLO cambia por ventas,
# compras, correcciones y reembolsos, nunca por esta vía.
FIELD_RESTRICTIONS = {
    ('productos', 'cajero', 'PATCH'): frozenset({'id', 'nombre', 'categoriaId', 'precio', 'costo'}),
}


def authenticate(usuario_nombre, contrasena):
    usuario = Usuario.objects.filter(usuario__iexact=usuario_nombre).first()
    if usuario is None or not usuario.check_password(contrasena):
        raise AuthenticationFailed('Usuario o contraseña incorrectos.')
    return usuario


def create_session(usuario):
    token = secrets.token_urlsafe(32)
    expira_en = timezone.now() + timedelta(hours=SESSION_TTL_HOURS)
    return Sesion.objects.create(token=token, usuario=usuario, expira_en=expira_en)


def lookup_session(token):
    """Sesión vigente para ese token, o None. Usado por la autenticación DRF
    y por RequestLoggingMiddleware; es de solo lectura a propósito."""
    if not token:
        return None
    session = Sesion.objects.select_related('usuario').filter(pk=token).first()
    if session is None or session.expira_en <= timezone.now():
        return None
    return session


def revoke_session(session):
    if session is not None:
        session.delete()
